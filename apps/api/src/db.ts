import 'dotenv/config';
import { Pool } from 'pg';

// Database SSL/TLS Encryption in Transit configuration
const useSSL =
  process.env.DB_SSL === 'true' ||
  (process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30_000,          // Close idle clients after 30s
  connectionTimeoutMillis: 5_000,     // Fail fast if no connection available within 5s
  statement_timeout: 15_000,          // Kill any query taking more than 15s
  query_timeout: 15_000,              // Redundant safety net
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

export const db = pool;

export async function testConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    process.stdout.write('[DB] Connected to PostgreSQL ✓\n');
  } finally {
    client.release();
  }
}
