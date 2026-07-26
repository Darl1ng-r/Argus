import { describe, it, expect } from 'vitest';
import {
  sanitizeClaimContent,
  sanitizeTopicTitle,
  validateEdgeType,
  validateVoteType,
  validateIdentifier,
  ValidationError,
} from '../utils/sanitizer.js';

describe('Sanitizer & Input Validation Utilities', () => {
  describe('sanitizeClaimContent()', () => {
    it('strips all HTML script and image tags from input', () => {
      const dirty = 'Mars exploration <script>alert("xss")</script> is <b>vital</b>.';
      const clean = sanitizeClaimContent(dirty);
      expect(clean).toBe('Mars exploration  is vital.');
      expect(clean).not.toContain('<script>');
      expect(clean).not.toContain('<b>');
    });

    it('normalizes Unicode strings to NFC form', () => {
      const unnormalized = 'e\u0301'; // 'e' + combining acute accent
      const clean = sanitizeClaimContent(unnormalized);
      expect(clean).toBe('é');
    });

    it('throws ValidationError when claim is empty', () => {
      expect(() => sanitizeClaimContent('   ')).toThrow(ValidationError);
      expect(() => sanitizeClaimContent('')).toThrow('Claim content cannot be empty.');
    });

    it('throws ValidationError when claim exceeds 1000 characters', () => {
      const longText = 'a'.repeat(1001);
      expect(() => sanitizeClaimContent(longText)).toThrow(ValidationError);
    });
  });

  describe('sanitizeTopicTitle()', () => {
    it('sanitizes HTML and validates minimum title length', () => {
      const dirty = '<i>Space Policy 2026</i>';
      const clean = sanitizeTopicTitle(dirty);
      expect(clean).toBe('Space Policy 2026');
    });

    it('throws ValidationError for titles shorter than 3 characters', () => {
      expect(() => sanitizeTopicTitle('Hi')).toThrow(ValidationError);
    });
  });

  describe('validateEdgeType()', () => {
    it('accepts valid edge types', () => {
      expect(validateEdgeType('supports')).toBe('supports');
      expect(validateEdgeType('refutes')).toBe('refutes');
      expect(validateEdgeType('clarifies')).toBe('clarifies');
      expect(validateEdgeType('evidence')).toBe('evidence');
    });

    it('rejects invalid edge type strings', () => {
      expect(() => validateEdgeType('malicious_edge')).toThrow(ValidationError);
    });
  });

  describe('validateVoteType()', () => {
    it('accepts valid vote types', () => {
      expect(validateVoteType('support')).toBe('support');
      expect(validateVoteType('contest')).toBe('contest');
    });

    it('rejects unapproved vote values', () => {
      expect(() => validateVoteType('upvote')).toThrow(ValidationError);
    });
  });

  describe('validateIdentifier()', () => {
    it('accepts valid UUID and alphanumeric identifiers', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(validateIdentifier(uuid, 'topicId')).toBe(uuid);
      expect(validateIdentifier('topic_123-abc', 'nodeId')).toBe('topic_123-abc');
    });

    it('rejects path traversal or SQL injection patterns', () => {
      expect(() => validateIdentifier('../admin/passwords', 'id')).toThrow(ValidationError);
      expect(() => validateIdentifier("1; DROP TABLE users;--", 'id')).toThrow(ValidationError);
    });
  });
});
