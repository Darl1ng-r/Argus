/**
 * Miscellaneous API routes:
 *  - GET /api/me
 *  - GET /api/link-preview
 */
import { Router, Request, Response } from 'express';
import { fetchLinkPreview } from '../services/linkPreviewService.js';
import { sendError } from '../middleware/index.js';

const router = Router();

// GET /api/me — returns the currently authenticated user
router.get('/me', (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  res.json(req.user);
});

// GET /api/link-preview — OpenGraph metadata extractor (SSRF-protected)
router.get('/link-preview', async (req: Request, res: Response) => {
  try {
    const rawUrl = String(req.query.url || '');
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      return res.status(400).json({ error: 'Valid HTTP/HTTPS URL parameter is required.' });
    }

    const previewData = await fetchLinkPreview(rawUrl);
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.json(previewData);
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
  }
});

export default router;
