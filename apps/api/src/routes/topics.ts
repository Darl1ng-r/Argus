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
  detectCycle,
  getTopicFlatNodes,
  getSteelmanPath,
  TopicRole,
} from '../services/graphService.js';
import { analyzeArgumentGraph } from '../services/aiService.js';
import { enqueueAIAnalysis, getAIJobStatus } from '../services/aiQueueService.js';
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
// GET /api/topics — paginated topic list (supports page or cursor-based pagination)
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const topics = await getAllTopics(page, limit, cursor);

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
    const topic = await getTopic(topicId, currentUserId);
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
    const subgraph = await getTopicSubgraph(topicId, currentUserId, Math.min(depth, 5), fromNodeId);
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
// GET /api/topics/:id/cycle-check — public utility endpoint
// ---------------------------------------------------------------------------
router.get('/:id/cycle-check', async (req: Request, res: Response) => {
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
// GET /api/topics/:id/steelman — backend-computed steelman sub-graph (Fix F-7)
// ---------------------------------------------------------------------------
router.get('/:id/steelman', async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const currentUserId = req.user?.id;
    const nodes = await getSteelmanPath(topicId, currentUserId);
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    res.json({ topicId, nodes });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/topics/:id/fork — fork a topic
// ---------------------------------------------------------------------------
router.post('/:id/fork', requireAuth, mutationLimiter, async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');
    const forked = await forkTopic(topicId, req.user!);
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
// POST /api/topics/:id/ai-analyze — BullMQ async AI argument analysis queue
// Fix S-2: Added requireAuth + mutationLimiter to prevent unauthenticated Gemini budget drain.
// Fix P-2: Uses getTopicFlatNodes instead of full subgraph to avoid expensive recursive CTE.
// ---------------------------------------------------------------------------
router.post('/:id/ai-analyze', requireAuth, mutationLimiter, async (req: Request, res: Response) => {
  try {
    const topicId = validateIdentifier(req.params.id, 'topicId');

    // P-2: Verify topic exists with a lightweight check before enqueueing
    const topicCheck = await getTopic(topicId, req.user?.id);
    if (!topicCheck) return res.status(404).json({ error: 'Topic not found' });

    const jobInfo = await enqueueAIAnalysis(topicId, req.user?.id);
    if (jobInfo.status === 'queued') {
      return res.status(202).json({
        jobId: jobInfo.jobId,
        status: 'queued',
        message: 'AI analysis queued in background worker.',
      });
    }

    res.json(jobInfo.result);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/topics/:id/ai-analyze/status/:jobId — Check async AI analysis status
// Fix S-2: Requires auth to prevent job ID enumeration by anonymous users.
// ---------------------------------------------------------------------------
router.get('/:id/ai-analyze/status/:jobId', requireAuth, async (req: Request, res: Response) => {
  try {
    const jobId = validateIdentifier(req.params.jobId, 'jobId');
    const status = await getAIJobStatus(jobId);
    res.json(status);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});
// ---------------------------------------------------------------------------
// DELETE /api/topics/:id — delete a topic (F-6, owner only)
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  requireAuth,
  requireTopicRole('owner'),
  mutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const topicId = validateIdentifier(req.params.id, 'topicId');
      const { deleteTopic } = await import('../services/graphService.js');
      const result = await deleteTopic(topicId);
      res.json(result);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

export default router;
