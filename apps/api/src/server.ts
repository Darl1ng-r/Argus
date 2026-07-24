import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { testConnection } from './db.js';
import {
  getTopic,
  getAllTopics,
  createTopic,
  addClaimNode,
  voteNode,
  forkTopic,
} from './services/graphService.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (_req, res) => {
  try {
    const { db } = await import('./db.js');
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// GET /api/topics
app.get('/api/topics', async (_req, res) => {
  try {
    const topics = await getAllTopics();
    res.json(topics);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/topics/:id
app.get('/api/topics/:id', async (req, res) => {
  try {
    const topic = await getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });
    res.json(topic);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics
app.post('/api/topics', async (req, res) => {
  try {
    const { title, rootClaim } = req.body as { title?: string; rootClaim?: string };
    if (!title || !rootClaim) {
      return res.status(400).json({ error: 'title and rootClaim are required' });
    }
    const topic = await createTopic(title, rootClaim);
    res.status(201).json(topic);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/nodes
app.post('/api/topics/:id/nodes', async (req, res) => {
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
    const newNode = await addClaimNode(
      req.params.id,
      parentId,
      edgeType as 'supports' | 'refutes' | 'clarifies' | 'evidence',
      content
    );
    res.status(201).json(newNode);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/nodes/:nodeId/vote
app.post('/api/topics/:id/nodes/:nodeId/vote', async (req, res) => {
  try {
    const { voteType } = req.body as { voteType?: string };
    if (voteType !== 'support' && voteType !== 'contest') {
      return res.status(400).json({ error: "voteType must be 'support' or 'contest'" });
    }
    const updated = await voteNode(req.params.id, req.params.nodeId, voteType);
    res.json(updated);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/topics/:id/fork
app.post('/api/topics/:id/fork', async (req, res) => {
  try {
    const forked = await forkTopic(req.params.id);
    res.status(201).json(forked);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Start server
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
