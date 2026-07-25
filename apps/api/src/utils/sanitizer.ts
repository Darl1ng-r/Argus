import DOMPurify from 'isomorphic-dompurify';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Sanitizes and validates claim node content.
 * - Enforces string type
 * - Strips ALL HTML tags and dangerous attributes
 * - Normalizes Unicode (NFC) to prevent homograph attacks
 * - Enforces 1 <= length <= 1000
 */
export function sanitizeClaimContent(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ValidationError('Claim content must be a text string.');
  }

  const trimmed = raw.trim();

  // Strip all HTML tags
  const sanitized = DOMPurify.sanitize(trimmed, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });

  const normalized = sanitized.normalize('NFC');

  if (normalized.length < 1) {
    throw new ValidationError('Claim content cannot be empty.');
  }

  if (normalized.length > 1000) {
    throw new ValidationError(
      `Claim content exceeds the maximum limit of 1000 characters (received ${normalized.length} characters).`
    );
  }

  return normalized;
}

/**
 * Sanitizes and validates debate topic title.
 * - Enforces 3 <= length <= 500
 */
export function sanitizeTopicTitle(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ValidationError('Topic title must be a text string.');
  }

  const trimmed = raw.trim();
  const sanitized = DOMPurify.sanitize(trimmed, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
  const normalized = sanitized.normalize('NFC');

  if (normalized.length < 3) {
    throw new ValidationError('Topic title must be at least 3 characters long.');
  }

  if (normalized.length > 500) {
    throw new ValidationError(
      `Topic title exceeds maximum limit of 500 characters (received ${normalized.length} characters).`
    );
  }

  return normalized;
}

/**
 * Validates logical relationship edge type strictly against allowed enum.
 */
export function validateEdgeType(raw: unknown): 'supports' | 'refutes' | 'clarifies' | 'evidence' {
  const allowed = ['supports', 'refutes', 'clarifies', 'evidence'] as const;

  if (typeof raw !== 'string' || !allowed.includes(raw as any)) {
    throw new ValidationError(
      `Invalid edgeType '${String(raw)}'. Allowed values are: ${allowed.join(', ')}.`
    );
  }

  return raw as 'supports' | 'refutes' | 'clarifies' | 'evidence';
}

/**
 * Validates vote type strictly against allowed enum.
 */
export function validateVoteType(raw: unknown): 'support' | 'contest' {
  const allowed = ['support', 'contest'] as const;

  if (typeof raw !== 'string' || !allowed.includes(raw as any)) {
    throw new ValidationError(
      `Invalid voteType '${String(raw)}'. Allowed values are: ${allowed.join(', ')}.`
    );
  }

  return raw as 'support' | 'contest';
}

/**
 * Validates UUID / ID parameter string.
 */
export function validateIdentifier(raw: unknown, paramName: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationError(`Invalid ${paramName}: must be a non-empty string identifier.`);
  }

  const cleaned = raw.trim();
  // Prevent path traversal or command injection in ID parameters
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
    throw new ValidationError(`Invalid ${paramName} format.`);
  }

  return cleaned;
}
