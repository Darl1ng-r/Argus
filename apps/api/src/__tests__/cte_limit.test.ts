import { describe, it, expect, vi } from 'vitest';
import { getTopicSubgraph } from '../services/graphService.js';
import { db, readDb } from '../db.js';

describe('Performance Fix: CTE Row Limit & Memory Protection', () => {
  it('enforces row limit safety on recursive graph query', async () => {
    let executedSql = '';

    const querySpy = vi.spyOn(readDb, 'query').mockImplementation(async (sql: string, params?: any[]) => {
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

      if (typeof sql === 'string' && (sql.includes('WITH RECURSIVE topic_tree') || sql.includes('WITH RECURSIVE subgraph'))) {
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
    // Verify that the executed SQL query contains bounded_tree or LIMIT parameter for row cap
    expect(executedSql).toMatch(/LIMIT \$5|LIMIT 500/);

    querySpy.mockRestore();
  });
});
