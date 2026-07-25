import { Redis } from 'ioredis';

// Fix #3 — Shared Redis client for distributed rate limiting and future caching
// Gracefully degrades: if REDIS_URL is not set, rate limiters fall back to memory store
let redisClient: Redis | null = null;

if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  redisClient.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  redisClient.on('connect', () => {
    console.log('[Redis] Connected ✓');
  });
}

export { redisClient };
