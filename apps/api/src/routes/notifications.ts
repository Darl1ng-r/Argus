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
    const { notificationIds } = req.body as { notificationIds?: string[] };
    const updatedCount = await markNotificationsAsRead(req.user!.id, notificationIds);
    res.json({ success: true, updatedCount });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Failed to mark notifications as read', err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/notifications/events — real-time SSE notification stream for logged-in user
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

    let redisSubscriber: Redis | null = null;
    const pubSubChannel = `argus:user:${userId}:notifications`;

    if (process.env.REDIS_URL) {
      try {
        redisSubscriber = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: true,
        });

        await redisSubscriber.subscribe(pubSubChannel);

        redisSubscriber.on('message', (_channel, raw) => {
          try {
            const item = JSON.parse(raw);
            writeEvent('notification', item);
          } catch {
            // Ignore parse errors
          }
        });
      } catch {
        redisSubscriber = null;
      }
    }

    req.on('close', async () => {
      clearInterval(heartbeat);
      if (redisSubscriber) {
        try {
          await redisSubscriber.unsubscribe(pubSubChannel);
          redisSubscriber.disconnect();
        } catch {}
      }
      if (!res.writableEnded) res.end();
    });
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'SSE failed', err);
  }
});

export default router;
