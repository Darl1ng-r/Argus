import { describe, it, expect } from 'vitest';
import { getNodeVersionHistory, searchDebatesAndClaims } from '../services/graphService.js';

describe('Audit Fixes: Node Versions, Fork Lineage & Full-Text Search', () => {
  it('returns empty array when searching for non-matching or empty query', async () => {
    const res = await searchDebatesAndClaims('');
    expect(res.topics).toEqual([]);
    expect(res.claims).toEqual([]);
  });

  it('exports getNodeVersionHistory function', () => {
    expect(typeof getNodeVersionHistory).toBe('function');
  });

  it('exports searchDebatesAndClaims function', () => {
    expect(typeof searchDebatesAndClaims).toBe('function');
  });
});
