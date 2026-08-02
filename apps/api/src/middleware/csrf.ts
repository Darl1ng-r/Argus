import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_COOKIE_NAME = 'argus_csrf_token';

/**
 * CSRF Protection Middleware for Argus API.
 * Uses Double Submit Cookie pattern to protect against Cross-Site Request Forgery.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe HTTP Methods (GET, HEAD, OPTIONS) do not alter state
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    // Issue or renew CSRF cookie if not present
    let token = req.cookies?.[CSRF_COOKIE_NAME];
    if (!token) {
      token = crypto.randomBytes(32).toString('hex');
      res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false, // Accessible by frontend JS to set X-CSRF-Token header
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      });
    }
    res.setHeader('X-CSRF-Token', token);
    return next();
  }

  // Mutating HTTP Methods (POST, PUT, DELETE, PATCH)
  const headerToken = req.headers[CSRF_HEADER_NAME] || req.headers[CSRF_HEADER_NAME.toLowerCase()];
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

  // In test / dev environment without CSRF enforcement, allow if bypass header is set or in dev mode
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return next();
  }

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    res.status(403).json({
      error: 'CSRF Protection: Invalid or missing X-CSRF-Token header.',
    });
    return;
  }

  next();
}
