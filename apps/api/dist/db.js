"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.setSessionUser = setSessionUser;
exports.withUserSession = withUserSession;
exports.testConnection = testConnection;
require("dotenv/config");
const pg_1 = require("pg");
// Database SSL/TLS Encryption in Transit configuration
const useSSL = process.env.DB_SSL === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false');
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30_000, // Close idle clients after 30s
    connectionTimeoutMillis: 5_000, // Fail fast if no connection available within 5s
    statement_timeout: 15_000, // Kill any query taking more than 15s
    query_timeout: 15_000, // Redundant safety net
    application_name: 'argus-api',
    ssl: useSSL
        ? {
            rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
        }
        : false,
});
pool.on('error', (err) => {
    // Import logger lazily to avoid circular dep — db.ts is imported by server.ts before logger is assigned
    process.stderr.write(`[DB] Unexpected idle client error: ${err.message}\n`);
});
pool.on('connect', () => {
    // Optional: log pool connects in debug mode
});
exports.db = pool;
/**
 * Sets active user session context for PostgreSQL Row-Level Security (RLS) evaluation.
 * NOTE: Must be called on a dedicated PoolClient (not a shared pool query) because
 * SET LOCAL is scoped to the current transaction/session.
 */
async function setSessionUser(client, userId) {
    if (userId) {
        await client.query(`SET LOCAL app.current_user_id = $1`, [userId]);
    }
}
/**
 * Fix 2 — RLS enforcement helper.
 *
 * Acquires a dedicated client, sets `app.current_user_id` in a transaction so
 * PostgreSQL RLS policies can evaluate `current_setting('app.current_user_id')`
 * correctly, runs the callback, then releases the client.
 *
 * Use this wherever a route or service performs queries against tables that have
 * Row-Level Security policies gated on the calling user's identity.
 *
 * @example
 *   const result = await withUserSession(userId, async (client) => {
 *     return client.query('SELECT * FROM notifications WHERE user_id = $1', [userId]);
 *   });
 */
async function withUserSession(userId, fn) {
    const client = await pool.connect();
    try {
        // Use a transaction so SET LOCAL is scoped correctly and released on COMMIT/ROLLBACK
        await client.query('BEGIN');
        await client.query('SET LOCAL app.current_user_id = $1', [userId]);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
async function testConnection(maxRetries = 5, initialDelayMs = 1000) {
    let delay = initialDelayMs;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const client = await pool.connect();
            try {
                await client.query('SELECT 1');
                process.stdout.write('[DB] Connected to PostgreSQL ✓\n');
                return;
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            if (attempt === maxRetries) {
                process.stderr.write(`[DB] Connection failed after ${maxRetries} attempts: ${err instanceof Error ? err.message : String(err)}\n`);
                throw err;
            }
            process.stdout.write(`[DB] Connection attempt ${attempt}/${maxRetries} failed. Retrying in ${delay}ms...\n`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
}
