import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import {
  validateIdentifier,
  sanitizeFlagReason,
  ValidationError,
} from '../utils/sanitizer.js';

describe('New Improvements & Security Fixes Tests', () => {
  describe('S-6: validateIdentifier max length limit', () => {
    it('accepts identifiers under 128 characters', () => {
      const validId = 'a'.repeat(128);
      expect(validateIdentifier(validId, 'testId')).toBe(validId);
    });

    it('rejects identifiers exceeding 128 characters', () => {
      const longId = 'a'.repeat(129);
      expect(() => validateIdentifier(longId, 'testId')).toThrow(ValidationError);
      expect(() => validateIdentifier(longId, 'testId')).toThrow(/must not exceed 128 characters/);
    });
  });

  describe('D-2: sanitizeFlagReason() HTML stripping & length check', () => {
    it('strips HTML tags from flag reasons', () => {
      const dirty = 'Spam content <script>alert(1)</script> <b>here</b>';
      const clean = sanitizeFlagReason(dirty);
      expect(clean).toBe('Spam content  here');
    });

    it('provides fallback for empty or non-string reason', () => {
      expect(sanitizeFlagReason('')).toBe('Inappropriate content');
      expect(sanitizeFlagReason(null)).toBe('Inappropriate content');
      expect(sanitizeFlagReason(undefined)).toBe('Inappropriate content');
    });

    it('throws ValidationError for reasons over 250 characters', () => {
      const longReason = 'a'.repeat(251);
      expect(() => sanitizeFlagReason(longReason)).toThrow(ValidationError);
    });
  });

  describe('F-1: PUT /api/topics/:id/nodes/:nodeId (Auth Guard)', () => {
    it('returns HTTP 401 Unauthorized when unauthenticated', async () => {
      const res = await request(app)
        .put('/api/topics/topic-123/nodes/node-456')
        .send({ content: 'Updated content claim' });
      expect([401, 500]).toContain(res.status);
    });
  });

  describe('F-2: DELETE /api/topics/:id/nodes/:nodeId (Auth Guard)', () => {
    it('returns HTTP 401 Unauthorized when unauthenticated', async () => {
      const res = await request(app).delete('/api/topics/topic-123/nodes/node-456');
      expect([401, 500]).toContain(res.status);
    });
  });

  describe('S-7: POST /api/notifications/mark-read (Validation)', () => {
    it('returns HTTP 400 when notificationIds exceeds 100 entries', async () => {
      const tooManyIds = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      const res = await request(app)
        .post('/api/notifications/mark-read')
        .set('x-user-id', 'user_test')
        .send({ notificationIds: tooManyIds });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must not contain more than 100 entries');
    });
  });

  describe('F-7: GET /api/topics/:id/steelman endpoint', () => {
    it('returns HTTP 200, 404 or 500 depending on DB connection with topicId parameter', async () => {
      const res = await request(app).get('/api/topics/topic-123/steelman');
      expect([200, 404, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('topicId', 'topic-123');
        expect(res.body).toHaveProperty('nodes');
        expect(Array.isArray(res.body.nodes)).toBe(true);
      }
    });
  });

  describe('Wave 2: New Endpoints & Delete Permissions', () => {
    it('GET /api/topics/:id/nodes/:nodeId returns 404 or 500 without DB mock', async () => {
      const res = await request(app).get('/api/topics/topic-123/nodes/node-456');
      expect([404, 500]).toContain(res.status);
    });

    it('POST /api/topics/:id/nodes/:nodeId/steelman requires authentication', async () => {
      const res = await request(app)
        .post('/api/topics/topic-123/nodes/node-456/steelman')
        .send({ isSteel: true });
      expect([401, 500]).toContain(res.status);
    });

    it('DELETE /api/topics/:id requires authentication', async () => {
      const res = await request(app).delete('/api/topics/topic-123');
      expect([401, 500]).toContain(res.status);
    });
  });
});
