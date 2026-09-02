/**
 * SSE (Server-Sent Events) handler for real-time topic updates.
 *
 * Architecture:
 *  - Each SSE client subscribes to BOTH:
 *    1. The in-process EventEmitter (fast path — same API instance mutations)
 *    2. A shared Redis Pub/Sub multiplexer (cross-instance fan-out)
 *
 * Fix 3 — Redis connection per CLIENT → per TOPIC:
 *  - Previously each connected SSE client opened its own `new Redis(...)` subscriber.
 *    At 1,000 clients watching the same topic that was 1,000 Redis connections.
 *  - Now a single Redis subscriber is shared across all clients watching the same topic.
 *    Connection count is O(unique topics being watched), not O(total SSE clients).
 *
 * Teardown:
 *  - When the last client for a topic disconnects, the shared subscriber is unsubscribed
 *    and disconnected. New connections recreate it transparently.
 */
import { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { topicEvents, TopicMutationEvent, topicPubSubChannel } from '../services/topicEvents.js';
import { validateIdentifier, ValidationError } from '../utils/sanitizer.js';
import { sendError } from '../middleware/index.js';
import { activeSseConnectionsGauge } from '../utils/metrics.js';
import { registerSseClient, unregisterSseClient } from '../services/sseManager.js';

// ---------------------------------------------------------------------------
// Shared Redis multiplexer — one subscriber per topic, many SSE clients
// ---------------------------------------------------------------------------

type MessageCallback = (event: TopicMutationEvent) => void;

interface TopicSubscription {
  redis: Redis;
  callbacks: Set<MessageCallback>;
}

/** Module-level map: topicId → shared subscriber + callback set. */
const topicSubscriptions = new Map<string, TopicSubscription>();
/** In-flight pending subscription promises to prevent race conditions during concurrent connections. */
const pendingSubscriptions = new Map<string, Promise<TopicSubscription>>();

/**
 * Registers a callback for Redis Pub/Sub events on a topic.
 * Uses mutex-locked single-flight promise to eliminate race conditions under concurrent connects.
 */
async function subscribeToTopicRedis(
  topicId: string,
  callback: MessageCallback
): Promise<() => Promise<void>> {
  if (!process.env.REDIS_URL) {
    return async () => {};
  }

  let sub = topicSubscriptions.get(topicId);

  if (!sub) {
    let pending = pendingSubscriptions.get(topicId);
    if (!pending) {
      pending = (async () => {
        const redis = new Redis(process.env.REDIS_URL!, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: true,
        });

        const callbacks = new Set<MessageCallback>();
        const newSub: TopicSubscription = { redis, callbacks };

        await redis.subscribe(topicPubSubChannel(topicId));

        redis.on('message', (_ch: string, raw: string) => {
          try {
            const event: TopicMutationEvent = JSON.parse(raw);
            for (const cb of newSub.callbacks) cb(event);
          } catch {
            // Ignore malformed Pub/Sub messages
          }
        });

        redis.on('error', (err) => {
          console.error(`[SSE Redis] Error on topic ${topicId}:`, err?.message || err);
        });

        topicSubscriptions.set(topicId, newSub);
        return newSub;
      })().finally(() => {
        pendingSubscriptions.delete(topicId);
      });

      pendingSubscriptions.set(topicId, pending);
    }

    sub = await pending;
  }

  sub.callbacks.add(callback);

  return async () => {
    const current = topicSubscriptions.get(topicId);
    if (!current) return;
    current.callbacks.delete(callback);
    if (current.callbacks.size === 0) {
      topicSubscriptions.delete(topicId);
      try {
        await current.redis.unsubscribe(topicPubSubChannel(topicId));
        current.redis.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Connection tracking with Memory Leak Protection
// ---------------------------------------------------------------------------
const openConnections = new Map<string, number>();
const ipConnections = new Map<string, number>();
const userConnections = new Map<string, number>();

const MAX_SSE_PER_IP = 100;
const MAX_SSE_PER_USER = 20;

export async function topicSseHandler(req: Request, res: Response): Promise<void> {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = req.user?.id;

    // 1. Privacy Guard: Verify topic existence and access permissions
    const { db } = await import('../db.js');
    const topicRes = await db.query<{ author_id: string; is_private: boolean }>(
      'SELECT author_id, is_private FROM topics WHERE id = $1',
      [topicId]
    );

    if (topicRes.rowCount === 0) {
      res.status(404).json({ error: 'Topic not found.' });
      return;
    }

    const topicRow = topicRes.rows[0];
    if (topicRow.is_private) {
      if (!userId) {
        res.status(404).json({ error: 'Topic not found.' });
        return;
      }
      if (topicRow.author_id !== userId) {
        const memberRes = await db.query(
          'SELECT 1 FROM topic_members WHERE topic_id = $1 AND user_id = $2',
          [topicId, userId]
        );
        if (memberRes.rowCount === 0) {
          res.status(404).json({ error: 'Topic not found.' });
          return;
        }
      }
    }

    // 2. Safe Connection Limits (User-scoped when authenticated, IP-scoped when guest)
    if (userId) {
      const userCount = userConnections.get(userId) ?? 0;
      if (userCount >= MAX_SSE_PER_USER) {
        res.status(429).json({ error: 'Too many concurrent real-time connections for this account.' });
        return;
      }
      userConnections.set(userId, userCount + 1);
    } else {
      const ipCount = ipConnections.get(clientIp) ?? 0;
      if (ipCount >= MAX_SSE_PER_IP) {
        res.status(429).json({ error: 'Too many concurrent real-time connections from this network.' });
        return;
      }
      ipConnections.set(clientIp, ipCount + 1);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const connectionId = `sse-topic-${topicId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    registerSseClient(connectionId, res, { topicId });

    openConnections.set(topicId, (openConnections.get(topicId) ?? 0) + 1);
    activeSseConnectionsGauge.inc();

    let eventSeq = 0;
    function writeEvent(type: string, data: unknown): void {
      if (res.writableEnded) return;
      res.write(`id: ${++eventSeq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    writeEvent('connected', { status: 'live', topicId });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 20_000);

    // Local EventEmitter — same-instance fast path
    const localChannel = `topic:${topicId}`;
    const onLocalMutation = (event: TopicMutationEvent) => writeEvent(event.type, event.payload);
    topicEvents.on(localChannel, onLocalMutation);

    // Shared Redis multiplexer — cross-instance fan-out
    const redisCallback: MessageCallback = (event) => writeEvent(event.type, event.payload);
    let unsubscribeRedis: () => Promise<void> = async () => {};
    try {
      unsubscribeRedis = await subscribeToTopicRedis(topicId, redisCallback);
    } catch (err) {
      req.log?.warn({ err }, '[SSE] Failed to subscribe to Redis — falling back to local-only');
    }

    req.on('close', async () => {
      clearInterval(heartbeat);
      unregisterSseClient(connectionId);
      topicEvents.removeListener(localChannel, onLocalMutation);
      await unsubscribeRedis();

      // Memory leak prevention: Delete keys when counter reaches zero
      const remTopic = (openConnections.get(topicId) ?? 1) - 1;
      if (remTopic <= 0) openConnections.delete(topicId);
      else openConnections.set(topicId, remTopic);

      if (userId) {
        const remUser = (userConnections.get(userId) ?? 1) - 1;
        if (remUser <= 0) userConnections.delete(userId);
        else userConnections.set(userId, remUser);
      } else {
        const remIp = (ipConnections.get(clientIp) ?? 1) - 1;
        if (remIp <= 0) ipConnections.delete(clientIp);
        else ipConnections.set(clientIp, remIp);
      }

      activeSseConnectionsGauge.dec();
      if (!res.writableEnded) res.end();
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
}

/** Returns current open SSE connection counts by topicId (for metrics/diagnostics). */
export function getSseConnectionStats(): Record<string, number> {
  return Object.fromEntries(openConnections);
}
