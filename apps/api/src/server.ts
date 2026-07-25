import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { verifyToken } from '@clerk/backend';
import { testConnection } from './db.js';
import { redisClient } from './redis.js';
import {
  getTopic,
  getTopicSubgraph,
  getAllTopics,
  createTopic,
  addClaimNode,
  voteNode,
  forkTopic,
  getOrCreateUser,
  detectCycle,
  User,
} from './services/graphService.js';
import {
  sanitizeClaimContent,
  sanitizeTopicTitle,
  validateEdgeType,
  validateVoteType,
  validateIdentifier,
  ValidationError,
} from './utils/sanitizer.js';

// -----------------------------------------------------------------------
// Structured Logger (Fix #4b — Pino replaces bare console.log)
// -----------------------------------------------------------------------
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
});

declare global {
  namespace Express {
    interface Request {
      user?: User;
      requestId?: string;
    }
  }
}

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// -----------------------------------------------------------------------
// Fix #11 — Security Headers via Helmet
// -----------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
      },
    },
    hsts: IS_PRODUCTION ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  })
);

// -----------------------------------------------------------------------
// Request Logging (Pino-HTTP)
// -----------------------------------------------------------------------
app.use(
  pinoHttp({
    logger,
    customLogLevel(_req, res) {
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Don't log health check spam
    autoLogging: { ignore: (req) => req.url === '/health' },
  })
);

// -----------------------------------------------------------------------
// CORS Security Configuration
// -----------------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, curl, health checks)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new ValidationError(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '50kb' }));

// -----------------------------------------------------------------------
// Fix #3 — Distributed Rate Limiting via Redis (graceful fallback to memory)
// -----------------------------------------------------------------------
function makeStore() {
  if (redisClient) {
    return new RedisStore({
      // @ts-expect-error — ioredis satisfies the interface
      sendCommand: (...args: string[]) => redisClient!.call(...args),
    });
  }
  // Memory store fallback (dev only)
  return undefined;
}

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  message: { error: 'Too many requests. Please slow down.' },
});

// Stricter limits for state-mutating endpoints
const mutationLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  message: { error: 'Too many submissions. Please wait a minute before trying again.' },
});

const voteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore(),
  message: { error: 'Voting speed limit exceeded. Please wait before voting again.' },
});

app.use(globalLimiter);

// -----------------------------------------------------------------------
// Fix #1 — Authentication Middleware
// - Reads Clerk JWT (Bearer token) ONLY — no custom header forgery
// - In dev mode (ALLOW_DEV_AUTH=true), also accepts X-User-Id/X-User-Name
//   so the existing dev flow still works without a Clerk account
// -----------------------------------------------------------------------
const ALLOW_DEV_AUTH = process.env.ALLOW_DEV_AUTH === 'true' && !IS_PRODUCTION;

app.use(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization'];
    let resolvedId: string | undefined;
    let resolvedUsername: string | undefined;
    let resolvedEmail: string | undefined;

    // --- Clerk JWT path ---
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (secretKey) {
        try {
          const payload = await verifyToken(token, { secretKey });
          if (payload?.sub) {
            resolvedId = payload.sub;
          }
        } catch (err) {
          // JWT invalid/expired — do NOT fall through to dev auth in production
          if (IS_PRODUCTION) {
            req.log.warn({ err }, '[AUTH] Invalid JWT token');
          }
        }
      }
    }

    // --- Dev auth path (only when ALLOW_DEV_AUTH=true and not production) ---
    if (!resolvedId && ALLOW_DEV_AUTH) {
      const customUserId = req.headers['x-user-id'];
      const customUserName = req.headers['x-user-name'];
      if (typeof customUserId === 'string' && customUserId.trim()) {
        resolvedId = customUserId.trim();
      }
      if (typeof customUserName === 'string' && customUserName.trim()) {
        resolvedUsername = customUserName.trim();
      }
    }

    if (resolvedId) {
      req.user = await getOrCreateUser(resolvedId, resolvedUsername, resolvedEmail);
    }
    // No resolved ID → req.user remains undefined (anonymous read access)
    next();
  } catch (err) {
    req.log.error({ err }, '[AUTH] Failed to resolve user session');
    next();
  }
});

// -----------------------------------------------------------------------
// Fix #2 — requireAuth middleware guards all mutation routes
// -----------------------------------------------------------------------
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

// -----------------------------------------------------------------------
// Fix #21 — Generic error sender (prevents leaking internal details)
// -----------------------------------------------------------------------
function sendError(res: Response, status: number, message: string, internalErr?: unknown) {
  if (internalErr) {
    logger.error({ err: internalErr }, message);
  }
  // In production, never expose raw error messages for 5xx
  const clientMessage =
    status >= 500 && IS_PRODUCTION ? 'An internal error occurred. Please try again.' : message;
  return res.status(status).json({ error: clientMessage });
}

// -----------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------

// Health check — public, not rate limited
app.get('/health', async (_req: Request, res: Response) => {
  try {
    const { db } = await import('./db.js');
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// GET /api/me — public, returns authenticated user if any
app.get('/api/me', (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  res.json(req.user);
});

// GET /api/topics — public, Cache-Control for CDN/browser
app.get('/api/topics', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const topics = await getAllTopics(page, limit);

    // Fix — add cache headers for public GET endpoints
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    res.json(topics);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// GET /api/topics/:id
app.get('/api/topics/:id', async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const depth = req.query.depth ? parseInt(String(req.query.depth), 10) : 2;
    const fromNodeId = req.query.fromNodeId
      ? validateIdentifier(String(req.query.fromNodeId), 'fromNodeId')
      : undefined;

    const currentUserId = req.user?.id;
    const topic = await getTopicSubgraph(topicId, fromNodeId, Math.min(depth, 10), currentUserId);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=20');
    res.json(topic);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// GET /api/topics/:id/subgraph
app.get('/api/topics/:id/subgraph', async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const fromNodeId = validateIdentifier(String(req.query.fromNodeId), 'fromNodeId');
    const depth = req.query.depth ? parseInt(String(req.query.depth), 10) : 2;

    const currentUserId = req.user?.id;
    const subgraph = await getTopicSubgraph(topicId, fromNodeId, Math.min(depth, 5), currentUserId);
    if (!subgraph) return res.status(404).json({ error: 'Topic or node not found' });

    res.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=10');
    res.json(subgraph);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// POST /api/topics — Fix #2: requireAuth applied
app.post('/api/topics', requireAuth, mutationLimiter, async (req: Request, res: Response) => {
  try {
    const { title, rootClaim } = req.body as { title?: unknown; rootClaim?: unknown };
    const sanitizedTitle = sanitizeTopicTitle(title);
    const sanitizedRootClaim = sanitizeClaimContent(rootClaim);

    const topic = await createTopic(sanitizedTitle, sanitizedRootClaim, req.user!.id);
    res.status(201).json(topic);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// POST /api/topics/:id/nodes — Fix #2: requireAuth applied
app.post(
  '/api/topics/:id/nodes',
  requireAuth,
  mutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const topicId = validateIdentifier(req.params.id, 'topicId');
      const { parentId, edgeType, content } = req.body as {
        parentId?: unknown;
        edgeType?: unknown;
        content?: unknown;
      };

      const sanitizedParentId = validateIdentifier(parentId, 'parentId');
      const validatedEdgeType = validateEdgeType(edgeType);
      const sanitizedContent = sanitizeClaimContent(content);

      // Note: a brand-new leaf node cannot create a cycle since it has no
      // outgoing edges. Cycle detection here is a safety check for edge
      // rearrangement, which isn't supported in the current API.
      const wouldCycle = await detectCycle(topicId, sanitizedParentId);
      if (wouldCycle) {
        throw new ValidationError(
          'Circular reasoning blocked: connecting these claims creates a cycle.'
        );
      }

      const newNode = await addClaimNode(
        topicId,
        sanitizedParentId,
        req.user!.id,
        validatedEdgeType,
        sanitizedContent
      );
      res.status(201).json(newNode);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

// GET /api/topics/:id/cycle-check — public utility endpoint
app.get('/api/topics/:id/cycle-check', async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const { parentId, childId } = req.query as { parentId?: string; childId?: string };

    if (!parentId || !childId) {
      return res.status(400).json({ error: 'parentId and childId query params are required' });
    }

    const sParent = validateIdentifier(parentId, 'parentId');
    const sChild = validateIdentifier(childId, 'childId');

    const wouldCycle = await detectCycle(topicId, sParent, sChild);
    res.json({ wouldCycle, parentId: sParent, childId: sChild });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// POST /api/topics/:id/nodes/:nodeId/vote — Fix #2: requireAuth applied
app.post(
  '/api/topics/:id/nodes/:nodeId/vote',
  requireAuth,
  voteLimiter,
  async (req: Request, res: Response) => {
    try {
      const topicId = validateIdentifier(req.params.id, 'topicId');
      const nodeId = validateIdentifier(req.params.nodeId, 'nodeId');
      const { voteType } = req.body as { voteType?: unknown };

      const validatedVoteType = validateVoteType(voteType);
      const updatedNode = await voteNode(topicId, nodeId, req.user!.id, validatedVoteType);
      res.json(updatedNode);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

// POST /api/topics/:id/fork — Fix #2: requireAuth applied
app.post('/api/topics/:id/fork', requireAuth, mutationLimiter, async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const forked = await forkTopic(topicId, req.user!.id);
    res.status(201).json(forked);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// -----------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------
async function bootstrap() {
  await testConnection();
  app.listen(PORT, () => {
    logger.info(`[ARGUS API] Listening on port ${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
    if (ALLOW_DEV_AUTH) {
      logger.warn('[ARGUS API] ALLOW_DEV_AUTH=true — X-User-Id header auth is enabled. Never use in production!');
    }
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, '[ARGUS API] Fatal startup error');
  process.exit(1);
});
