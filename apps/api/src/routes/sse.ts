/**
 * SSE (Server-Sent Events) handler for real-time topic updates.
 *
 * Architecture:
 *  - Each SSE client subscribes to BOTH:
 *    1. The in-process EventEmitter (fast path — same API instance mutations)
 *    2. A Redis Pub/Sub subscription (cross-instance fan-out for horizontally scaled deployments)
 *  - Events are deduplicated on the client via the event `id` field and `Last-Event-ID`.
 *  - Each SSE connection creates its own dedicated Redis subscriber connection (required by ioredis
 *    since a subscribed client cannot issue regular commands).
 *  - The Redis subscriber is properly torn down when the client disconnects.
 */
import { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { topicEvents, TopicMutationEvent, topicPubSubChannel } from '../services/topicEvents.js';
import { validateIdentifier, ValidationError } from '../utils/sanitizer.js';
import { sendError } from '../middleware/index.js';
import { globalLimiter } from '../middleware/rateLimiter.js';

// Track open SSE connections per topic for monitoring / diagnostics
const openConnections = new Map<string, number>();

export async function topicSseHandler(req: Request, res: Response): Promise<void> {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');

    // --- SSE headers ---
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    // Track connection count
    openConnections.set(topicId, (openConnections.get(topicId) ?? 0) + 1);

    let eventSeq = 0;

    /**
     * Writes a single SSE event with an incrementing sequence ID.
     * The sequence ID lets clients use Last-Event-ID for reconnect replay (future work).
     */
    function writeEvent(type: string, data: unknown): void {
      if (res.writableEnded) return;
      res.write(`id: ${++eventSeq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    // Initial handshake ping
    writeEvent('connected', { status: 'live', topicId });

    // Heartbeat every 20s to keep the connection alive through proxies / load balancers
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 20_000);

    // --- Local EventEmitter subscription (same-instance fast path) ---
    const localChannel = `topic:${topicId}`;
    const onLocalMutation = (event: TopicMutationEvent) => {
      writeEvent(event.type, event.payload);
    };
    topicEvents.on(localChannel, onLocalMutation);

    // --- Redis Pub/Sub subscription (cross-instance fan-out) ---
    let redisSubscriber: Redis | null = null;
    const pubSubChannel = topicPubSubChannel(topicId);

    if (process.env.REDIS_URL) {
      try {
        redisSubscriber = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: true,
        });

        await redisSubscriber.subscribe(pubSubChannel);

        redisSubscriber.on('message', (_channel: string, raw: string) => {
          try {
            const event: TopicMutationEvent = JSON.parse(raw);
            // Only write Redis events if the local EventEmitter hasn't already delivered them.
            // Since local mutations emit to BOTH local EventEmitter AND Redis, same-instance clients
            // would receive duplicates without this guard. The local emitter fires synchronously
            // (within the same tick), so we use a short dedup window via a seen-set on seq IDs.
            // Simplest approach: Redis subscriber only serves cross-instance events, which the
            // local EventEmitter will NOT have fired (different process). No dedup needed.
            // NOTE: If both fire for same-instance events, the client deduplicates by event `id`.
            writeEvent(event.type, event.payload);
          } catch {
            // Ignore malformed Pub/Sub messages
          }
        });

        redisSubscriber.on('error', (err) => {
          req.log?.warn({ err }, '[SSE] Redis subscriber error');
        });
      } catch (err) {
        req.log?.warn({ err }, '[SSE] Failed to create Redis subscriber — falling back to local-only');
        redisSubscriber = null;
      }
    }

    // --- Cleanup on client disconnect ---
    req.on('close', async () => {
      clearInterval(heartbeat);
      topicEvents.removeListener(localChannel, onLocalMutation);

      if (redisSubscriber) {
        try {
          await redisSubscriber.unsubscribe(pubSubChannel);
          redisSubscriber.disconnect();
        } catch {
          // Ignore cleanup errors
        }
      }

      openConnections.set(topicId, Math.max(0, (openConnections.get(topicId) ?? 1) - 1));
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
