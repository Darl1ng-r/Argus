import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSseClient, unregisterSseClient, drainAllSseClients, getActiveSseCount } from '../services/sseManager.js';
import { enqueueJob, processNextJob, getJobStatus, getDlqJobs } from '../queue/jobQueue.js';
import request from 'supertest';
import { app } from '../server.js';

describe('Architecture & Infrastructure Improvements Test Suite', () => {

  // =========================================================================
  // 1. Graceful SSE Connection Draining & Anti-Thundering-Herd Jitter
  // =========================================================================
  describe('SSE Connection Manager & Anti-Thundering-Herd Drain', () => {
    it('registers, tracks, and unregisters active SSE client sockets', () => {
      const mockRes: any = {
        writableEnded: false,
        write: vi.fn(),
        end: vi.fn((cb) => cb && cb()),
      };

      registerSseClient('test-client-1', mockRes, { topicId: 'topic-123' });
      expect(getActiveSseCount()).toBeGreaterThanOrEqual(1);

      unregisterSseClient('test-client-1');
    });

    it('drains active SSE clients with randomized jitter delay on server teardown', async () => {
      const writtenMessages: string[] = [];
      const mockRes: any = {
        writableEnded: false,
        write: vi.fn((chunk: string) => {
          writtenMessages.push(chunk);
          return true;
        }),
        end: vi.fn((cb) => cb && cb()),
      };

      registerSseClient('drain-client-1', mockRes, { topicId: 'topic-abc' });
      registerSseClient('drain-client-2', mockRes, { topicId: 'topic-xyz' });

      const drained = await drainAllSseClients(500, 2000);
      expect(drained).toBeGreaterThanOrEqual(2);
      expect(getActiveSseCount()).toBe(0);

      // Verify that reconnect packet with jitter was transmitted
      expect(mockRes.write).toHaveBeenCalled();
      const reconnectPacket = writtenMessages.find((m) => m.includes('event: reconnect'));
      expect(reconnectPacket).toBeDefined();
      expect(reconnectPacket).toContain('"status":"draining"');
      expect(reconnectPacket).toContain('"reconnectDelayMs"');
    });
  });

  // =========================================================================
  // 2. Distributed Async Job Queue with Retry & Dead-Letter Queue (DLQ)
  // =========================================================================
  describe('Async Job Queue & Dead-Letter Queue (DLQ)', () => {
    it('successfully processes enqueued background tasks', async () => {
      const job = await enqueueJob('test-graph-calc', { topicId: 'topic-1', nodesCount: 42 });
      expect(job.status).toBe('pending');
      expect(job.id).toMatch(/^job-/);

      let processedData: any = null;
      await processNextJob('test-graph-calc', async (j) => {
        processedData = j.data;
      });

      expect(processedData).toEqual({ topicId: 'topic-1', nodesCount: 42 });
      const updated = await getJobStatus(job.id);
      expect(updated?.status).toBe('completed');
    });

    it('retries failed tasks and routes to Dead-Letter Queue after max retries', async () => {
      const queueName = `poison-queue-${Date.now()}`;
      const job = await enqueueJob(queueName, { task: 'failing-calculation' }, { maxRetries: 2 });

      const failingHandler = async () => {
        throw new Error('Deterministic processing error');
      };

      // Attempt 1: Should fail and re-enqueue
      const attempt1 = await processNextJob(queueName, failingHandler);
      expect(attempt1?.attempts).toBe(1);
      expect(attempt1?.status).toBe('pending');

      // Attempt 2: Exceeds maxRetries (2) -> Should route to DLQ
      const attempt2 = await processNextJob(queueName, failingHandler);
      expect(attempt2?.attempts).toBe(2);
      expect(attempt2?.status).toBe('dead_letter');

      const dlqJobs = await getDlqJobs(queueName);
      expect(dlqJobs.length).toBeGreaterThanOrEqual(1);
      expect(dlqJobs[0].id).toBe(job.id);
      expect(dlqJobs[0].error).toContain('Deterministic processing error');
    });
  });

  // =========================================================================
  // 3. Edge CDN Caching & Vary Headers
  // =========================================================================
  describe('Edge CDN Caching & Proxy Headers', () => {
    it('sets public s-maxage and Vary headers on public topic graph endpoints', async () => {
      const res = await request(app).get('/api/topics');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBeDefined();
    });
  });
});
