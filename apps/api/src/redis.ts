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

/**
 * Gets a cached JSON object from Redis. Returns null on miss or if Redis is offline.
 */
export async function getCached<T>(key: string): Promise<T | null> {
  if (!redisClient) return null;
  try {
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    return null;
  }
}

/**
 * Sets a JSON object in Redis with a TTL in seconds.
 */
export async function setCached(key: string, data: unknown, ttlSeconds = 30): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (err) {
    // Ignore cache write errors
  }
}

/**
 * Invalidates all cached subgraphs for a specific topic ID.
 */
export async function invalidateTopicCache(topicId: string): Promise<void> {
  if (!redisClient) return;
  try {
    const pattern = `subgraph:${topicId}:*`;
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (err) {
    // Ignore cache invalidation errors
  }
}
