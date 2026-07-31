import { describe, it, expect, vi } from 'vitest';
import { getTopicSubgraph } from '../services/graphService.js';
import { db } from '../db.js';

describe('Performance Fix: CTE Row Limit & Memory Protection', () => {
  it('enforces row limit safety on recursive graph query', async () => {
    let executedSql = '';

    const querySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string, params?: any[]) => {
      if (typeof sql === 'string') {
        executedSql += sql + '\n';
      }

      if (typeof sql === 'string' && sql.includes('FROM topics')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'large-topic',
              title: 'Large Debate Topic',
              root_node_id: 'root-node-1',
              fork_count: 0,
              created_at: new Date(),
            },
          ],
        } as any;
      }

      if (typeof sql === 'string' && sql.includes('WITH RECURSIVE subgraph')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'root-node-1',
              parent_id: null,
              author_id: 'author-1',
              edge_type: 'root',
              pos_x: 0,
              pos_y: 0,
              content: 'Root Claim',
              support_score: 10,
              contest_score: 2,
              is_steel: true,
              created_at: new Date(),
              has_more_children: true,
            },
          ],
        } as any;
      }

      return { rowCount: 0, rows: [] } as any;
    });

    const topic = await getTopicSubgraph('large-topic', undefined, 5);

    expect(topic).not.toBeNull();
    // Verify that the executed SQL query contains LIMIT 500
    expect(executedSql).toContain('LIMIT 500');

    querySpy.mockRestore();
  });
});
