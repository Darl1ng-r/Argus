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
 * Fix P-3: Optionally associates the key with a topic tag set for O(1) bulk invalidation.
 */
export async function setCached(
  key: string,
  data: unknown,
  ttlSeconds = 30,
  topicId?: string
): Promise<void> {
  if (!redisClient) return;
  try {
    const pipeline = redisClient.pipeline();
    pipeline.setex(key, ttlSeconds, JSON.stringify(data));
    if (topicId) {
      // Track this key under the topic's tag set so invalidation never needs SCAN
      const tagKey = `cache-tag:topic:${topicId}`;
      pipeline.sadd(tagKey, key);
      // Tag set TTL = cache TTL + 60s buffer so it outlives the cached value
      pipeline.expire(tagKey, ttlSeconds + 60);
    }
    await pipeline.exec();
  } catch (err) {
    // Ignore cache write errors — cache is best-effort
  }
}

/**
 * Fix P-3: Invalidates all cached subgraphs for a specific topic ID.
 * Uses a Redis Set (cache-tag:topic:{topicId}) instead of SCAN to avoid O(keyspace) cost.
 */
export async function invalidateTopicCache(topicId: string): Promise<void> {
  if (!redisClient) return;
  try {
    const tagKey = `cache-tag:topic:${topicId}`;
    const keys = await redisClient.smembers(tagKey);
    if (keys.length > 0) {
      const pipeline = redisClient.pipeline();
      pipeline.del(...keys);
      pipeline.del(tagKey); // Remove the tag set itself
      await pipeline.exec();
    }
  } catch (err) {
    // Ignore cache invalidation errors — stale data will expire naturally
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
