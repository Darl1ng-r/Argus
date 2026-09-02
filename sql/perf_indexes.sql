-- ============================================================
-- Argus High-Performance Index Optimizations
-- ============================================================

-- 1. Covering index for atomic vote calculations (Index-Only Scan)
CREATE INDEX IF NOT EXISTS idx_votes_covering
    ON votes(node_id, vote_type, user_id);

-- 2. Partial index for fast Steelman dialectic path extraction
CREATE INDEX IF NOT EXISTS idx_nodes_topic_steel
    ON nodes(topic_id, is_steel, support_score DESC)
    WHERE status = 'ACTIVE';

-- 3. Composite index for explore feed pagination with privacy filter
CREATE INDEX IF NOT EXISTS idx_topics_feed_perf
    ON topics(is_private, created_at DESC, id);
