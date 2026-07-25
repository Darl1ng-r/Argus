import 'dotenv/config';
import { Pool } from 'pg';

// Fix #4 — Properly configured connection pool with timeouts and connection limits
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30_000,          // Close idle clients after 30s
  connectionTimeoutMillis: 5_000,     // Fail fast if no connection available within 5s
  statement_timeout: 15_000,          // Kill any query taking more than 15s
  query_timeout: 15_000,              // Redundant safety net
  application_name: 'argus-api',
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected idle client error', err);
});

pool.on('connect', () => {
  // Optional: log pool connects in debug mode
});

export const db = pool;

export async function testConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('[DB] Connected to PostgreSQL ✓');
  } finally {
    client.release();
  }
}
