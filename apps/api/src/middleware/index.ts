/**
 * Shared Express middleware used across route handlers.
 * Extracted from the monolithic server.ts to allow individual route files
 * to import only what they need without circular dependencies.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../server.js';
import { getCached, setCached } from '../redis.js';
import { getUserTopicRole, hasRequiredRole, TopicRole } from '../services/graphService.js';
import { validateIdentifier, ValidationError } from '../utils/sanitizer.js';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// requireAuth — rejects unauthenticated requests with 401
// ---------------------------------------------------------------------------
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// idempotencyGuard — replays cached mutation response on duplicate Idempotency-Key
// ---------------------------------------------------------------------------
export async function idempotencyGuard(req: Request, res: Response, next: NextFunction) {
  const idempotencyKey = req.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    return next();
  }

  const userId = req.user?.id || 'anon';
  const cacheKey = `idempotency:${userId}:${idempotencyKey.trim()}`;

  const cached = await getCached<{ status: number; body: unknown }>(cacheKey);
  if (cached) {
    req.log?.info({ idempotencyKey }, '[IDEMPOTENCY] Replayed cached response');
    return res.status(cached.status).json(cached.body);
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      setCached(cacheKey, { status: res.statusCode, body }, 600); // 10 min TTL
    }
    return originalJson(body);
  };

  next();
}

// ---------------------------------------------------------------------------
// requireTopicRole — RBAC role check for a target topic
// ---------------------------------------------------------------------------
export function requireTopicRole(requiredRole: TopicRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
      const rawTopicId = req.params.id || req.body?.topicId;
      if (!rawTopicId) {
        return res.status(400).json({ error: 'Topic ID is required for role verification.' });
      }

      const topicId = validateIdentifier(rawTopicId, 'topicId');
      const userRole = await getUserTopicRole(topicId, req.user.id);

      if (!hasRequiredRole(userRole, requiredRole)) {
        return res.status(403).json({
          error: `Forbidden: This action requires '${requiredRole}' role on this topic. You have '${userRole}'.`,
        });
      }

      next();
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// sendError — generic error sender that prevents 5xx detail leakage in production
// ---------------------------------------------------------------------------
export function sendError(res: Response, status: number, message: string, internalErr?: unknown) {
  if (internalErr) {
    logger.error({ err: internalErr }, message);
  }
  const clientMessage =
    status >= 500 && IS_PRODUCTION ? 'An internal error occurred. Please try again.' : message;
  return res.status(status).json({ error: clientMessage });
}
