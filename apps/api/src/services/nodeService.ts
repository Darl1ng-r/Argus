import { db } from '../db.js';
import { User, ClaimNode } from './graphTypes.js';
import { invalidateTopicCache } from '../redis.js';
import { emitTopicMutation } from './topicEvents.js';
import { createNotification } from './notificationService.js';
import { ValidationError } from '../utils/sanitizer.js';

export function rowToNode(
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
    ...(row.author_username ? { authorUsername: row.author_username as string } : {}),
    createdAt: (row.created_at as Date).toISOString(),
    hasMoreChildren: Boolean(row.has_more_children),
  };
}

export async function detectCycle(
  topicId: string,
  proposedParentId: string,
  proposedChildId?: string
): Promise<boolean> {
  if (proposedChildId && proposedParentId === proposedChildId) return true;
  if (!proposedChildId) return false;

  const res = await db.query<{ ancestor_id: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT parent_id AS ancestor_id FROM nodes WHERE id = $1 AND topic_id = $2
       UNION ALL
       SELECT n.parent_id
       FROM nodes n
       JOIN ancestors a ON n.id = a.ancestor_id
       WHERE n.topic_id = $2 AND n.parent_id IS NOT NULL
     )
     SELECT ancestor_id FROM ancestors WHERE ancestor_id = $3 LIMIT 1;`,
    [proposedParentId, topicId, proposedChildId]
  );

  return res.rowCount! > 0;
}

export async function addClaimNode(
  topicId: string,
  parentId: string,
  user: User,
  edgeType: 'supports' | 'refutes' | 'clarifies' | 'evidence',
  content: string
): Promise<ClaimNode> {
  const MAX_NODES_PER_USER_PER_TOPIC_PER_DAY = 50;
  const quotaResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM nodes
     WHERE topic_id = $1 AND author_id = $2
       AND created_at > NOW() - INTERVAL '24 hours'`,
    [topicId, user.id]
  );
  if (parseInt(quotaResult.rows[0].count, 10) >= MAX_NODES_PER_USER_PER_TOPIC_PER_DAY) {
    throw new ValidationError(
      `Daily node quota exceeded: maximum ${MAX_NODES_PER_USER_PER_TOPIC_PER_DAY} claims per topic per 24 hours.`
    );
  }

  const parentResult = await db.query<{
    id: string;
    pos_x: number;
    pos_y: number;
    author_id: string;
  }>(
    'SELECT id, pos_x, pos_y, author_id FROM nodes WHERE id = $1 AND topic_id = $2 AND status = $3',
    [parentId, topicId, 'ACTIVE']
  );

  if (parentResult.rowCount === 0) {
    throw new ValidationError(`Parent node not found or inactive: ${parentId}`);
  }

  const parent = parentResult.rows[0];

  const countResult = await db.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM nodes WHERE parent_id = $1 AND topic_id = $2',
    [parentId, topicId]
  );
  const siblingCount = parseInt(countResult.rows[0].count, 10);

  const HORIZONTAL_SPACING = 280;
  const VERTICAL_SPACING = 160;

  const posX = parent.pos_x + (siblingCount % 2 === 0 ? 1 : -1) * Math.ceil(siblingCount / 2) * HORIZONTAL_SPACING;
  const posY = parent.pos_y + VERTICAL_SPACING;

  const nodeResult = await db.query<{
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
    `INSERT INTO nodes (
       topic_id, parent_id, author_id, edge_type,
       pos_x, pos_y, content, support_score, contest_score, is_steel, version, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, FALSE, 1, 'ACTIVE')
     RETURNING id, parent_id, author_id, edge_type, pos_x, pos_y, content,
               support_score, contest_score, is_steel, created_at`,
    [topicId, parentId, user.id, edgeType, posX, posY, content]
  );

  const row = nodeResult.rows[0];
  const newNode: ClaimNode = {
    id: row.id,
    parent: row.parent_id,
    edgeType: row.edge_type as ClaimNode['edgeType'],
    x: Number(row.pos_x),
    y: Number(row.pos_y),
    content: row.content,
    support: Number(row.support_score),
    contest: Number(row.contest_score),
    steel: Boolean(row.is_steel),
    userVote: null,
    authorId: row.author_id,
    createdAt: row.created_at.toISOString(),
  };

  await invalidateTopicCache(topicId);
  emitTopicMutation(topicId, 'node_added', newNode);

  if (parent.author_id !== user.id) {
    createNotification(
      parent.author_id,
      user.id,
      'NODE_REPLIED',
      topicId,
      newNode.id,
      `${user.username} replied to your claim: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`
    ).catch(() => {});
  }

  return newNode;
}

export async function updateClaimNode(
  topicId: string,
  nodeId: string,
  newContent: string,
  editorUser: User
): Promise<ClaimNode> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{
      content: string;
      version: number;
      author_id: string;
      edge_type: string;
    }>(
      'SELECT content, version, author_id, edge_type FROM nodes WHERE id = $1 AND topic_id = $2 AND status = $3',
      [nodeId, topicId, 'ACTIVE']
    );

    if (existing.rowCount === 0) {
      throw new ValidationError(`Node not found or inactive: ${nodeId}`);
    }

    const { content: oldContent, version: oldVersion } = existing.rows[0];

    await client.query(
      `INSERT INTO node_versions (node_id, content, version, edited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (node_id, version) DO NOTHING`,
      [nodeId, oldContent, oldVersion, editorUser.id]
    );

    const updateRes = await client.query(
      `UPDATE nodes
       SET content = $1, version = version + 1
       WHERE id = $2 AND topic_id = $3
       RETURNING id, parent_id, author_id, edge_type, pos_x, pos_y, content,
                 support_score, contest_score, is_steel, created_at`,
      [newContent, nodeId, topicId]
    );

    await client.query('COMMIT');

    const node = rowToNode(updateRes.rows[0] as unknown as Record<string, unknown>);

    await invalidateTopicCache(topicId);
    emitTopicMutation(topicId, 'node_updated', node);

    return node;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const NODE_DELETE_GRACE_PERIOD_MS = 15 * 60 * 1000;

export async function deleteClaimNode(
  topicId: string,
  nodeId: string,
  requestingUser: User,
  byTopicOwner = false
): Promise<{ nodeId: string; status: string }> {
  const nodeRes = await db.query<{
    author_id: string;
    edge_type: string;
    status: string;
    created_at: Date;
  }>(
    'SELECT author_id, edge_type, status, created_at FROM nodes WHERE id = $1 AND topic_id = $2',
    [nodeId, topicId]
  );

  if (nodeRes.rowCount === 0) {
    throw new ValidationError(`Node not found: ${nodeId}`);
  }

  const { author_id, edge_type, status, created_at } = nodeRes.rows[0];

  if (edge_type === 'root') {
    throw new ValidationError('Root nodes cannot be deleted. Delete the entire topic instead.');
  }

  if (status !== 'ACTIVE') {
    throw new ValidationError(`Node is already ${status} and cannot be deleted.`);
  }

  if (!byTopicOwner) {
    // isAuthor = the requesting user IS the node's author (fix: was incorrectly inverted)
    const isAuthor = requestingUser.id === author_id;
    if (isAuthor) {
      // Authors can only delete within the 15-minute grace period
      const ageMs = Date.now() - new Date(created_at).getTime();
      if (ageMs > NODE_DELETE_GRACE_PERIOD_MS) {
        throw new ValidationError(
          'Self-deletion window has passed. Claims older than 15 minutes cannot be deleted.'
        );
      }
    } else {
      // Non-authors cannot delete nodes they didn't write
      // (topic owners bypass this via requireTopicRole check at the route level)
      throw new ValidationError('Forbidden: you can only delete your own claims.');
    }
  }

  const childCount = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM nodes WHERE parent_id = $1 AND topic_id = $2 AND status = 'ACTIVE'`,
    [nodeId, topicId]
  );
  if (parseInt(childCount.rows[0].count, 10) > 0) {
    throw new ValidationError(
      'Cannot delete a claim that has active replies. Remove all child claims first.'
    );
  }

  const updateRes = await db.query(
    `UPDATE nodes SET status = 'REMOVED' WHERE id = $1 AND topic_id = $2 RETURNING id, status`,
    [nodeId, topicId]
  );

  if (updateRes.rowCount === 0) {
    throw new ValidationError(`Node not found: ${nodeId}`);
  }

  await invalidateTopicCache(topicId);
  emitTopicMutation(topicId, 'node_deleted', { nodeId, status: 'REMOVED' });

  return { nodeId, status: 'REMOVED' };
}

export async function getNodeVersionHistory(nodeId: string): Promise<import('./graphTypes.js').NodeVersion[]> {
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
     ORDER BY version ASC`,
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

export async function getNodeById(topicId: string, nodeId: string, currentUserId?: string): Promise<ClaimNode | null> {
  const res = await db.query(
    `SELECT n.id, n.parent_id, n.author_id, u.username AS author_username,
            n.edge_type, n.pos_x, n.pos_y, n.content,
            n.support_score, n.contest_score, n.is_steel, n.created_at
     FROM nodes n
     LEFT JOIN users u ON u.id = n.author_id
     WHERE n.id = $1 AND n.topic_id = $2 AND n.status = 'ACTIVE'`,
    [nodeId, topicId]
  );
  if (res.rowCount === 0) return null;

  let userVoteMap: Map<string, 'support' | 'contest'> | undefined;
  if (currentUserId) {
    userVoteMap = new Map();
    const voteRes = await db.query<{ vote_type: string }>(
      'SELECT vote_type FROM votes WHERE node_id = $1 AND user_id = $2',
      [nodeId, currentUserId]
    );
    if (voteRes.rowCount! > 0) {
      userVoteMap.set(nodeId, voteRes.rows[0].vote_type.toLowerCase() as 'support' | 'contest');
    }
  }

  return rowToNode(res.rows[0] as Record<string, unknown>, userVoteMap);
}

export async function toggleSteelmanNode(topicId: string, nodeId: string, isSteel: boolean): Promise<ClaimNode> {
  const res = await db.query(
    `UPDATE nodes
     SET is_steel = $1
     WHERE id = $2 AND topic_id = $3 AND status = 'ACTIVE'
     RETURNING id, parent_id, author_id, edge_type, pos_x, pos_y, content,
               support_score, contest_score, is_steel, created_at`,
    [isSteel, nodeId, topicId]
  );
  if (res.rowCount === 0) throw new ValidationError(`Node not found or inactive: ${nodeId}`);

  const node = rowToNode(res.rows[0] as Record<string, unknown>);
  await invalidateTopicCache(topicId);
  emitTopicMutation(topicId, 'node_steelman_toggled', node);
  return node;
}

