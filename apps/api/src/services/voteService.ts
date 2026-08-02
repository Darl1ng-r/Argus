import { db } from '../db.js';
import { User, ClaimNode } from './graphTypes.js';
import { invalidateTopicCache } from '../redis.js';
import { emitTopicMutation } from './topicEvents.js';
import { createNotification } from './notificationService.js';
import { ValidationError } from '../utils/sanitizer.js';

export async function voteNode(
  topicId: string,
  nodeId: string,
  user: User,
  voteType: 'support' | 'contest'
): Promise<ClaimNode> {
  const dbVoteType = voteType.toUpperCase();

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const nodeRes = await client.query<{ author_id: string }>(
      'SELECT author_id FROM nodes WHERE id = $1 AND topic_id = $2 AND status = $3',
      [nodeId, topicId, 'ACTIVE']
    );

    if (nodeRes.rowCount === 0) {
      throw new ValidationError(`Node not found or inactive: ${nodeId}`);
    }

    const nodeAuthorId = nodeRes.rows[0].author_id;

    const existingVoteRes = await client.query<{ vote_type: string }>(
      'SELECT vote_type FROM votes WHERE node_id = $1 AND user_id = $2',
      [nodeId, user.id]
    );

    let newUserVote: 'support' | 'contest' | null = voteType;

    if (existingVoteRes.rowCount! > 0) {
      const currentVoteType = existingVoteRes.rows[0].vote_type;

      if (currentVoteType === dbVoteType) {
        await client.query(
          'DELETE FROM votes WHERE node_id = $1 AND user_id = $2',
          [nodeId, user.id]
        );

        if (currentVoteType === 'SUPPORT') {
          await client.query(
            'UPDATE nodes SET support_score = GREATEST(0, support_score - 1) WHERE id = $1',
            [nodeId]
          );
        } else {
          await client.query(
            'UPDATE nodes SET contest_score = GREATEST(0, contest_score - 1) WHERE id = $1',
            [nodeId]
          );
        }

        newUserVote = null;
      } else {
        await client.query(
          'UPDATE votes SET vote_type = $1 WHERE node_id = $2 AND user_id = $3',
          [dbVoteType, nodeId, user.id]
        );

        if (dbVoteType === 'SUPPORT') {
          await client.query(
            `UPDATE nodes SET
               support_score = support_score + 1,
               contest_score = GREATEST(0, contest_score - 1)
             WHERE id = $1`,
            [nodeId]
          );
        } else {
          await client.query(
            `UPDATE nodes SET
               contest_score = contest_score + 1,
               support_score = GREATEST(0, support_score - 1)
             WHERE id = $1`,
            [nodeId]
          );
        }
      }
    } else {
      await client.query(
        'INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, $3)',
        [nodeId, user.id, dbVoteType]
      );

      if (dbVoteType === 'SUPPORT') {
        await client.query(
          'UPDATE nodes SET support_score = support_score + 1 WHERE id = $1',
          [nodeId]
        );
      } else {
        await client.query(
          'UPDATE nodes SET contest_score = contest_score + 1 WHERE id = $1',
          [nodeId]
        );
      }
    }

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
      [nodeId]
    );

    await client.query('COMMIT');

    const row = updatedNodeRes.rows[0];
    const node: ClaimNode = {
      id: row.id,
      parent: row.parent_id,
      edgeType: row.edge_type as ClaimNode['edgeType'],
      x: Number(row.pos_x),
      y: Number(row.pos_y),
      content: row.content,
      support: Number(row.support_score),
      contest: Number(row.contest_score),
      steel: Boolean(row.is_steel),
      userVote: newUserVote,
      authorId: row.author_id,
      createdAt: row.created_at.toISOString(),
    };

    await invalidateTopicCache(topicId);
    emitTopicMutation(topicId, 'node_voted', node);

    if (newUserVote !== null && nodeAuthorId !== user.id) {
      createNotification(
        nodeAuthorId,
        user.id,
        'NODE_VOTED',
        topicId,
        nodeId,
        `${user.username} ${newUserVote === 'support' ? 'supported' : 'contested'} your claim.`
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
