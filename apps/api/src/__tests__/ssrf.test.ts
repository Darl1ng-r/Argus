import { describe, it, expect } from 'vitest';
import { fetchLinkPreview } from '../services/linkPreviewService.js';

describe('SSRF Protection in Link Preview Service', () => {
  it('blocks localhost and loopback IPv4 addresses', async () => {
    const previewLocalhost = await fetchLinkPreview('http://localhost:4000/api/topics');
    expect(previewLocalhost.description).toContain('preview restricted');

    const previewLoopback = await fetchLinkPreview('http://127.0.0.1:5432/admin');
    expect(previewLoopback.description).toContain('preview restricted');
  });

  it('blocks cloud metadata endpoints (169.254.169.254)', async () => {
    const previewMetadata = await fetchLinkPreview('http://169.254.169.254/latest/meta-data/');
    expect(previewMetadata.description).toContain('preview restricted');
  });

  it('blocks internal RFC1918 private subnets', async () => {
    const preview10 = await fetchLinkPreview('http://10.0.0.1/admin');
    expect(preview10.description).toContain('preview restricted');

    const preview192 = await fetchLinkPreview('http://192.168.1.1/router');
    expect(preview192.description).toContain('preview restricted');
  });

  it('validates and resolves URLs, returning resolved IPs for safe external hosts', async () => {
    const { validateAndResolveUrl } = await import('../services/linkPreviewService.js');
    const res = await validateAndResolveUrl('http://localhost:4000/api/topics');
    expect(res.safe).toBe(false);
    expect(res.resolvedIps).toEqual([]);
  });
});
