/**
 * OpenTelemetry Distributed Tracing Provider for Argus API.
 *
 * Configures OpenTelemetry TracerProvider and provides utilities:
 *  - Automatically generates trace IDs for incoming HTTP requests.
 *  - Attaches `X-Trace-Id` headers to HTTP responses for end-to-end trace correlation.
 *  - Provides `traceSpan` helper to instrument async operations (DB queries, AI calls, graph algorithms).
 */

import { trace, context, SpanStatusCode, Span, Tracer } from '@opentelemetry/api';
import { BasicTracerProvider, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Request, Response, NextFunction } from 'express';

const SERVICE_NAME = 'argus-api';

// Initialize OpenTelemetry TracerProvider with spanProcessors
const provider = new BasicTracerProvider(
  process.env.OTEL_TRACING_ENABLED === 'true' || process.env.NODE_ENV === 'development'
    ? { spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())] }
    : undefined
);

trace.setGlobalTracerProvider(provider);

export const tracer: Tracer = trace.getTracer(SERVICE_NAME, '1.0.0');

/**
 * Express middleware to create an OpenTelemetry span for every incoming request
 * and attach the traceId to response headers (`X-Trace-Id`).
 */
export function openTelemetryMiddleware(req: Request, res: Response, next: NextFunction): void {
  const spanName = `${req.method} ${req.path}`;
  const span = tracer.startSpan(spanName, {
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.target': req.path,
      'user_agent': req.headers['user-agent'] || '',
    },
  });

  const spanContext = span.spanContext();
  const traceId = spanContext.traceId;

  // Attach trace ID to response header for client correlation
  res.setHeader('X-Trace-Id', traceId);

  res.on('finish', () => {
    span.setAttribute('http.status_code', res.statusCode);
    if (res.statusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${res.statusCode}`,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  });

  // Execute remaining middleware inside span context
  context.with(trace.setSpan(context.active(), span), () => {
    next();
  });
}

/**
 * Helper to wrap any async operation (DB query, AI model call, layout calculation) in an OpenTelemetry span.
 */
export async function traceSpan<T>(
  spanName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const span = tracer.startSpan(spanName);
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }

  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err: any) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err.message || 'Operation failed',
    });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
