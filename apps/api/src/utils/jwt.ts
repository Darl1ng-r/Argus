/**
 * JWT & Refresh Token Manager for Argus Native Authentication.
 *
 * Implements:
 *  - Short-lived Access Tokens (15 minutes) signed with HMAC-SHA256 (JWT_SECRET).
 *  - Rotating Refresh Tokens (7 days) with Token Family tracking and Reuse Detection in Redis.
 *  - Access Token Blacklisting upon logout (`bl:token:{jti}`).
 *  - Global session revocation for user account deactivation.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { redisClient } from '../redis.js';

const JWT_SECRET = process.env.JWT_SECRET || 'argus_dev_secret_jwt_CHANGE_IN_PRODUCTION';
const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

export interface ArgusTokenPayload {
  sub: string;       // user ID
  username: string;
  jti: string;       // unique token ID for blacklisting
  familyId?: string; // refresh token family ID
  type?: 'access';
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // in seconds (for access token)
}

interface StoredRefreshToken {
  userId: string;
  username: string;
  familyId: string;
  createdAt: number;
}

/** Signs a 15-minute Access Token */
export function signAccessToken(userId: string, username: string, familyId?: string): string {
  const jti = `${userId}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  return jwt.sign(
    { sub: userId, username, jti, familyId, type: 'access' },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL_SEC }
  );
}

/** Verifies an Access Token and returns payload */
export function verifyArgusToken(token: string): ArgusTokenPayload {
  return jwt.verify(token, JWT_SECRET) as ArgusTokenPayload;
}

/**
 * Creates a cryptographically secure token pair (Access Token + Refresh Token).
 * Initializes or continues a Token Family in Redis for rotation tracking.
 */
export async function createTokenPair(
  userId: string,
  username: string,
  existingFamilyId?: string
): Promise<TokenPair> {
  const familyId = existingFamilyId || `fam_${userId}_${crypto.randomBytes(12).toString('hex')}`;
  const refreshToken = `rt_${crypto.randomBytes(36).toString('hex')}`;
  const accessToken = signAccessToken(userId, username, familyId);

  if (redisClient) {
    try {
      const data: StoredRefreshToken = {
        userId,
        username,
        familyId,
        createdAt: Date.now(),
      };

      const pipeline = redisClient.pipeline();
      // Store the active refresh token
      pipeline.setex(`rf:token:${refreshToken}`, REFRESH_TOKEN_TTL_SEC, JSON.stringify(data));
      // Track within user's family set
      pipeline.sadd(`rf:family:${familyId}`, refreshToken);
      pipeline.expire(`rf:family:${familyId}`, REFRESH_TOKEN_TTL_SEC + 3600);
      // Track families for this user (for global logout/deactivation)
      pipeline.sadd(`rf:user_families:${userId}`, familyId);
      pipeline.expire(`rf:user_families:${userId}`, REFRESH_TOKEN_TTL_SEC + 3600);

      await pipeline.exec();
    } catch (err) {
      // In case of Redis degradation, token is returned but rotation is best-effort
    }
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
  };
}

/**
 * Rotates a refresh token:
 *  - Validates old token.
 *  - Invalidates old token.
 *  - Issues fresh Access Token + fresh Refresh Token in the same family.
 *  - REUSE DETECTION: If a previously rotated token is reused, revokes the entire family!
 */
export async function rotateRefreshToken(oldRefreshToken: string): Promise<{
  tokens: TokenPair;
  user: { id: string; username: string };
} | null> {
  if (!redisClient) {
    return null;
  }

  try {
    const raw = await redisClient.get(`rf:token:${oldRefreshToken}`);

    // Check for REUSE of an already-used refresh token (Compromise / Replay Attack)
    if (!raw) {
      const wasUsed = await redisClient.get(`rf:used:${oldRefreshToken}`);
      if (wasUsed) {
        // Reuse detected! Revoke the entire token family immediately
        const familyId = wasUsed;
        await revokeTokenFamily(familyId);
        throw new Error('SECURITY_ALERT_REFRESH_TOKEN_REUSE_DETECTED');
      }
      return null;
    }

    const data: StoredRefreshToken = JSON.parse(raw);
    const { userId, username, familyId } = data;

    // Invalidate old token and mark as 'used' (kept for 2 minutes to detect double-spend)
    const pipeline = redisClient.pipeline();
    pipeline.del(`rf:token:${oldRefreshToken}`);
    pipeline.srem(`rf:family:${familyId}`, oldRefreshToken);
    pipeline.setex(`rf:used:${oldRefreshToken}`, 120, familyId);
    await pipeline.exec();

    // Issue new pair under the same family
    const tokens = await createTokenPair(userId, username, familyId);

    return {
      tokens,
      user: { id: userId, username },
    };
  } catch (err: any) {
    if (err.message === 'SECURITY_ALERT_REFRESH_TOKEN_REUSE_DETECTED') {
      throw err;
    }
    return null;
  }
}

/** Revokes an entire token family (used on logout or replay attack detection) */
export async function revokeTokenFamily(familyId: string): Promise<void> {
  if (!redisClient) return;
  try {
    const tokens = await redisClient.smembers(`rf:family:${familyId}`);
    if (tokens && tokens.length > 0) {
      const pipeline = redisClient.pipeline();
      for (const t of tokens) {
        pipeline.del(`rf:token:${t}`);
      }
      pipeline.del(`rf:family:${familyId}`);
      await pipeline.exec();
    }
  } catch {
    // Ignore Redis errors
  }
}

/** Revokes all refresh tokens and families for a user (used on account deactivation / global logout) */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  if (!redisClient) return;
  try {
    const families = await redisClient.smembers(`rf:user_families:${userId}`);
    if (families && families.length > 0) {
      for (const f of families) {
        await revokeTokenFamily(f);
      }
      await redisClient.del(`rf:user_families:${userId}`);
    }
  } catch {
    // Ignore Redis errors
  }
}

/** Adds an access token's jti to the Redis blacklist until its natural expiry */
export async function blacklistToken(jti: string, expiresAt: number): Promise<void> {
  if (!redisClient) return;
  const ttl = Math.max(1, Math.ceil((expiresAt * 1000 - Date.now()) / 1000));
  try {
    await redisClient.setex(`bl:token:${jti}`, ttl, '1');
  } catch {
    // Ignore Redis errors — token will expire naturally
  }
}

/** Returns true if the jti is on the Redis blacklist (i.e. logged out) */
export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  if (!redisClient) return false;
  try {
    const val = await redisClient.get(`bl:token:${jti}`);
    return val === '1';
  } catch {
    return false;
  }
}
