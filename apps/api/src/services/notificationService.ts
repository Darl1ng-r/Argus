/**
 * Notification Service for Argus API.
 *
 * Manages user notifications for debate events:
 *  - NODE_REPLIED: Someone replied to your claim.
 *  - NODE_VOTED: Someone voted on your claim.
 *  - NODE_FLAGGED: Your claim was flagged for moderation.
 *  - TOPIC_FORKED: Someone forked your debate topic.
 */

import { db, withUserSession } from '../db.js';
import { publishEvent } from '../redis.js';

export interface NotificationItem {
  id: string;
  userId: string;
  actorId: string;
  type: 'NODE_REPLIED' | 'NODE_VOTED' | 'NODE_FLAGGED' | 'TOPIC_FORKED';
  topicId: string;
  nodeId?: string | null;
  message: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * Creates and persists a notification for a recipient user (unless recipient == actor).
 * Publishes a real-time event to the recipient's Redis notification channel.
 */
export async function createNotification(
  userId: string,
  actorId: string,
  type: NotificationItem['type'],
  topicId: string,
  nodeId: string | null | undefined,
  message: string
): Promise<NotificationItem | null> {
  // Do not send notifications to self
  if (userId === actorId) return null;

  try {
    const res = await db.query<{
      id: string;
      user_id: string;
      actor_id: string;
      type: string;
      topic_id: string;
      node_id: string | null;
      message: string;
      is_read: boolean;
      created_at: Date;
    }>(
      `INSERT INTO notifications (user_id, actor_id, type, topic_id, node_id, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, actor_id, type, topic_id, node_id, message, is_read, created_at`,
      [userId, actorId, type, topicId, nodeId || null, message]
    );

    const row = res.rows[0];
    const item: NotificationItem = {
      id: row.id,
      userId: row.user_id,
      actorId: row.actor_id,
      type: row.type as NotificationItem['type'],
      topicId: row.topic_id,
      nodeId: row.node_id,
      message: row.message,
      isRead: row.is_read,
      createdAt: row.created_at.toISOString(),
    };

    // Real-time broadcast to recipient's notification Pub/Sub channel
    publishEvent(`argus:user:${userId}:notifications`, item).catch(() => {});

    return item;
  } catch (err) {
    console.error('[NotificationService] Failed to create notification:', err);
    return null;
  }
}

/**
 * Fetches user notifications and total unread count.
 * Fix 2: wrapped in withUserSession so RLS policy is enforced.
 */
export async function getUserNotifications(
  userId: string,
  limit = 20,
  unreadOnly = false
): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const whereClause = unreadOnly
    ? 'WHERE user_id = $1 AND is_read = FALSE'
    : 'WHERE user_id = $1';

  return withUserSession(userId, async (client) => {
    const [listRes, countRes] = await Promise.all([
      client.query<{
        id: string;
        user_id: string;
        actor_id: string;
        type: string;
        topic_id: string;
        node_id: string | null;
        message: string;
        is_read: boolean;
        created_at: Date;
      }>(
        `SELECT id, user_id, actor_id, type, topic_id, node_id, message, is_read, created_at
         FROM notifications
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      ),
      client.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
        [userId]
      ),
    ]);

    const unreadCount = parseInt(countRes.rows[0]?.count || '0', 10);
    const notifications: NotificationItem[] = listRes.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      actorId: r.actor_id,
      type: r.type as NotificationItem['type'],
      topicId: r.topic_id,
      nodeId: r.node_id,
      message: r.message,
      isRead: r.is_read,
      createdAt: r.created_at.toISOString(),
    }));

    return { notifications, unreadCount };
  });
}

/**
 * Marks notifications as read. If notificationIds is empty/undefined, marks ALL as read for the user.
 * Fix 2: wrapped in withUserSession so RLS policy is enforced.
 */
export async function markNotificationsAsRead(
  userId: string,
  notificationIds?: string[]
): Promise<number> {
  return withUserSession(userId, async (client) => {
    if (notificationIds && notificationIds.length > 0) {
      const res = await client.query(
        `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND id = ANY($2::text[])`,
        [userId, notificationIds]
      );
      return res.rowCount || 0;
    } else {
      const res = await client.query(
        `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
        [userId]
      );
      return res.rowCount || 0;
    }
  });
}
