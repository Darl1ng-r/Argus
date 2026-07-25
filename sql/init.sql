-- Argus clean schema for PostgreSQL 15+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    username   VARCHAR(50)  UNIQUE NOT NULL,
    email      VARCHAR(255) UNIQUE NOT NULL,
    reputation INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users (id, username, email)
VALUES ('system-user-0000-0000-000000000000', 'system', 'system@argus.local')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS topics (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title        VARCHAR(500) NOT NULL,
    root_node_id TEXT,
    author_id    TEXT NOT NULL REFERENCES users(id),
    fork_count   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

CREATE INDEX IF NOT EXISTS idx_nodes_topic_id  ON nodes(topic_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_edges_from_node ON edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_node   ON edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_topic     ON edges(topic_id);
CREATE INDEX IF NOT EXISTS idx_votes_node_id   ON votes(node_id);

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
