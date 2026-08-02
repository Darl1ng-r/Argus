import { db } from '../db.js';
import { Topic, TopicSummary, PaginatedTopics, ClaimNode, User } from './graphTypes.js';
import { rowToNode } from './nodeService.js';
import { getOrCreateUser } from './userService.js';
import { getCached, setCached, invalidateTopicCache } from '../redis.js';
import { emitTopicMutation } from './topicEvents.js';
import { createNotification } from './notificationService.js';
import { ValidationError } from '../utils/sanitizer.js';

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}||${id}`).toString('base64');
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const [createdAt, id] = raw.split('||');
    return createdAt && id ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

export async function createTopic(
  title: string,
  rootClaimContent: string,
  authorId: string
): Promise<Topic> {
  const user = await getOrCreateUser(authorId);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const topicRes = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id, root_node_id, fork_count)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 0)
       RETURNING id, created_at`,
      [title, user.id]
    );
    const topicId = topicRes.rows[0].id;
    const createdAt = topicRes.rows[0].created_at;

    const nodeRes = await client.query<{ id: string }>(
      `INSERT INTO nodes (
         topic_id, parent_id, author_id, edge_type,
         pos_x, pos_y, content, support_score, contest_score, is_steel, version, status
       )
       VALUES ($1, NULL, $2, 'root', 0, 0, $3, 0, 0, FALSE, 1, 'ACTIVE')
       RETURNING id`,
      [topicId, user.id, rootClaimContent]
    );
    const rootNodeId = nodeRes.rows[0].id;

    await client.query('UPDATE topics SET root_node_id = $1 WHERE id = $2', [rootNodeId, topicId]);
    await client.query(
      `INSERT INTO topic_members (topic_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [topicId, user.id]
    );

    await client.query('COMMIT');

    const rootNode: ClaimNode = {
      id: rootNodeId,
      parent: null,
      edgeType: 'root',
      x: 0,
      y: 0,
      content: rootClaimContent,
      support: 0,
      contest: 0,
      steel: false,
      userVote: null,
      authorId: user.id,
      createdAt: createdAt.toISOString(),
    };

    return {
      id: topicId,
      title,
      rootNodeId,
      forkCount: 0,
      createdAt: createdAt.toISOString(),
      nodes: [rootNode],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getAllTopics(
  page = 1,
  limit = 20,
  cursor?: string
): Promise<PaginatedTopics> {
  const fetchLimit = limit + 1;

  if (cursor) {
    const decoded = decodeCursor(cursor);
    const queryParams: unknown[] = [fetchLimit];
    let whereClause = '';

    if (decoded) {
      whereClause = 'WHERE (t.created_at < $2 OR (t.created_at = $2 AND t.id < $3))';
      queryParams.push(decoded.createdAt, decoded.id);
    }

    const topicsResult = await db.query<{
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
       ${whereClause}
       GROUP BY t.id, root_node.content
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $1`,
      queryParams
    );

    const rows = topicsResult.rows;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    const topics: TopicSummary[] = rows.map((t) => ({
      id: t.id,
      title: t.title,
      rootNodeId: t.root_node_id,
      forkCount: t.fork_count,
      createdAt: t.created_at.toISOString(),
      claimCount: parseInt(t.claim_count, 10),
      rootClaimContent: t.root_claim_content,
    }));

    const lastTopic = topics[topics.length - 1];
    const nextCursor = hasMore && lastTopic ? encodeCursor(lastTopic.createdAt, lastTopic.id) : null;

    return { topics, total: topics.length, page, limit, nextCursor, hasMore };
  }

  const offset = Math.max(0, (page - 1) * limit);

  const topicsResult = await db.query<{
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
     GROUP BY t.id, root_node.content
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $1 OFFSET $2`,
    [fetchLimit, offset]
  );

  const rows = topicsResult.rows;
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  const topics: TopicSummary[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    rootNodeId: t.root_node_id,
    forkCount: t.fork_count,
    createdAt: t.created_at.toISOString(),
    claimCount: parseInt(t.claim_count, 10),
    rootClaimContent: t.root_claim_content,
  }));

  const lastTopic = topics[topics.length - 1];
  const nextCursor = hasMore && lastTopic ? encodeCursor(lastTopic.createdAt, lastTopic.id) : null;

  return {
    topics,
    total: topics.length,
    page,
    limit,
    nextCursor,
    hasMore,
  };
}

export async function getTopic(topicId: string, currentUserId?: string): Promise<Topic | null> {
  const result = await db.query<{
    id: string;
    title: string;
    root_node_id: string;
    fork_count: number;
    forked_from_id: string | null;
    created_at: Date;
  }>('SELECT id, title, root_node_id, fork_count, forked_from_id, created_at FROM topics WHERE id = $1', [
    topicId,
  ]);

  if (result.rowCount === 0) return null;

  const topicRow = result.rows[0];
  const nodes = await getTopicSubgraph(topicId, currentUserId);

  return {
    id: topicRow.id,
    title: topicRow.title,
    rootNodeId: topicRow.root_node_id,
    forkCount: topicRow.fork_count,
    forkedFromId: topicRow.forked_from_id,
    createdAt: topicRow.created_at.toISOString(),
    nodes,
  };
}

export async function getTopicSubgraph(
  topicId: string,
  currentUserId?: string,
  maxDepth = 10,
  fromNodeId?: string,
  perNodeLimit = 20
): Promise<ClaimNode[]> {
  const MAX_RECURSION_DEPTH = Math.min(Math.max(1, maxDepth), 20);
  const MAX_PER_NODE_LIMIT = Math.min(Math.max(1, perNodeLimit), 50);

  const baseCacheKey = `subgraph:${topicId}:depth:${MAX_RECURSION_DEPTH}:from:${fromNodeId || 'root'}:limit:${MAX_PER_NODE_LIMIT}`;

  let baseGraph = await getCached<{ nodes: ClaimNode[] }>(baseCacheKey);

  if (!baseGraph) {
    const CTE_ROW_CAP = 500;

    let queryParams: unknown[];
    let rootAnchorClause: string;

    if (fromNodeId) {
      rootAnchorClause = 'WHERE n.id = $2 AND n.topic_id = $1 AND n.status = $3';
      queryParams = [topicId, fromNodeId, 'ACTIVE', MAX_RECURSION_DEPTH, MAX_PER_NODE_LIMIT, CTE_ROW_CAP];
    } else {
      rootAnchorClause = 'WHERE n.parent_id IS NULL AND n.topic_id = $1 AND n.status = $3';
      queryParams = [topicId, 'ACTIVE', MAX_RECURSION_DEPTH, MAX_PER_NODE_LIMIT, CTE_ROW_CAP];
    }

    const depthParamIndex = fromNodeId ? '$4' : '$3';
    const limitParamIndex = fromNodeId ? '$5' : '$4';
    const capParamIndex = fromNodeId ? '$6' : '$5';

    const nodesResult = await db.query(
      `WITH RECURSIVE topic_tree AS (
         SELECT
           n.id, n.parent_id, n.author_id, u.username AS author_username,
           n.edge_type, n.pos_x, n.pos_y, n.content,
           n.support_score, n.contest_score, n.is_steel, n.created_at,
           1 AS depth, 1 AS child_ordinal
         FROM nodes n
         LEFT JOIN users u ON u.id = n.author_id
         ${rootAnchorClause}

         UNION ALL

         SELECT
           child.id, child.parent_id, child.author_id, u.username AS author_username,
           child.edge_type, child.pos_x, child.pos_y, child.content,
           child.support_score, child.contest_score, child.is_steel, child.created_at,
           parent.depth + 1 AS depth,
           ROW_NUMBER() OVER (PARTITION BY child.parent_id ORDER BY child.created_at ASC) AS child_ordinal
         FROM nodes child
         JOIN topic_tree parent ON child.parent_id = parent.id
         LEFT JOIN users u ON u.id = child.author_id
         WHERE child.topic_id = $1
           AND child.status = 'ACTIVE'
           AND parent.depth < ${depthParamIndex}
       ),
       bounded_tree AS (
         SELECT * FROM topic_tree
         WHERE child_ordinal <= ${limitParamIndex}
         LIMIT ${capParamIndex}
       )
       SELECT
         bt.*,
         EXISTS (
           SELECT 1 FROM nodes extra
           WHERE extra.parent_id = bt.id AND extra.status = 'ACTIVE'
           LIMIT 1 OFFSET ${limitParamIndex}
         ) AS has_more_children
       FROM bounded_tree bt
       ORDER BY bt.depth ASC, bt.created_at ASC;`,
      queryParams
    );

    baseGraph = {
      nodes: nodesResult.rows.map((row) => rowToNode(row, undefined)),
    };

    await setCached(baseCacheKey, baseGraph, 30, topicId);
  }

  if (!currentUserId) {
    return baseGraph.nodes;
  }

  const userVotesResult = await db.query<{ node_id: string; vote_type: string }>(
    `SELECT v.node_id, v.vote_type
     FROM votes v
     JOIN nodes n ON n.id = v.node_id
     WHERE v.user_id = $1 AND n.topic_id = $2`,
    [currentUserId, topicId]
  );

  const userVoteMap = new Map<string, 'support' | 'contest'>();
  for (const row of userVotesResult.rows) {
    userVoteMap.set(row.node_id, row.vote_type.toLowerCase() as 'support' | 'contest');
  }

  return baseGraph.nodes.map((node) => ({
    ...node,
    userVote: userVoteMap.get(node.id) || null,
  }));
}

export async function getTopicFlatNodes(topicId: string): Promise<ClaimNode[]> {
  const res = await db.query(
    `SELECT
       n.id, n.parent_id, n.author_id, u.username AS author_username,
       n.edge_type, n.pos_x, n.pos_y, n.content,
       n.support_score, n.contest_score, n.is_steel, n.created_at,
       FALSE AS has_more_children
     FROM nodes n
     LEFT JOIN users u ON u.id = n.author_id
     WHERE n.topic_id = $1 AND n.status = 'ACTIVE'
     ORDER BY n.created_at ASC`,
    [topicId]
  );
  return res.rows.map((row) => rowToNode(row as Record<string, unknown>));
}

export async function getSteelmanPath(topicId: string, currentUserId?: string): Promise<ClaimNode[]> {
  const res = await db.query(
    `SELECT
       n.id, n.parent_id, n.author_id, u.username AS author_username,
       n.edge_type, n.pos_x, n.pos_y, n.content,
       n.support_score, n.contest_score, n.is_steel, n.created_at,
       FALSE AS has_more_children
     FROM nodes n
     LEFT JOIN users u ON u.id = n.author_id
     WHERE n.topic_id = $1 AND n.status = 'ACTIVE' AND n.is_steel = TRUE
     ORDER BY n.support_score DESC`,
    [topicId]
  );

  let userVoteMap: Map<string, 'support' | 'contest'> | undefined;
  if (currentUserId) {
    userVoteMap = new Map();
    const votesRes = await db.query<{ node_id: string; vote_type: string }>(
      `SELECT node_id, vote_type FROM votes WHERE user_id = $1 AND node_id = ANY($2::text[])`,
      [currentUserId, res.rows.map((r) => r.id)]
    );
    for (const v of votesRes.rows) {
      userVoteMap.set(v.node_id, v.vote_type.toLowerCase() as 'support' | 'contest');
    }
  }

  return res.rows.map((row) => rowToNode(row as Record<string, unknown>, userVoteMap));
}

export async function updateRootClaim(topicId: string, newContent: string): Promise<ClaimNode> {
  const topicRes = await db.query<{ root_node_id: string }>(
    'SELECT root_node_id FROM topics WHERE id = $1',
    [topicId]
  );
  if (topicRes.rowCount === 0) {
    throw new ValidationError(`Topic not found: ${topicId}`);
  }
  const rootNodeId = topicRes.rows[0].root_node_id;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE nodes
       SET content = $1, version = version + 1
       WHERE id = $2 AND topic_id = $3
       RETURNING id`,
      [newContent, rootNodeId, topicId]
    );

    await client.query('UPDATE topics SET title = $1 WHERE id = $2', [newContent, topicId]);

    const updatedNodeRes = await client.query<{
      id: string;
      parent_id: string | null;
      author_id: string;
      edge_type: string;
      pos_x: number;
      pos_y: number;
      content: string;
      support_score: number;
      contest_score: number;
      is_steel: boolean;
      created_at: Date;
    }>(
      `SELECT id, parent_id, author_id, edge_type, pos_x, pos_y, content,
              support_score, contest_score, is_steel, created_at
       FROM nodes WHERE id = $1`,
      [rootNodeId]
    );

    await client.query('COMMIT');

    const updatedNode = rowToNode(updatedNodeRes.rows[0] as unknown as Record<string, unknown>);

    await invalidateTopicCache(topicId);
    emitTopicMutation(topicId, 'root_updated', updatedNode);

    return updatedNode;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function forkTopic(topicId: string, user: User): Promise<Topic> {
  const original = await getTopic(topicId, user.id);
  if (!original) throw new ValidationError(`Topic not found: ${topicId}`);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const topicRes = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id, root_node_id, fork_count, forked_from_id)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 0, $3)
       RETURNING id, created_at`,
      [original.title, user.id, topicId]
    );
    const newTopicId = topicRes.rows[0].id;
    const newCreatedAt = topicRes.rows[0].created_at;

    await client.query(
      `INSERT INTO nodes (
         id, topic_id, parent_id, author_id, edge_type,
         pos_x, pos_y, content, support_score, contest_score, is_steel, version, status
       )
       SELECT
         id, $1 AS topic_id, parent_id, author_id, edge_type,
         pos_x, pos_y, content, 0 AS support_score, 0 AS contest_score,
         is_steel, version, status
       FROM nodes
       WHERE topic_id = $2 AND status = 'ACTIVE'`,
      [newTopicId, topicId]
    );

    await client.query(
      `UPDATE topics SET root_node_id = $1 WHERE id = $2`,
      [original.rootNodeId, newTopicId]
    );

    await client.query(
      `INSERT INTO topic_members (topic_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [newTopicId, user.id]
    );

    await client.query('UPDATE topics SET fork_count = fork_count + 1 WHERE id = $1', [topicId]);

    await client.query('COMMIT');

    const newNodes = await getTopicSubgraph(newTopicId, user.id);

    if (original.nodes.length > 0 && original.nodes[0].authorId !== user.id) {
      createNotification(
        original.nodes[0].authorId,
        user.id,
        'TOPIC_FORKED',
        newTopicId,
        null,
        `${user.username} forked your debate "${original.title}".`
      ).catch(() => {});
    }

    return {
      id: newTopicId,
      title: original.title,
      rootNodeId: original.rootNodeId,
      forkCount: 0,
      forkedFromId: topicId,
      createdAt: newCreatedAt.toISOString(),
      nodes: newNodes,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
