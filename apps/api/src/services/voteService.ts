/**
 * Vote Service for Argus Graph Claims.
 * Optimized for high-concurrency atomic execution and minimal row-lock duration.
 */

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

    // 1. Fetch target node & existing user vote in a single fast parallel query
    const [nodeRes, existingVoteRes] = await Promise.all([
      client.query<{
        id: string;
        author_id: string;
        author_username: string | null;
        edge_type: string;
        pos_x: number;
        pos_y: number;
        content: string;
        support_score: number;
        contest_score: number;
        is_steel: boolean;
        created_at: Date;
      }>(
        `SELECT n.id, n.author_id, u.username AS author_username,
                n.edge_type, n.pos_x, n.pos_y, n.content,
                n.support_score, n.contest_score, n.is_steel, n.created_at
         FROM nodes n
         LEFT JOIN users u ON u.id = n.author_id
         WHERE n.id = $1 AND n.topic_id = $2 AND n.status = 'ACTIVE'
         FOR UPDATE OF n`,
        [nodeId, topicId]
      ),
      client.query<{ vote_type: string }>(
        'SELECT vote_type FROM votes WHERE node_id = $1 AND user_id = $2',
        [nodeId, user.id]
      ),
    ]);

    if (nodeRes.rowCount === 0) {
      throw new ValidationError(`Node not found or inactive: ${nodeId}`);
    }

    const nodeRow = nodeRes.rows[0];
    const nodeAuthorId = nodeRow.author_id;

    let supportDelta = 0;
    let contestDelta = 0;
    let reputationDelta = 0;
    let newUserVote: 'support' | 'contest' | null = voteType;

    const existingVote = existingVoteRes.rows[0];

    if (existingVote) {
      const currentVoteType = existingVote.vote_type;

      if (currentVoteType === dbVoteType) {
        // Toggle OFF existing vote
        await client.query('DELETE FROM votes WHERE node_id = $1 AND user_id = $2', [nodeId, user.id]);
        if (currentVoteType === 'SUPPORT') {
          supportDelta = -1;
          reputationDelta = -10;
        } else {
          contestDelta = -1;
        }
        newUserVote = null;
      } else {
        // Switch vote type (e.g. SUPPORT -> CONTEST or CONTEST -> SUPPORT)
        await client.query(
          'UPDATE votes SET vote_type = $1 WHERE node_id = $2 AND user_id = $3',
          [dbVoteType, nodeId, user.id]
        );
        if (dbVoteType === 'SUPPORT') {
          supportDelta = 1;
          contestDelta = -1;
          reputationDelta = 10;
        } else {
          contestDelta = 1;
          supportDelta = -1;
          reputationDelta = -10;
        }
      }
    } else {
      // New vote
      await client.query(
        'INSERT INTO votes (node_id, user_id, vote_type) VALUES ($1, $2, $3)',
        [nodeId, user.id, dbVoteType]
      );
      if (dbVoteType === 'SUPPORT') {
        supportDelta = 1;
        reputationDelta = 10;
      } else {
        contestDelta = 1;
      }
    }

    // 2. Atomic update on node counters
    const updatedNodeRes = await client.query<{
      support_score: number;
      contest_score: number;
    }>(
      `UPDATE nodes
       SET support_score = GREATEST(0, support_score + $2),
           contest_score = GREATEST(0, contest_score + $3)
       WHERE id = $1
       RETURNING support_score, contest_score`,
      [nodeId, supportDelta, contestDelta]
    );

    // 3. Update author reputation if delta is non-zero
    if (reputationDelta !== 0) {
      await client.query(
        `UPDATE users
         SET reputation = GREATEST(0, reputation + $2)
         WHERE id = $1`,
        [nodeAuthorId, reputationDelta]
      );
    }

    await client.query('COMMIT');

    const updatedScores = updatedNodeRes.rows[0];
    const node: ClaimNode = {
      id: nodeRow.id,
      parent: null,
      edgeType: nodeRow.edge_type as ClaimNode['edgeType'],
      x: Number(nodeRow.pos_x),
      y: Number(nodeRow.pos_y),
      content: nodeRow.content,
      support: Number(updatedScores.support_score),
      contest: Number(updatedScores.contest_score),
      steel: Boolean(nodeRow.is_steel),
      userVote: newUserVote,
      authorId: nodeRow.author_id,
      authorUsername: nodeRow.author_username || undefined,
      createdAt: nodeRow.created_at.toISOString(),
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
