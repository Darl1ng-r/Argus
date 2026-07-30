import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../services/graphService.js';

describe('Cursor Pagination Utilities', () => {
  it('encodes and decodes cursor strings correctly', () => {
    const createdAt = new Date().toISOString();
    const id = 'topic-123-abc';

    const encoded = encodeCursor(createdAt, id);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toBe(`${createdAt}|${id}`);

    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt).toBe(createdAt);
    expect(decoded?.id).toBe(id);
  });

  it('returns null for malformed cursor strings', () => {
    expect(decodeCursor('invalid-cursor-123!!!')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});
