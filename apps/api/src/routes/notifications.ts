/**
 * /api/notifications — User notification routes.
 */
import { Router, Request, Response } from 'express';
import { Redis } from 'ioredis';
import {
  getUserNotifications,
  markNotificationsAsRead,
} from '../services/notificationService.js';
import { requireAuth, sendError } from '../middleware/index.js';
import { validateIdentifier, ValidationError } from '../utils/sanitizer.js';

// ---------------------------------------------------------------------------
// Shared Redis multiplexer for notification SSE — one subscriber per userId
// ---------------------------------------------------------------------------

type NotifCallback = (raw: string) => void;

interface UserNotifSubscription {
  redis: Redis;
  callbacks: Set<NotifCallback>;
}

const userNotifSubs = new Map<string, UserNotifSubscription>();

async function subscribeToUserNotifications(
  userId: string,
  callback: NotifCallback
): Promise<() => Promise<void>> {
  if (!process.env.REDIS_URL) return async () => {};

  let sub = userNotifSubs.get(userId);
  if (!sub) {
    const redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    const callbacks = new Set<NotifCallback>();
    sub = { redis, callbacks };
    userNotifSubs.set(userId, sub);
    await redis.subscribe(`argus:user:${userId}:notifications`);
    redis.on('message', (_ch, raw) => {
      for (const cb of callbacks) cb(raw);
    });
    redis.on('error', () => {});
  }

  sub.callbacks.add(callback);

  return async () => {
    const current = userNotifSubs.get(userId);
    if (!current) return;
    current.callbacks.delete(callback);
    if (current.callbacks.size === 0) {
      userNotifSubs.delete(userId);
      try {
        await current.redis.unsubscribe(`argus:user:${userId}:notifications`);
        current.redis.disconnect();
      } catch {}
    }
  };
}

const router = Router();

// All notification routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/notifications — fetch notifications for the current user
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const unreadOnly = req.query.unread === 'true';

    const data = await getUserNotifications(req.user!.id, limit, unreadOnly);
    res.json(data);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to fetch notifications', err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count — fetch unread notification count
// ---------------------------------------------------------------------------
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const { getUserNotifications } = await import('../services/notificationService.js');
    const { unreadCount } = await getUserNotifications(req.user!.id, 1, true);
    res.json({ unreadCount });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to fetch unread count', err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/mark-read — mark notifications as read
// ---------------------------------------------------------------------------
router.post('/mark-read', async (req: Request, res: Response) => {
  try {
    const { notificationIds } = req.body as { notificationIds?: unknown[] };

    // Fix S-7: Validate each notification ID and cap array size to prevent SQL injection
    const MAX_IDS = 100;
    let validatedIds: string[] | undefined;
    if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      if (notificationIds.length > MAX_IDS) {
        return res.status(400).json({
          error: `notificationIds must not contain more than ${MAX_IDS} entries.`,
        });
      }
      const { validateIdentifier } = await import('../utils/sanitizer.js');
      validatedIds = notificationIds.map((id, i) => validateIdentifier(id, `notificationIds[${i}]`));
    }

    const updatedCount = await markNotificationsAsRead(req.user!.id, validatedIds);
    res.json({ success: true, updatedCount });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to mark notifications as read', err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/notifications/events — real-time SSE notification stream for logged-in user
// Fix 3 (notifications): shared Redis subscriber per userId, not per connection
// ---------------------------------------------------------------------------
router.get('/events', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let seq = 0;
    const writeEvent = (type: string, payload: unknown) => {
      if (!res.writableEnded) {
        res.write(`id: ${++seq}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      }
    };

    writeEvent('connected', { status: 'live', userId });

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 20_000);

    const redisCallback: NotifCallback = (raw) => {
      try {
        writeEvent('notification', JSON.parse(raw));
      } catch {}
    };

    let unsubscribeRedis: () => Promise<void> = async () => {};
    try {
      unsubscribeRedis = await subscribeToUserNotifications(userId, redisCallback);
    } catch {}

    req.on('close', async () => {
      clearInterval(heartbeat);
      await unsubscribeRedis();
      if (!res.writableEnded) res.end();
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'SSE failed', err);
  }
});

export default router;
