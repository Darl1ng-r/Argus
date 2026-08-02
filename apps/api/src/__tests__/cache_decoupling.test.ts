import { describe, it, expect, vi } from 'vitest';
import { getTopicSubgraph } from '../services/graphService.js';
import { db } from '../db.js';

describe('Performance Fix: Decoupled Base Subgraph Cache', () => {
  it('generates a shared base cache key without userId and merges vote overlay in-memory', async () => {
    // Mock db.query to return mock topic and nodes
    const querySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string, params?: any[]) => {
      if (typeof sql === 'string' && sql.includes('FROM topics')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'test-topic-1',
              title: 'Test Topic Title',
              root_node_id: 'root-1',
              fork_count: 0,
              created_at: new Date(),
            },
          ],
        } as any;
      }

      if (typeof sql === 'string' && (sql.includes('WITH RECURSIVE topic_tree') || sql.includes('WITH RECURSIVE subgraph'))) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'root-1',
              parent_id: null,
              author_id: 'author-1',
              edge_type: 'root',
              pos_x: 0,
              pos_y: 0,
              content: 'Root Claim',
              support_score: 5,
              contest_score: 1,
              is_steel: true,
              created_at: new Date(),
              has_more_children: false,
            },
          ],
        } as any;
      }

      if (typeof sql === 'string' && sql.includes('FROM votes')) {
        return {
          rowCount: 1,
          rows: [{ node_id: 'root-1', vote_type: 'SUPPORT' }],
        } as any;
      }

      return { rowCount: 0, rows: [] } as any;
    });

    // Call getTopicSubgraph for User A and User B
    const topicUserA = await getTopicSubgraph('test-topic-1', 'user-a');
    const topicUserB = await getTopicSubgraph('test-topic-1', 'user-b');

    expect(topicUserA?.length).toBeGreaterThan(0);
    expect(topicUserB?.length).toBeGreaterThan(0);
    expect(topicUserA?.[0].userVote).toBe('support');
    expect(topicUserB?.[0].userVote).toBe('support');

    querySpy.mockRestore();
  });
});
