# Argus — Database Plan

> PostgreSQL 15 as the primary store. Graph-shaped data modeled relationally using nodes/edges tables with **recursive CTEs** for traversal. Redis for caching hot topic graphs.

---

## 1. Design Philosophy

From `Argus.md`:
> *"Graph-shaped data, so don't fight it with a relational DB for the core structure. Practical MVP move: start with Postgres alone (nodes/edges as tables, recursive CTEs for traversal) — it's 'good enough' until you have real scale."*

We use **PostgreSQL + recursive CTEs** for v1. Migration path to Neo4j is an option if traversal queries become the bottleneck (monitor via `pg_stat_statements`).

---

## 2. Core Schema

```sql
-- =============================================
-- USERS
-- =============================================
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id    VARCHAR(255) UNIQUE NOT NULL,   -- Clerk's user ID (sub claim in JWT)
    username    VARCHAR(50)  UNIQUE NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    reputation  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- TOPICS
-- =============================================
CREATE TABLE topics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(500) NOT NULL,
    root_node_id    UUID,                      -- FK set after root node is created
    author_id       UUID NOT NULL REFERENCES users(id),
    forked_from_id  UUID REFERENCES topics(id),  -- NULL for original topics
    fork_count      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- NODES (claims)
-- =============================================
CREATE TABLE nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id        UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL
                    CHECK (char_length(content) BETWEEN 1 AND 1000),  -- enforce atomicity
    support_score   INT NOT NULL DEFAULT 0,
    contest_score   INT NOT NULL DEFAULT 0,
    is_steel        BOOLEAN NOT NULL DEFAULT FALSE,  -- cached computed value
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','FLAGGED','REMOVED')),
    version         INT NOT NULL DEFAULT 1,          -- for immutable edit tracking
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from topics → nodes after nodes table exists
ALTER TABLE topics
    ADD CONSTRAINT fk_topics_root_node
    FOREIGN KEY (root_node_id) REFERENCES nodes(id);

-- =============================================
-- NODE VERSIONS (immutable edit history)
-- =============================================
CREATE TABLE node_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id     UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    version     INT  NOT NULL,
    content     TEXT NOT NULL,
    edited_by   UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (node_id, version)
);

-- =============================================
-- EDGES (relationships between claims)
-- =============================================
CREATE TYPE edge_type AS ENUM (
    'SUPPORTS',
    'REFUTES',
    'CLARIFIES',
    'REQUIRES_EVIDENCE',
    'EQUIVALENT_TO'
);

CREATE TABLE edges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id        UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    from_node_id    UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    to_node_id      UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type            edge_type NOT NULL,
    author_id       UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate directed edges of the same type between same nodes
    CONSTRAINT uq_edges_unique UNIQUE (from_node_id, to_node_id, type),

    -- Prevent self-loops at the DB level
    CONSTRAINT chk_no_self_loop CHECK (from_node_id != to_node_id)
);

-- =============================================
-- VOTES
-- =============================================
CREATE TYPE vote_type AS ENUM ('SUPPORT', 'CONTEST');

CREATE TABLE votes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id     UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    vote_type   vote_type NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One vote per user per node (can change their vote)
    CONSTRAINT uq_votes_user_node UNIQUE (node_id, user_id)
);

-- =============================================
-- RATE LIMIT TRACKING (creation rate limits)
-- =============================================
CREATE TABLE creation_rate_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    action      VARCHAR(20) NOT NULL,   -- 'ADD_NODE', 'ADD_EDGE', 'CREATE_TOPIC'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Performance Indexes

```sql
-- Hot path: fetch all nodes for a topic
CREATE INDEX idx_nodes_topic_id         ON nodes(topic_id);
CREATE INDEX idx_nodes_topic_status     ON nodes(topic_id, status) WHERE status = 'ACTIVE';
CREATE INDEX idx_nodes_steel            ON nodes(topic_id, is_steel) WHERE is_steel = TRUE;

-- Graph traversal: find children of a node
CREATE INDEX idx_edges_from_node        ON edges(from_node_id);
CREATE INDEX idx_edges_to_node          ON edges(to_node_id);
CREATE INDEX idx_edges_topic            ON edges(topic_id);

-- Votes: check if user already voted, count votes
CREATE INDEX idx_votes_node_id          ON votes(node_id);
CREATE INDEX idx_votes_user_node        ON votes(user_id, node_id);

-- Topics: browse & search
CREATE INDEX idx_topics_author          ON topics(author_id);
CREATE INDEX idx_topics_forked_from     ON topics(forked_from_id) WHERE forked_from_id IS NOT NULL;
CREATE INDEX idx_topics_created_at      ON topics(created_at DESC);

-- Rate limit queries
CREATE INDEX idx_rate_log_user_action   ON creation_rate_log(user_id, action, created_at DESC);

-- Node version history
CREATE INDEX idx_node_versions_node_id  ON node_versions(node_id, version DESC);

-- Full-text search (pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_nodes_content_trgm     ON nodes USING gin(content gin_trgm_ops);
```

---

## 4. Key Query Patterns

### 4.1 Recursive Subgraph Traversal (up to N hops)

```sql
-- Fetch a node and all descendants up to depth 3
WITH RECURSIVE subgraph AS (
    -- Base case: the starting node
    SELECT n.*, 0 AS depth, NULL::UUID AS parent_node_id, NULL::edge_type AS edge_type
    FROM nodes n
    WHERE n.id = $1           -- rootNodeId
      AND n.status = 'ACTIVE'

    UNION ALL

    -- Recursive case: children via edges
    SELECT n.*, sg.depth + 1, e.from_node_id, e.type
    FROM nodes n
    JOIN edges e ON e.to_node_id = n.id
    JOIN subgraph sg ON sg.id = e.from_node_id
    WHERE sg.depth < $2       -- maxDepth (e.g. 2)
      AND n.status = 'ACTIVE'
)
SELECT DISTINCT ON (id) *
FROM subgraph
ORDER BY id, depth;           -- deduplicate nodes that appear via multiple paths
```

### 4.2 Steelman Score Update (called after every vote)

```sql
-- Recompute is_steel for a node after a vote
UPDATE nodes
SET
    support_score = (SELECT COUNT(*) FROM votes WHERE node_id = $1 AND vote_type = 'SUPPORT'),
    contest_score = (SELECT COUNT(*) FROM votes WHERE node_id = $1 AND vote_type = 'CONTEST'),
    is_steel = (
        (SELECT COUNT(*) FROM votes WHERE node_id = $1 AND vote_type = 'SUPPORT') >
        (SELECT COUNT(*) FROM votes WHERE node_id = $1 AND vote_type = 'CONTEST') * 1.8
        AND
        (SELECT COUNT(*) FROM votes WHERE node_id = $1 AND vote_type = 'SUPPORT') >= 10
    ),
    updated_at = NOW()
WHERE id = $1;
```

### 4.3 Cycle Detection Before Edge Insert

```sql
-- Check if adding edge (A → B) would create a cycle
-- i.e. check if B can already reach A via existing edges
WITH RECURSIVE reachable AS (
    SELECT to_node_id AS id FROM edges WHERE from_node_id = $2  -- B

    UNION ALL

    SELECT e.to_node_id FROM edges e
    JOIN reachable r ON r.id = e.from_node_id
)
SELECT EXISTS (SELECT 1 FROM reachable WHERE id = $1) AS would_create_cycle;
-- If true → reject the edge insert
```

### 4.4 Fork a Topic (deep copy)

```sql
-- Run inside a transaction
-- 1. Create new topic
INSERT INTO topics (title, author_id, forked_from_id)
SELECT title, $newAuthorId, id
FROM topics WHERE id = $sourceTopicId
RETURNING id AS new_topic_id;

-- 2. Copy all nodes with new IDs (store old→new mapping)
-- (done in application layer: iterate nodes, insert with new IDs, build mapping table)

-- 3. Copy all edges using the ID mapping
-- (done in application layer using the mapping)

-- 4. Increment fork_count on source topic
UPDATE topics SET fork_count = fork_count + 1 WHERE id = $sourceTopicId;
```

### 4.5 Rate Limit Check (node creation)

```sql
-- Count nodes created by user in last hour
SELECT COUNT(*) FROM creation_rate_log
WHERE user_id = $1
  AND action = 'ADD_NODE'
  AND created_at > NOW() - INTERVAL '1 hour';
-- If count >= 30 → reject with 429
```

---

## 5. Redis Caching Strategy

| Cache Key | Value | TTL | Invalidated On |
|---|---|---|---|
| `argus:topic:{topicId}:graph` | Full serialized subgraph JSON (depth=3) | 5 min | Any node/edge added to topic |
| `argus:topic:{topicId}:steel` | Array of `isSteel` node IDs | 2 min | Any vote on topic's nodes |
| `argus:topics:recent` | Paginated topic list JSON | 1 min | New topic created |
| `argus:user:{userId}:ratelimit:nodes` | Integer counter | 1 hour sliding | Incremented on each node creation |

**Cache invalidation rule**: All `argus:topic:{topicId}:*` keys are deleted (SCAN + DEL) whenever any write to that topic occurs.

---

## 6. Data Integrity Rules

| Rule | Enforcement |
|---|---|
| No self-loops | DB constraint: `CHECK (from_node_id != to_node_id)` |
| No duplicate directed edges (same type) | DB constraint: `UNIQUE (from_node_id, to_node_id, type)` |
| No cycles | Application-level DFS check before edge insert (recursive CTE query above) |
| Claim content length 1–1000 chars | DB constraint: `CHECK (char_length(content) BETWEEN 1 AND 1000)` |
| Immutable claim content | `node_versions` table; `UPDATE` to content bumps `version` and inserts a row |
| One vote per user per node | DB constraint: `UNIQUE (node_id, user_id)` |
| All timestamps in UTC | `TIMESTAMPTZ` columns + `NOW()` (Postgres defaults to UTC) |

---

## 7. Migration Strategy

Using **Prisma Migrate** for schema versioning:
```
api/src/db/prisma/migrations/
  0001_init_users_topics.sql
  0002_add_nodes_edges.sql
  0003_add_votes_versions.sql
  0004_add_indexes_trgm.sql
  ...
```

Run `prisma migrate deploy` on every Fly.io release (CI/CD pipeline step).

---

## 8. Future: Migration to Neo4j

Trigger point: when recursive CTE traversal queries consistently exceed 200ms at P95 (visible in `pg_stat_statements`).

**Migration approach**:
1. Stand up Neo4j alongside Postgres (dual-write for ~2 weeks)
2. Sync existing graph structure via migration script (Postgres → Cypher `CREATE (n:Node {...})` + `CREATE (a)-[:SUPPORTS]->(b)`)
3. Shift reads to Neo4j; keep Postgres for users, votes, rate logs
4. Remove Postgres graph tables once Neo4j read path is stable

Cypher equivalent of the recursive subgraph query:
```cypher
MATCH path = (root:Node {id: $rootNodeId})-[*1..3]->(child:Node)
WHERE child.status = 'ACTIVE'
RETURN DISTINCT child, relationships(path)
```
