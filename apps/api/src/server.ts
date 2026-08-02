import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import pino from 'pino';
import { verifyToken } from '@clerk/backend';
import { testConnection } from './db.js';
import { redisClient } from './redis.js';
import { getOrCreateUser, User } from './services/graphService.js';
import { ValidationError } from './utils/sanitizer.js';
import { globalLimiter } from './middleware/rateLimiter.js';
import topicsRouter from './routes/topics.js';
import nodesRouter from './routes/nodes.js';
import miscRouter from './routes/misc.js';
import notificationsRouter from './routes/notifications.js';
import authRouter from './routes/auth.js';
import { metricsMiddleware, getPrometheusMetrics, getMetricsContentType } from './utils/metrics.js';
import { openTelemetryMiddleware } from './utils/tracer.js';

// -----------------------------------------------------------------------
// Structured Logger
// -----------------------------------------------------------------------
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
});

declare global {
  namespace Express {
    interface Request {
      user?: User;
      requestId?: string;
    }
  }
}

const app = express();
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
  logger.fatal('[ARGUS] CRITICAL: ALLOW_DEV_AUTH=true is forbidden in production. Exiting.');
  process.exit(1);
}

// -----------------------------------------------------------------------
// Gateway / Reverse Proxy Trust
// -----------------------------------------------------------------------
app.set('trust proxy', process.env.TRUST_PROXY || 1);

// -----------------------------------------------------------------------
// Security Headers (Helmet)
// -----------------------------------------------------------------------
app.use(
  helmet({
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
  })
);

// -----------------------------------------------------------------------
// Request Logging (Pino-HTTP) with Sensitive Data Redaction
// -----------------------------------------------------------------------
app.use(
  pinoHttp({
    logger,
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
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' },
  })
);

// OpenTelemetry Distributed Tracing & Prometheus Metrics Middleware
app.use(openTelemetryMiddleware);
app.use(metricsMiddleware);

// -----------------------------------------------------------------------
// CORS
// -----------------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new ValidationError(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '50kb' }));

// -----------------------------------------------------------------------
// Global Rate Limiter
// -----------------------------------------------------------------------
app.use(globalLimiter);

// -----------------------------------------------------------------------
// Authentication Middleware
// Reads Clerk JWT (Bearer token) ONLY — no custom header forgery in production.
// Dev mode (ALLOW_DEV_AUTH=true) also accepts X-User-Id/X-User-Name headers.
// -----------------------------------------------------------------------
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization'];
    let resolvedId: string | undefined;
    let resolvedUsername: string | undefined;
    let resolvedEmail: string | undefined;

    // Clerk JWT path
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (secretKey) {
        try {
          const payload = await verifyToken(token, { secretKey });
          // Fix 5: validate sub format before it reaches the DB layer
          if (payload?.sub) {
            const { validateIdentifier } = await import('./utils/sanitizer.js');
            try {
              resolvedId = validateIdentifier(payload.sub, 'sub');
            } catch {
              req.log.warn({ sub: payload.sub }, '[AUTH] JWT sub failed identifier validation — ignoring');
            }
          }
        } catch (err) {
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
      req.user = await getOrCreateUser(resolvedId, resolvedUsername, resolvedEmail);
    }
    next();
  } catch (err) {
    req.log.error({ err }, '[AUTH] Failed to resolve user session');
    next();
  }
});

// -----------------------------------------------------------------------
// Health Check — public, exempt from rate limiting
// -----------------------------------------------------------------------
app.get('/health', async (_req: Request, res: Response) => {
  try {
    const { db } = await import('./db.js');
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// Prometheus Metrics Endpoint (Item 18)
// Fix 1: Protected by METRICS_TOKEN bearer check to prevent intelligence leakage.
// Set METRICS_TOKEN env var; Prometheus scraper must send: Authorization: Bearer <token>
// In dev (no METRICS_TOKEN set), access is allowed with a logged warning.
app.get('/metrics', async (req: Request, res: Response) => {
  const metricsToken = process.env.METRICS_TOKEN;
  if (IS_PRODUCTION && metricsToken) {
    const authHeader = req.headers['authorization'];
    const provided = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;
    if (provided !== metricsToken) {
      return res.status(403).json({ error: 'Forbidden: valid METRICS_TOKEN required.' });
    }
  } else if (!metricsToken && IS_PRODUCTION) {
    // Prod without a token configured — refuse entirely rather than expose data
    logger.error('[METRICS] METRICS_TOKEN is not set in production. Blocking /metrics.');
    return res.status(403).json({ error: 'Metrics endpoint is not configured.' });
  } else if (!metricsToken) {
    logger.warn('[METRICS] METRICS_TOKEN not set — /metrics is open (dev mode only).');
  }
  try {
    const metrics = await getPrometheusMetrics();
    res.set('Content-Type', getMetricsContentType());
    res.send(metrics);
  } catch (err) {
    res.status(500).json({ error: 'Failed to collect Prometheus metrics' });
  }
});

// -----------------------------------------------------------------------
// Route Mounting
// -----------------------------------------------------------------------
app.use('/api', miscRouter);
app.use('/api/auth', authRouter);
app.use('/api/topics', topicsRouter);
app.use('/api/topics/:id/nodes', nodesRouter);
app.use('/api/notifications', notificationsRouter);

// -----------------------------------------------------------------------
// Global Error Handler
// -----------------------------------------------------------------------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, '[ARGUS] Unhandled error');
  const status = err instanceof ValidationError ? 400 : 500;
  const message =
    status >= 500 && IS_PRODUCTION
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
  await testConnection();
  app.listen(PORT, () => {
    logger.info(`[ARGUS API] Listening on port ${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
    if (ALLOW_DEV_AUTH) {
      logger.warn('[ARGUS API] ALLOW_DEV_AUTH=true — X-User-Id header auth is enabled. Never use in production!');
    }
  });
}

export { app };

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    logger.error({ err }, '[ARGUS API] Fatal startup error');
    process.exit(1);
  });
}
