import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { testConnection } from './db.js';
import {
  getTopic,
  getAllTopics,
  createTopic,
  addClaimNode,
  voteNode,
  forkTopic,
  getOrCreateUser,
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

app.use(cors());
app.use(express.json({ limit: '100kb' })); // Restrict JSON payload size to 100KB to prevent memory exhaustion DoS

// -----------------------------------------------------------------------
// Authentication Middleware
// -----------------------------------------------------------------------
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const rawHeader = req.headers['x-user-id'] || req.headers['authorization'];
    let userId = 'system-user-0000-0000-000000000000';
    let username: string | undefined;

    if (typeof rawHeader === 'string' && rawHeader.trim()) {
      userId = rawHeader.replace('Bearer ', '').trim();
    }

    if (req.headers['x-user-name'] && typeof req.headers['x-user-name'] === 'string') {
      username = req.headers['x-user-name'].trim();
    }

    req.user = await getOrCreateUser(userId, username);
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

// GET /api/me - Active user session profile
app.get('/api/me', (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  res.json(req.user);
});

// GET /api/topics - List all topics
app.get('/api/topics', async (_req: Request, res: Response) => {
  try {
    const topics = await getAllTopics();
    res.json(topics);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/topics/:id - Fetch topic with sanitized ID parameter
app.get('/api/topics/:id', async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const currentUserId = req.user?.id;
    const topic = await getTopic(topicId, currentUserId);
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

// POST /api/topics - Create topic with input validation and HTML stripping
app.post('/api/topics', async (req: Request, res: Response) => {
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

// POST /api/topics/:id/nodes - Add claim node with input sanitization & edgeType enum validation
app.post('/api/topics/:id/nodes', async (req: Request, res: Response) => {
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

// POST /api/topics/:id/nodes/:nodeId/vote - Vote with strict voteType validation
app.post('/api/topics/:id/nodes/:nodeId/vote', async (req: Request, res: Response) => {
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

// POST /api/topics/:id/fork
app.post('/api/topics/:id/fork', async (req: Request, res: Response) => {
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
