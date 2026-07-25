"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rate_limit_redis_1 = require("rate-limit-redis");
const pino_http_1 = __importDefault(require("pino-http"));
const pino_1 = __importDefault(require("pino"));
const backend_1 = require("@clerk/backend");
const db_js_1 = require("./db.js");
const redis_js_1 = require("./redis.js");
const graphService_js_1 = require("./services/graphService.js");
const sanitizer_js_1 = require("./utils/sanitizer.js");
// -----------------------------------------------------------------------
// Structured Logger (Fix #4b — Pino replaces bare console.log)
// -----------------------------------------------------------------------
exports.logger = (0, pino_1.default)({
    level: process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV !== 'production' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
});
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// -----------------------------------------------------------------------
// Fix #11 — Security Headers via Helmet
// -----------------------------------------------------------------------
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
        },
    },
    hsts: IS_PRODUCTION ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
}));
// -----------------------------------------------------------------------
// Request Logging (Pino-HTTP)
// -----------------------------------------------------------------------
app.use((0, pino_http_1.default)({
    logger: exports.logger,
    customLogLevel(_req, res) {
        if (res.statusCode >= 500)
            return 'error';
        if (res.statusCode >= 400)
            return 'warn';
        return 'info';
    },
    // Don't log health check spam
    autoLogging: { ignore: (req) => req.url === '/health' },
}));
// -----------------------------------------------------------------------
// CORS Security Configuration
// -----------------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim());
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, curl, health checks)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new sanitizer_js_1.ValidationError(`CORS blocked: ${origin}`));
        }
    },
    credentials: true,
}));
app.use(express_1.default.json({ limit: '50kb' }));
// -----------------------------------------------------------------------
// Fix #3 — Distributed Rate Limiting via Redis (graceful fallback to memory)
// -----------------------------------------------------------------------
function makeStore() {
    if (redis_js_1.redisClient) {
        return new rate_limit_redis_1.RedisStore({
            // @ts-expect-error — ioredis satisfies the interface
            sendCommand: (...args) => redis_js_1.redisClient.call(...args),
        });
    }
    // Memory store fallback (dev only)
    return undefined;
}
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(),
    message: { error: 'Too many requests. Please slow down.' },
});
// Stricter limits for state-mutating endpoints
const mutationLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60_000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(),
    message: { error: 'Too many submissions. Please wait a minute before trying again.' },
});
const voteLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(),
    message: { error: 'Voting speed limit exceeded. Please wait before voting again.' },
});
app.use(globalLimiter);
// -----------------------------------------------------------------------
// Fix #1 — Authentication Middleware
// - Reads Clerk JWT (Bearer token) ONLY — no custom header forgery
// - In dev mode (ALLOW_DEV_AUTH=true), also accepts X-User-Id/X-User-Name
//   so the existing dev flow still works without a Clerk account
// -----------------------------------------------------------------------
const ALLOW_DEV_AUTH = process.env.ALLOW_DEV_AUTH === 'true' && !IS_PRODUCTION;
app.use(async (req, _res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        let resolvedId;
        let resolvedUsername;
        let resolvedEmail;
        // --- Clerk JWT path ---
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '').trim();
            const secretKey = process.env.CLERK_SECRET_KEY;
            if (secretKey) {
                try {
                    const payload = await (0, backend_1.verifyToken)(token, { secretKey });
                    if (payload?.sub) {
                        resolvedId = payload.sub;
                    }
                }
                catch (err) {
                    // JWT invalid/expired — do NOT fall through to dev auth in production
                    if (IS_PRODUCTION) {
                        req.log.warn({ err }, '[AUTH] Invalid JWT token');
                    }
                }
            }
        }
        // --- Dev auth path (only when ALLOW_DEV_AUTH=true and not production) ---
        if (!resolvedId && ALLOW_DEV_AUTH) {
            const customUserId = req.headers['x-user-id'];
            const customUserName = req.headers['x-user-name'];
            if (typeof customUserId === 'string' && customUserId.trim()) {
                resolvedId = customUserId.trim();
            }
            if (typeof customUserName === 'string' && customUserName.trim()) {
                resolvedUsername = customUserName.trim();
            }
        }
        if (resolvedId) {
            req.user = await (0, graphService_js_1.getOrCreateUser)(resolvedId, resolvedUsername, resolvedEmail);
        }
        // No resolved ID → req.user remains undefined (anonymous read access)
        next();
    }
    catch (err) {
        req.log.error({ err }, '[AUTH] Failed to resolve user session');
        next();
    }
});
// -----------------------------------------------------------------------
// Fix #2 — requireAuth middleware guards all mutation routes
// -----------------------------------------------------------------------
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    next();
}
// -----------------------------------------------------------------------
// Fix #21 — Generic error sender (prevents leaking internal details)
// -----------------------------------------------------------------------
function sendError(res, status, message, internalErr) {
    if (internalErr) {
        exports.logger.error({ err: internalErr }, message);
    }
    // In production, never expose raw error messages for 5xx
    const clientMessage = status >= 500 && IS_PRODUCTION ? 'An internal error occurred. Please try again.' : message;
    return res.status(status).json({ error: clientMessage });
}
// -----------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------
// Health check — public, not rate limited
app.get('/health', async (_req, res) => {
    try {
        const { db } = await import('./db.js');
        await db.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
    }
    catch (err) {
        res.status(503).json({ status: 'error', db: 'disconnected' });
    }
});
// GET /api/me — public, returns authenticated user if any
app.get('/api/me', (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthenticated' });
    res.json(req.user);
});
// GET /api/topics — public, Cache-Control for CDN/browser
app.get('/api/topics', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
        const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
        const topics = await (0, graphService_js_1.getAllTopics)(page, limit);
        // Fix — add cache headers for public GET endpoints
        res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
        res.json(topics);
    }
    catch (err) {
        sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
});
// GET /api/topics/:id
app.get('/api/topics/:id', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const depth = req.query.depth ? parseInt(String(req.query.depth), 10) : 2;
        const fromNodeId = req.query.fromNodeId
            ? (0, sanitizer_js_1.validateIdentifier)(String(req.query.fromNodeId), 'fromNodeId')
            : undefined;
        const currentUserId = req.user?.id;
        const topic = await (0, graphService_js_1.getTopicSubgraph)(topicId, fromNodeId, Math.min(depth, 10), currentUserId);
        if (!topic)
            return res.status(404).json({ error: 'Topic not found' });
        res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=20');
        res.json(topic);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError)
            return res.status(400).json({ error: err.message });
        sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
});
// GET /api/topics/:id/subgraph
app.get('/api/topics/:id/subgraph', async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const fromNodeId = (0, sanitizer_js_1.validateIdentifier)(String(req.query.fromNodeId), 'fromNodeId');
        const depth = req.query.depth ? parseInt(String(req.query.depth), 10) : 2;
        const currentUserId = req.user?.id;
        const subgraph = await (0, graphService_js_1.getTopicSubgraph)(topicId, fromNodeId, Math.min(depth, 5), currentUserId);
        if (!subgraph)
            return res.status(404).json({ error: 'Topic or node not found' });
        res.set('Cache-Control', 'public, max-age=5, stale-while-revalidate=10');
        res.json(subgraph);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError)
            return res.status(400).json({ error: err.message });
        sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
});
// POST /api/topics — Fix #2: requireAuth applied
app.post('/api/topics', requireAuth, mutationLimiter, async (req, res) => {
    try {
        const { title, rootClaim } = req.body;
        const sanitizedTitle = (0, sanitizer_js_1.sanitizeTopicTitle)(title);
        const sanitizedRootClaim = (0, sanitizer_js_1.sanitizeClaimContent)(rootClaim);
        const topic = await (0, graphService_js_1.createTopic)(sanitizedTitle, sanitizedRootClaim, req.user.id);
        res.status(201).json(topic);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError)
            return res.status(400).json({ error: err.message });
        sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
});
// POST /api/topics/:id/nodes — Fix #2: requireAuth applied
app.post('/api/topics/:id/nodes', requireAuth, mutationLimiter, async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const { parentId, edgeType, content } = req.body;
        const sanitizedParentId = (0, sanitizer_js_1.validateIdentifier)(parentId, 'parentId');
        const validatedEdgeType = (0, sanitizer_js_1.validateEdgeType)(edgeType);
        const sanitizedContent = (0, sanitizer_js_1.sanitizeClaimContent)(content);
        // Note: a brand-new leaf node cannot create a cycle since it has no
        // outgoing edges. Cycle detection here is a safety check for edge
        // rearrangement, which isn't supported in the current API.
        const wouldCycle = await (0, graphService_js_1.detectCycle)(topicId, sanitizedParentId);
        if (wouldCycle) {
            throw new sanitizer_js_1.ValidationError('Circular reasoning blocked: connecting these claims creates a cycle.');
        }
        const newNode = await (0, graphService_js_1.addClaimNode)(topicId, sanitizedParentId, req.user.id, validatedEdgeType, sanitizedContent);
        res.status(201).json(newNode);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError)
            return res.status(400).json({ error: err.message });
        sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
});
// GET /api/topics/:id/cycle-check — public utility endpoint
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
        if (err instanceof sanitizer_js_1.ValidationError)
            return res.status(400).json({ error: err.message });
        sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
});
// POST /api/topics/:id/nodes/:nodeId/vote — Fix #2: requireAuth applied
app.post('/api/topics/:id/nodes/:nodeId/vote', requireAuth, voteLimiter, async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const nodeId = (0, sanitizer_js_1.validateIdentifier)(req.params.nodeId, 'nodeId');
        const { voteType } = req.body;
        const validatedVoteType = (0, sanitizer_js_1.validateVoteType)(voteType);
        const updatedNode = await (0, graphService_js_1.voteNode)(topicId, nodeId, req.user.id, validatedVoteType);
        res.json(updatedNode);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError)
            return res.status(400).json({ error: err.message });
        sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
});
// POST /api/topics/:id/fork — Fix #2: requireAuth applied
app.post('/api/topics/:id/fork', requireAuth, mutationLimiter, async (req, res) => {
    try {
        const topicId = (0, sanitizer_js_1.validateIdentifier)(req.params.id, 'topicId');
        const forked = await (0, graphService_js_1.forkTopic)(topicId, req.user.id);
        res.status(201).json(forked);
    }
    catch (err) {
        if (err instanceof sanitizer_js_1.ValidationError)
            return res.status(400).json({ error: err.message });
        sendError(res, 500, err instanceof Error ? err.message : 'Unknown error', err);
    }
});
// -----------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------
async function bootstrap() {
    await (0, db_js_1.testConnection)();
    app.listen(PORT, () => {
        exports.logger.info(`[ARGUS API] Listening on port ${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
        if (ALLOW_DEV_AUTH) {
            exports.logger.warn('[ARGUS API] ALLOW_DEV_AUTH=true — X-User-Id header auth is enabled. Never use in production!');
        }
    });
}
bootstrap().catch((err) => {
    exports.logger.error({ err }, '[ARGUS API] Fatal startup error');
    process.exit(1);
});
