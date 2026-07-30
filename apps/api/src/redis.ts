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
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
      cursor = nextCursor;
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } while (cursor !== '0');
  } catch (err) {
    // Ignore cache invalidation errors
  }
}

/**
 * Publishes a message to a Redis channel for SSE fan-out.
 */
export async function publishEvent(channel: string, message: unknown): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.publish(channel, JSON.stringify(message));
  } catch (err) {
    // Ignore publish errors
  }
}

/**
 * Subscribes to a Redis channel. Returns a new client instance for the subscriber.
 */
export async function subscribeToEvent(channel: string, onMessage: (message: string) => void): Promise<Redis | null> {
  if (!process.env.REDIS_URL) return null;
  const subscriber = new Redis(process.env.REDIS_URL);
  await subscriber.subscribe(channel);
  subscriber.on('message', (ch, msg) => {
    if (ch === channel) onMessage(msg);
  });
  return subscriber;
}
