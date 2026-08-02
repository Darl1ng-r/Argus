import { db } from '../db.js';
import { User, FlagResult } from './graphTypes.js';
import { invalidateTopicCache } from '../redis.js';
import { emitTopicMutation } from './topicEvents.js';
import { ValidationError } from '../utils/sanitizer.js';

export async function flagClaimNode(
  topicId: string,
  nodeId: string,
  user: User,
  reason: string
): Promise<FlagResult> {
  const nodeResult = await db.query<{ id: string; status: string }>(
    'SELECT id, status FROM nodes WHERE id = $1 AND topic_id = $2',
    [nodeId, topicId]
  );
  if (nodeResult.rowCount === 0) {
    throw new ValidationError(`Node not found in topic: ${nodeId}`);
  }

  const existingFlag = await db.query(
    'SELECT id FROM flags WHERE node_id = $1 AND user_id = $2',
    [nodeId, user.id]
  );
  if (existingFlag.rowCount! > 0) {
    throw new ValidationError('You have already flagged this claim node.');
  }

  await db.query(
    `INSERT INTO flags (node_id, user_id, reason)
     VALUES ($1, $2, $3)`,
    [nodeId, user.id, reason]
  );

  const flagCountResult = await db.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM flags WHERE node_id = $1',
    [nodeId]
  );
  const flagCount = parseInt(flagCountResult.rows[0].count, 10);

  let newStatus = nodeResult.rows[0].status;
  if (flagCount >= 3 && newStatus === 'ACTIVE') {
    newStatus = 'FLAGGED';
    await db.query('UPDATE nodes SET status = $1 WHERE id = $2', ['FLAGGED', nodeId]);
    await invalidateTopicCache(topicId);
    emitTopicMutation(topicId, 'node_flagged' as any, { nodeId, status: 'FLAGGED' });
  }

  return { nodeId, status: newStatus };
}

export async function moderateNode(
  topicId: string,
  nodeId: string,
  action: 'approve' | 'remove'
): Promise<FlagResult> {
  const newStatus = action === 'approve' ? 'ACTIVE' : 'REMOVED';

  const updateRes = await db.query(
    'UPDATE nodes SET status = $1 WHERE id = $2 AND topic_id = $3 RETURNING id',
    [newStatus, nodeId, topicId]
  );

  if (updateRes.rowCount === 0) {
    throw new ValidationError(`Node not found: ${nodeId}`);
  }

  await invalidateTopicCache(topicId);
  emitTopicMutation(topicId, 'node_moderated' as any, { nodeId, status: newStatus });

  return { nodeId, status: newStatus };
}
