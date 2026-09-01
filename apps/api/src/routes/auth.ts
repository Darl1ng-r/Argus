/**
 * Argus Authentication Routes
 * Real PostgreSQL + Redis-backed user auth using bcrypt + rotating JWT tokens.
 *
 * Security Features:
 *  - Short-lived Access Tokens (15 min) + Rotating Refresh Tokens (7 days).
 *  - Replay & Reuse Detection for Refresh Tokens (revokes token family on double-spend).
 *  - Account-level brute-force lockout protection in Redis (5 failed attempts -> 15 min lock).
 *  - GDPR Right-to-be-Forgotten / Account De-identification protocol.
 *  - Password strength complexity checks & rate limiting.
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db.js';
import { redisClient } from '../redis.js';
import {
  createTokenPair,
  rotateRefreshToken,
  revokeTokenFamily,
  revokeAllUserTokens,
  blacklistToken,
  verifyArgusToken,
} from '../utils/jwt.js';
import { validatePasswordStrength, ValidationError } from '../utils/sanitizer.js';
import { authBruteForceLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_TTL_SEC = 15 * 60; // 15 minutes

// ─── Redis Helpers ──────────────────────────────────────────────────────────

async function setRedis(key: string, value: unknown, ttlSeconds: number) {
  if (!redisClient) return;
  await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
}

async function getRedis<T>(key: string): Promise<T | null> {
  if (!redisClient) return null;
  try {
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function delRedis(key: string) {
  if (!redisClient) return;
  try { await redisClient.del(key); } catch { /* ignore */ }
}

// ─── Brute-Force Account Lockout Protections ────────────────────────────────

async function checkAccountLockout(identifier: string): Promise<{ locked: boolean; remainingSec?: number }> {
  if (!redisClient) return { locked: false };
  try {
    const cleanId = identifier.trim().toLowerCase();
    const ttl = await redisClient.ttl(`lockout:${cleanId}`);
    if (ttl > 0) {
      return { locked: true, remainingSec: ttl };
    }
  } catch {
    // Ignore Redis errors
  }
  return { locked: false };
}

async function recordFailedLoginAttempt(identifier: string): Promise<{ locked: boolean }> {
  if (!redisClient) return { locked: false };
  try {
    const cleanId = identifier.trim().toLowerCase();
    const key = `failed_logins:${cleanId}`;
    const attempts = await redisClient.incr(key);

    if (attempts === 1) {
      await redisClient.expire(key, LOCKOUT_TTL_SEC);
    }

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      await redisClient.setex(`lockout:${cleanId}`, LOCKOUT_TTL_SEC, '1');
      await redisClient.del(key);
      return { locked: true };
    }
  } catch {
    // Ignore Redis errors
  }
  return { locked: false };
}

async function clearFailedLoginAttempts(identifier: string): Promise<void> {
  if (!redisClient) return;
  try {
    const cleanId = identifier.trim().toLowerCase();
    await redisClient.del(`failed_logins:${cleanId}`);
    await redisClient.del(`lockout:${cleanId}`);
  } catch {
    // Ignore Redis errors
  }
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, confirmPassword } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Full name is required.' }); return;
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'A valid email address is required.' }); return;
    }

    validatePasswordStrength(password);

    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' }); return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    // Check if active account with email already exists
    const existing = await db.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM users WHERE email = $1',
      [cleanEmail]
    );
    if (existing.rowCount! > 0) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' }); return;
    }

    // Derive sanitized username
    let username = cleanName.replace(/\s+/g, '_').toLowerCase().slice(0, 40);
    const usernameCheck = await db.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    if (usernameCheck.rowCount! > 0) {
      username = `${username}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Store pending registration in Redis (15 min TTL)
    await setRedis(`pendingVerif:${cleanEmail}`, {
      name: cleanName,
      username,
      email: cleanEmail,
      passwordHash,
      code: verificationCode,
    }, 900);

    res.status(201).json({
      status: 'verification_sent',
      email: cleanEmail,
      message: `A 6-digit verification code has been sent to ${cleanEmail}.`,
      ...(process.env.NODE_ENV !== 'production' ? { devCode: verificationCode } : {}),
    });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message || 'Registration failed.' });
    }
  }
});

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────

router.post('/verify-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      res.status(400).json({ error: 'Email and verification code are required.' }); return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const pending = await getRedis<{
      name: string; username: string; email: string;
      passwordHash: string; code: string;
    }>(`pendingVerif:${cleanEmail}`);

    if (!pending) {
      res.status(400).json({ error: 'No pending registration found. The code may have expired — please register again.' }); return;
    }

    if (pending.code !== String(code).trim()) {
      res.status(400).json({ error: 'Invalid verification code. Please check your email and try again.' }); return;
    }

    // Insert user into PostgreSQL with active status
    const result = await db.query<{ id: string; username: string; email: string; reputation: number }>(
      `INSERT INTO users (username, email, password_hash, reputation, is_active)
       VALUES ($1, $2, $3, 10, TRUE)
       ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username, is_active = TRUE
       RETURNING id, username, email, reputation`,
      [pending.username, pending.email, pending.passwordHash]
    );

    const user = result.rows[0];
    await delRedis(`pendingVerif:${cleanEmail}`);

    // Generate Token Pair (15m Access Token + 7d Rotating Refresh Token)
    const tokenPair = await createTokenPair(user.id, user.username);

    res.json({
      status: 'verified',
      message: 'Email verified! Welcome to Argus.',
      token: tokenPair.accessToken,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      user: { id: user.id, username: user.username, email: user.email, reputation: user.reputation },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Verification failed.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', authBruteForceLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
      res.status(400).json({ error: 'Username or email is required.' }); return;
    }
    if (!password) {
      res.status(400).json({ error: 'Password is required.' }); return;
    }

    const clean = identifier.trim().toLowerCase();

    // Check account-level brute-force lockout in Redis
    const lockout = await checkAccountLockout(clean);
    if (lockout.locked) {
      const mins = Math.ceil((lockout.remainingSec || 900) / 60);
      res.status(423).json({
        error: `Account temporarily locked due to repeated failed login attempts. Please try again in ${mins} minute(s).`,
      });
      return;
    }

    const result = await db.query<{
      id: string; username: string; email: string;
      reputation: number; password_hash: string | null; is_active: boolean;
    }>(
      `SELECT id, username, email, reputation, password_hash, is_active
       FROM users
       WHERE email = $1 OR lower(username) = $1`,
      [clean]
    );

    if (result.rowCount === 0) {
      await bcrypt.hash('dummy_prevent_timing', BCRYPT_ROUNDS);
      const lockStatus = await recordFailedLoginAttempt(clean);
      if (lockStatus.locked) {
        res.status(423).json({
          error: 'Too many failed attempts. Account has been temporarily locked for 15 minutes.',
        });
        return;
      }
      res.status(401).json({ error: 'Invalid credentials. Please check your email/username and password.' }); return;
    }

    const user = result.rows[0];

    // Check if deactivated
    if (user.is_active === false) {
      res.status(403).json({ error: 'This account has been deactivated.' }); return;
    }

    if (!user.password_hash) {
      res.status(401).json({ error: 'This account uses SSO / Clerk authentication. Please sign in via that method.' }); return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      const lockStatus = await recordFailedLoginAttempt(clean);
      if (lockStatus.locked) {
        res.status(423).json({
          error: 'Too many failed attempts. Account has been temporarily locked for 15 minutes.',
        });
        return;
      }
      res.status(401).json({ error: 'Invalid credentials. Please check your email/username and password.' }); return;
    }

    // Clear failed login tracking on success
    await clearFailedLoginAttempts(clean);

    // Create fresh Token Pair (Access Token + Rotating Refresh Token)
    const tokenPair = await createTokenPair(user.id, user.username);

    res.json({
      status: 'authenticated',
      token: tokenPair.accessToken,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      user: { id: user.id, username: user.username, email: user.email, reputation: user.reputation },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Login failed.' });
  }
});

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────

/**
 * Token Rotation Endpoint:
 * Validates Refresh Token -> Issues new Access Token + new Refresh Token.
 * If reuse of an old refresh token is detected, revokes all tokens for that family.
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body || {};

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({ error: 'Refresh token is required.' }); return;
    }

    try {
      const result = await rotateRefreshToken(refreshToken.trim());
      if (!result) {
        res.status(401).json({ error: 'Invalid or expired refresh token. Please sign in again.' }); return;
      }

      res.json({
        status: 'refreshed',
        token: result.tokens.accessToken,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresIn: result.tokens.expiresIn,
        user: result.user,
      });
    } catch (err: any) {
      if (err.message === 'SECURITY_ALERT_REFRESH_TOKEN_REUSE_DETECTED') {
        res.status(403).json({
          error: 'Security alert: Refresh token reuse detected. All active sessions have been revoked. Please sign in again.',
        });
        return;
      }
      throw err;
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Token refresh failed.' });
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const { refreshToken } = req.body || {};

    // 1. Blacklist active access token
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const payload = verifyArgusToken(token);
        if (payload.jti && payload.exp) {
          await blacklistToken(payload.jti, payload.exp);
        }
        if (payload.familyId) {
          await revokeTokenFamily(payload.familyId);
        }
      } catch {
        // Token invalid or already expired
      }
    }

    // 2. Invalidate refresh token if provided
    if (refreshToken && typeof refreshToken === 'string' && redisClient) {
      try {
        const raw = await redisClient.get(`rf:token:${refreshToken.trim()}`);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.familyId) {
            await revokeTokenFamily(data.familyId);
          }
        }
        await redisClient.del(`rf:token:${refreshToken.trim()}`);
      } catch {
        // Ignore Redis errors
      }
    }

    res.json({ status: 'logged_out' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Logout failed.' });
  }
});

// ─── POST /api/auth/me/deactivate (GDPR Anonymization) ─────────────────────────

/**
 * GDPR Right to be Forgotten / Soft-Delete Protocol:
 *  - Scrubs email, sets password_hash to NULL.
 *  - Anonymizes username to `usr_anonymized_<id>`.
 *  - Sets is_active = FALSE and anonymized_at = NOW().
 *  - Revokes all active refresh token families and blacklists current access token.
 *  - Preserves graph DAG nodes and voting history intact to protect dialectic structure.
 */
router.post('/me/deactivate', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({ error: 'Authentication required to deactivate account.' }); return;
    }

    const userId = req.user.id;
    const anonymizedUsername = `usr_anonymized_${userId.slice(0, 8)}`;
    const anonymizedEmail = `deleted_${userId}@argus.deleted`;

    // 1. Scrub PII in PostgreSQL
    await db.query(
      `UPDATE users
       SET username = $1,
           email = $2,
           password_hash = NULL,
           is_active = FALSE,
           anonymized_at = NOW()
       WHERE id = $3`,
      [anonymizedUsername, anonymizedEmail, userId]
    );

    // 2. Revoke all active token sessions in Redis
    await revokeAllUserTokens(userId);

    // 3. Blacklist current access token
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const payload = verifyArgusToken(token);
        if (payload.jti && payload.exp) {
          await blacklistToken(payload.jti, payload.exp);
        }
      } catch {
        // Ignore
      }
    }

    res.json({
      status: 'account_deactivated',
      message: 'Your account has been deactivated and personal data permanently scrubbed in accordance with GDPR regulations.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to deactivate account.' });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

router.post('/forgot-password', authBruteForceLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'A valid email address is required.' }); return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Store in Redis (15 min TTL)
    await setRedis(`resetToken:${resetToken}`, { email: cleanEmail, used: false }, 900);

    res.json({
      status: 'reset_link_sent',
      email: cleanEmail,
      message: `A password reset link has been dispatched to ${cleanEmail}.`,
      ...(process.env.NODE_ENV !== 'production' ? { resetToken, resetUrl: `/reset-password?token=${resetToken}` } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to process forgot password request.' });
  }
});

// ─── POST /api/auth/validate-reset-token ─────────────────────────────────────

router.post('/validate-reset-token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      res.status(400).json({ valid: false, error: 'Token is required.' }); return;
    }

    const record = await getRedis<{ email: string; used: boolean }>(`resetToken:${token}`);
    if (!record || record.used) {
      res.status(400).json({ valid: false, error: 'Password reset link is invalid or has expired.' }); return;
    }

    res.json({ valid: true, email: record.email });
  } catch (err: any) {
    res.status(500).json({ valid: false, error: 'Token validation failed.' });
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post('/reset-password', authBruteForceLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword, confirmPassword } = req.body || {};
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Reset token is required.' }); return;
    }

    const record = await getRedis<{ email: string; used: boolean }>(`resetToken:${token}`);
    if (!record || record.used) {
      res.status(400).json({ error: 'This password reset link is invalid or has expired.' }); return;
    }

    validatePasswordStrength(newPassword);

    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' }); return;
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, record.email]);
    await delRedis(`resetToken:${token}`);

    // Invalidate any existing sessions for this account upon password change
    const userRes = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [record.email]);
    if (userRes.rowCount! > 0) {
      await revokeAllUserTokens(userRes.rows[0].id);
    }

    res.json({
      status: 'success',
      message: 'Your password has been successfully updated! All active sessions have been reset. Please sign in with your new credentials.',
    });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message || 'Password reset failed.' });
    }
  }
});

export default router;
