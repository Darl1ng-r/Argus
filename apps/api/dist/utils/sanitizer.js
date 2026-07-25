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
 */
function validateIdentifier(raw, paramName) {
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
