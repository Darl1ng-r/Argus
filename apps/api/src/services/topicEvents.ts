import { EventEmitter } from 'events';
import { redisClient, publishEvent } from '../redis.js';

// ---------------------------------------------------------------------------
// In-process EventEmitter (local fan-out within a single API instance)
// ---------------------------------------------------------------------------
class TopicEventEmitter extends EventEmitter {}
export const topicEvents = new TopicEventEmitter();
topicEvents.setMaxListeners(0); // Unlimited — managed per-topic in SSE handler

export interface TopicMutationEvent {
  type: 'node_added' | 'node_voted' | 'root_updated';
  topicId: string;
  payload: unknown;
  timestamp: string;
}

/**
 * Emits a topic mutation event:
 *  1. Publishes to Redis Pub/Sub so ALL API instances receive it (horizontal scale fix).
 *  2. Also emits locally on the in-process EventEmitter as a fast path for same-instance SSE clients.
 *
 * SSE handlers subscribe to the Redis channel and the local EventEmitter — whichever
 * fires first delivers the event; deduplication is by event sequence ID on the client.
 */
export function emitTopicMutation(
  topicId: string,
  type: TopicMutationEvent['type'],
  payload: unknown
): void {
  const event: TopicMutationEvent = {
    type,
    topicId,
    payload,
    timestamp: new Date().toISOString(),
  };

  // Local fan-out (same instance SSE clients)
  topicEvents.emit(`topic:${topicId}`, event);

  // Cross-instance fan-out via Redis Pub/Sub
  // Fire-and-forget: non-critical — local path already delivered to same-instance clients
  if (redisClient) {
    publishEvent(`argus:topic:${topicId}`, event).catch(() => {
      // Swallow — Redis being offline should not break mutations
    });
  }
}

/**
 * Returns the Redis Pub/Sub channel name for a given topic ID.
 * Used by SSE handlers to subscribe for cross-instance events.
 */
export function topicPubSubChannel(topicId: string): string {
  return `argus:topic:${topicId}`;
}
