"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = exports.logger = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const pino_http_1 = __importDefault(require("pino-http"));
const pino_1 = __importDefault(require("pino"));
const backend_1 = require("@clerk/backend");
const db_js_1 = require("./db.js");
const graphService_js_1 = require("./services/graphService.js");
const sanitizer_js_1 = require("./utils/sanitizer.js");
const rateLimiter_js_1 = require("./middleware/rateLimiter.js");
const topics_js_1 = __importDefault(require("./routes/topics.js"));
const nodes_js_1 = __importDefault(require("./routes/nodes.js"));
const misc_js_1 = __importDefault(require("./routes/misc.js"));
const notifications_js_1 = __importDefault(require("./routes/notifications.js"));
const auth_js_1 = __importDefault(require("./routes/auth.js"));
const metrics_js_1 = require("./utils/metrics.js");
const tracer_js_1 = require("./utils/tracer.js");
// -----------------------------------------------------------------------
// Structured Logger
// -----------------------------------------------------------------------
exports.logger = (0, pino_1.default)({
    level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
});
const app = (0, express_1.default)();
exports.app = app;
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOW_DEV_AUTH = process.env.ALLOW_DEV_AUTH === 'true' && !IS_PRODUCTION;
// -----------------------------------------------------------------------
// STARTUP SAFETY GUARD
// If ALLOW_DEV_AUTH is somehow true in production, crash immediately.
// This prevents a misconfigured staging environment from accepting
// unauthenticated X-User-Id header requests against real data.
// -----------------------------------------------------------------------
if (ALLOW_DEV_AUTH && IS_PRODUCTION) {
    exports.logger.fatal('[ARGUS] CRITICAL: ALLOW_DEV_AUTH=true is forbidden in production. Exiting.');
    process.exit(1);
}
// -----------------------------------------------------------------------
// Gateway / Reverse Proxy Trust
// -----------------------------------------------------------------------
app.set('trust proxy', process.env.TRUST_PROXY || 1);
// -----------------------------------------------------------------------
// Security Headers (Helmet)
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
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
        },
    },
    frameguard: { action: 'deny' },
    hsts: IS_PRODUCTION ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
}));
// -----------------------------------------------------------------------
// Request Logging (Pino-HTTP) with Sensitive Data Redaction
// -----------------------------------------------------------------------
app.use((0, pino_http_1.default)({
    logger: exports.logger,
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-user-id"]',
            'req.body.password',
            'req.body.secret',
        ],
        censor: '[REDACTED]',
    },
    customLogLevel(_req, res) {
        if (res.statusCode >= 500)
            return 'error';
        if (res.statusCode >= 400)
            return 'warn';
        return 'info';
    },
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' },
}));
// OpenTelemetry Distributed Tracing & Prometheus Metrics Middleware
app.use(tracer_js_1.openTelemetryMiddleware);
app.use(metrics_js_1.metricsMiddleware);
// -----------------------------------------------------------------------
// CORS
// -----------------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim());
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
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
// Global Rate Limiter
// -----------------------------------------------------------------------
app.use(rateLimiter_js_1.globalLimiter);
// -----------------------------------------------------------------------
// Authentication Middleware
// Reads Clerk JWT (Bearer token) ONLY — no custom header forgery in production.
// Dev mode (ALLOW_DEV_AUTH=true) also accepts X-User-Id/X-User-Name headers.
// -----------------------------------------------------------------------
app.use(async (req, _res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        let resolvedId;
        let resolvedUsername;
        let resolvedEmail;
        // Clerk JWT path
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '').trim();
            const secretKey = process.env.CLERK_SECRET_KEY;
            if (secretKey) {
                try {
                    const payload = await (0, backend_1.verifyToken)(token, { secretKey });
                    // Fix 5: validate sub format before it reaches the DB layer
                    if (payload?.sub) {
                        const { validateIdentifier } = await import('./utils/sanitizer.js');
                        try {
                            resolvedId = validateIdentifier(payload.sub, 'sub');
                        }
                        catch {
                            req.log.warn({ sub: payload.sub }, '[AUTH] JWT sub failed identifier validation — ignoring');
                        }
                    }
                }
                catch (err) {
                    if (IS_PRODUCTION) {
                        req.log.warn({ err }, '[AUTH] Invalid JWT token');
                    }
                }
            }
        }
        // Dev auth path (only when ALLOW_DEV_AUTH=true and explicitly not production)
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
        next();
    }
    catch (err) {
        req.log.error({ err }, '[AUTH] Failed to resolve user session');
        next();
    }
});
// -----------------------------------------------------------------------
// Health Check — public, exempt from rate limiting
// -----------------------------------------------------------------------
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
// Prometheus Metrics Endpoint (Item 18)
// Fix 1: Protected by METRICS_TOKEN bearer check to prevent intelligence leakage.
// Set METRICS_TOKEN env var; Prometheus scraper must send: Authorization: Bearer <token>
// In dev (no METRICS_TOKEN set), access is allowed with a logged warning.
app.get('/metrics', async (req, res) => {
    const metricsToken = process.env.METRICS_TOKEN;
    if (IS_PRODUCTION && metricsToken) {
        const authHeader = req.headers['authorization'];
        const provided = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7).trim()
            : null;
        if (provided !== metricsToken) {
            return res.status(403).json({ error: 'Forbidden: valid METRICS_TOKEN required.' });
        }
    }
    else if (!metricsToken && IS_PRODUCTION) {
        // Prod without a token configured — refuse entirely rather than expose data
        exports.logger.error('[METRICS] METRICS_TOKEN is not set in production. Blocking /metrics.');
        return res.status(403).json({ error: 'Metrics endpoint is not configured.' });
    }
    else if (!metricsToken) {
        exports.logger.warn('[METRICS] METRICS_TOKEN not set — /metrics is open (dev mode only).');
    }
    try {
        const metrics = await (0, metrics_js_1.getPrometheusMetrics)();
        res.set('Content-Type', (0, metrics_js_1.getMetricsContentType)());
        res.send(metrics);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to collect Prometheus metrics' });
    }
});
// -----------------------------------------------------------------------
// Route Mounting
// -----------------------------------------------------------------------
app.use('/api', misc_js_1.default);
app.use('/api/auth', auth_js_1.default);
app.use('/api/topics', topics_js_1.default);
app.use('/api/topics/:id/nodes', nodes_js_1.default);
app.use('/api/notifications', notifications_js_1.default);
// -----------------------------------------------------------------------
// Global Error Handler
// -----------------------------------------------------------------------
app.use((err, _req, res, _next) => {
    exports.logger.error({ err }, '[ARGUS] Unhandled error');
    const status = err instanceof sanitizer_js_1.ValidationError ? 400 : 500;
    const message = status >= 500 && IS_PRODUCTION
        ? 'An internal error occurred. Please try again.'
        : err instanceof Error
            ? err.message
            : 'Unknown error';
    res.status(status).json({ error: message });
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
if (process.env.NODE_ENV !== 'test') {
    bootstrap().catch((err) => {
        exports.logger.error({ err }, '[ARGUS API] Fatal startup error');
        process.exit(1);
    });
}
