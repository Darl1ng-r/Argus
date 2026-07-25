"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.testConnection = testConnection;
require("dotenv/config");
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
});
pool.on('error', (err) => {
    console.error('[DB] Unexpected client error', err);
});
exports.db = pool;
async function testConnection() {
    const client = await pool.connect();
    try {
        await client.query('SELECT 1');
        console.log('[DB] Connected to PostgreSQL');
    }
    finally {
        client.release();
    }
}
