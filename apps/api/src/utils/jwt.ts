/**
 * JWT utility for Argus native authentication.
 * Issues and verifies signed JWTs using JWT_SECRET.
 * Supports Redis-based token blacklisting for logout.
 */

import jwt from 'jsonwebtoken';
import { redisClient } from '../redis.js';

const JWT_SECRET = process.env.JWT_SECRET || 'argus_dev_secret_jwt_CHANGE_IN_PRODUCTION';
const JWT_EXPIRES_IN = '7d';

export interface ArgusTokenPayload {
  sub: string;       // user ID
  username: string;
  jti: string;       // unique token ID for blacklisting
  iat?: number;
  exp?: number;
}

/** Signs a JWT for the given user. Returns the token string. */
export function signToken(userId: string, username: string): string {
  const jti = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return jwt.sign({ sub: userId, username, jti }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/** Verifies a JWT and returns the payload. Throws on invalid/expired token. */
export function verifyArgusToken(token: string): ArgusTokenPayload {
  return jwt.verify(token, JWT_SECRET) as ArgusTokenPayload;
}

/** Adds a token's jti to the Redis blacklist until its natural expiry. */
export async function blacklistToken(jti: string, expiresAt: number): Promise<void> {
  if (!redisClient) return;
  const ttl = Math.max(1, Math.ceil((expiresAt * 1000 - Date.now()) / 1000));
  try {
    await redisClient.setex(`bl:token:${jti}`, ttl, '1');
  } catch {
    // Ignore Redis errors — token will expire naturally
  }
}

/** Returns true if the jti is on the Redis blacklist (i.e. logged out). */
export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  if (!redisClient) return false;
  try {
    const val = await redisClient.get(`bl:token:${jti}`);
    return val === '1';
  } catch {
    return false;
  }
}
