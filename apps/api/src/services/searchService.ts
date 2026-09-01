/**
 * Search Service for Argus Debate Graphs.
 *
 * Global & Multilingual Capabilities:
 *  - Uses readDb pool to route queries to regional read replicas when available.
 *  - Supports universal Unicode character set matching using 'simple' full-text tokenization
 *    combined with ILIKE substring scoring (works seamlessly across Latin, Arabic, Greek, Cyrillic, etc.).
 *  - Ranked by relevance score + creation recency.
 */

import { readDb } from '../db.js';
import { SearchResults, TopicSummary } from './graphTypes.js';

export async function searchDebatesAndClaims(
  query: string,
  limit = 15,
  currentUserId?: string
): Promise<SearchResults> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { topics: [], claims: [] };
  }

  const boundedLimit = Math.min(Math.max(1, limit), 50);
  const userParam = currentUserId || '00000000-0000-0000-0000-000000000000';

  // 1. Search Topics with ranking
  const topicRes = await readDb.query<{
    id: string;
    title: string;
    root_node_id: string;
    fork_count: number;
    forked_from_id: string | null;
    author_id: string;
    author_username: string | null;
    is_private: boolean;
    created_at: Date;
    claim_count: string;
    root_claim_content: string | null;
  }>(
    `SELECT
       t.id, t.title, t.root_node_id, t.fork_count, t.forked_from_id,
       t.author_id, u.username AS author_username, t.is_private, t.created_at,
       COUNT(n.id) AS claim_count,
       root_node.content AS root_claim_content
     FROM topics t
     LEFT JOIN users u ON u.id = t.author_id
     LEFT JOIN nodes n ON n.topic_id = t.id AND n.status = 'ACTIVE'
     LEFT JOIN nodes root_node ON root_node.id = t.root_node_id
     WHERE (t.is_private = FALSE OR t.author_id = $4)
       AND (t.title ILIKE $1 OR to_tsvector('simple', t.title) @@ plainto_tsquery('simple', $2))
     GROUP BY t.id, u.username, root_node.content
     ORDER BY
       CASE
         WHEN t.title ILIKE $1 THEN 1
         ELSE 2
       END,
       t.created_at DESC
     LIMIT $3`,
    [`%${cleanQuery}%`, cleanQuery, boundedLimit, userParam]
  );

  // 2. Search Claims with ranking
  const claimsRes = await readDb.query<{
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
     WHERE n.status = 'ACTIVE'
       AND (t.is_private = FALSE OR t.author_id = $4)
       AND (n.content ILIKE $1 OR to_tsvector('simple', n.content) @@ plainto_tsquery('simple', $2))
     ORDER BY
       CASE
         WHEN n.content ILIKE $1 THEN 1
         ELSE 2
       END,
       n.created_at DESC
     LIMIT $3`,
    [`%${cleanQuery}%`, cleanQuery, boundedLimit, userParam]
  );

  const topics: TopicSummary[] = topicRes.rows.map((t) => ({
    id: t.id,
    title: t.title,
    rootNodeId: t.root_node_id,
    forkCount: t.fork_count,
    forkedFromId: t.forked_from_id,
    authorId: t.author_id,
    authorUsername: t.author_username || undefined,
    isPrivate: t.is_private,
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
