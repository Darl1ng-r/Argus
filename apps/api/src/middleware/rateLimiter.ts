/**
 * Rate limiter instances — centralized here so all route files share the same
 * Redis store and window configuration without re-instantiating per import.
 */
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../redis.js';

function makeStore() {
  if (redisClient && process.env.NODE_ENV !== 'test') {
    return new RedisStore({
      // @ts-expect-error — ioredis satisfies the interface
      sendCommand: (...args: string[]) => redisClient!.call(...args),
    });
  }
  return undefined; // Memory store fallback
}

/** Applied globally to every request (100 req/min per IP). */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  message: { error: 'Too many requests. Please slow down.' },
});

/** Applied to state-mutating endpoints (create/update/fork) — keyed per user. */
export const mutationLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  keyGenerator: (req) => req.user?.id || req.ip || 'unknown',
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many submissions. Please wait a minute before trying again.' },
});

/** Applied to voting endpoints — keyed per user. */
export const voteLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  keyGenerator: (req) => req.user?.id || req.ip || 'unknown',
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Voting speed limit exceeded. Please wait before voting again.' },
});

/** Applied to Auth endpoints (Login, Reset Password) — IP level throttling (25 attempts per 15 min). Account-level lockout is handled individually in auth service. */
export const authBruteForceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25, // 25 attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  message: {
    error: 'Too many authentication attempts from this IP address. Please wait 15 minutes before trying again.',
  },
});
