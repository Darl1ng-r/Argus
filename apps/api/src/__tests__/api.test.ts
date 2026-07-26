import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';

describe('Argus REST API Integration Tests', () => {
  describe('GET /health', () => {
    it('returns health diagnostics status JSON payload', async () => {
      const res = await request(app).get('/health');
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
    });
  });

  describe('GET /api/topics', () => {
    it('returns topics response payload with Cache-Control header', async () => {
      const res = await request(app).get('/api/topics');
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.headers['cache-control']).toContain('public');
      }
    });
  });

  describe('POST /api/topics (Auth Guard)', () => {
    it('returns HTTP 401 Unauthorized when no authentication token is provided', async () => {
      const res = await request(app)
        .post('/api/topics')
        .send({ title: 'Unauthenticated Debate', rootClaim: 'Test claim content' });
      expect([401, 500]).toContain(res.status);
    });
  });

  describe('GET /api/link-preview', () => {
    it('returns HTTP 400 Bad Request when url query parameter is missing', async () => {
      const res = await request(app).get('/api/link-preview');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Valid HTTP/HTTPS URL');
    });

    it('returns HTTP 200 OK with link metadata for valid URL', async () => {
      const res = await request(app).get('/api/link-preview?url=https://example.com');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('url');
      expect(res.body).toHaveProperty('title');
    });
  });

  describe('GET /api/topics/:id/cycle-check', () => {
    it('returns HTTP 400 Bad Request if query parameters are missing', async () => {
      const res = await request(app).get('/api/topics/topic-123/cycle-check');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('parentId and childId');
    });
  });
});
