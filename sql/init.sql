-- Argus clean schema for PostgreSQL 15+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    clerk_id   TEXT UNIQUE,
    username   VARCHAR(50)  UNIQUE NOT NULL,
    email      VARCHAR(255) UNIQUE NOT NULL,
    reputation INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users (id, username, email)
VALUES ('system-user-0000-0000-000000000000', 'system', 'system@argus.local')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS topics (
    id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title          VARCHAR(500) NOT NULL,
    root_node_id   TEXT,
    author_id      TEXT NOT NULL REFERENCES users(id),
    forked_from_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    fork_count     INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nodes (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    topic_id      TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    parent_id     TEXT REFERENCES nodes(id),
    author_id     TEXT NOT NULL REFERENCES users(id),
    content       TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
    edge_type     VARCHAR(30) NOT NULL DEFAULT 'root',
    pos_x         FLOAT NOT NULL DEFAULT 0,
    pos_y         FLOAT NOT NULL DEFAULT 0,
    support_score INT NOT NULL DEFAULT 0,
    contest_score INT NOT NULL DEFAULT 0,
    is_steel      BOOLEAN NOT NULL DEFAULT FALSE,
    status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    version       INT NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE topics
    DROP CONSTRAINT IF EXISTS fk_topics_root_node;
ALTER TABLE topics
    ADD CONSTRAINT fk_topics_root_node
    FOREIGN KEY (root_node_id) REFERENCES nodes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS edges (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    from_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    to_node_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type         VARCHAR(30) NOT NULL,
    author_id    TEXT NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_edges_unique UNIQUE (from_node_id, to_node_id, type),
    CONSTRAINT chk_no_self_loop CHECK (from_node_id != to_node_id)
);

CREATE TABLE IF NOT EXISTS votes (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id),
    vote_type  VARCHAR(20) NOT NULL CHECK (vote_type IN ('SUPPORT', 'CONTEST')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_votes_user_node UNIQUE (node_id, user_id)
);

CREATE TABLE IF NOT EXISTS topic_members (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    topic_id   TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'contributor', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_topic_members UNIQUE (topic_id, user_id)
);

CREATE TABLE IF NOT EXISTS node_versions (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    version    INT NOT NULL,
    edited_by  TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_node_versions_ver UNIQUE (node_id, version)
);

-- Basic traversal & search indexes
CREATE INDEX IF NOT EXISTS idx_nodes_topic_id       ON nodes(topic_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent_id      ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_topics_forked_from   ON topics(forked_from_id);
CREATE INDEX IF NOT EXISTS idx_node_versions_node   ON node_versions(node_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_edges_from_node      ON edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_node        ON edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_topic          ON edges(topic_id);
CREATE INDEX IF NOT EXISTS idx_votes_node_id        ON votes(node_id);

-- Full-text search indexes (GIN on tsvector)
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX IF NOT EXISTS idx_nodes_content_tsv ON nodes USING gin(content_tsv);

ALTER TABLE topics ADD COLUMN IF NOT EXISTS title_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title)) STORED;
CREATE INDEX IF NOT EXISTS idx_topics_title_tsv ON topics USING gin(title_tsv);

-- Fix #14 — Composite & partial indexes for production query patterns

-- Subgraph recursive CTE: filters by topic_id + status on every level
CREATE INDEX IF NOT EXISTS idx_nodes_topic_status
    ON nodes(topic_id, status);

-- Subgraph traversal: join on parent_id scoped to topic
CREATE INDEX IF NOT EXISTS idx_nodes_topic_parent
    ON nodes(topic_id, parent_id);

-- Partial index: ACTIVE nodes only (eliminates status filter overhead)
CREATE INDEX IF NOT EXISTS idx_nodes_active
    ON nodes(topic_id, parent_id)
    WHERE status = 'ACTIVE';

-- getAllTopics sort (created_at DESC is used on every topic list query)
CREATE INDEX IF NOT EXISTS idx_topics_created_at
    ON topics(created_at DESC);

-- Vote lookup scoped to node+user (supports toggle-vote & unique constraint)
CREATE INDEX IF NOT EXISTS idx_votes_node_user
    ON votes(node_id, user_id);

-- Vote lookup scoped to user (for topiced vote map query)
CREATE INDEX IF NOT EXISTS idx_votes_user_id
    ON votes(user_id);

-- Clerk auth lookup
CREATE INDEX IF NOT EXISTS idx_users_clerk_id
    ON users(clerk_id)
    WHERE clerk_id IS NOT NULL;

-- Topic member role lookup
CREATE INDEX IF NOT EXISTS idx_topic_members_lookup
    ON topic_members(topic_id, user_id, role);

-- ============================================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================
-- Enable RLS on core tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_members ENABLE ROW LEVEL SECURITY;

-- Permissive public read access for public debate graphs
CREATE POLICY rls_users_select ON users FOR SELECT USING (true);
CREATE POLICY rls_topics_select ON topics FOR SELECT USING (true);
CREATE POLICY rls_nodes_select ON nodes FOR SELECT USING (true);
CREATE POLICY rls_votes_select ON votes FOR SELECT USING (true);
CREATE POLICY rls_members_select ON topic_members FOR SELECT USING (true);

-- Restrict topic updates to topic members holding 'owner' role
CREATE POLICY rls_topics_update ON topics FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM topic_members m
            WHERE m.topic_id = topics.id
              AND m.role = 'owner'
        )
    );

-- ============================================================
-- TOPIC 1: Mars vs. Earth
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id)
    VALUES ('mars-vs-earth', 'Should humanity prioritize colonizing Mars over repairing Earth''s climate?', v_author_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('node-root', 'mars-vs-earth', NULL, v_author_id,
        'Humanity should prioritize colonizing Mars over repairing Earth''s climate.',
        'root', 470, 40, 340, 210, TRUE)
    ON CONFLICT DO NOTHING;

    UPDATE topics SET root_node_id = 'node-root' WHERE id = 'mars-vs-earth';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('node-n1',  'mars-vs-earth', 'node-root', v_author_id, 'A multi-planet species is far less likely to go extinct from any single catastrophe.', 'supports',  30, 300, 512, 88, TRUE),
    ('node-n2',  'mars-vs-earth', 'node-root', v_author_id, 'Every dollar spent on Mars is a dollar not spent solving a crisis we already know is solvable.', 'refutes',   350, 300, 405, 140, TRUE),
    ('node-n3',  'mars-vs-earth', 'node-root', v_author_id, 'This isn''t really either/or — space agencies are under 0.1% of relevant national budgets combined.', 'clarifies', 680, 300, 180, 30, TRUE),
    ('node-n4',  'mars-vs-earth', 'node-root', v_author_id, 'Fixing Earth doesn''t guard against non-climate extinction risks like asteroids or supervolcanoes.', 'refutes',   1010, 300, 260, 190, FALSE),
    ('node-n1a', 'mars-vs-earth', 'node-n1', v_author_id, 'Mars colonies won''t be self-sufficient for at least 50 years — this is a bet on unproven timelines.', 'evidence',  30, 560, 60, 240, FALSE),
    ('node-n2a', 'mars-vs-earth', 'node-n2', v_author_id, 'Climate mitigation technology is proven and scaling. Mars life-support technology is not.', 'supports',  350, 560, 220, 40, TRUE)
    ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- TOPIC 2: ASI Safety Pause
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id)
    VALUES ('asi-safety-pause', 'Artificial Superintelligence development should be paused globally until formal safety proofs exist.', v_author_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('asi-root', 'asi-safety-pause', NULL, v_author_id,
        'Artificial Superintelligence development should be paused globally until formal safety proofs exist.',
        'root', 470, 40, 280, 95, TRUE)
    ON CONFLICT DO NOTHING;

    UPDATE topics SET root_node_id = 'asi-root' WHERE id = 'asi-safety-pause';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('asi-n1', 'asi-safety-pause', 'asi-root', v_author_id, 'Once an AI system surpasses human capability across all cognitive domains, containment becomes impossible.', 'supports', 30, 300, 420, 50, TRUE),
    ('asi-n2', 'asi-safety-pause', 'asi-root', v_author_id, 'A global pause is unenforceable without totalitarian surveillance, driving development into covert military labs.', 'refutes', 380, 300, 310, 80, TRUE),
    ('asi-n3', 'asi-safety-pause', 'asi-root', v_author_id, 'Safety research scales directly with frontier model capability — you cannot test safety without advanced models.', 'clarifies', 730, 300, 195, 40, TRUE)
    ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- TOPIC 3: Universal Basic Income
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id)
    VALUES ('ubi-vs-welfare', 'Universal Basic Income is superior to traditional targeted welfare systems.', v_author_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('ubi-root', 'ubi-vs-welfare', NULL, v_author_id,
        'Universal Basic Income is superior to traditional targeted welfare systems.',
        'root', 470, 40, 190, 110, TRUE)
    ON CONFLICT DO NOTHING;

    UPDATE topics SET root_node_id = 'ubi-root' WHERE id = 'ubi-vs-welfare';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('ubi-n1', 'ubi-vs-welfare', 'ubi-root', v_author_id, 'UBI eliminates administrative overhead, welfare traps, and paternalistic means-testing bureaucracy.', 'supports', 30, 300, 340, 65, TRUE),
    ('ubi-n2', 'ubi-vs-welfare', 'ubi-root', v_author_id, 'Giving unconditional cash to wealthy individuals diverts trillions from those living in deep poverty.', 'refutes', 380, 300, 270, 90, TRUE)
    ON CONFLICT DO NOTHING;
END $$;
