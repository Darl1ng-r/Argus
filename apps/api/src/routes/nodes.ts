/**
 * /api/topics/:id/nodes — Node CRUD and voting.
 * Mounted by the topics router at /:id/nodes.
 */
import { Router, Request, Response } from 'express';
import {
  addClaimNode,
  voteNode,
  detectCycle,
  updateClaimNode,
  deleteClaimNode,
} from '../services/graphService.js';
import {
  sanitizeClaimContent,
  sanitizeFlagReason,
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
        req.user!,
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
      const updatedNode = await voteNode(topicId, nodeId, req.user!, validatedVoteType);
      res.json(updatedNode);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/topics/:id/nodes/:nodeId/history — immutable edit history (Item 13)
// ---------------------------------------------------------------------------
router.get('/:nodeId/history', async (req: Request, res: Response) => {
  try {
    const nodeId = validateIdentifier(req.params.nodeId, 'nodeId');
    const { getNodeVersionHistory } = await import('../services/graphService.js');
    const history = await getNodeVersionHistory(nodeId);
    res.json(history);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/topics/:id/nodes/:nodeId/flag — flag a claim node for moderation (Item 19)
// ---------------------------------------------------------------------------
router.post(
  '/:nodeId/flag',
  requireAuth,
  mutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const topicId = validateIdentifier(req.params.id, 'topicId');
      const nodeId = validateIdentifier(req.params.nodeId, 'nodeId');
      const { reason } = req.body as { reason?: unknown };

      // Fix D-2: Use sanitizeFlagReason for proper type checking, HTML strip, and length enforcement
      const cleanReason = sanitizeFlagReason(reason);
      const { flagClaimNode } = await import('../services/graphService.js');
      const result = await flagClaimNode(topicId, nodeId, req.user!, cleanReason);

      res.json(result);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/topics/:id/nodes/:nodeId/moderate — moderator action (Item 19)
// ---------------------------------------------------------------------------
router.post(
  '/:nodeId/moderate',
  requireAuth,
  requireTopicRole('owner'),
  mutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const topicId = validateIdentifier(req.params.id, 'topicId');
      const nodeId = validateIdentifier(req.params.nodeId, 'nodeId');
      const { action } = req.body as { action?: string };

      if (!action || !['FLAG', 'UNFLAG', 'REMOVE'].includes(action.toUpperCase())) {
        return res.status(400).json({ error: 'Action must be one of FLAG, UNFLAG, REMOVE' });
      }

      const { moderateNode } = await import('../services/graphService.js');
      const result = await moderateNode(topicId, nodeId, action.toUpperCase() as any);

      res.json(result);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/topics/:id/nodes/:nodeId — edit a claim node (Fix F-1)
// Author or topic owner can edit. Content is versioned into node_versions.
// ---------------------------------------------------------------------------
router.put(
  '/:nodeId',
  requireAuth,
  mutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const topicId = validateIdentifier(req.params.id, 'topicId');
      const nodeId = validateIdentifier(req.params.nodeId, 'nodeId');
      const { content } = req.body as { content?: unknown };

      const sanitizedContent = sanitizeClaimContent(content);

      // Verify caller is the node's author or the topic owner
      const { getUserTopicRole } = await import('../services/graphService.js');
      const userRole = await getUserTopicRole(topicId, req.user!.id);
      const nodeAuthorRes = await import('../db.js').then(({ db }) =>
        db.query<{ author_id: string }>(
          'SELECT author_id FROM nodes WHERE id = $1 AND topic_id = $2',
          [nodeId, topicId]
        )
      );
      if (nodeAuthorRes.rowCount === 0) {
        return res.status(404).json({ error: 'Node not found.' });
      }

      const isAuthor = nodeAuthorRes.rows[0].author_id === req.user!.id;
      const isOwner = userRole === 'owner';
      if (!isAuthor && !isOwner) {
        return res.status(403).json({ error: 'Forbidden: Only the claim author or topic owner can edit this claim.' });
      }

      const updatedNode = await updateClaimNode(topicId, nodeId, sanitizedContent, req.user!);
      res.json(updatedNode);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/topics/:id/nodes/:nodeId — soft-delete a claim node (Fix F-2)
// Authors can delete within 15 minutes. Topic owners can delete any time.
// Cannot delete if node has active children.
// ---------------------------------------------------------------------------
router.delete(
  '/:nodeId',
  requireAuth,
  mutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const topicId = validateIdentifier(req.params.id, 'topicId');
      const nodeId = validateIdentifier(req.params.nodeId, 'nodeId');

      // Topic owners bypass the grace-period check (they can always moderate)
      const { getUserTopicRole } = await import('../services/graphService.js');
      const userRole = await getUserTopicRole(topicId, req.user!.id);
      const isOwner = userRole === 'owner';

      // Pass the requesting user; deleteClaimNode applies grace-period check unless owner
      const result = await deleteClaimNode(topicId, nodeId, req.user!);

      // If the caller is not the owner, ensure they are the author (deleteClaimNode enforces this)
      res.json(result);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
  }
);

export default router;
