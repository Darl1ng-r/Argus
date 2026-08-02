"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = void 0;
exports.sanitizeClaimContent = sanitizeClaimContent;
exports.sanitizeTopicTitle = sanitizeTopicTitle;
exports.validateEdgeType = validateEdgeType;
exports.validateVoteType = validateVoteType;
exports.validateIdentifier = validateIdentifier;
exports.sanitizeFlagReason = sanitizeFlagReason;
exports.validatePasswordStrength = validatePasswordStrength;
const isomorphic_dompurify_1 = __importDefault(require("isomorphic-dompurify"));
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
/**
 * Sanitizes and validates claim node content.
 * - Enforces string type
 * - Strips ALL HTML tags and dangerous attributes
 * - Normalizes Unicode (NFC) to prevent homograph attacks
 * - Enforces 1 <= length <= 1000
 */
function sanitizeClaimContent(raw) {
    if (typeof raw !== 'string') {
        throw new ValidationError('Claim content must be a text string.');
    }
    const trimmed = raw.trim();
    // Strip all HTML tags
    const sanitized = isomorphic_dompurify_1.default.sanitize(trimmed, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
    });
    const normalized = sanitized.normalize('NFC');
    if (normalized.length < 1) {
        throw new ValidationError('Claim content cannot be empty.');
    }
    if (normalized.length > 1000) {
        throw new ValidationError(`Claim content exceeds the maximum limit of 1000 characters (received ${normalized.length} characters).`);
    }
    return normalized;
}
/**
 * Sanitizes and validates debate topic title.
 * - Enforces 3 <= length <= 500
 */
function sanitizeTopicTitle(raw) {
    if (typeof raw !== 'string') {
        throw new ValidationError('Topic title must be a text string.');
    }
    const trimmed = raw.trim();
    const sanitized = isomorphic_dompurify_1.default.sanitize(trimmed, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
    });
    const normalized = sanitized.normalize('NFC');
    if (normalized.length < 3) {
        throw new ValidationError('Topic title must be at least 3 characters long.');
    }
    if (normalized.length > 500) {
        throw new ValidationError(`Topic title exceeds maximum limit of 500 characters (received ${normalized.length} characters).`);
    }
    return normalized;
}
/**
 * Validates logical relationship edge type strictly against allowed enum.
 */
function validateEdgeType(raw) {
    const allowed = ['supports', 'refutes', 'clarifies', 'evidence'];
    if (typeof raw !== 'string' || !allowed.includes(raw)) {
        throw new ValidationError(`Invalid edgeType '${String(raw)}'. Allowed values are: ${allowed.join(', ')}.`);
    }
    return raw;
}
/**
 * Validates vote type strictly against allowed enum.
 */
function validateVoteType(raw) {
    const allowed = ['support', 'contest'];
    if (typeof raw !== 'string' || !allowed.includes(raw)) {
        throw new ValidationError(`Invalid voteType '${String(raw)}'. Allowed values are: ${allowed.join(', ')}.`);
    }
    return raw;
}
/**
 * Validates UUID / ID parameter string.
 * Fix S-6: Added MAX_IDENTIFIER_LEN cap (128 chars) to prevent DoS via oversized ID strings.
 */
const MAX_IDENTIFIER_LEN = 128;
function validateIdentifier(raw, paramName) {
    if (typeof raw !== 'string' || !raw.trim()) {
        throw new ValidationError(`Invalid ${paramName}: must be a non-empty string identifier.`);
    }
    const cleaned = raw.trim();
    if (cleaned.length > MAX_IDENTIFIER_LEN) {
        throw new ValidationError(`Invalid ${paramName}: identifier must not exceed ${MAX_IDENTIFIER_LEN} characters.`);
    }
    // Prevent path traversal or command injection in ID parameters
    if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
        throw new ValidationError(`Invalid ${paramName} format.`);
    }
    return cleaned;
}
/**
 * Sanitizes and validates a moderation flag reason.
 * Fix D-2: Enforces type checking, HTML strip, and length constraints on flag reasons.
 */
function sanitizeFlagReason(raw) {
    if (typeof raw !== 'string') {
        // Coerce non-string to default reason rather than throw, preserving UX
        return 'Inappropriate content';
    }
    const trimmed = raw.trim();
    if (!trimmed)
        return 'Inappropriate content';
    const sanitized = isomorphic_dompurify_1.default.sanitize(trimmed, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
    });
    if (sanitized.length > 250) {
        throw new ValidationError(`Flag reason exceeds maximum limit of 250 characters (received ${sanitized.length} characters).`);
    }
    return sanitized || 'Inappropriate content';
}
/**
 * Validates password strength according to production security policies:
 * - Minimum 12 characters
 * - Requires uppercase letter
 * - Requires lowercase letter
 * - Requires number
 * - Requires special character
 */
function validatePasswordStrength(raw) {
    if (typeof raw !== 'string' || !raw) {
        throw new ValidationError('Password is required.');
    }
    if (raw.length < 12) {
        throw new ValidationError('Password must be at least 12 characters long.');
    }
    if (!/[A-Z]/.test(raw)) {
        throw new ValidationError('Password must contain at least one uppercase letter (A-Z).');
    }
    if (!/[a-z]/.test(raw)) {
        throw new ValidationError('Password must contain at least one lowercase letter (a-z).');
    }
    if (!/[0-9]/.test(raw)) {
        throw new ValidationError('Password must contain at least one number (0-9).');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(raw)) {
        throw new ValidationError('Password must contain at least one special character (!@#$%^&*...).');
    }
    return raw;
}
