import { db } from '../db.js';
import { SearchResults, TopicSummary } from './graphTypes.js';

export async function searchDebatesAndClaims(query: string, limit = 10): Promise<SearchResults> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { topics: [], claims: [] };
  }

  const topicRes = await db.query<{
    id: string;
    title: string;
    root_node_id: string;
    fork_count: number;
    created_at: Date;
    claim_count: string;
    root_claim_content: string | null;
  }>(
    `SELECT
       t.id, t.title, t.root_node_id, t.fork_count, t.created_at,
       COUNT(n.id) AS claim_count,
       root_node.content AS root_claim_content
     FROM topics t
     LEFT JOIN nodes n ON n.topic_id = t.id AND n.status = 'ACTIVE'
     LEFT JOIN nodes root_node ON root_node.id = t.root_node_id
     WHERE t.title ILIKE $1
     GROUP BY t.id, root_node.content
     ORDER BY t.created_at DESC
     LIMIT $2`,
    [`%${cleanQuery}%`, limit]
  );

  const claimsRes = await db.query<{
    id: string;
    topic_id: string;
    topic_title: string;
    content: string;
    edge_type: string;
    created_at: Date;
  }>(
    `SELECT
       n.id, n.topic_id, t.title AS topic_title, n.content, n.edge_type, n.created_at
     FROM nodes n
     JOIN topics t ON t.id = n.topic_id
     WHERE n.status = 'ACTIVE' AND n.content ILIKE $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [`%${cleanQuery}%`, limit]
  );

  const topics: TopicSummary[] = topicRes.rows.map((t) => ({
    id: t.id,
    title: t.title,
    rootNodeId: t.root_node_id,
    forkCount: t.fork_count,
    createdAt: t.created_at.toISOString(),
    claimCount: parseInt(t.claim_count, 10),
    rootClaimContent: t.root_claim_content,
  }));

  const claims = claimsRes.rows.map((c) => ({
    id: c.id,
    topicId: c.topic_id,
    topicTitle: c.topic_title,
    content: c.content,
    edgeType: c.edge_type,
    createdAt: c.created_at.toISOString(),
  }));

  return { topics, claims };
}
