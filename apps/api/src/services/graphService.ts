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

// Map a DB row to the frontend ClaimNode shape
function rowToNode(row: Record<string, unknown>): ClaimNode {
  return {
    id: row.id as string,
    parent: (row.parent_id as string | null) ?? null,
    edgeType: (row.edge_type as ClaimNode['edgeType']) ?? 'supports',
    x: Number(row.pos_x),
    y: Number(row.pos_y),
    content: row.content as string,
    support: Number(row.support_score),
    contest: Number(row.contest_score),
    steel: Boolean(row.is_steel),
    createdAt: (row.created_at as Date).toISOString(),
  };
}

// -----------------------------------------------------------------------
// getTopic — fetch a single topic with all its nodes
// -----------------------------------------------------------------------
export async function getTopic(id: string): Promise<Topic | null> {
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
    `SELECT id, parent_id, edge_type, pos_x, pos_y, content,
            support_score, contest_score, is_steel, created_at
     FROM nodes
     WHERE topic_id = $1 AND status = 'ACTIVE'
     ORDER BY pos_y, pos_x`,
    [id]
  );

  return {
    id: t.id,
    title: t.title,
    rootNodeId: t.root_node_id,
    forkCount: t.fork_count,
    createdAt: t.created_at.toISOString(),
    nodes: nodesResult.rows.map(rowToNode),
  };
}

// -----------------------------------------------------------------------
// getAllTopics — returns all topics (no nodes)
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
// createTopic — create a new topic with a root claim node
// -----------------------------------------------------------------------
export async function createTopic(title: string, rootClaim: string): Promise<Topic> {
  const systemUserId = 'system-user-0000-0000-000000000000';
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Create topic (without root_node_id yet)
    const topicResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`,
      [title, systemUserId]
    );
    const topicId = topicResult.rows[0].id;
    const topicCreatedAt = topicResult.rows[0].created_at;

    // 2. Create the root node
    const nodeResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, is_steel)
       VALUES ($1, NULL, $2, $3, 'root', 470, 40, 1, TRUE)
       RETURNING id, created_at`,
      [topicId, systemUserId, rootClaim]
    );
    const rootNodeId = nodeResult.rows[0].id;

    // 3. Update topic with root_node_id
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
// addClaimNode — add a child node to a parent
// -----------------------------------------------------------------------
export async function addClaimNode(
  topicId: string,
  parentId: string,
  edgeType: 'supports' | 'refutes' | 'clarifies' | 'evidence',
  content: string
): Promise<ClaimNode> {
  // Fetch parent node position
  const parentResult = await db.query<{
    pos_x: number;
    pos_y: number;
  }>('SELECT pos_x, pos_y FROM nodes WHERE id = $1 AND topic_id = $2', [parentId, topicId]);

  if (parentResult.rowCount === 0) throw new Error(`Parent node not found: ${parentId}`);

  const parentX = Number(parentResult.rows[0].pos_x);
  const parentY = Number(parentResult.rows[0].pos_y);

  // Count existing siblings
  const siblingsResult = await db.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM nodes WHERE parent_id = $1 AND topic_id = $2',
    [parentId, topicId]
  );
  const siblingCount = parseInt(siblingsResult.rows[0].count, 10);

  const newX = parentX + siblingCount * 230;
  const newY = parentY + 260;

  const systemUserId = 'system-user-0000-0000-000000000000';

  const insertResult = await db.query<{
    id: string;
    created_at: Date;
  }>(
    `INSERT INTO nodes (topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 0, FALSE)
     RETURNING id, created_at`,
    [topicId, parentId, systemUserId, content, edgeType, newX, newY]
  );

  const newNode = insertResult.rows[0];

  return {
    id: newNode.id,
    parent: parentId,
    edgeType,
    x: newX,
    y: newY,
    content,
    support: 1,
    contest: 0,
    steel: false,
    createdAt: newNode.created_at.toISOString(),
  };
}

// -----------------------------------------------------------------------
// voteNode — increment support or contest, recompute is_steel
// -----------------------------------------------------------------------
export async function voteNode(
  topicId: string,
  nodeId: string,
  voteType: 'support' | 'contest'
): Promise<ClaimNode> {
  const col = voteType === 'support' ? 'support_score' : 'contest_score';

  const result = await db.query<{
    id: string;
    parent_id: string | null;
    edge_type: string;
    pos_x: number;
    pos_y: number;
    content: string;
    support_score: number;
    contest_score: number;
    is_steel: boolean;
    created_at: Date;
  }>(
    `UPDATE nodes
     SET ${col} = ${col} + 1,
         is_steel = CASE
           WHEN edge_type = 'root' THEN TRUE
           WHEN (support_score + CASE WHEN $1 = 'support' THEN 1 ELSE 0 END) >
                (contest_score + CASE WHEN $1 = 'contest' THEN 1 ELSE 0 END) * 1.8 THEN TRUE
           ELSE FALSE
         END
     WHERE id = $2 AND topic_id = $3
     RETURNING id, parent_id, edge_type, pos_x, pos_y, content,
               support_score, contest_score, is_steel, created_at`,
    [voteType, nodeId, topicId]
  );

  if (result.rowCount === 0) throw new Error(`Node not found: ${nodeId}`);

  return rowToNode(result.rows[0] as unknown as Record<string, unknown>);
}

// -----------------------------------------------------------------------
// forkTopic — deep-copy a topic's nodes and edges
// -----------------------------------------------------------------------
export async function forkTopic(topicId: string): Promise<Topic> {
  const original = await getTopic(topicId);
  if (!original) throw new Error(`Topic not found: ${topicId}`);

  const systemUserId = 'system-user-0000-0000-000000000000';
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Increment fork count on original
    await client.query(
      'UPDATE topics SET fork_count = fork_count + 1 WHERE id = $1',
      [topicId]
    );

    // 2. Create new topic
    const topicResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO topics (title, author_id)
       VALUES ($1, $2)
       RETURNING id, created_at`,
      [`${original.title} (Fork)`, systemUserId]
    );
    const newTopicId = topicResult.rows[0].id;
    const newTopicCreatedAt = topicResult.rows[0].created_at;

    // 3. Clone nodes — build old-id → new-id map
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
          systemUserId,
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

    // 4. Update parent_id references using the id map
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

    // 5. Set root_node_id on new topic
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
