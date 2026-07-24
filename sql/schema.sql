-- Argus Database Schema (PostgreSQL 15+)

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    reputation INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    root_node_id UUID,
    author_id UUID NOT NULL REFERENCES users(id),
    fork_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE IF NOT EXISTS edge_type AS ENUM ('SUPPORTS', 'REFUTES', 'CLARIFIES', 'REQUIRES_EVIDENCE', 'EQUIVALENT_TO');

CREATE TABLE IF NOT EXISTS nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
    support_score INT NOT NULL DEFAULT 0,
    contest_score INT NOT NULL DEFAULT 0,
    is_steel BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE topics DROP CONSTRAINT IF EXISTS fk_topics_root_node;
ALTER TABLE topics ADD CONSTRAINT fk_topics_root_node FOREIGN KEY (root_node_id) REFERENCES nodes(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    from_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    to_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_edges_unique UNIQUE (from_node_id, to_node_id, type),
    CONSTRAINT chk_no_self_loop CHECK (from_node_id != to_node_id)
);

CREATE TABLE IF NOT EXISTS votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    vote_type VARCHAR(20) NOT NULL CHECK (vote_type IN ('SUPPORT', 'CONTEST')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_votes_user_node UNIQUE (node_id, user_id)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_nodes_topic_id ON nodes(topic_id);
CREATE INDEX IF NOT EXISTS idx_edges_from_node ON edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_node ON edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_votes_node_id ON votes(node_id);
