/**
 * /api/topics/:id/nodes — Node CRUD and voting.
 * Mounted by the topics router at /:id/nodes.
 */
import { Router, Request, Response } from 'express';
import {
  addClaimNode,
  voteNode,
  detectCycle,
} from '../services/graphService.js';
import {
  sanitizeClaimContent,
  validateEdgeType,
  validateVoteType,
  validateIdentifier,
  ValidationError,
} from '../utils/sanitizer.js';
import { requireAuth, requireTopicRole, sendError, idempotencyGuard } from '../middleware/index.js';
import { mutationLimiter, voteLimiter } from '../middleware/rateLimiter.js';

// NOTE: This router uses mergeParams: true so /:id is available from the parent router.
const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// GET /api/topics/:id/cycle-check — public utility, checks for cycles
// ---------------------------------------------------------------------------
router.get('/cycle-check', async (req: Request, res: Response) => {
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
// POST /api/topics/:id/nodes — add a claim node (contributor+)
// ---------------------------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireTopicRole('contributor'),
  idempotencyGuard,
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

// ---------------------------------------------------------------------------
// POST /api/topics/:id/nodes/:nodeId/vote — vote on a node (contributor+)
// ---------------------------------------------------------------------------
router.post(
  '/:nodeId/vote',
  requireAuth,
  requireTopicRole('contributor'),
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

export default router;
