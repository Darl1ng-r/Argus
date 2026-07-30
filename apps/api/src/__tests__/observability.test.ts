import { describe, it, expect } from 'vitest';
import { getPrometheusMetrics, getMetricsContentType } from '../utils/metrics.js';
import { tracer, traceSpan } from '../utils/tracer.js';

describe('Observability: Prometheus Metrics & OpenTelemetry Tracing', () => {
  it('collects Prometheus metrics in standard format', async () => {
    const metricsOutput = await getPrometheusMetrics();
    expect(typeof metricsOutput).toBe('string');
    expect(metricsOutput).toContain('argus_http_requests_total');
    expect(metricsOutput).toContain('argus_http_request_duration_seconds');
    expect(metricsOutput).toContain('argus_active_sse_connections');

    const contentType = getMetricsContentType();
    expect(contentType).toContain('text/plain');
  });

  it('provides active OpenTelemetry tracer and traceSpan helper', async () => {
    expect(tracer).toBeDefined();

    const result = await traceSpan('unit-test-span', async (span) => {
      expect(span).toBeDefined();
      return 42;
    }, { testAttr: 'val' });

    expect(result).toBe(42);
  });
});
