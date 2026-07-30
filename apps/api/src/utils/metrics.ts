/**
 * Prometheus Metrics Collector for Argus API.
 *
 * Exposes real-time application and infrastructure metrics:
 *  - HTTP Request counter & duration histogram (by method, route, status_code)
 *  - Database query duration histogram
 *  - Active SSE connections gauge
 *  - Node.js runtime process metrics (CPU, Memory, Event Loop Lag, Heap)
 */

import client from 'prom-client';
import { Request, Response, NextFunction } from 'express';

// Enable default Node.js process & system metrics collection
client.collectDefaultMetrics({ prefix: 'argus_' });

/** Counter tracking total HTTP request volume. */
export const httpRequestCounter = new client.Counter({
  name: 'argus_http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'],
});

/** Histogram tracking HTTP request duration in seconds. */
export const httpRequestDurationHistogram = new client.Histogram({
  name: 'argus_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** Histogram tracking database query execution duration in seconds. */
export const dbQueryDurationHistogram = new client.Histogram({
  name: 'argus_db_query_duration_seconds',
  help: 'Database query execution duration in seconds',
  labelNames: ['query_type'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

/** Gauge tracking active live SSE client connections. */
export const activeSseConnectionsGauge = new client.Gauge({
  name: 'argus_active_sse_connections',
  help: 'Number of active live SSE streaming connections',
});

/**
 * Express middleware to automatically track HTTP request duration and count metrics.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    const route = req.route?.path || req.path || 'unknown';
    const statusCode = String(res.statusCode);

    httpRequestCounter.inc({ method: req.method, route, status_code: statusCode });
    httpRequestDurationHistogram.observe({ method: req.method, route, status_code: statusCode }, durationInSeconds);
  });

  next();
}

/**
 * Returns formatted Prometheus metrics text representation for /metrics endpoint.
 */
export async function getPrometheusMetrics(): Promise<string> {
  return client.register.metrics();
}

/**
 * Returns the Content-Type header for Prometheus metrics response.
 */
export function getMetricsContentType(): string {
  return client.register.contentType;
}
