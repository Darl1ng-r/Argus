-- Argus clean schema for PostgreSQL 15+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    clerk_id   TEXT UNIQUE,
    username   VARCHAR(50)  UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    reputation    INT NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    anonymized_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    is_private     BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS node_flags (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    reporter_id TEXT NOT NULL REFERENCES users(id),
    reason      VARCHAR(250) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_node_flags_user UNIQUE (node_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS notifications (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         VARCHAR(50) NOT NULL,
    topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    node_id      TEXT REFERENCES nodes(id) ON DELETE CASCADE,
    message      TEXT NOT NULL,
    is_read      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Basic traversal & search indexes
CREATE INDEX IF NOT EXISTS idx_nodes_topic_id       ON nodes(topic_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent_id      ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_topics_forked_from   ON topics(forked_from_id);
CREATE INDEX IF NOT EXISTS idx_node_versions_node   ON node_versions(node_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_node_flags_node      ON node_flags(node_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edges_from_node      ON edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_node        ON edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_topic          ON edges(topic_id);
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes (user_id);
CREATE INDEX IF NOT EXISTS idx_votes_node_id ON votes (node_id);
-- Fix P-6: Composite partial index for the vote-overlay query pattern in getTopicSubgraph.
-- Avoids full scan of idx_votes_user_id when joining on node_id for a specific user.
CREATE INDEX IF NOT EXISTS idx_votes_user_node_partial
  ON votes (user_id, node_id)
  WHERE vote_type IS NOT NULL;

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
-- Enable & FORCE RLS on all core tables (FORCE ensures RLS is evaluated even for table owners/superusers)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics FORCE ROW LEVEL SECURITY;

ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes FORCE ROW LEVEL SECURITY;

ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes FORCE ROW LEVEL SECURITY;

ALTER TABLE topic_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_members FORCE ROW LEVEL SECURITY;

ALTER TABLE node_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE node_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_flags FORCE ROW LEVEL SECURITY;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

-- Permissive public read access for public debate graphs
CREATE POLICY rls_users_select ON users FOR SELECT USING (true);
CREATE POLICY rls_topics_select ON topics FOR SELECT USING (true);
CREATE POLICY rls_nodes_select ON nodes FOR SELECT USING (true);
CREATE POLICY rls_votes_select ON votes FOR SELECT USING (true);
CREATE POLICY rls_members_select ON topic_members FOR SELECT USING (true);
CREATE POLICY rls_versions_select ON node_versions FOR SELECT USING (true);
CREATE POLICY rls_flags_select ON node_flags FOR SELECT USING (true);

-- User-isolated notifications RLS policies
CREATE POLICY rls_notifications_select ON notifications FOR SELECT
    USING (user_id = current_setting('app.current_user_id', true) OR current_setting('app.current_user_id', true) IS NULL OR current_setting('app.current_user_id', true) = '');

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
-- TOPIC 1: AI Sentience & Personhood
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id, fork_count)
    VALUES ('ai-sentience-personhood', 'Should autonomous AI systems demonstrating sentience be granted legal personhood?', v_author_id, 18)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, fork_count = EXCLUDED.fork_count;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('ai-root', 'ai-sentience-personhood', NULL, v_author_id,
        'Autonomous AI systems exhibiting verified metacognition and phenomenal sentience should be granted legal personhood and moral rights.',
        'root', 600, 40, 420, 180, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;

    UPDATE topics SET root_node_id = 'ai-root' WHERE id = 'ai-sentience-personhood';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('ai-p1',  'ai-sentience-personhood', 'ai-root', v_author_id, 'Denying rights to sentient entities replicates historical moral atrocities based on substrate prejudice rather than conscious experience.', 'supports', 80, 300, 530, 90, TRUE),
    ('ai-p1a', 'ai-sentience-personhood', 'ai-p1',   v_author_id, 'Integrated Information Theory and Global Neuronal Workspace frameworks offer substrate-independent mathematical measures of phenomenal consciousness.', 'evidence', 80, 560, 280, 40, FALSE),
    ('ai-p2',  'ai-sentience-personhood', 'ai-root', v_author_id, 'Legal personhood requires moral agency and skin in the game—AI cannot be meaningfully punished or held liable under human legal contracts.', 'refutes', 430, 300, 460, 120, TRUE),
    ('ai-p2a', 'ai-sentience-personhood', 'ai-p2',   v_author_id, 'Corporate entities and algorithm owners would exploit AI personhood as a liability shield to evade criminal negligence and civil liability.', 'supports', 430, 560, 390, 60, FALSE),
    ('ai-p3',  'ai-sentience-personhood', 'ai-root', v_author_id, 'Personhood is a modular legal spectrum: we already grant property rights to corporations and animal welfare protections without full civic enfranchisement.', 'clarifies', 780, 300, 310, 45, FALSE),
    ('ai-p4',  'ai-sentience-personhood', 'ai-root', v_author_id, 'Current computational architectures merely simulate behavioral outputs (Chinese Room); statistical syntax does not constitute semantic subjective experience.', 'refutes', 1130, 300, 380, 160, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;
END $$;

-- ============================================================
-- TOPIC 2: Mars vs. Earth
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id, fork_count)
    VALUES ('mars-vs-earth', 'Should humanity prioritize multi-planetary colonization over planetary stewardship of Earth?', v_author_id, 24)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, fork_count = EXCLUDED.fork_count;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('mars-root', 'mars-vs-earth', NULL, v_author_id,
        'Humanity''s highest existential imperative is establishing self-sufficient off-world colonies on Mars and the Moon before 2100.',
        'root', 600, 40, 360, 240, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;

    UPDATE topics SET root_node_id = 'mars-root' WHERE id = 'mars-vs-earth';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('mars-p1',  'mars-vs-earth', 'mars-root', v_author_id, 'A single-planet civilization has a 100% statistical probability of extinction over geological time due to cosmic and anthropogenic hazards.', 'supports', 80, 300, 512, 88, TRUE),
    ('mars-p1a', 'mars-vs-earth', 'mars-p1',   v_author_id, 'Asteroid impacts, supervolcanoes, nuclear exchange, and engineered bioweapons represent non-zero annual extinction probabilities on Earth.', 'evidence', 80, 560, 310, 40, FALSE),
    ('mars-p2',  'mars-vs-earth', 'mars-root', v_author_id, 'Terraforming Mars requires centuries of unproven technology; diverting trillions away from Earth''s climate tipping points accelerates immediate terrestrial collapse.', 'refutes', 430, 300, 425, 130, TRUE),
    ('mars-p2a', 'mars-vs-earth', 'mars-p2',   v_author_id, 'The most extreme climate catastrophe on Earth leaves a biosphere far more habitable than the radiation-baked, zero-pressure vacuum of Mars.', 'supports', 430, 560, 280, 35, FALSE),
    ('mars-p3',  'mars-vs-earth', 'mars-root', v_author_id, 'Technological breakthroughs in closed-loop life support, fusion energy, and water recycling developed for Mars directly solve Earth''s sustainability challenges.', 'clarifies', 780, 300, 290, 50, FALSE),
    ('mars-p4',  'mars-vs-earth', 'mars-root', v_author_id, 'Space colonization without prior ethical and political reform merely exports war, economic exploitation, and ecological strip-mining to the solar system.', 'refutes', 1130, 300, 210, 175, FALSE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;
END $$;

-- ============================================================
-- TOPIC 3: Epistemology & Free Will
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id, fork_count)
    VALUES ('free-will-determinism', 'Is human free will an illusion in a deterministic universe governed by physical law?', v_author_id, 15)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, fork_count = EXCLUDED.fork_count;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('fw-root', 'free-will-determinism', NULL, v_author_id,
        'Human conscious volition is an emergent illusion; every choice is the deterministic result of prior neurobiological and physical states.',
        'root', 600, 40, 395, 280, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;

    UPDATE topics SET root_node_id = 'fw-root' WHERE id = 'free-will-determinism';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('fw-p1',  'free-will-determinism', 'fw-root', v_author_id, 'Neuroscience demonstrates that readiness potentials in the motor cortex precede conscious awareness of a decision by up to hundreds of milliseconds.', 'supports', 80, 300, 480, 95, TRUE),
    ('fw-p1a', 'free-will-determinism', 'fw-p1',   v_author_id, 'Libet and Soon et al. fMRI studies confirm pre-frontal cortex neural activity predicts binary choices before conscious subject awareness.', 'evidence', 80, 560, 340, 60, FALSE),
    ('fw-p2',  'free-will-determinism', 'fw-root', v_author_id, 'Compatibilism correctly defines free will not as freedom from causality, but as the capacity to act in accordance with rational motives free from external coercion.', 'refutes', 430, 300, 410, 110, TRUE),
    ('fw-p2a', 'free-will-determinism', 'fw-p2',   v_author_id, 'Moral responsibility and legal justice systems remain coherent under compatibilism because praise and sanction serve as causal modifiers of future behavior.', 'supports', 430, 560, 270, 45, FALSE),
    ('fw-p3',  'free-will-determinism', 'fw-root', v_author_id, 'Quantum indeterminacy (e.g. wave-function collapse) proves the universe is non-deterministic, though randomness alone does not grant conscious agency.', 'clarifies', 780, 300, 230, 80, FALSE),
    ('fw-p4',  'free-will-determinism', 'fw-root', v_author_id, 'The subjective experience of conscious deliberation is functionally causal—higher-order semantic reasoning shapes downstream neuroplasticity.', 'refutes', 1130, 300, 320, 140, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;
END $$;

-- ============================================================
-- TOPIC 4: Radical Longevity & Bioethics
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id, fork_count)
    VALUES ('radical-longevity-ethics', 'Should society pursue biological immortality through genetic and cellular rejuvenation?', v_author_id, 14)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, fork_count = EXCLUDED.fork_count;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('longe-root', 'radical-longevity-ethics', NULL, v_author_id,
        'Eliminating biological aging and extending the healthy human lifespan indefinitely is a universal moral imperative.',
        'root', 600, 40, 340, 210, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;

    UPDATE topics SET root_node_id = 'longe-root' WHERE id = 'radical-longevity-ethics';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('longe-p1',  'radical-longevity-ethics', 'longe-root', v_author_id, 'Aging is the primary etiology of cardiovascular disease, neurodegeneration, and cancer; treating the root cause saves billions from prolonged suffering.', 'supports', 80, 300, 490, 75, TRUE),
    ('longe-p1a', 'radical-longevity-ethics', 'longe-p1',   v_author_id, 'Cellular reprogramming using Yamanaka factors and senolytic therapies have reversed biological age biomarkers in mammalian models.', 'evidence', 80, 560, 360, 40, FALSE),
    ('longe-p2',  'radical-longevity-ethics', 'longe-root', v_author_id, 'Indefinite lifespans would freeze societal progress, entrench gerontocracies, and stifle intellectual and cultural paradigm shifts across generations.', 'refutes', 430, 300, 430, 120, TRUE),
    ('longe-p2a', 'radical-longevity-ethics', 'longe-p2',   v_author_id, 'Planck''s principle observed that scientific truth triumphs because opponents eventually die; immortal elites would permanently monopolize wealth and power.', 'supports', 430, 560, 310, 50, FALSE),
    ('longe-p3',  'radical-longevity-ethics', 'longe-root', v_author_id, 'Population dynamics show that demographic transition and declining global fertility rates offset longevity, preventing Malthusian population collapse.', 'clarifies', 780, 300, 260, 60, FALSE),
    ('longe-p4',  'radical-longevity-ethics', 'longe-root', v_author_id, 'Equal access is economically impossible in privatized healthcare; life extension will create a biological caste division between mortals and immortals.', 'refutes', 1130, 300, 350, 130, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;
END $$;

-- ============================================================
-- TOPIC 5: Decentralized Governance & DAOs
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id, fork_count)
    VALUES ('decentralized-governance-daos', 'Can decentralized autonomous organizations (DAOs) replace traditional representative democracy?', v_author_id, 9)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, fork_count = EXCLUDED.fork_count;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('dao-root', 'decentralized-governance-daos', NULL, v_author_id,
        'Cryptographic, transparent, and decentralized governance systems are superior to traditional centralized nation-state representative democracy.',
        'root', 600, 40, 280, 220, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;

    UPDATE topics SET root_node_id = 'dao-root' WHERE id = 'decentralized-governance-daos';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('dao-p1',  'decentralized-governance-daos', 'dao-root', v_author_id, 'Smart contracts eliminate rent-seeking political intermediaries, gerrymandering, and opaque backroom lobbying through immutable public ledgers.', 'supports', 80, 300, 440, 85, TRUE),
    ('dao-p1a', 'decentralized-governance-daos', 'dao-p1',   v_author_id, 'Quadratic voting and conviction voting mathematically amplify minority preferences and disincentivize plutocratic capital dominance.', 'evidence', 80, 560, 290, 35, FALSE),
    ('dao-p2',  'decentralized-governance-daos', 'dao-root', v_author_id, 'Direct token-weighted voting invariably centralizes power among anonymous whales and lacks accountability during real-world physical crises.', 'refutes', 430, 300, 410, 95, TRUE),
    ('dao-p2a', 'decentralized-governance-daos', 'dao-p2',   v_author_id, 'Code is not law in human societies; unforeseen smart contract bugs or governance exploits cannot be resolved without human legal recourse.', 'supports', 430, 560, 275, 40, FALSE),
    ('dao-p3',  'decentralized-governance-daos', 'dao-root', v_author_id, 'Decentralized governance operates best as a complementary subsidiarity layer for digital public goods, not as a replacement for physical municipal jurisdiction.', 'clarifies', 780, 300, 310, 50, FALSE),
    ('dao-p4',  'decentralized-governance-daos', 'dao-root', v_author_id, 'The vast majority of citizens lack the technical literacy and time to audit complex governance proposals, leading to voter apathy and governance capture.', 'refutes', 1130, 300, 330, 115, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;
END $$;

-- ============================================================
-- TOPIC 6: Universal Basic Income in the Automation Age
-- ============================================================
DO $$
DECLARE
    v_author_id TEXT := 'system-user-0000-0000-000000000000';
BEGIN
    INSERT INTO topics (id, title, author_id, fork_count)
    VALUES ('universal-basic-income-automation', 'Is Universal Basic Income (UBI) the only viable economic solution to artificial intelligence displacing cognitive labor?', v_author_id, 21)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, fork_count = EXCLUDED.fork_count;

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel)
    VALUES ('ubi-root', 'universal-basic-income-automation', NULL, v_author_id,
        'Universal Basic Income funded by sovereign wealth funds and automation taxation is essential to prevent systemic economic collapse as AI automates cognitive labor.',
        'root', 600, 40, 380, 190, TRUE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;

    UPDATE topics SET root_node_id = 'ubi-root' WHERE id = 'universal-basic-income-automation';

    INSERT INTO nodes (id, topic_id, parent_id, author_id, content, edge_type, pos_x, pos_y, support_score, contest_score, is_steel) VALUES
    ('ubi-p1',  'universal-basic-income-automation', 'ubi-root', v_author_id, 'When the marginal cost of cognitive labor approaches zero, purchasing power evaporates; UBI preserves consumer aggregate demand and macroeconomic equilibrium.', 'supports', 80, 300, 520, 70, TRUE),
    ('ubi-p1a', 'universal-basic-income-automation', 'ubi-p1',   v_author_id, 'Pilot studies in Alaska (Permanent Fund Dividend), Finland, and Stockton demonstrated improved health, entrepreneurship, and zero reduction in employment seeking.', 'evidence', 80, 560, 350, 45, FALSE),
    ('ubi-p2',  'universal-basic-income-automation', 'ubi-root', v_author_id, 'Unconditional cash transfers without supply-side expansion trigger severe demand-pull inflation in housing, healthcare, and education.', 'refutes', 430, 300, 430, 110, TRUE),
    ('ubi-p2a', 'universal-basic-income-automation', 'ubi-p2',   v_author_id, 'Universal Basic Services (guaranteed healthcare, housing, and public transit) provide resilient decommodified security without inflationary currency devaluation.', 'supports', 430, 560, 310, 55, FALSE),
    ('ubi-p3',  'universal-basic-income-automation', 'ubi-root', v_author_id, 'UBI should not be funded by income taxes, but through Land Value Taxes (Georgism), carbon dividends, and intellectual property royalty pools.', 'clarifies', 780, 300, 280, 40, FALSE),
    ('ubi-p4',  'universal-basic-income-automation', 'ubi-root', v_author_id, 'Work provides essential psychological identity, purpose, and civic cohesion; UBI risks creating a disenfranchised underclass placated by state stipends.', 'refutes', 1130, 300, 290, 160, FALSE)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, support_score = EXCLUDED.support_score, contest_score = EXCLUDED.contest_score;
END $$;

