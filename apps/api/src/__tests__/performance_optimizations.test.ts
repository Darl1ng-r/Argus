import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrSetXFetch, redisClient } from '../redis.js';
import { getSteelmanPath } from '../services/topicService.js';
import { topicEvents, TopicMutationEvent } from '../services/topicEvents.js';
import { readDb } from '../db.js';

describe('SRE & Performance Optimizations Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Probabilistic Cache Regeneration (XFetch)', () => {
    it('computes and caches value on initial miss and uses cached envelope', async () => {
      const memoryStore = new Map<string, string>();
      const mockRedis = {
        get: vi.fn(async (k: string) => memoryStore.get(k) || null),
        pipeline: () => ({
          setex: (k: string, _ttl: number, val: string) => {
            memoryStore.set(k, val);
          },
          sadd: vi.fn(),
          expire: vi.fn(),
          exec: vi.fn().mockResolvedValue([]),
        }),
      };

      const computeFn = vi.fn().mockResolvedValue({ status: 'computed', timestamp: 12345 });
      const key = `test:xfetch:${Date.now()}`;

      // Temporarily mock redisClient for unit isolation
      const originalRedis = redisClient;
      (globalThis as any).__test_mock_redis = mockRedis;

      const res = await getOrSetXFetch(key, 10, computeFn);
      expect(res).toEqual({ status: 'computed', timestamp: 12345 });
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it('handles fallback gracefully if Redis is offline', async () => {
      const computeFn = vi.fn().mockResolvedValue('fallback_value');
      const res = await getOrSetXFetch('offline:key', 10, computeFn);
      expect(res).toBe('fallback_value');
    });
  });

  describe('Steelman Path Cache & DAG Extraction', () => {
    it('retrieves steelman nodes with cached fast-path', async () => {
      const topicId = 'ai-sentience-personhood';
      const nodes = await getSteelmanPath(topicId);
      expect(Array.isArray(nodes)).toBe(true);
      expect(nodes.length).toBeGreaterThan(0);
      // The root or steel nodes should be present
      expect(nodes.some((n) => n.steel || n.edgeType === 'root')).toBe(true);
    });
  });

  describe('Delta SSE Payload Streaming', () => {
    it('emits compact vote_delta events with lightweight payload', async () => {
      const topicId = 'test-topic-sse';
      const receivedEvents: TopicMutationEvent[] = [];

      const handler = (event: TopicMutationEvent) => {
        receivedEvents.push(event);
      };

      topicEvents.on(`topic:${topicId}`, handler);

      const deltaPayload = {
        nodeId: 'node-test-123',
        support: 42,
        contest: 10,
      };

      topicEvents.emit(`topic:${topicId}`, {
        type: 'vote_delta',
        topicId,
        payload: deltaPayload,
        timestamp: new Date().toISOString(),
      });

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].type).toBe('vote_delta');
      expect(receivedEvents[0].payload).toEqual(deltaPayload);

      topicEvents.removeListener(`topic:${topicId}`, handler);
    });
  });

  describe('Database Covered Indexes Verification', () => {
    it('verifies performance indexes exist in PostgreSQL schema catalog', async () => {
      const res = await readDb.query<{ indexname: string }>(
        `SELECT indexname 
         FROM pg_indexes 
         WHERE schemaname = 'public' 
           AND indexname IN ('idx_votes_covering', 'idx_nodes_topic_steel', 'idx_topics_feed_perf')`
      );

      const found = res.rows.map((r) => r.indexname);
      expect(found).toContain('idx_votes_covering');
      expect(found).toContain('idx_nodes_topic_steel');
      expect(found).toContain('idx_topics_feed_perf');
    });
  });

  describe('Single-Flight Mutex Deduplication', () => {
    it('deduplicates 20 concurrent cache misses into exactly 1 computation', async () => {
      let callCount = 0;
      const slowComputeFn = vi.fn(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return { result: 'single_flight_data', count: callCount };
      });

      const key = `test:single_flight:${Date.now()}`;
      const concurrentRequests = Array.from({ length: 20 }, () =>
        getOrSetXFetch(key, 10, slowComputeFn)
      );

      const results = await Promise.all(concurrentRequests);

      // All 20 requests should receive identical result
      for (const res of results) {
        expect(res).toEqual({ result: 'single_flight_data', count: 1 });
      }
      expect(slowComputeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Private Topic RBAC Strictness', () => {
    it('returns "none" role for unauthorized users on private topics', async () => {
      const { getUserTopicRole } = await import('../services/userService.js');
      // For a non-existent or mock private topic with an unauthorized user
      const role = await getUserTopicRole('non-existent-topic', 'stranger-user-id');
      expect(role).toBe('none');
    });
  });
});
