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

/**
 * Sets active user session context for PostgreSQL Row-Level Security (RLS) evaluation.
 * NOTE: Must be called on a dedicated PoolClient (not a shared pool query) because
 * SET LOCAL is scoped to the current transaction/session.
 */
export async function setSessionUser(client: any, userId: string): Promise<void> {
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
export async function withUserSession<T>(
  userId: string,
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    // Use a transaction so SET LOCAL is scoped correctly and released on COMMIT/ROLLBACK
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_user_id = $1', [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function testConnection(maxRetries = process.env.NODE_ENV === 'development' ? 1 : 5, initialDelayMs = 500): Promise<void> {
  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        process.stdout.write('[DB] Connected to PostgreSQL ✓\n');
        return;
      } finally {
        client.release();
      }
    } catch (err) {
      if (attempt === maxRetries) {
        process.stderr.write(`[DB] Connection failed after ${maxRetries} attempts: ${err instanceof Error ? err.message : String(err)}\n`);
        if (process.env.NODE_ENV !== 'development') {
          throw err;
        }
        process.stderr.write('[DB] Running in development mode without active database — mock mode enabled.\n');
        return;
      }
      process.stdout.write(`[DB] Connection attempt ${attempt}/${maxRetries} failed. Retrying in ${delay}ms...\n`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}
