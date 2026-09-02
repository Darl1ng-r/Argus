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
 * Optionally associates the key with a topic tag set for O(1) bulk invalidation.
 */
export async function setCached(
  key: string,
  data: unknown,
  ttlSeconds = 30,
  tagOrTopicId?: string
): Promise<void> {
  if (!redisClient) return;
  try {
    const pipeline = redisClient.pipeline();
    pipeline.setex(key, ttlSeconds, JSON.stringify(data));
    if (tagOrTopicId) {
      const tagKey = tagOrTopicId.startsWith('cache-tag:')
        ? tagOrTopicId
        : tagOrTopicId.startsWith('topic:')
        ? `cache-tag:${tagOrTopicId}`
        : `cache-tag:topic:${tagOrTopicId}`;
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, ttlSeconds + 60);
    }
    await pipeline.exec();
  } catch (err) {
    // Ignore cache write errors — cache is best-effort
  }
}

/**
 * Structure for XFetch Probabilistic Early Expiration metadata
 */
interface XFetchEnvelope<T> {
  val: T;
  delta: number; // Time in ms it took to compute the value
  expireAt: number; // Timestamp when TTL expires
}

// Module-level Single-Flight Mutex Map: Prevents duplicate background/foreground queries on the same key
const inFlightRefreshes = new Map<string, Promise<unknown>>();

/**
 * Gets or computes a value using the Optimal Probabilistic Cache Regeneration (XFetch) algorithm
 * with Single-Flight Mutex deduplication.
 * Prevents Cache Stampedes / Thundering Herd effects on hot keys by probabilistically
 * refreshing the cache in the background with at most ONE concurrent worker.
 */
export async function getOrSetXFetch<T>(
  key: string,
  ttlSeconds: number,
  computeFn: () => Promise<T>,
  beta = 1.0,
  tagOrTopicId?: string
): Promise<T> {
  if (!redisClient) {
    // Single-flight in-memory fallback even when Redis is offline
    if (inFlightRefreshes.has(key)) {
      return inFlightRefreshes.get(key) as Promise<T>;
    }
    const computePromise = computeFn().finally(() => {
      inFlightRefreshes.delete(key);
    });
    inFlightRefreshes.set(key, computePromise);
    return computePromise;
  }

  try {
    const raw = await redisClient.get(key);
    if (raw) {
      const envelope = JSON.parse(raw) as XFetchEnvelope<T>;
      const remainingMs = envelope.expireAt - Date.now();

      // XFetch Early Expiration condition: remaining < -beta * delta * ln(random())
      const shouldEarlyRefresh =
        remainingMs > 0 &&
        remainingMs <= -beta * envelope.delta * Math.log(Math.random() || 0.0001);

      if (shouldEarlyRefresh && !inFlightRefreshes.has(key)) {
        // Asynchronously refresh in background with exactly ONE single-flight worker
        const startTime = Date.now();
        const refreshPromise = computeFn()
          .then(async (fresh) => {
            const computeTimeMs = Date.now() - startTime;
            const newEnvelope: XFetchEnvelope<T> = {
              val: fresh,
              delta: Math.max(1, computeTimeMs),
              expireAt: Date.now() + ttlSeconds * 1000,
            };
            await setCached(key, newEnvelope, ttlSeconds, tagOrTopicId);
            return fresh;
          })
          .catch((err) => {
            console.error(`[XFetch] Background refresh error for key "${key}":`, err?.message || err);
          })
          .finally(() => {
            inFlightRefreshes.delete(key);
          });

        inFlightRefreshes.set(key, refreshPromise);
      }

      if (remainingMs > 0) {
        return envelope.val;
      }
    }
  } catch (err) {
    // Fall back to computeFn if Redis read fails
  }

  // Cache miss or hard expired: compute with Single-Flight deduplication
  if (inFlightRefreshes.has(key)) {
    return inFlightRefreshes.get(key) as Promise<T>;
  }

  const startTime = Date.now();
  const computePromise = computeFn()
    .then(async (fresh) => {
      const computeTimeMs = Date.now() - startTime;
      const envelope: XFetchEnvelope<T> = {
        val: fresh,
        delta: Math.max(1, computeTimeMs),
        expireAt: Date.now() + ttlSeconds * 1000,
      };
      await setCached(key, envelope, ttlSeconds, tagOrTopicId);
      return fresh;
    })
    .finally(() => {
      inFlightRefreshes.delete(key);
    });

  inFlightRefreshes.set(key, computePromise);
  return computePromise;
}

/**
 * Invalidates all cached keys under a specific tag set.
 */
export async function invalidateCacheTag(tag: string): Promise<void> {
  if (!redisClient) return;
  try {
    const tagKey = tag.startsWith('cache-tag:') ? tag : `cache-tag:${tag}`;
    const keys = await redisClient.smembers(tagKey);
    if (keys.length > 0) {
      const pipeline = redisClient.pipeline();
      pipeline.del(...keys);
      pipeline.del(tagKey);
      await pipeline.exec();
    }
  } catch (err) {
    // Ignore cache invalidation errors
  }
}

/**
 * Invalidates all cached subgraphs for a specific topic ID.
 */
export async function invalidateTopicCache(topicId: string): Promise<void> {
  await invalidateCacheTag(`topic:${topicId}`);
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
