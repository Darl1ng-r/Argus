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

// Extend Express Request type to include user context
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
app.use(express.json());

// -----------------------------------------------------------------------
// Authentication Middleware
// Extracts identity from `X-User-Id` header or `Authorization: Bearer <id>`
// Automatically provisions user profile in PostgreSQL database if missing
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

// GET /api/me - Return active session user profile
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

// GET /api/topics/:id - Fetch topic with user-specific vote states attached
app.get('/api/topics/:id', async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    const topic = await getTopic(req.params.id, currentUserId);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    res.json(topic);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics - Create topic
app.post('/api/topics', async (req: Request, res: Response) => {
  try {
    const { title, rootClaim } = req.body as { title?: string; rootClaim?: string };
    if (!title || !rootClaim) {
      return res.status(400).json({ error: 'title and rootClaim are required' });
    }
    const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
    const topic = await createTopic(title, rootClaim, authorId);
    res.status(201).json(topic);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/nodes - Add claim node
app.post('/api/topics/:id/nodes', async (req: Request, res: Response) => {
  try {
    const { parentId, edgeType, content } = req.body as {
      parentId?: string;
      edgeType?: string;
      content?: string;
    };
    if (!parentId || !edgeType || !content) {
      return res.status(400).json({ error: 'parentId, edgeType, and content are required' });
    }
    const allowed = ['supports', 'refutes', 'clarifies', 'evidence'];
    if (!allowed.includes(edgeType)) {
      return res.status(400).json({ error: `edgeType must be one of: ${allowed.join(', ')}` });
    }
    const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
    const newNode = await addClaimNode(
      req.params.id,
      parentId,
      authorId,
      edgeType as 'supports' | 'refutes' | 'clarifies' | 'evidence',
      content
    );
    res.status(201).json(newNode);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/nodes/:nodeId/vote - Deduplicated voting endpoint
app.post('/api/topics/:id/nodes/:nodeId/vote', async (req: Request, res: Response) => {
  try {
    const { voteType } = req.body as { voteType?: string };
    if (voteType !== 'support' && voteType !== 'contest') {
      return res.status(400).json({ error: "voteType must be 'support' or 'contest'" });
    }

    const userId = req.user?.id || 'system-user-0000-0000-000000000000';
    const updatedNode = await voteNode(req.params.id, req.params.nodeId, userId, voteType);
    res.json(updatedNode);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/fork
app.post('/api/topics/:id/fork', async (req: Request, res: Response) => {
  try {
    const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
    const forked = await forkTopic(req.params.id, authorId);
    res.status(201).json(forked);
  } catch (err: unknown) {
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
