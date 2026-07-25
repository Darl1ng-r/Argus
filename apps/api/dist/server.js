"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_js_1 = require("./db.js");
const graphService_js_1 = require("./services/graphService.js");
const sanitizer_js_1 = require("./utils/sanitizer.js");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '100kb' })); // Restrict JSON payload size to 100KB to prevent memory exhaustion DoS
// -----------------------------------------------------------------------
// Authentication Middleware
// -----------------------------------------------------------------------
app.use(async (req, _res, next) => {
    try {
        const rawHeader = req.headers['x-user-id'] || req.headers['authorization'];
        let userId = 'system-user-0000-0000-000000000000';
        let username;
        if (typeof rawHeader === 'string' && rawHeader.trim()) {
            userId = rawHeader.replace('Bearer ', '').trim();
        }
        if (req.headers['x-user-name'] && typeof req.headers['x-user-name'] === 'string') {
            username = req.headers['x-user-name'].trim();
        }
        req.user = await (0, graphService_js_1.getOrCreateUser)(userId, username);
        next();
    }
    catch (err) {
        console.error('[AUTH] Failed to resolve user session:', err);
        next();
    }
});
// Health check
app.get('/health', async (_req, res) => {
    try {
        const { db } = await import('./db.js');
        await db.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
    }
    catch {
        res.status(503).json({ status: 'error', db: 'disconnected' });
    }
});
// GET /api/me - Active user session profile
app.get('/api/me', (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthenticated' });
    res.json(req.user);
});
// GET /api/topics - List all topics
app.get('/api/topics', async (_req, res) => {
    try {
        const topics = await (0, graphService_js_1.getAllTopics)();
        res.json(topics);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// GET /api/topics/:id - Fetch topic with sanitized ID parameter
app.get('/api/topics/:id', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const currentUserId = req.user?.id;
        const topic = await (0, graphService_js_1.getTopic)(topicId, currentUserId);
        if (!topic)
            return res.status(404).json({ error: 'Topic not found' });
        res.json(topic);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError) {
            return res.status(400).json({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// POST /api/topics - Create topic with input validation and HTML stripping
app.post('/api/topics', async (req, res) => {
    try {
        const { title, rootClaim } = req.body;
        const sanitizedTitle = (0, sanitizer_js_1.sanitizeTopicTitle)(title);
        const sanitizedRootClaim = (0, sanitizer_js_1.sanitizeClaimContent)(rootClaim);
        const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
        const topic = await (0, graphService_js_1.createTopic)(sanitizedTitle, sanitizedRootClaim, authorId);
        res.status(201).json(topic);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError) {
            return res.status(400).json({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// POST /api/topics/:id/nodes - Add claim node with input sanitization & edgeType enum validation
app.post('/api/topics/:id/nodes', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const { parentId, edgeType, content } = req.body;
        const sanitizedParentId = (0, sanitizer_js_1.validateIdentifier)(parentId, 'parentId');
        const validatedEdgeType = (0, sanitizer_js_1.validateEdgeType)(edgeType);
        const sanitizedContent = (0, sanitizer_js_1.sanitizeClaimContent)(content);
        const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
        const newNode = await (0, graphService_js_1.addClaimNode)(topicId, sanitizedParentId, authorId, validatedEdgeType, sanitizedContent);
        res.status(201).json(newNode);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError) {
            return res.status(400).json({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// POST /api/topics/:id/nodes/:nodeId/vote - Vote with strict voteType validation
app.post('/api/topics/:id/nodes/:nodeId/vote', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const nodeId = (0, sanitizer_js_1.validateIdentifier)(req.params.nodeId, 'nodeId');
        const { voteType } = req.body;
        const validatedVoteType = (0, sanitizer_js_1.validateVoteType)(voteType);
        const userId = req.user?.id || 'system-user-0000-0000-000000000000';
        const updatedNode = await (0, graphService_js_1.voteNode)(topicId, nodeId, userId, validatedVoteType);
        res.json(updatedNode);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError) {
            return res.status(400).json({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// POST /api/topics/:id/fork
app.post('/api/topics/:id/fork', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const authorId = req.user?.id || 'system-user-0000-0000-000000000000';
        const forked = await (0, graphService_js_1.forkTopic)(topicId, authorId);
        res.status(201).json(forked);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError) {
            return res.status(400).json({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// Bootstrap
async function bootstrap() {
    await (0, db_js_1.testConnection)();
    app.listen(PORT, () => {
        console.log(`[ARGUS API] Listening on port ${PORT}`);
    });
}
bootstrap().catch((err) => {
    console.error('[ARGUS API] Failed to start:', err);
    process.exit(1);
});
