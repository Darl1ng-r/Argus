import { db, readDb } from '../db.js';
import { Topic, TopicSummary, PaginatedTopics, ClaimNode, User } from './graphTypes.js';
import { rowToNode } from './nodeService.js';
import { getOrCreateUser } from './userService.js';
import { getCached, setCached, invalidateTopicCache, invalidateCacheTag } from '../redis.js';
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
  authorId: string,
  isPrivate = false
): Promise<Topic> {
  const user = await getOrCreateUser(authorId);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const topicRes = await client.query<{ id: string; created_at: Date; is_private: boolean }>(
      `INSERT INTO topics (title, author_id, root_node_id, fork_count, is_private)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 0, $3)
       RETURNING id, created_at, is_private`,
      [title, user.id, isPrivate]
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
    await invalidateCacheTag('topics_list');

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
      authorUsername: user.username,
      createdAt: createdAt.toISOString(),
    };

    return {
      id: topicId,
      title,
      rootNodeId,
      forkCount: 0,
      authorId: user.id,
      authorUsername: user.username,
      isPrivate,
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

const MOCK_TOPICS: TopicSummary[] = [
  {
    id: "ai-sentience-personhood",
    title: "Should autonomous AI systems demonstrating sentience be granted legal personhood?",
    rootNodeId: "ai-root",
    forkCount: 18,
    createdAt: new Date().toISOString(),
    claimCount: 7,
    rootClaimContent: "Autonomous AI systems exhibiting verified metacognition and phenomenal sentience should be granted legal personhood and moral rights."
  },
  {
    id: "mars-vs-earth",
    title: "Should humanity prioritize multi-planetary colonization over planetary stewardship of Earth?",
    rootNodeId: "mars-root",
    forkCount: 24,
    createdAt: new Date().toISOString(),
    claimCount: 7,
    rootClaimContent: "Humanity's highest existential imperative is establishing self-sufficient off-world colonies on Mars and the Moon before 2100."
  },
  {
    id: "free-will-determinism",
    title: "Is human free will an illusion in a deterministic universe governed by physical law?",
    rootNodeId: "fw-root",
    forkCount: 15,
    createdAt: new Date().toISOString(),
    claimCount: 7,
    rootClaimContent: "Human conscious volition is an emergent illusion; every choice is the deterministic result of prior neurobiological and physical states."
  },
  {
    id: "radical-longevity-ethics",
    title: "Should society pursue biological immortality through genetic and cellular rejuvenation?",
    rootNodeId: "longe-root",
    forkCount: 14,
    createdAt: new Date().toISOString(),
    claimCount: 7,
    rootClaimContent: "Eliminating biological aging and extending the healthy human lifespan indefinitely is a universal moral imperative."
  },
  {
    id: "decentralized-governance-daos",
    title: "Can decentralized autonomous organizations (DAOs) replace traditional representative democracy?",
    rootNodeId: "dao-root",
    forkCount: 9,
    createdAt: new Date().toISOString(),
    claimCount: 7,
    rootClaimContent: "Cryptographic, transparent, and decentralized governance systems are superior to traditional centralized nation-state representative democracy."
  },
  {
    id: "universal-basic-income-automation",
    title: "Is Universal Basic Income (UBI) the only viable economic solution to artificial intelligence displacing cognitive labor?",
    rootNodeId: "ubi-root",
    forkCount: 21,
    createdAt: new Date().toISOString(),
    claimCount: 7,
    rootClaimContent: "Universal Basic Income funded by sovereign wealth funds and automation taxation is essential to prevent systemic economic collapse as AI automates cognitive labor."
  }
];

const MOCK_NODES: ClaimNode[] = [
  {
    id: "root-mars",
    parent: null,
    edgeType: "root",
    x: 610,
    y: 40,
    content: "Humanity should prioritize colonizing Mars over repairing Earth's climate.",
    support: 340,
    contest: 210,
    steel: true,
    userVote: null,
    authorId: "user-1",
    createdAt: new Date().toISOString()
  },
  {
    id: "n1",
    parent: "root-mars",
    edgeType: "supports",
    x: 90,
    y: 300,
    content: "A multi-planet species is far less likely to go extinct from any single catastrophe.",
    support: 512,
    contest: 88,
    steel: true,
    userVote: null,
    authorId: "user-2",
    createdAt: new Date().toISOString()
  },
  {
    id: "n2",
    parent: "root-mars",
    edgeType: "refutes",
    x: 460,
    y: 300,
    content: "Every dollar spent on Mars is a dollar not spent solving a crisis we already know is solvable.",
    support: 405,
    contest: 140,
    steel: true,
    userVote: null,
    authorId: "user-3",
    createdAt: new Date().toISOString()
  },
  {
    id: "n3",
    parent: "root-mars",
    edgeType: "clarifies",
    x: 830,
    y: 300,
    content: "This isn't really either/or — space agencies are under 0.1% of relevant national budgets combined.",
    support: 180,
    contest: 30,
    steel: false,
    userVote: null,
    authorId: "user-4",
    createdAt: new Date().toISOString()
  }
];

export async function getAllTopics(
  page = 1,
  limit = 20,
  cursor?: string,
  currentUserId?: string
): Promise<PaginatedTopics> {
  const cacheKey = `topics_list:p${page}:l${limit}:c${cursor || 'none'}:u${currentUserId || 'anon'}`;
  const cached = await getCached<PaginatedTopics>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const fetchLimit = limit + 1;

    if (cursor) {
      const decoded = decodeCursor(cursor);
      const queryParams: unknown[] = [fetchLimit];
      let whereClause = 'WHERE (t.is_private = FALSE' + (currentUserId ? ' OR t.author_id = $2)' : ')');
      if (currentUserId) {
        queryParams.push(currentUserId);
      }

      if (decoded) {
        const p1 = queryParams.length + 1;
        const p2 = queryParams.length + 2;
        whereClause += ` AND (t.created_at < $${p1} OR (t.created_at = $${p1} AND t.id < $${p2}))`;
        queryParams.push(decoded.createdAt, decoded.id);
      }

      const topicsResult = await readDb.query<{
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
         ${whereClause}
         GROUP BY t.id, u.username, root_node.content
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
        forkedFromId: t.forked_from_id,
        authorId: t.author_id,
        authorUsername: t.author_username || undefined,
        isPrivate: t.is_private,
        createdAt: t.created_at.toISOString(),
        claimCount: parseInt(t.claim_count, 10),
        rootClaimContent: t.root_claim_content,
      }));

      const lastTopic = topics[topics.length - 1];
      const nextCursor = hasMore && lastTopic ? encodeCursor(lastTopic.createdAt, lastTopic.id) : null;

      const result: PaginatedTopics = { topics, total: topics.length, page, limit, nextCursor, hasMore };
      await setCached(cacheKey, result, 30, 'topics_list');
      return result;
    }

    const offset = Math.max(0, (page - 1) * limit);
    const queryParams: unknown[] = [fetchLimit, offset];
    let whereClause = 'WHERE (t.is_private = FALSE' + (currentUserId ? ' OR t.author_id = $3)' : ')');
    if (currentUserId) {
      queryParams.push(currentUserId);
    }

    const topicsResult = await readDb.query<{
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
       ${whereClause}
       GROUP BY t.id, u.username, root_node.content
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $1 OFFSET $2`,
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
      forkedFromId: t.forked_from_id,
      authorId: t.author_id,
      authorUsername: t.author_username || undefined,
      isPrivate: t.is_private,
      createdAt: t.created_at.toISOString(),
      claimCount: parseInt(t.claim_count, 10),
      rootClaimContent: t.root_claim_content,
    }));

    const lastTopic = topics[topics.length - 1];
    const nextCursor = hasMore && lastTopic ? encodeCursor(lastTopic.createdAt, lastTopic.id) : null;

    const result: PaginatedTopics = {
      topics,
      total: topics.length,
      page,
      limit,
      nextCursor,
      hasMore,
    };
    await setCached(cacheKey, result, 30, 'topics_list');
    return result;
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      return { topics: MOCK_TOPICS, total: MOCK_TOPICS.length, page: 1, limit: 20, nextCursor: null, hasMore: false };
    }
    throw err;
  }
}

export async function getTopic(topicId: string, currentUserId?: string): Promise<Topic | null> {
  try {
    const result = await readDb.query<{
      id: string;
      title: string;
      root_node_id: string;
      fork_count: number;
      forked_from_id: string | null;
      author_id: string;
      author_username: string | null;
      is_private: boolean;
      created_at: Date;
    }>(
      `SELECT t.id, t.title, t.root_node_id, t.fork_count, t.forked_from_id,
              t.author_id, u.username AS author_username, t.is_private, t.created_at
       FROM topics t
       LEFT JOIN users u ON u.id = t.author_id
       WHERE t.id = $1`,
      [topicId]
    );

    if (result.rowCount === 0) return null;

    const topicRow = result.rows[0];

    // Privacy Guard: If private and viewer is not author or member, return null
    if (topicRow.is_private) {
      if (!currentUserId) return null;
      if (topicRow.author_id !== currentUserId) {
        const memberRes = await readDb.query(
          'SELECT role FROM topic_members WHERE topic_id = $1 AND user_id = $2',
          [topicId, currentUserId]
        );
        if (memberRes.rowCount === 0) return null;
      }
    }

    const nodes = await getTopicSubgraph(topicId, currentUserId);

    return {
      id: topicRow.id,
      title: topicRow.title,
      rootNodeId: topicRow.root_node_id,
      forkCount: topicRow.fork_count,
      forkedFromId: topicRow.forked_from_id,
      authorId: topicRow.author_id,
      authorUsername: topicRow.author_username || undefined,
      isPrivate: topicRow.is_private,
      createdAt: topicRow.created_at.toISOString(),
      nodes,
    };
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      const foundMock = MOCK_TOPICS.find((t) => t.id === topicId) || MOCK_TOPICS[0];
      return {
        id: foundMock.id,
        title: foundMock.title,
        rootNodeId: foundMock.rootNodeId,
        forkCount: foundMock.forkCount,
        authorId: 'system-user-0000-0000-000000000000',
        isPrivate: false,
        createdAt: foundMock.createdAt,
        nodes: MOCK_NODES,
      };
    }
    throw err;
  }
}

export async function getTopicSubgraph(
  topicId: string,
  currentUserId?: string,
  maxDepth = 10,
  fromNodeId?: string,
  perNodeLimit = 20
): Promise<ClaimNode[]> {
  try {
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
        rootAnchorClause = 'WHERE n.parent_id IS NULL AND n.topic_id = $1 AND n.status = $2';
        queryParams = [topicId, 'ACTIVE', MAX_RECURSION_DEPTH, MAX_PER_NODE_LIMIT, CTE_ROW_CAP];
      }

      const depthParamIndex = fromNodeId ? '$4' : '$3';
      const limitParamIndex = fromNodeId ? '$5' : '$4';
      const capParamIndex = fromNodeId ? '$6' : '$5';

      const nodesResult = await readDb.query(
        `WITH RECURSIVE topic_tree AS (
           SELECT
             n.id, n.parent_id, n.author_id, u.username AS author_username,
             n.edge_type, n.pos_x, n.pos_y, n.content,
             n.support_score, n.contest_score, n.is_steel, n.created_at,
             1 AS depth, 1::bigint AS child_ordinal
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

    const userVotesResult = await readDb.query<{ node_id: string; vote_type: string }>(
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
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      return MOCK_NODES;
    }
    throw err;
  }
}

export async function getTopicFlatNodes(topicId: string): Promise<ClaimNode[]> {
  const res = await readDb.query(
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
  const res = await readDb.query(
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
  // P-1: Lightweight lookup — avoid full recursive CTE just to check existence and get metadata
  const originalMeta = await db.query<{
    id: string;
    title: string;
    root_node_id: string;
    fork_count: number;
    forked_from_id: string | null;
    author_id: string;
    is_private: boolean;
    created_at: Date;
  }>('SELECT id, title, root_node_id, fork_count, forked_from_id, author_id, is_private, created_at FROM topics WHERE id = $1', [topicId]);

  if (originalMeta.rowCount === 0) throw new ValidationError(`Topic not found: ${topicId}`);
  const original = originalMeta.rows[0];

  if (original.is_private && original.author_id !== user.id) {
    throw new ValidationError('Forbidden: Cannot fork a private debate.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const topicRes = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id, root_node_id, fork_count, forked_from_id, is_private)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 0, $3, FALSE)
       RETURNING id, created_at`,
      [original.title, user.id, topicId]
    );
    const newTopicId = topicRes.rows[0].id;
    const newCreatedAt = topicRes.rows[0].created_at;

    const origNodesRes = await client.query<{
      id: string;
      parent_id: string | null;
      author_id: string;
      edge_type: string;
      pos_x: number;
      pos_y: number;
      content: string;
      is_steel: boolean;
    }>(
      `SELECT id, parent_id, author_id, edge_type, pos_x, pos_y, content, is_steel
       FROM nodes
       WHERE topic_id = $1 AND status = 'ACTIVE'`,
      [topicId]
    );

    const idMap = new Map<string, string>();
    for (const n of origNodesRes.rows) {
      idMap.set(n.id, crypto.randomUUID());
    }

    // Topologically sort nodes so parents are always inserted before their children
    const nodeMap = new Map<string, typeof origNodesRes.rows[0]>();
    for (const n of origNodesRes.rows) nodeMap.set(n.id, n);

    const sortedNodes: typeof origNodesRes.rows = [];
    const visited = new Set<string>();

    function visit(node: typeof origNodesRes.rows[0]) {
      if (visited.has(node.id)) return;
      if (node.parent_id && nodeMap.has(node.parent_id)) {
        visit(nodeMap.get(node.parent_id)!);
      }
      visited.add(node.id);
      sortedNodes.push(node);
    }

    for (const n of origNodesRes.rows) {
      visit(n);
    }

    for (const n of sortedNodes) {
      const newId = idMap.get(n.id)!;
      const newParentId = n.parent_id ? (idMap.get(n.parent_id) || null) : null;
      await client.query(
        `INSERT INTO nodes (
           id, topic_id, parent_id, author_id, edge_type,
           pos_x, pos_y, content, support_score, contest_score, is_steel, version, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, 1, 'ACTIVE')`,
        [newId, newTopicId, newParentId, n.author_id, n.edge_type, n.pos_x, n.pos_y, n.content, n.is_steel]
      );
    }

    const newRootNodeId = idMap.get(original.root_node_id) || origNodesRes.rows[0]?.id;
    if (newRootNodeId) {
      await client.query(
        `UPDATE topics SET root_node_id = $1 WHERE id = $2`,
        [newRootNodeId, newTopicId]
      );
    }

    await client.query(
      `INSERT INTO topic_members (topic_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [newTopicId, user.id]
    );

    await client.query('UPDATE topics SET fork_count = fork_count + 1 WHERE id = $1', [topicId]);

    await client.query('COMMIT');
    await invalidateCacheTag('topics_list');

    const newNodes = await getTopicSubgraph(newTopicId, user.id);

    // Notify original author if they are not the one forking
    if (original.author_id !== user.id) {
      createNotification(
        original.author_id,
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
      rootNodeId: newRootNodeId,
      forkCount: 0,
      forkedFromId: topicId,
      authorId: user.id,
      authorUsername: user.username,
      isPrivate: false,
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

export async function deleteTopic(topicId: string): Promise<{ topicId: string; status: string }> {
  const res = await db.query('DELETE FROM topics WHERE id = $1 RETURNING id', [topicId]);
  if (res.rowCount === 0) throw new ValidationError(`Topic not found: ${topicId}`);
  await invalidateTopicCache(topicId);
  await invalidateCacheTag('topics_list');
  emitTopicMutation(topicId, 'topic_deleted', { topicId });
  return { topicId, status: 'DELETED' };
}
