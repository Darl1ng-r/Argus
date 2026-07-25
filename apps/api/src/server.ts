import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '@clerk/backend';
import { testConnection } from './db.js';
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

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const app = express();
const PORT = process.env.PORT || 4000;

// CORS Security Configuration
const allowedOrigins = [
  process.env.CORS_ORIGIN || 'http://localhost:5173',
  'http://127.0.0.1:5173',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new ValidationError(`CORS blocked request from origin: ${origin}`));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '100kb' }));

// -----------------------------------------------------------------------
// API Rate Limiting Configuration
// Solves attack surface: DDoS prevention, brute-force spamming, resource exhaustion
// -----------------------------------------------------------------------

// General API rate limiter (100 requests per 1 min window)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again later.' },
});

// Mutation rate limiter for creating topics/claims/forks (15 requests per 1 min window)
const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many claims or topics created. Please wait a minute before submitting again.' },
});

// Voting rate limiter (30 votes per 1 min window)
const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Voting speed limit exceeded. Please wait a moment before voting again.' },
});

app.use(globalLimiter);

// -----------------------------------------------------------------------
// Authentication Middleware
// -----------------------------------------------------------------------
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization'];
    const customUserId = req.headers['x-user-id'];
    const customUserName = req.headers['x-user-name'];

    let resolvedId = 'system-user-0000-0000-000000000000';
    let resolvedUsername: string | undefined;
    let resolvedEmail: string | undefined;

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      const secretKey = process.env.CLERK_SECRET_KEY;

      if (secretKey) {
        try {
          const verifiedPayload = await verifyToken(token, { secretKey });
          if (verifiedPayload && verifiedPayload.sub) {
            resolvedId = verifiedPayload.sub;
          }
        } catch {
          // Fallback to custom header token
        }
      }
    }

    if (resolvedId === 'system-user-0000-0000-000000000000' && typeof customUserId === 'string' && customUserId.trim()) {
      resolvedId = customUserId.trim();
    }

    if (typeof customUserName === 'string' && customUserName.trim()) {
      resolvedUsername = customUserName.trim();
    }

    req.user = await getOrCreateUser(resolvedId, resolvedUsername, resolvedEmail);
    next();
  } catch (err) {
    console.error('[AUTH] Failed to resolve user session:', err);
    next();
  }
});

// Health check
app.get('/health', async (_req: Request, res: Response) => {
  try {
    const { db } = await import('./db.js');
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// GET /api/me
app.get('/api/me', (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  res.json(req.user);
});

// GET /api/topics
app.get('/api/topics', async (_req: Request, res: Response) => {
  try {
    const topics = await getAllTopics();
    res.json(topics);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/topics/:id
app.get('/api/topics/:id', async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const depth = req.query.depth ? parseInt(String(req.query.depth), 10) : 2;
    const fromNodeId = req.query.fromNodeId ? validateIdentifier(String(req.query.fromNodeId), 'fromNodeId') : undefined;

    const currentUserId = req.user?.id;
    const topic = await getTopicSubgraph(topicId, fromNodeId, Math.min(depth, 10), currentUserId);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    res.json(topic);
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
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
    res.json(subgraph);
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics (Protected by Mutation Rate Limiter)
app.post('/api/topics', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const { title, rootClaim } = req.body as { title?: unknown; rootClaim?: unknown };
    const sanitizedTitle = sanitizeTopicTitle(title);
    const sanitizedRootClaim = sanitizeClaimContent(rootClaim);

    const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
    const topic = await createTopic(sanitizedTitle, sanitizedRootClaim, authorId);
    res.status(201).json(topic);
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/nodes (Protected by Mutation Rate Limiter)
app.post('/api/topics/:id/nodes', mutationLimiter, async (req: Request, res: Response) => {
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

    const wouldCycle = await detectCycle(topicId, sanitizedParentId);
    if (wouldCycle) {
      throw new ValidationError(
        'Circular reasoning blocked: connecting these claims creates a cycle. Argus argument graphs must be Directed Acyclic Graphs (DAGs).'
      );
    }

    const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
    const newNode = await addClaimNode(
      topicId,
      sanitizedParentId,
      authorId,
      validatedEdgeType,
      sanitizedContent
    );
    res.status(201).json(newNode);
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/topics/:id/cycle-check
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
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/nodes/:nodeId/vote (Protected by Voting Rate Limiter)
app.post('/api/topics/:id/nodes/:nodeId/vote', voteLimiter, async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const nodeId = validateIdentifier(req.params.nodeId, 'nodeId');
    const { voteType } = req.body as { voteType?: unknown };

    const validatedVoteType = validateVoteType(voteType);
    const userId = req.user?.id || 'system-user-0000-0000-000000000000';

    const updatedNode = await voteNode(topicId, nodeId, userId, validatedVoteType);
    res.json(updatedNode);
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/fork (Protected by Mutation Rate Limiter)
app.post('/api/topics/:id/fork', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
    const forked = await forkTopic(topicId, authorId);
    res.status(201).json(forked);
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Bootstrap
async function bootstrap() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`[ARGUS API] Listening on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[ARGUS API] Failed to start:', err);
  process.exit(1);
});
