"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
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
    console.error('[DB] Unexpected idle client error', err);
});
pool.on('connect', () => {
    // Optional: log pool connects in debug mode
});
exports.db = pool;
async function testConnection() {
    const client = await pool.connect();
    try {
        await client.query('SELECT 1');
        console.log('[DB] Connected to PostgreSQL ✓');
    }
    finally {
        client.release();
    }
}
