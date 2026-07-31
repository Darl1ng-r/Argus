import { describe, it, expect } from 'vitest';
import { flagClaimNode, moderateNode } from '../services/graphService.js';

describe('Item 19: Moderation System', () => {
  it('exports flagClaimNode and moderateNode service functions', () => {
    expect(typeof flagClaimNode).toBe('function');
    expect(typeof moderateNode).toBe('function');
  });
});
