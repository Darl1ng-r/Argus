/**
 * Rate limiter instances — centralized here so all route files share the same
 * Redis store and window configuration without re-instantiating per import.
 */
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../redis.js';

function makeStore() {
  if (redisClient && process.env.NODE_ENV !== 'test') {
    // Fix P-7: Removed `redisClient.status === 'ready'` guard — with lazyConnect: true,
    // the status is always 'wait' at import time, so the store was never created.
    // ioredis will queue commands until the connection is established.
    return new RedisStore({
      // @ts-expect-error — ioredis satisfies the interface
      sendCommand: (...args: string[]) => redisClient!.call(...args),
    });
  }
  return undefined; // Memory store fallback (dev & offline testing)
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

/** Applied to state-mutating endpoints (create/update/fork). */
export const mutationLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  message: { error: 'Too many submissions. Please wait a minute before trying again.' },
});

/** Applied to voting endpoints. */
export const voteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  message: { error: 'Voting speed limit exceeded. Please wait before voting again.' },
});

/** Applied to Auth endpoints (Login, Reset Password) — 5 attempts per 10 minutes temporary lockout. */
export const authBruteForceLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // 5 attempts limit
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  message: {
    error: 'Too many failed authentication attempts. Account temporarily locked for 10 minutes to prevent brute force attacks. Please try again later.',
  },
});
