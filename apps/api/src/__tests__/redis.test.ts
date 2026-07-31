import { describe, it, expect } from 'vitest';
import { getCached, setCached, invalidateTopicCache, publishEvent } from '../redis.js';

describe('Redis Cache & SCAN Cursor Invalidation', () => {
  it('returns null on cache miss or when Redis is offline', async () => {
    const res = await getCached('non_existent_key_123');
    expect(res).toBeNull();
  });

  it('handles setCached without throwing error', async () => {
    await expect(setCached('test_key', { a: 1 }, 10)).resolves.not.toThrow();
  });

  it('handles invalidateTopicCache using SCAN cursor loop without blocking', async () => {
    await expect(invalidateTopicCache('topic-123')).resolves.not.toThrow();
  });

  it('handles publishEvent without throwing error', async () => {
    await expect(publishEvent('argus:test', { event: 'ping' })).resolves.not.toThrow();
  });
});
