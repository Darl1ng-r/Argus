/**
 * Argus Authentication Routes
 * Real PostgreSQL + Redis-backed user auth using bcrypt + JWT.
 *
 * Endpoints:
 *  POST /api/auth/register          — create account, send verification code via Redis
 *  POST /api/auth/verify-email      — confirm code, insert user into DB, return JWT
 *  POST /api/auth/login             — authenticate with email/username + password, return JWT
 *  POST /api/auth/logout            — blacklist JWT in Redis
 *  POST /api/auth/forgot-password   — generate reset token (stored in Redis)
 *  POST /api/auth/validate-reset-token
 *  POST /api/auth/reset-password
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db.js';
import { redisClient } from '../redis.js';
import { signToken, verifyArgusToken, blacklistToken } from '../utils/jwt.js';
import { validatePasswordStrength, ValidationError } from '../utils/sanitizer.js';
import { authBruteForceLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const BCRYPT_ROUNDS = 12;

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── POST /api/auth/register ─────────────────────────────────────────────────

/**
 * Validates input, hashes the password, stores a pending verification
 * record in Redis (TTL=900s), and returns a 6-digit code.
 * In dev mode the code is returned directly in the response body.
 */
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
    const cleanName  = name.trim();

    // Check if email is already registered
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [cleanEmail]
    );
    if (existing.rowCount! > 0) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' }); return;
    }

    // Derive username (lowercased, spaces→underscores, max 40 chars)
    let username = cleanName.replace(/\s+/g, '_').toLowerCase().slice(0, 40);
    // Ensure username uniqueness by appending a short random suffix if needed
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
      // Expose the code in dev so users don't need a mail server
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

    // Insert user into PostgreSQL
    const result = await db.query<{ id: string; username: string; email: string; reputation: number }>(
      `INSERT INTO users (username, email, password_hash, reputation)
       VALUES ($1, $2, $3, 10)
       ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username
       RETURNING id, username, email, reputation`,
      [pending.username, pending.email, pending.passwordHash]
    );

    const user = result.rows[0];
    await delRedis(`pendingVerif:${cleanEmail}`);

    const token = signToken(user.id, user.username);

    res.json({
      status: 'verified',
      message: 'Email verified! Welcome to Argus.',
      token,
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
    const result = await db.query<{
      id: string; username: string; email: string;
      reputation: number; password_hash: string | null;
    }>(
      `SELECT id, username, email, reputation, password_hash
       FROM users
       WHERE email = $1 OR lower(username) = $1`,
      [clean]
    );

    if (result.rowCount === 0) {
      // Consistent timing to prevent user enumeration
      await bcrypt.hash('dummy', BCRYPT_ROUNDS);
      res.status(401).json({ error: 'Invalid credentials. Please check your email/username and password.' }); return;
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      res.status(401).json({ error: 'This account uses SSO / Clerk authentication. Please sign in via that method.' }); return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials. Please check your email/username and password.' }); return;
    }

    const token = signToken(user.id, user.username);

    res.json({
      status: 'authenticated',
      token,
      user: { id: user.id, username: user.username, email: user.email, reputation: user.reputation },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Login failed.' });
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const payload = verifyArgusToken(token);
        if (payload.jti && payload.exp) {
          await blacklistToken(payload.jti, payload.exp);
        }
      } catch {
        // Token invalid or already expired — nothing to blacklist
      }
    }
    res.json({ status: 'logged_out' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Logout failed.' });
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
      // In dev, return the token directly so it can be used without email
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

    res.json({
      status: 'success',
      message: 'Your password has been successfully updated! You can now sign in with your new credentials.',
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
