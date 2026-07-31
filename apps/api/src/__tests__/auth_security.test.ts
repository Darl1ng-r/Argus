import { describe, it, expect } from 'vitest';
import { getOrCreateUser } from '../services/graphService.js';
import { ValidationError } from '../utils/sanitizer.js';

describe('Security Verification: Auth Privilege Escalation Prevention', () => {
  it('throws ValidationError when getOrCreateUser receives undefined', async () => {
    await expect(getOrCreateUser(undefined)).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when getOrCreateUser receives empty string', async () => {
    await expect(getOrCreateUser('')).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when getOrCreateUser receives whitespace only string', async () => {
    await expect(getOrCreateUser('   ')).rejects.toThrow(ValidationError);
  });
});
