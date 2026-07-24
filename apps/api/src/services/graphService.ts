import { db } from '../db.js';

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
}

export interface Topic {
  id: string;
  title: string;
  rootNodeId: string;
  forkCount: number;
  createdAt: string;
  nodes: ClaimNode[];
}

export interface User {
  id: string;
  username: string;
  email: string;
  reputation: number;
}

// -----------------------------------------------------------------------
// Ensure user exists in DB
// -----------------------------------------------------------------------
export async function getOrCreateUser(userId?: string, username?: string): Promise<User> {
  const id = userId || 'system-user-0000-0000-000000000000';
  const name = username || (id === 'system-user-0000-0000-000000000000' ? 'system' : `User_${id.slice(0, 6)}`);
  const email = `${name.toLowerCase()}@argus.local`;

  const existing = await db.query<User>(
    'SELECT id, username, email, reputation FROM users WHERE id = $1',
    [id]
  );

  if (existing.rowCount! > 0) {
    return existing.rows[0];
  }

  const created = await db.query<User>(
    `INSERT INTO users (id, username, email, reputation)
     VALUES ($1, $2, $3, 10)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
     RETURNING id, username, email, reputation`,
    [id, name, email]
  );

  return created.rows[0];
}

// Helper to convert row to ClaimNode with optional userVote
function rowToNode(row: Record<string, unknown>, userVoteMap?: Map<string, 'support' | 'contest'>): ClaimNode {
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
  };
}

// -----------------------------------------------------------------------
// getTopic — fetch single topic with nodes and active user's votes
// -----------------------------------------------------------------------
export async function getTopic(id: string, currentUserId?: string): Promise<Topic | null> {
  const topicResult = await db.query<{
    id: string;
    title: string;
    root_node_id: string;
    fork_count: number;
    created_at: Date;
  }>(
    'SELECT id, title, root_node_id, fork_count, created_at FROM topics WHERE id = $1',
    [id]
  );

  if (topicResult.rowCount === 0) return null;
  const t = topicResult.rows[0];

  const nodesResult = await db.query(
    `SELECT id, parent_id, author_id, edge_type, pos_x, pos_y, content,
            support_score, contest_score, is_steel, created_at
     FROM nodes
     WHERE topic_id = $1 AND status = 'ACTIVE'
     ORDER BY pos_y, pos_x`,
    [id]
  );

  // Fetch current user's votes for nodes in this topic
  const userVoteMap = new Map<string, 'support' | 'contest'>();
  if (currentUserId) {
    const votesResult = await db.query<{ node_id: string; vote_type: string }>(
      'SELECT node_id, vote_type FROM votes WHERE user_id = $1',
      [currentUserId]
    );
    for (const v of votesResult.rows) {
      userVoteMap.set(v.node_id, v.vote_type.toLowerCase() as 'support' | 'contest');
    }
  }

  return {
    id: t.id,
    title: t.title,
    rootNodeId: t.root_node_id,
    forkCount: t.fork_count,
    createdAt: t.created_at.toISOString(),
    nodes: nodesResult.rows.map(row => rowToNode(row, userVoteMap)),
  };
}

// -----------------------------------------------------------------------
// getAllTopics
// -----------------------------------------------------------------------
export async function getAllTopics(): Promise<Omit<Topic, 'nodes'>[]> {
  const result = await db.query<{
    id: string;
    title: string;
    root_node_id: string;
    fork_count: number;
    created_at: Date;
  }>('SELECT id, title, root_node_id, fork_count, created_at FROM topics ORDER BY created_at DESC');

  return result.rows.map((t) => ({
    id: t.id,
    title: t.title,
    rootNodeId: t.root_node_id,
    forkCount: t.fork_count,
    createdAt: t.created_at.toISOString(),
  }));
}

// -----------------------------------------------------------------------
// createTopic
// -----------------------------------------------------------------------
export async function createTopic(title: string, rootClaim: string, authorId: string): Promise<Topic> {
  await getOrCreateUser(authorId);
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const topicResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`,
      [title, authorId]
    );
    const topicId = topicResult.rows[0].id;
    const topicCreatedAt = topicResult.rows[0].created_at;

    const nodeResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, is_steel)
       VALUES ($1, NULL, $2, $3, 'root', 470, 40, 1, TRUE)
       RETURNING id, created_at`,
      [topicId, authorId, rootClaim]
    );
    const rootNodeId = nodeResult.rows[0].id;

    // Record author's initial support vote
    await client.query(
      `INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, 'SUPPORT')`,
      [rootNodeId, authorId]
    );

    await client.query(
      'UPDATE topics SET root_node_id = $1 WHERE id = $2',
      [rootNodeId, topicId]
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
          authorId,
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

// -----------------------------------------------------------------------
// addClaimNode
// -----------------------------------------------------------------------
export async function addClaimNode(
  topicId: string,
  parentId: string,
  authorId: string,
  edgeType: 'supports' | 'refutes' | 'clarifies' | 'evidence',
  content: string
): Promise<ClaimNode> {
  await getOrCreateUser(authorId);

  const parentResult = await db.query<{ pos_x: number; pos_y: number }>(
    'SELECT pos_x, pos_y FROM nodes WHERE id = $1 AND topic_id = $2',
    [parentId, topicId]
  );
  if (parentResult.rowCount === 0) throw new Error(`Parent node not found: ${parentId}`);

  const parentX = Number(parentResult.rows[0].pos_x);
  const parentY = Number(parentResult.rows[0].pos_y);

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
      [topicId, parentId, authorId, content, edgeType, newX, newY]
    );

    const newNodeId = insertResult.rows[0].id;

    // Record author's initial vote
    await client.query(
      `INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, 'SUPPORT')`,
      [newNodeId, authorId]
    );

    await client.query('COMMIT');

    return {
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
      authorId,
      createdAt: insertResult.rows[0].created_at.toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// voteNode — ENFORCED DEDUPLICATED VOTING
// - Same vote again → remove vote (toggle off)
// - Switch vote type → update vote (Support ↔ Contest)
// - New vote → insert vote
// Recalculates exact score tallies from votes table!
// -----------------------------------------------------------------------
export async function voteNode(
  topicId: string,
  nodeId: string,
  userId: string,
  voteType: 'support' | 'contest'
): Promise<ClaimNode> {
  await getOrCreateUser(userId);
  const dbVoteType = voteType.toUpperCase(); // 'SUPPORT' or 'CONTEST'

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Check existing vote by user on this node
    const existingVote = await client.query<{ id: string; vote_type: string }>(
      'SELECT id, vote_type FROM votes WHERE node_id = $1 AND user_id = $2',
      [nodeId, userId]
    );

    let activeUserVote: 'support' | 'contest' | null = voteType;

    if (existingVote.rowCount! > 0) {
      const currentType = existingVote.rows[0].vote_type;
      if (currentType === dbVoteType) {
        // Toggle OFF vote if clicking same button again
        await client.query('DELETE FROM votes WHERE id = $1', [existingVote.rows[0].id]);
        activeUserVote = null;
      } else {
        // Switch vote type (e.g. SUPPORT -> CONTEST)
        await client.query('UPDATE votes SET vote_type = $1 WHERE id = $2', [
          dbVoteType,
          existingVote.rows[0].id,
        ]);
      }
    } else {
      // Insert new vote
      await client.query(
        'INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, $3)',
        [nodeId, userId, dbVoteType]
      );
    }

    // 2. Recalculate exact vote counts from DB
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

    // 3. Compute steelman standing
    // Root node is always steel; otherwise support > contest * 1.8
    const nodeInfo = await client.query<{ edge_type: string }>(
      'SELECT edge_type FROM nodes WHERE id = $1',
      [nodeId]
    );
    const isRoot = nodeInfo.rows[0]?.edge_type === 'root';
    const isSteel = isRoot || supportScore > contestScore * 1.8;

    // 4. Update nodes table
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

    if (updated.rowCount === 0) throw new Error(`Node not found: ${nodeId}`);

    const node = rowToNode(updated.rows[0] as unknown as Record<string, unknown>);
    node.userVote = activeUserVote;
    return node;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------
// forkTopic
// -----------------------------------------------------------------------
export async function forkTopic(topicId: string, authorId: string): Promise<Topic> {
  await getOrCreateUser(authorId);
  const original = await getTopic(topicId, authorId);
  if (!original) throw new Error(`Topic not found: ${topicId}`);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      'UPDATE topics SET fork_count = fork_count + 1 WHERE id = $1',
      [topicId]
    );

    const topicResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`,
      [`${original.title} (Fork)`, authorId]
    );
    const newTopicId = topicResult.rows[0].id;
    const newTopicCreatedAt = topicResult.rows[0].created_at;

    const idMap = new Map<string, string>();
    const clonedNodes: ClaimNode[] = [];

    for (const node of original.nodes) {
      const nodeResult = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type,
                            pos_x, pos_y, support_score, contest_score, is_steel)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at`,
        [
          newTopicId,
          authorId,
          node.content,
          node.edgeType,
          node.x,
          node.y,
          node.support,
          node.contest,
          node.steel,
        ]
      );
      const newId = nodeResult.rows[0].id;
      idMap.set(node.id, newId);
      clonedNodes.push({
        ...node,
        id: newId,
        parent: node.parent,
        createdAt: nodeResult.rows[0].created_at.toISOString(),
      });
    }

    for (const node of original.nodes) {
      if (node.parent) {
        const newId = idMap.get(node.id)!;
        const newParentId = idMap.get(node.parent)!;
        await client.query(
          'UPDATE nodes SET parent_id = $1 WHERE id = $2',
          [newParentId, newId]
        );
      }
    }

    const newRootId = idMap.get(original.rootNodeId)!;
    await client.query(
      'UPDATE topics SET root_node_id = $1 WHERE id = $2',
      [newRootId, newTopicId]
    );

    await client.query('COMMIT');

    return {
      id: newTopicId,
      title: `${original.title} (Fork)`,
      rootNodeId: newRootId,
      forkCount: 0,
      createdAt: newTopicCreatedAt.toISOString(),
      nodes: clonedNodes.map((n) => ({
        ...n,
        id: idMap.get(n.id) ?? n.id,
        parent: n.parent ? idMap.get(n.parent) ?? null : null,
      })),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
