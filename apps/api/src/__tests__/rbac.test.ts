import { describe, it, expect } from 'vitest';
import { hasRequiredRole, TopicRole } from '../services/graphService.js';

describe('RBAC Role Hierarchy Validation', () => {
  it('allows owner to perform owner, contributor, and viewer actions', () => {
    const userRole: TopicRole = 'owner';
    expect(hasRequiredRole(userRole, 'owner')).toBe(true);
    expect(hasRequiredRole(userRole, 'contributor')).toBe(true);
    expect(hasRequiredRole(userRole, 'viewer')).toBe(true);
  });

  it('allows contributor to perform contributor and viewer actions, but blocks owner actions', () => {
    const userRole: TopicRole = 'contributor';
    expect(hasRequiredRole(userRole, 'owner')).toBe(false);
    expect(hasRequiredRole(userRole, 'contributor')).toBe(true);
    expect(hasRequiredRole(userRole, 'viewer')).toBe(true);
  });

  it('allows viewer to perform viewer actions only', () => {
    const userRole: TopicRole = 'viewer';
    expect(hasRequiredRole(userRole, 'owner')).toBe(false);
    expect(hasRequiredRole(userRole, 'contributor')).toBe(false);
    expect(hasRequiredRole(userRole, 'viewer')).toBe(true);
  });

  it('denies access when user role is null (unauthenticated)', () => {
    expect(hasRequiredRole(null, 'viewer')).toBe(false);
    expect(hasRequiredRole(null, 'contributor')).toBe(false);
    expect(hasRequiredRole(null, 'owner')).toBe(false);
  });
});
