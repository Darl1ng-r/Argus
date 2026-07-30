/**
 * /api/topics — CRUD routes for debate topics.
 */
import { Router, Request, Response } from 'express';
import { getCached, setCached } from '../redis.js';
import {
  getTopic,
  getTopicSubgraph,
  getAllTopics,
  createTopic,
  forkTopic,
  updateRootClaim,
  compareTopicForks,
  TopicRole,
} from '../services/graphService.js';
import { analyzeArgumentGraph } from '../services/aiService.js';
import {
  sanitizeClaimContent,
  sanitizeTopicTitle,
  validateIdentifier,
  ValidationError,
} from '../utils/sanitizer.js';
import { requireAuth, requireTopicRole, sendError, idempotencyGuard } from '../middleware/index.js';
import { mutationLimiter } from '../middleware/rateLimiter.js';
import { topicSseHandler } from './sse.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/topics — paginated topic list
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const topics = await getAllTopics(page, limit);

    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    res.json(topics);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/topics/:id — full topic subgraph
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
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

// ---------------------------------------------------------------------------
// GET /api/topics/:id/subgraph — lazy-load a subgraph from a given node
// ---------------------------------------------------------------------------
router.get('/:id/subgraph', async (req: Request, res: Response) => {
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

// ---------------------------------------------------------------------------
// GET /api/topics/:id/events — SSE real-time stream (delegated to sse.ts)
// ---------------------------------------------------------------------------
router.get('/:id/events', topicSseHandler);

// ---------------------------------------------------------------------------
// POST /api/topics — create a new topic
// ---------------------------------------------------------------------------
router.post('/', requireAuth, idempotencyGuard, mutationLimiter, async (req: Request, res: Response) => {
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

// ---------------------------------------------------------------------------
// PUT /api/topics/:id/root — update root claim (owner only)
// ---------------------------------------------------------------------------
router.put(
  '/:id/root',
  requireAuth,
  requireTopicRole('owner'),
  idempotencyGuard,
  mutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const topicId = validateIdentifier(req.params.id, 'topicId');
      const { content } = req.body as { content?: unknown };
      const sanitizedContent = sanitizeClaimContent(content);

      const updatedRootNode = await updateRootClaim(topicId, sanitizedContent);
      res.json(updatedRootNode);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/topics/:id/fork — fork a topic
// ---------------------------------------------------------------------------
router.post('/:id/fork', requireAuth, mutationLimiter, async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const forked = await forkTopic(topicId, req.user!.id);
    res.status(201).json(forked);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/topics/:id/diff/:compareId — graph diffing engine
// ---------------------------------------------------------------------------
router.get('/:id/diff/:compareId', async (req: Request, res: Response) => {
  try {
    const baseTopicId = validateIdentifier(req.params.id, 'baseTopicId');
    const compareTopicId = validateIdentifier(req.params.compareId, 'compareTopicId');

    const diffResult = await compareTopicForks(baseTopicId, compareTopicId, req.user?.id);
    res.json(diffResult);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/topics/:id/ai-analyze — Gemini AI argument analysis
// ---------------------------------------------------------------------------
router.post('/:id/ai-analyze', async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const topic = await getTopic(topicId, req.user?.id);

    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    const analysis = await analyzeArgumentGraph(topic);
    res.json(analysis);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

export default router;
