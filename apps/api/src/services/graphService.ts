import { db } from '../db.js';
import { getCached, setCached, invalidateTopicCache } from '../redis.js';
import { emitTopicMutation } from './topicEvents.js';
import { createNotification } from './notificationService.js';
import { ValidationError } from '../utils/sanitizer.js';

export interface ClaimNode {
  id: string;
  parent: string | null;
  edgeType: 'root' | 'supports' | 'refutes' | 'clarifies' | 'evidence';
  x: number;
  y: number;
  content: string;
  support: number;
  contest: number;
  steel: boolean;
  userVote?: 'support' | 'contest' | null;
  authorId: string;
  createdAt: string;
  hasMoreChildren?: boolean;
}

// Fix #6 — enriched topic summary returned by getAllTopics
export interface TopicSummary {
  id: string;
  title: string;
  rootNodeId: string;
  forkCount: number;
  forkedFromId?: string | null;
  createdAt: string;
  claimCount: number;
  rootClaimContent: string | null;
}

export interface Topic {
  id: string;
  title: string;
  rootNodeId: string;
  forkCount: number;
  forkedFromId?: string | null;
  createdAt: string;
  nodes: ClaimNode[];
}

export interface NodeVersion {
  id: string;
  nodeId: string;
  content: string;
  version: number;
  editedBy: string;
  createdAt: string;
}

export interface SearchResults {
  topics: TopicSummary[];
  claims: {
    id: string;
    topicId: string;
    topicTitle: string;
    content: string;
    edgeType: string;
    createdAt: string;
  }[];
}

export interface User {
  id: string;
  clerkId?: string;
  username: string;
  email: string;
  reputation: number;
}

export type TopicRole = 'owner' | 'contributor' | 'viewer';

export interface TopicMember {
  topicId: string;
  userId: string;
  role: TopicRole;
  createdAt: string;
}

// Fix #9 — cursor & offset paginated response wrapper
export interface PaginatedTopics {
  topics: TopicSummary[];
  total: number;
  page?: number;
  limit: number;
  totalPages?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

// -----------------------------------------------------------------------
// RBAC Role Resolution
// -----------------------------------------------------------------------

const ROLE_RANK: Record<TopicRole, number> = {
  owner: 3,
  contributor: 2,
  viewer: 1,
};

/**
 * Checks if a user's role on a topic meets or exceeds the required role rank.
 */
export function hasRequiredRole(userRole: TopicRole | null, requiredRole: TopicRole): boolean {
  if (!userRole) return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

/**
 * Resolves a user's role for a specific topic.
 * - Topic author is automatically 'owner'.
 * - Explicit entry in topic_members table is returned if present.
 * - Any authenticated user defaults to 'contributor' for public topics.
 * - Anonymous users are 'viewer'.
 */
export async function getUserTopicRole(
  topicId: string,
  userId?: string
): Promise<TopicRole> {
  if (!userId) return 'viewer';

  // Check explicit role in topic_members
  const memberRes = await db.query<{ role: TopicRole }>(
    'SELECT role FROM topic_members WHERE topic_id = $1 AND user_id = $2',
    [topicId, userId]
  );
  if (memberRes.rowCount! > 0) {
    return memberRes.rows[0].role;
  }

  // Check if topic author
  const topicRes = await db.query<{ author_id: string }>(
    'SELECT author_id FROM topics WHERE id = $1',
    [topicId]
  );
  if (topicRes.rowCount! > 0 && topicRes.rows[0].author_id === userId) {
    return 'owner';
  }

  // Public debate model: authenticated users default to contributor
  return 'contributor';
}

// -----------------------------------------------------------------------
// Get or Provision User
// -----------------------------------------------------------------------
export async function getOrCreateUser(
  userIdOrClerkId?: string,
  username?: string,
  email?: string
): Promise<User> {
  // SECURITY FIX: Never fall back to the privileged system user for real callers.
  // Callers must pass a valid non-empty identifier; otherwise throw immediately.
  if (!userIdOrClerkId || !userIdOrClerkId.trim()) {
    throw new ValidationError('Cannot resolve user: no valid user ID provided.');
  }

  const inputId = userIdOrClerkId.trim();
  const isClerkId = inputId.startsWith('user_');

  const existing = await db.query<User>(
    'SELECT id, clerk_id AS "clerkId", username, email, reputation FROM users WHERE id = $1 OR clerk_id = $1',
    [inputId]
  );

  if (existing.rowCount! > 0) {
    return existing.rows[0];
  }

  const name =
    username ||
    (inputId === 'system-user-0000-0000-000000000000' ? 'system' : `User_${inputId.slice(-6)}`);
  const userEmail =
    email || `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@argus.local`;

  let created;
  if (isClerkId) {
    created = await db.query<User>(
      `INSERT INTO users (clerk_id, username, email, reputation)
       VALUES ($1, $2, $3, 10)
       RETURNING id, clerk_id AS "clerkId", username, email, reputation`,
      [inputId, name, userEmail]
    );
  } else {
    created = await db.query<User>(
      `INSERT INTO users (id, username, email, reputation)
       VALUES ($1, $2, $3, 10)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
       RETURNING id, clerk_id AS "clerkId", username, email, reputation`,
      [inputId, name, userEmail]
    );
  }

  return created.rows[0];
}

function rowToNode(
  row: Record<string, unknown>,
  userVoteMap?: Map<string, 'support' | 'contest'>
): ClaimNode {
  const id = row.id as string;
  return {
    id,
    parent: (row.parent_id as string | null) ?? null,
    edgeType: (row.edge_type as ClaimNode['edgeType']) ?? 'supports',
    x: Number(row.pos_x),
    y: Number(row.pos_y),
    content: row.content as string,
    support: Number(row.support_score),
    contest: Number(row.contest_score),
    steel: Boolean(row.is_steel),
    userVote: userVoteMap ? userVoteMap.get(id) || null : null,
    authorId: (row.author_id as string) || 'system',
    createdAt: (row.created_at as Date).toISOString(),
    hasMoreChildren: Boolean(row.has_more_children),
  };
}

// -----------------------------------------------------------------------
// CYCLE DETECTION ENGINE (Recursive CTE)
// -----------------------------------------------------------------------
export async function detectCycle(
  topicId: string,
  proposedParentId: string,
  proposedChildId?: string
): Promise<boolean> {
  // Direct self-reference is always a cycle
  if (proposedChildId && proposedParentId === proposedChildId) {
    return true;
  }

  // Without a child ID (new node creation), no cycle is possible since
  // a brand-new leaf node has no outgoing edges.
  if (!proposedChildId) {
    return false;
  }

  // Check whether proposedChildId is an ancestor of proposedParentId
  // (i.e., adding edge parent→child would close a cycle)
  const result = await db.query<{ would_create_cycle: boolean }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id FROM nodes WHERE id = $1 AND topic_id = $3
       UNION ALL
       SELECT n.id, n.parent_id
       FROM nodes n
       JOIN ancestors a ON a.parent_id = n.id
       WHERE n.topic_id = $3
     )
     SELECT EXISTS (
       SELECT 1 FROM ancestors WHERE id = $2
     ) AS would_create_cycle`,
    [proposedParentId, proposedChildId, topicId]
  );

  return Boolean(result.rows[0]?.would_create_cycle);
}

// -----------------------------------------------------------------------
// SUBGRAPH DEPTH LIMITING & LAZY LOADING TRAVERSAL
// -----------------------------------------------------------------------
export async function getTopicSubgraph(
  topicId: string,
  fromNodeId?: string,
  maxDepth: number = 2,
  currentUserId?: string
): Promise<Topic | null> {
  // PERF FIX: Cache the base graph WITHOUT userId so all users share one cache entry.
  // User-specific vote data is loaded separately and merged in memory.
  const baseCacheKey = `subgraph:${topicId}:${fromNodeId || 'root'}:${maxDepth}:base`;
  let baseGraph = await getCached<Topic>(baseCacheKey);

  if (!baseGraph) {
    const topicResult = await db.query<{
      id: string;
      title: string;
      root_node_id: string;
      fork_count: number;
      created_at: Date;
    }>(
      'SELECT id, title, root_node_id, fork_count, created_at FROM topics WHERE id = $1',
      [topicId]
    );

    if (topicResult.rowCount === 0) return null;
    const t = topicResult.rows[0];

    const startNodeId = fromNodeId || t.root_node_id;
    if (!startNodeId) throw new ValidationError('Topic has no root node');

    // PERF FIX: Added LIMIT 500 to prevent OOM on massive graphs.
    // hasMoreChildren flag already signals the client to lazy-load further.
    const nodesResult = await db.query(
      `WITH RECURSIVE subgraph AS (
         SELECT id, parent_id, author_id, edge_type, pos_x, pos_y, content,
                support_score, contest_score, is_steel, created_at, 0 AS depth
         FROM nodes
         WHERE id = $1 AND topic_id = $3 AND status = 'ACTIVE'

         UNION ALL

         SELECT n.id, n.parent_id, n.author_id, n.edge_type, n.pos_x, n.pos_y, n.content,
                n.support_score, n.contest_score, n.is_steel, n.created_at, sg.depth + 1
         FROM nodes n
         JOIN subgraph sg ON sg.id = n.parent_id
         WHERE sg.depth < $2 AND n.topic_id = $3 AND n.status = 'ACTIVE'
       )
       SELECT sg.*,
              EXISTS (
                SELECT 1 FROM nodes child
                WHERE child.parent_id = sg.id AND child.topic_id = $3 AND child.status = 'ACTIVE'
                  AND child.id NOT IN (SELECT id FROM subgraph)
              ) AS has_more_children
       FROM subgraph sg
       ORDER BY sg.pos_y, sg.pos_x
       LIMIT 500`,
      [startNodeId, maxDepth, topicId]
    );

    baseGraph = {
      id: t.id,
      title: t.title,
      rootNodeId: t.root_node_id,
      forkCount: t.fork_count,
      createdAt: t.created_at.toISOString(),
      // Base graph has no userVote data (null for all nodes)
      nodes: nodesResult.rows.map((row) => rowToNode(row, undefined)),
    };

    await setCached(baseCacheKey, baseGraph, 30);
  }

  // If no user, return the shared base graph directly (no vote overlay needed)
  if (!currentUserId) {
    return baseGraph;
  }

  // Lightweight per-user vote overlay — only fetches vote rows, not the full graph
  const userVoteMap = new Map<string, 'support' | 'contest'>();
  const votesResult = await db.query<{ node_id: string; vote_type: string }>(
    `SELECT v.node_id, v.vote_type
     FROM votes v
     JOIN nodes n ON n.id = v.node_id
     WHERE v.user_id = $1 AND n.topic_id = $2`,
    [currentUserId, topicId]
  );
  for (const v of votesResult.rows) {
    userVoteMap.set(v.node_id, v.vote_type.toLowerCase() as 'support' | 'contest');
  }

  // Merge votes into a shallow copy — do NOT mutate the cached base graph
  return {
    ...baseGraph,
    nodes: baseGraph.nodes.map((n) => ({
      ...n,
      userVote: userVoteMap.get(n.id) || null,
    })),
  };
}

export async function getTopic(id: string, currentUserId?: string): Promise<Topic | null> {
  return getTopicSubgraph(id, undefined, 10, currentUserId);
}

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAt, id] = raw.split('|');
    if (createdAt && id) {
      return { createdAt, id };
    }
    return null;
  } catch {
    return null;
  }
}

// Fix #6 — getAllTopics returns enriched data via single JOIN query
// Fix #8 — supports high-performance cursor-based pagination
export async function getAllTopics(
  page = 1,
  limit = 20,
  cursor?: string
): Promise<PaginatedTopics> {
  const fetchLimit = limit + 1; // Fetch 1 extra to determine nextCursor / hasMore

  let whereClause = '';
  const queryParams: unknown[] = [fetchLimit];

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      whereClause = 'WHERE (t.created_at < $2 OR (t.created_at = $2 AND t.id < $3))';
      queryParams.push(decoded.createdAt, decoded.id);
    }
  } else if (page > 1) {
    const offset = (page - 1) * limit;
    whereClause = 'OFFSET $2';
    queryParams.push(offset);
  }

  const [countResult, topicsResult] = await Promise.all([
    db.query<{ total: string }>('SELECT COUNT(*) AS total FROM topics'),
    db.query<{
      id: string;
      title: string;
      root_node_id: string;
      fork_count: number;
      created_at: Date;
      claim_count: string;
      root_claim_content: string | null;
    }>(
      `SELECT
         t.id,
         t.title,
         t.root_node_id,
         t.fork_count,
         t.created_at,
         COUNT(n.id) AS claim_count,
         root_node.content AS root_claim_content
       FROM topics t
       LEFT JOIN nodes n
         ON n.topic_id = t.id AND n.status = 'ACTIVE'
       LEFT JOIN nodes root_node
         ON root_node.id = t.root_node_id
       ${whereClause}
       GROUP BY t.id, root_node.content
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $1`,
      queryParams
    ),
  ]);

  const total = parseInt(countResult.rows[0]?.total || '0', 10);
  const rows = topicsResult.rows;
  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.pop(); // Pop extra item
  }

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
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    nextCursor,
    hasMore,
  };
}

export async function createTopic(title: string, rootClaim: string, authorId: string): Promise<Topic> {
  const user = await getOrCreateUser(authorId);
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const topicResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`,
      [title, user.id]
    );
    const topicId = topicResult.rows[0].id;
    const topicCreatedAt = topicResult.rows[0].created_at;

    const nodeResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, is_steel)
       VALUES ($1, NULL, $2, $3, 'root', 470, 40, 1, TRUE)
       RETURNING id, created_at`,
      [topicId, user.id, rootClaim]
    );
    const rootNodeId = nodeResult.rows[0].id;

    await client.query(
      `INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, 'SUPPORT')`,
      [rootNodeId, user.id]
    );

    await client.query('UPDATE topics SET root_node_id = $1 WHERE id = $2', [rootNodeId, topicId]);

    // Record owner role in topic_members
    await client.query(
      `INSERT INTO topic_members (topic_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [topicId, user.id]
    );

    await client.query('COMMIT');

    return {
      id: topicId,
      title,
      rootNodeId,
      forkCount: 0,
      createdAt: topicCreatedAt.toISOString(),
      nodes: [
        {
          id: rootNodeId,
          parent: null,
          edgeType: 'root',
          x: 470,
          y: 40,
          content: rootClaim,
          support: 1,
          contest: 0,
          steel: true,
          userVote: 'support',
          authorId: user.id,
          createdAt: nodeResult.rows[0].created_at.toISOString(),
        },
      ],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function addClaimNode(
  topicId: string,
  parentId: string,
  authorId: string,
  edgeType: 'supports' | 'refutes' | 'clarifies' | 'evidence',
  content: string
): Promise<ClaimNode> {
  const user = await getOrCreateUser(authorId);

  // Quota enforcement: Max 50 nodes per user per topic per 24 hours
  const MAX_NODES_PER_USER_PER_TOPIC_PER_DAY = 50;
  const quotaResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM nodes
     WHERE topic_id = $1 AND author_id = $2 AND created_at > NOW() - INTERVAL '24 hours'`,
    [topicId, user.id]
  );
  const userNodeCount = parseInt(quotaResult.rows[0]?.count || '0', 10);
  if (userNodeCount >= MAX_NODES_PER_USER_PER_TOPIC_PER_DAY) {
    throw new ValidationError(
      `Quota exceeded: You can create a maximum of ${MAX_NODES_PER_USER_PER_TOPIC_PER_DAY} claims per topic per 24 hours.`
    );
  }

  const parentResult = await db.query<{ pos_x: number; pos_y: number; author_id: string }>(
    'SELECT pos_x, pos_y, author_id FROM nodes WHERE id = $1 AND topic_id = $2',
    [parentId, topicId]
  );
  if (parentResult.rowCount === 0) throw new ValidationError(`Parent node not found: ${parentId}`);

  const parentX = Number(parentResult.rows[0].pos_x);
  const parentY = Number(parentResult.rows[0].pos_y);
  const parentAuthorId = parentResult.rows[0].author_id;

  const siblingsResult = await db.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM nodes WHERE parent_id = $1 AND topic_id = $2',
    [parentId, topicId]
  );
  const siblingCount = parseInt(siblingsResult.rows[0].count, 10);

  const newX = parentX + siblingCount * 230;
  const newY = parentY + 260;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 0, FALSE)
       RETURNING id, created_at`,
      [topicId, parentId, user.id, content, edgeType, newX, newY]
    );

    const newNodeId = insertResult.rows[0].id;

    await client.query(
      `INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, 'SUPPORT')`,
      [newNodeId, user.id]
    );

    await client.query('COMMIT');

    const resultNode: ClaimNode = {
      id: newNodeId,
      parent: parentId,
      edgeType,
      x: newX,
      y: newY,
      content,
      support: 1,
      contest: 0,
      steel: false,
      userVote: 'support',
      authorId: user.id,
      createdAt: insertResult.rows[0].created_at.toISOString(),
    };

    // Invalidate cached subgraphs and broadcast real-time SSE event
    await invalidateTopicCache(topicId);
    emitTopicMutation(topicId, 'node_added', resultNode);

    // Trigger notification to parent claim author
    createNotification(
      parentAuthorId,
      user.id,
      'NODE_REPLIED',
      topicId,
      newNodeId,
      `Someone added a ${edgeType} claim to your argument.`
    ).catch(() => {});

    return resultNode;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function voteNode(
  topicId: string,
  nodeId: string,
  userId: string,
  voteType: 'support' | 'contest'
): Promise<ClaimNode> {
  const user = await getOrCreateUser(userId);
  const dbVoteType = voteType.toUpperCase();

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const existingVote = await client.query<{ id: string; vote_type: string }>(
      'SELECT id, vote_type FROM votes WHERE node_id = $1 AND user_id = $2',
      [nodeId, user.id]
    );

    let activeUserVote: 'support' | 'contest' | null = voteType;

    if (existingVote.rowCount! > 0) {
      const currentType = existingVote.rows[0].vote_type;
      if (currentType === dbVoteType) {
        // Toggling same vote off
        await client.query('DELETE FROM votes WHERE id = $1', [existingVote.rows[0].id]);
        activeUserVote = null;
      } else {
        await client.query('UPDATE votes SET vote_type = $1 WHERE id = $2', [
          dbVoteType,
          existingVote.rows[0].id,
        ]);
      }
    } else {
      await client.query(
        'INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, $3)',
        [nodeId, user.id, dbVoteType]
      );
    }

    // Recalculate scores
    const counts = await client.query<{ vote_type: string; count: string }>(
      'SELECT vote_type, COUNT(*) as count FROM votes WHERE node_id = $1 GROUP BY vote_type',
      [nodeId]
    );

    let supportScore = 0;
    let contestScore = 0;
    for (const row of counts.rows) {
      if (row.vote_type === 'SUPPORT') supportScore = parseInt(row.count, 10);
      if (row.vote_type === 'CONTEST') contestScore = parseInt(row.count, 10);
    }

    const nodeInfo = await client.query<{ edge_type: string }>(
      'SELECT edge_type FROM nodes WHERE id = $1',
      [nodeId]
    );
    const isRoot = nodeInfo.rows[0]?.edge_type === 'root';
    const isSteel = isRoot || supportScore > contestScore * 1.8;

    const updated = await client.query(
      `UPDATE nodes
       SET support_score = $1,
           contest_score = $2,
           is_steel = $3
       WHERE id = $4 AND topic_id = $5
       RETURNING id, parent_id, author_id, edge_type, pos_x, pos_y, content,
                 support_score, contest_score, is_steel, created_at`,
      [supportScore, contestScore, isSteel, nodeId, topicId]
    );

    await client.query('COMMIT');

    if (updated.rowCount === 0) throw new ValidationError(`Node not found: ${nodeId}`);

    const node = rowToNode(updated.rows[0] as unknown as Record<string, unknown>);
    node.userVote = activeUserVote;

    // Invalidate cached subgraphs and broadcast real-time SSE event
    await invalidateTopicCache(topicId);
    emitTopicMutation(topicId, 'node_voted', node);

    // Trigger notification to claim author
    if (activeUserVote && node.authorId) {
      createNotification(
        node.authorId,
        user.id,
        'NODE_VOTED',
        topicId,
        nodeId,
        `Someone voted ${activeUserVote.toUpperCase()} on your claim.`
      ).catch(() => {});
    }

    return node;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Fix #7 — Replace N-query loop with bulk INSERT ... SELECT
export async function forkTopic(topicId: string, authorId: string): Promise<Topic> {
  const user = await getOrCreateUser(authorId);
  const original = await getTopic(topicId, user.id);
  if (!original) throw new ValidationError(`Topic not found: ${topicId}`);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Increment fork counter on the original
    await client.query('UPDATE topics SET fork_count = fork_count + 1 WHERE id = $1', [topicId]);

    // Create the new forked topic (Item 14: track fork lineage)
    const topicResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id, forked_from_id)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [`${original.title} (Fork)`, user.id, topicId]
    );
    const newTopicId = topicResult.rows[0].id;
    const newTopicCreatedAt = topicResult.rows[0].created_at;

    // Bulk-copy all nodes in a single INSERT ... SELECT with generated new UUIDs.
    // We store the (old_id, new_id) mapping in a temp table to fix parent_id refs.
    await client.query(`
      CREATE TEMP TABLE _fork_id_map ON COMMIT DROP AS
      SELECT
        n.id AS old_id,
        gen_random_uuid()::text AS new_id
      FROM nodes n
      WHERE n.topic_id = $1
    `, [topicId]);

    // Bulk insert all nodes with new IDs and new topic_id, parent_id still NULL
    await client.query(`
      INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type,
                         pos_x, pos_y, support_score, contest_score, is_steel)
      SELECT
        m.new_id,
        $1,
        NULL,
        $2,
        n.content,
        n.edge_type,
        n.pos_x,
        n.pos_y,
        n.support_score,
        n.contest_score,
        n.is_steel
      FROM nodes n
      JOIN _fork_id_map m ON m.old_id = n.id
      WHERE n.topic_id = $3
    `, [newTopicId, user.id, topicId]);

    // Fix up parent_id references using the id map
    await client.query(`
      UPDATE nodes new_node
      SET parent_id = m_parent.new_id
      FROM nodes orig_node
      JOIN _fork_id_map m_self   ON m_self.old_id   = orig_node.id
      JOIN _fork_id_map m_parent ON m_parent.old_id = orig_node.parent_id
      WHERE new_node.id = m_self.new_id
        AND new_node.topic_id = $1
        AND orig_node.parent_id IS NOT NULL
    `, [newTopicId]);

    // Set the new root_node_id
    await client.query(`
      UPDATE topics
      SET root_node_id = (
        SELECT m.new_id FROM _fork_id_map m WHERE m.old_id = $1
      )
      WHERE id = $2
    `, [original.rootNodeId, newTopicId]);

    // Record owner role for the user on their new fork
    await client.query(
      `INSERT INTO topic_members (topic_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [newTopicId, user.id]
    );

    await client.query('COMMIT');

    // Reload the forked topic from DB to return accurate state
    const forked = await getTopic(newTopicId, user.id);
    if (!forked) throw new Error('Fork creation failed unexpectedly');
    return forked;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates the content of a topic's root claim node.
 * Stores previous version into immutable node_versions table (Item 13).
 */
export async function updateRootClaim(
  topicId: string,
  newContent: string,
  editedByUserId?: string
): Promise<ClaimNode> {
  const topicRes = await db.query<{ root_node_id: string }>(
    'SELECT root_node_id FROM topics WHERE id = $1',
    [topicId]
  );
  if (topicRes.rowCount === 0 || !topicRes.rows[0].root_node_id) {
    throw new ValidationError(`Topic not found or has no root node: ${topicId}`);
  }

  const rootNodeId = topicRes.rows[0].root_node_id;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Fetch existing node state for version history snapshot
    const existingNode = await client.query<{ content: string; version: number; author_id: string }>(
      'SELECT content, version, author_id FROM nodes WHERE id = $1 AND topic_id = $2',
      [rootNodeId, topicId]
    );

    if (existingNode.rowCount === 0) {
      throw new ValidationError(`Root node not found: ${rootNodeId}`);
    }

    const { content: oldContent, version: oldVersion, author_id: authorId } = existingNode.rows[0];
    const editor = editedByUserId || authorId;

    // Snapshot current version into immutable node_versions table (Item 13)
    await client.query(
      `INSERT INTO node_versions (node_id, content, version, edited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (node_id, version) DO NOTHING`,
      [rootNodeId, oldContent, oldVersion, editor]
    );

    const updateRes = await client.query(
      `UPDATE nodes
       SET content = $1, version = version + 1
       WHERE id = $2 AND topic_id = $3
       RETURNING id, parent_id, author_id, edge_type, pos_x, pos_y, content,
                 support_score, contest_score, is_steel, created_at`,
      [newContent, rootNodeId, topicId]
    );

    await client.query('COMMIT');

    const node = rowToNode(updateRes.rows[0] as unknown as Record<string, unknown>);

    await invalidateTopicCache(topicId);
    emitTopicMutation(topicId, 'root_updated', node);

    return node;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns immutable edit history for a specific node (Item 13).
 */
export async function getNodeVersionHistory(nodeId: string): Promise<NodeVersion[]> {
  const res = await db.query<{
    id: string;
    node_id: string;
    content: string;
    version: number;
    edited_by: string;
    created_at: Date;
  }>(
    `SELECT id, node_id, content, version, edited_by, created_at
     FROM node_versions
     WHERE node_id = $1
     ORDER BY version DESC`,
    [nodeId]
  );

  return res.rows.map((r) => ({
    id: r.id,
    nodeId: r.node_id,
    content: r.content,
    version: r.version,
    editedBy: r.edited_by,
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Full-text search across topics and nodes using PostgreSQL GIN TSVECTOR indexes (Item 15).
 */
export async function searchDebatesAndClaims(query: string, limit = 20): Promise<SearchResults> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { topics: [], claims: [] };
  }

  const [topicsRes, nodesRes] = await Promise.all([
    db.query<{
      id: string;
      title: string;
      root_node_id: string;
      fork_count: number;
      created_at: Date;
      claim_count: string;
      root_claim_content: string | null;
      forked_from_id: string | null;
    }>(
      `SELECT
         t.id,
         t.title,
         t.root_node_id,
         t.fork_count,
         t.created_at,
         t.forked_from_id,
         COUNT(n.id) AS claim_count,
         root_node.content AS root_claim_content
       FROM topics t
       LEFT JOIN nodes n ON n.topic_id = t.id AND n.status = 'ACTIVE'
       LEFT JOIN nodes root_node ON root_node.id = t.root_node_id
       WHERE t.title_tsv @@ plainto_tsquery('english', $1)
          OR t.title ILIKE '%' || $1 || '%'
       GROUP BY t.id, root_node.content
       ORDER BY ts_rank_cd(t.title_tsv, plainto_tsquery('english', $1)) DESC, t.created_at DESC
       LIMIT $2`,
      [cleanQuery, limit]
    ),
    db.query<{
      id: string;
      topic_id: string;
      topic_title: string;
      content: string;
      edge_type: string;
      created_at: Date;
    }>(
      `SELECT
         n.id,
         n.topic_id,
         t.title AS topic_title,
         n.content,
         n.edge_type,
         n.created_at
       FROM nodes n
       JOIN topics t ON t.id = n.topic_id
       WHERE (n.content_tsv @@ plainto_tsquery('english', $1) OR n.content ILIKE '%' || $1 || '%')
         AND n.status = 'ACTIVE'
       ORDER BY ts_rank_cd(n.content_tsv, plainto_tsquery('english', $1)) DESC, n.created_at DESC
       LIMIT $2`,
      [cleanQuery, limit]
    ),
  ]);

  return {
    topics: topicsRes.rows.map((t) => ({
      id: t.id,
      title: t.title,
      rootNodeId: t.root_node_id,
      forkCount: t.fork_count,
      createdAt: t.created_at.toISOString(),
      claimCount: parseInt(t.claim_count, 10),
      rootClaimContent: t.root_claim_content,
      forkedFromId: t.forked_from_id,
    })),
    claims: nodesRes.rows.map((n) => ({
      id: n.id,
      topicId: n.topic_id,
      topicTitle: n.topic_title,
      content: n.content,
      edgeType: n.edge_type,
      createdAt: n.created_at.toISOString(),
    })),
  };
}

export interface TopicDiffResult {
  baseTopic: Topic;
  compareTopic: Topic;
  diff: {
    addedNodes: ClaimNode[];
    removedNodes: ClaimNode[];
    sharedNodes: ClaimNode[];
  };
}

/**
 * Functional Graph Diffing Engine:
 * Compares two topic graphs (base debate vs. fork debate) and categorizes
 * nodes into added, removed, or shared based on normalized content matching.
 */
export async function compareTopicForks(
  baseTopicId: string,
  compareTopicId: string,
  userId?: string
): Promise<TopicDiffResult> {
  const [baseTopic, compareTopic] = await Promise.all([
    getTopic(baseTopicId, userId),
    getTopic(compareTopicId, userId),
  ]);

  if (!baseTopic) throw new ValidationError(`Base topic not found: ${baseTopicId}`);
  if (!compareTopic) throw new ValidationError(`Comparison topic not found: ${compareTopicId}`);

  const normalize = (text: string) => text.trim().toLowerCase();

  const baseContentMap = new Map<string, ClaimNode>();
  for (const n of baseTopic.nodes) {
    baseContentMap.set(normalize(n.content), n);
  }

  const compareContentMap = new Map<string, ClaimNode>();
  for (const n of compareTopic.nodes) {
    compareContentMap.set(normalize(n.content), n);
  }

  const addedNodes: ClaimNode[] = [];
  const sharedNodes: ClaimNode[] = [];

  for (const n of compareTopic.nodes) {
    if (baseContentMap.has(normalize(n.content))) {
      sharedNodes.push(n);
    } else {
      addedNodes.push(n);
    }
  }

  const removedNodes: ClaimNode[] = [];
  for (const n of baseTopic.nodes) {
    if (!compareContentMap.has(normalize(n.content))) {
      removedNodes.push(n);
    }
  }

  return {
    baseTopic,
    compareTopic,
    diff: {
      addedNodes,
      removedNodes,
      sharedNodes,
    },
  };
}

export interface FlagResult {
  nodeId: string;
  flagCount: number;
  isFlagged: boolean;
  status: string;
}

/**
 * Flags a claim node for moderation (Item 19).
 * Auto-flags the node (status = 'FLAGGED') if it reaches 3 or more flags.
 */
export async function flagClaimNode(
  topicId: string,
  nodeId: string,
  reporterId: string,
  reason: string
): Promise<FlagResult> {
  const user = await getOrCreateUser(reporterId);

  const nodeResult = await db.query<{ id: string; status: string }>(
    'SELECT id, status FROM nodes WHERE id = $1 AND topic_id = $2',
    [nodeId, topicId]
  );
  if (nodeResult.rowCount === 0) {
    throw new ValidationError(`Node not found in topic: ${nodeId}`);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Insert flag report (unique per user per node)
    await client.query(
      `INSERT INTO node_flags (node_id, reporter_id, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (node_id, reporter_id) DO UPDATE SET reason = $3`,
      [nodeId, user.id, reason]
    );

    // Count total unique flags for this node
    const countRes = await client.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM node_flags WHERE node_id = $1',
      [nodeId]
    );
    const flagCount = parseInt(countRes.rows[0].count, 10);

    let currentStatus = nodeResult.rows[0].status;
    const isFlagged = flagCount >= 3;

    // Threshold rule: 3 or more flags automatically updates node status to FLAGGED
    if (isFlagged && currentStatus === 'ACTIVE') {
      await client.query(
        "UPDATE nodes SET status = 'FLAGGED' WHERE id = $1 AND topic_id = $2",
        [nodeId, topicId]
      );
      currentStatus = 'FLAGGED';
    }

    await client.query('COMMIT');

    await invalidateTopicCache(topicId);
    emitTopicMutation(topicId, 'node_flagged' as any, { nodeId, flagCount, isFlagged, status: currentStatus });

    return {
      nodeId,
      flagCount,
      isFlagged,
      status: currentStatus,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Moderator action to explicitly set a node's moderation status (ACTIVE, FLAGGED, REMOVED).
 */
export async function moderateNode(
  topicId: string,
  nodeId: string,
  action: 'FLAG' | 'UNFLAG' | 'REMOVE'
): Promise<{ nodeId: string; status: string }> {
  const newStatus = action === 'FLAG' ? 'FLAGGED' : action === 'REMOVE' ? 'REMOVED' : 'ACTIVE';

  const updateRes = await db.query(
    'UPDATE nodes SET status = $1 WHERE id = $2 AND topic_id = $3 RETURNING id, status',
    [newStatus, nodeId, topicId]
  );

  if (updateRes.rowCount === 0) {
    throw new ValidationError(`Node not found: ${nodeId}`);
  }

  await invalidateTopicCache(topicId);
  emitTopicMutation(topicId, 'node_moderated' as any, { nodeId, status: newStatus });

  return { nodeId, status: newStatus };
}
