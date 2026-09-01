import { db } from '../db.js';
import { User, TopicRole } from './graphTypes.js';
import { ValidationError } from '../utils/sanitizer.js';

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
 * - Non-owner users are 'viewer' (can view, vote, and fork to their own profile to edit).
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

  // GitHub-style model: other users are 'viewer' (must fork to modify)
  return 'viewer';
}

/**
 * Resolves existing user or provisions a new user record.
 */
export async function getOrCreateUser(
  userIdOrClerkId?: string,
  username?: string,
  email?: string
): Promise<User> {
  if (!userIdOrClerkId || !userIdOrClerkId.trim()) {
    throw new ValidationError('Cannot resolve user: no valid user ID provided.');
  }

  const inputId = userIdOrClerkId.trim();
  const isClerkId = inputId.startsWith('user_');

  try {
    const existing = await db.query<User>(
      'SELECT id, clerk_id AS "clerkId", username, email, reputation, is_active AS "isActive", anonymized_at AS "anonymizedAt" FROM users WHERE id = $1 OR clerk_id = $1',
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
        `INSERT INTO users (clerk_id, username, email, reputation, is_active)
         VALUES ($1, $2, $3, 10, TRUE)
         RETURNING id, clerk_id AS "clerkId", username, email, reputation, is_active AS "isActive", anonymized_at AS "anonymizedAt"`,
        [inputId, name, userEmail]
      );
    } else {
      created = await db.query<User>(
        `INSERT INTO users (id, username, email, reputation, is_active)
         VALUES ($1, $2, $3, 10, TRUE)
         ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
         RETURNING id, clerk_id AS "clerkId", username, email, reputation, is_active AS "isActive", anonymized_at AS "anonymizedAt"`,
        [inputId, name, userEmail]
      );
    }

    return created.rows[0];
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      const name = username || `User_${inputId.slice(-6)}`;
      return {
        id: inputId,
        username: name,
        email: email || `${name.toLowerCase()}@argus.local`,
        reputation: 10,
      };
    }
    throw err;
  }
}
