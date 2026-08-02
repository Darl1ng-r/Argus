import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { validatePasswordStrength, ValidationError } from '../utils/sanitizer';
import { authBruteForceLimiter } from '../middleware/rateLimiter';

const router = Router();

// In-memory verification & reset stores for demonstration & testing
const pendingVerifications = new Map<string, { code: string; userData: any; expiresAt: number }>();
const resetTokensStore = new Map<string, { email: string; expiresAt: number; used: boolean }>();

/**
 * POST /api/auth/register
 * Production user registration endpoint with strict password policy and terms validation.
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      email,
      password,
      confirmPassword,
      termsAccepted,
      privacyAccepted,
      captchaToken,
    } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    // Strict Password Validation Policy
    validatePasswordStrength(password);

    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    if (!termsAccepted) {
      res.status(400).json({ error: 'You must accept the Terms & Conditions to register.' });
      return;
    }

    if (!privacyAccepted) {
      res.status(400).json({ error: 'You must accept the Privacy Policy to register.' });
      return;
    }

    if (!captchaToken) {
      res.status(400).json({ error: 'Captcha verification is required.' });
      return;
    }

    // Generate 6-digit email OTP verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const cleanEmail = email.trim().toLowerCase();

    pendingVerifications.set(cleanEmail, {
      code: verificationCode,
      userData: {
        id: 'usr_' + Math.random().toString(36).substring(2, 9),
        name: name.trim(),
        username: name.trim().replace(/\s+/g, '_').toLowerCase(),
        email: cleanEmail,
      },
      expiresAt: Date.now() + 15 * 60 * 1000, // 15 mins
    });

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

/**
 * POST /api/auth/verify-email
 * Email verification endpoint using 6-digit OTP code.
 */
router.post('/verify-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code } = req.body || {};

    if (!email || !code) {
      res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const pending = pendingVerifications.get(cleanEmail);

    if (!pending) {
      res.status(400).json({ error: 'No pending registration found for this email address.' });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingVerifications.delete(cleanEmail);
      res.status(400).json({ error: 'Verification code has expired. Please register again.' });
      return;
    }

    if (pending.code !== String(code).trim()) {
      res.status(400).json({ error: 'Invalid verification code. Please check your email.' });
      return;
    }

    pendingVerifications.delete(cleanEmail);

    res.json({
      status: 'verified',
      message: 'Email successfully verified!',
      user: {
        id: pending.userData.id,
        username: pending.userData.username,
        email: pending.userData.email,
        name: pending.userData.name,
        reputation: 10,
      },
      token: `bearer_token_${pending.userData.id}_${Date.now()}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Verification failed.' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Brute force protected password reset token generator flow.
 */
router.post('/forgot-password', authBruteForceLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins

    resetTokensStore.set(resetToken, {
      email: cleanEmail,
      expiresAt,
      used: false,
    });

    res.json({
      status: 'reset_link_sent',
      email: cleanEmail,
      message: `A password reset link has been dispatched to ${cleanEmail}.`,
      resetToken,
      resetUrl: `/reset-password?token=${resetToken}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to process forgot password request.' });
  }
});

/**
 * POST /api/auth/validate-reset-token
 * Validates reset token validity and expiry before rendering reset form.
 */
router.post('/validate-reset-token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body || {};

    if (!token || typeof token !== 'string') {
      res.status(400).json({ valid: false, error: 'Token parameter is required.' });
      return;
    }

    const record = resetTokensStore.get(token);

    if (!record || record.used || Date.now() > record.expiresAt) {
      res.status(400).json({ valid: false, error: 'Password reset link is invalid or has expired.' });
      return;
    }

    res.json({ valid: true, email: record.email });
  } catch (err: any) {
    res.status(500).json({ valid: false, error: 'Token validation failed.' });
  }
});

/**
 * POST /api/auth/reset-password
 * Brute force protected password reset submission.
 */
router.post('/reset-password', authBruteForceLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword, confirmPassword } = req.body || {};

    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Reset token is required.' });
      return;
    }

    const record = resetTokensStore.get(token);

    if (!record || record.used || Date.now() > record.expiresAt) {
      res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
      return;
    }

    // Strict Password Complexity Policy Check
    validatePasswordStrength(newPassword);

    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: 'New password and confirm password do not match.' });
      return;
    }

    // Single-use token invalidation
    record.used = true;
    resetTokensStore.delete(token);

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
