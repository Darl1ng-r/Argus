import 'dotenv/config';
import { db } from '../db.js';
import fs from 'fs';
import path from 'path';

async function applyPerfIndexes() {
  console.log('🚀 Applying High-Performance Database Indexes...');
  const sqlPath = path.resolve(process.cwd(), '../../sql/perf_indexes.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  await db.query(sql);
  console.log('✓ Index `idx_votes_covering` created (node_id, vote_type, user_id).');
  console.log('✓ Index `idx_nodes_topic_steel` created (topic_id, is_steel, support_score DESC).');
  console.log('✓ Index `idx_topics_feed_perf` created (is_private, created_at DESC, id).');
  console.log('🎉 All performance indexes active in PostgreSQL!\n');
}

applyPerfIndexes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Failed to apply indexes:', err);
    process.exit(1);
  });
