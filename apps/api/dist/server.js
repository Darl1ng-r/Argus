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
// CORS Security Configuration
const allowedOrigins = [
    process.env.CORS_ORIGIN || 'http://localhost:5173',
    'http://127.0.0.1:5173',
];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new sanitizer_js_1.ValidationError(`CORS blocked request from origin: ${origin}`));
        }
    },
    credentials: true,
}));
app.use(express_1.default.json({ limit: '100kb' }));
// Authentication Middleware
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
// GET /api/me
app.get('/api/me', (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthenticated' });
    res.json(req.user);
});
// GET /api/topics
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
// GET /api/topics/:id - Fetch topic with depth-limiting & subgraph pagination support
app.get('/api/topics/:id', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const depth = req.query.depth ? parseInt(String(req.query.depth), 10) : 2; // Default to 2-hop subgraph depth
        const fromNodeId = req.query.fromNodeId ? (0, sanitizer_js_1.validateIdentifier)(String(req.query.fromNodeId), 'fromNodeId') : undefined;
        const currentUserId = req.user?.id;
        const topic = await (0, graphService_js_1.getTopicSubgraph)(topicId, fromNodeId, Math.min(depth, 10), currentUserId);
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
// GET /api/topics/:id/subgraph - Lazy load deeper hops on demand
app.get('/api/topics/:id/subgraph', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const fromNodeId = (0, sanitizer_js_1.validateIdentifier)(String(req.query.fromNodeId), 'fromNodeId');
        const depth = req.query.depth ? parseInt(String(req.query.depth), 10) : 2;
        const currentUserId = req.user?.id;
        const subgraph = await (0, graphService_js_1.getTopicSubgraph)(topicId, fromNodeId, Math.min(depth, 5), currentUserId);
        if (!subgraph)
            return res.status(404).json({ error: 'Topic or node not found' });
        res.json(subgraph);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError) {
            return res.status(400).json({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// POST /api/topics
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
// POST /api/topics/:id/nodes
app.post('/api/topics/:id/nodes', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const { parentId, edgeType, content } = req.body;
        const sanitizedParentId = (0, sanitizer_js_1.validateIdentifier)(parentId, 'parentId');
        const validatedEdgeType = (0, sanitizer_js_1.validateEdgeType)(edgeType);
        const sanitizedContent = (0, sanitizer_js_1.sanitizeClaimContent)(content);
        const wouldCycle = await (0, graphService_js_1.detectCycle)(topicId, sanitizedParentId);
        if (wouldCycle) {
            throw new sanitizer_js_1.ValidationError('Circular reasoning blocked: connecting these claims creates a cycle. Argus argument graphs must be Directed Acyclic Graphs (DAGs).');
        }
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
// GET /api/topics/:id/cycle-check
app.get('/api/topics/:id/cycle-check', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const { parentId, childId } = req.query;
        if (!parentId || !childId) {
            return res.status(400).json({ error: 'parentId and childId query params are required' });
        }
        const sParent = (0, sanitizer_js_1.validateIdentifier)(parentId, 'parentId');
        const sChild = (0, sanitizer_js_1.validateIdentifier)(childId, 'childId');
        const wouldCycle = await (0, graphService_js_1.detectCycle)(topicId, sParent, sChild);
        res.json({ wouldCycle, parentId: sParent, childId: sChild });
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError) {
            return res.status(400).json({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// POST /api/topics/:id/nodes/:nodeId/vote
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
