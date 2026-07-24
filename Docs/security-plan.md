# Argus — Security Plan

> Argus handles user-generated content rendered back to other users inside a collaborative graph structure. The threat surface is distinct from a typical CRUD app: the graph topology itself is a target for manipulation, and vote scores are a direct mechanism for information distortion.

---

## 1. Threat Model

| Threat | Description | Impact |
|---|---|---|
| **XSS** | Malicious script in node content rendered in other users' browsers | Account takeover, data theft |
| **Vote Brigading** | Coordinated bot/user campaign to artificially inflate support or contest scores | Distorts the "steelman" view, buries real arguments |
| **Graph Spam / Vandalism** | Bots or users flooding a topic with thousands of low-quality nodes | Drowns legitimate discussion, performance degradation |
| **Graph Poisoning** | Strategically placed misleading nodes forming cycles or false "supports" relationships | Corrupts the logical integrity of the debate graph |
| **Retroactive Edit Manipulation** | User silently editing a claim after others have voted on it | Invalidates the votes and breaks the debate history |
| **IDOR (Insecure Direct Object Reference)** | Accessing or mutating another user's resources by guessing IDs | Unauthorized data exposure or modification |
| **Auth bypass** | Calling mutations without a valid session | Creating nodes, votes without accountability |
| **Denial of Service** | Traversal queries on very large graphs consuming excessive DB/CPU time | Service unavailability |
| **SSRF / Webhook abuse** | (N/A for MVP — Argus does not make outbound HTTP calls based on user input) | — |

---

## 2. Authentication & Authorization

### 2.1 Authentication Provider: Clerk

From `Argus.md`:
> *"Auth0 or Clerk rather than rolling your own — get SSO, session management, and rate-limit-friendly auth for free early on."*

**JWT Verification Flow**:
```
Client                    Clerk                    Argus API
  │                         │                         │
  │──sign in──────────────>│                         │
  │<──session JWT (RS256)──│                         │
  │                         │                         │
  │──GraphQL mutation (Authorization: Bearer <JWT>)──>│
  │                         │       verify JWT (Clerk SDK)
  │                         │       extract sub (clerkId)
  │                         │       look up user in DB
  │<────────response────────────────────────────────│
```

**API Middleware** (`apps/api/src/middleware/auth.ts`):
```typescript
import { clerkClient } from '@clerk/clerk-sdk-node';

export async function authMiddleware(request, reply) {
  const token = request.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    // Anonymous read access: allowed for queries, blocked for mutations
    request.userId = null;
    return;
  }

  try {
    const payload = await clerkClient.verifyToken(token);
    // Resolve to internal user ID
    const user = await db.user.findUnique({ where: { clerkId: payload.sub } });
    if (!user) throw new Error('User not found');
    request.userId = user.id;
    request.userReputation = user.reputation;
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}
```

### 2.2 Authorization Rules

| Operation | Anonymous | Authenticated |
|---|---|---|
| Read topics | ✅ | ✅ |
| Read nodes / subgraphs | ✅ | ✅ |
| Create topic | ❌ | ✅ (rate-limited) |
| Add node | ❌ | ✅ (rate-limited) |
| Vote on node | ❌ | ✅ (rate-limited, one per user per node) |
| Fork topic | ❌ | ✅ |
| Edit own node content | ❌ | ✅ (creates new version, immutable) |
| Delete own node | ❌ | ✅ (soft-delete: status → REMOVED) |
| Moderate (flag/remove) any node | ❌ | ✅ (moderator role only) |

**Resolver-level guard** (applied in GraphQL resolvers):
```typescript
function requireAuth(userId: string | null): asserts userId is string {
  if (!userId) throw new GraphQLError('Authentication required', {
    extensions: { code: 'UNAUTHENTICATED' }
  });
}
```

---

## 3. Input Sanitization & XSS Prevention

### 3.1 Node Content Rules

Node content is the primary UGC attack surface. Rules enforced at multiple layers:

**Database layer**: `CHECK (char_length(content) BETWEEN 1 AND 1000)` — hard limit.

**API layer** (before DB write):
```typescript
import DOMPurify from 'isomorphic-dompurify';

function sanitizeNodeContent(raw: string): string {
  // 1. Trim whitespace
  const trimmed = raw.trim();

  // 2. Strip ALL HTML — node content is plain text only
  const stripped = DOMPurify.sanitize(trimmed, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });

  // 3. Normalize unicode (prevent homograph attacks)
  const normalized = stripped.normalize('NFC');

  if (stripped.length === 0) throw new Error('Content cannot be empty after sanitization');
  if (stripped.length > 1000) throw new Error('Content exceeds 1000 character limit');

  return normalized;
}
```

**Frontend layer** (defense-in-depth):
- Node content is rendered as `textContent`, **never `innerHTML`** — React's default behavior when using `{node.content}` in JSX.
- Cytoscape.js node labels are also rendered as plain text, not HTML.

### 3.2 Content Security Policy (CSP)

Set via nginx response headers on the web app:
```nginx
add_header Content-Security-Policy
  "default-src 'self';
   script-src 'self' https://js.clerk.dev;
   style-src 'self' https://fonts.googleapis.com 'unsafe-inline';
   font-src https://fonts.gstatic.com;
   connect-src 'self' https://api.argus.app wss://api.argus.app https://api.clerk.dev;
   img-src 'self' data:;
   frame-ancestors 'none';"
  always;

add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

---

## 4. Rate Limiting

From `Argus.md`:
> *"Rate-limit node/edge creation aggressively — a graph structure is very easy to spam/vandalize (bots creating thousands of nodes to bury real discussion)."*

### 4.1 Creation Rate Limits

| Action | Limit | Window | Storage |
|---|---|---|---|
| Add node | 30 | per hour per user | Redis (sliding window) |
| Add edge | 50 | per hour per user | Redis (sliding window) |
| Create topic | 5 | per day per user | Redis (sliding window) |
| Vote | 100 | per hour per user | Redis (sliding window) |
| Fork topic | 10 | per day per user | Redis (sliding window) |

**Implementation** (Redis sliding window counter):
```typescript
async function checkRateLimit(
  userId: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<void> {
  const key = `argus:ratelimit:${userId}:${action}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);     // remove old entries
  pipeline.zadd(key, now, `${now}`);                  // add current
  pipeline.zcard(key);                                 // count in window
  pipeline.expire(key, windowSeconds);                 // sliding TTL

  const results = await pipeline.exec();
  const count = results[2][1] as number;

  if (count > limit) {
    throw new GraphQLError(`Rate limit exceeded: max ${limit} ${action} per ${windowSeconds}s`, {
      extensions: { code: 'RATE_LIMITED', retryAfter: windowSeconds }
    });
  }
}
```

### 4.2 Traversal Depth Limit

Prevent expensive queries by enforcing max traversal depth at the API layer:
```typescript
const MAX_TRAVERSAL_DEPTH = 4;

// In resolver:
if (depth > MAX_TRAVERSAL_DEPTH) {
  throw new GraphQLError(`Traversal depth cannot exceed ${MAX_TRAVERSAL_DEPTH}`);
}
```

### 4.3 Query Complexity Limiting (GraphQL)

Prevent deeply nested GraphQL queries from killing the database:
```typescript
import costAnalysis from 'graphql-cost-analysis';

apolloServer.addPlugin(costAnalysis({
  maximumCost: 1000,
  defaultCost: 1,
  costMap: {
    Query: { subgraph: { multiplier: 'depth', useMultipliers: true } },
    Node: { children: { multiplier: 'depth' } }
  }
}));
```

---

## 5. Vote Integrity

From `Argus.md`:
> *"Vote manipulation (brigading a 'well-supported' score) needs the same protections as any voting system: rate limits, reputation-weighted votes, anomaly detection on vote velocity."*

### 5.1 One Vote Per User Per Node (DB Enforced)

```sql
CONSTRAINT uq_votes_user_node UNIQUE (node_id, user_id)
```

Vote changes (support → contest) use `INSERT ON CONFLICT DO UPDATE`:
```sql
INSERT INTO votes (node_id, user_id, vote_type)
VALUES ($1, $2, $3)
ON CONFLICT (node_id, user_id)
DO UPDATE SET vote_type = EXCLUDED.vote_type;
```

### 5.2 Reputation-Weighted Voting

```typescript
function computeVoteWeight(reputation: number): number {
  // Logarithmic reputation scaling
  // New user (rep=0): weight 1.0
  // Established user (rep=1000): weight ~2.0
  return 1 + Math.log10(Math.max(1, reputation)) / 3;
}
```

Store `vote_weight` on the `votes` table and use it when computing `support_score`:
```sql
-- Weighted support score
UPDATE nodes SET
  support_score = (
    SELECT COALESCE(SUM(vote_weight), 0)
    FROM votes WHERE node_id = $1 AND vote_type = 'SUPPORT'
  ),
  ...
```

### 5.3 Anomaly Detection (vote velocity)

Flag suspicious voting patterns for review:
```typescript
// After recording a vote, check velocity
const recentVotesOnNode = await redis.zcount(
  `argus:votevelocity:${nodeId}`,
  Date.now() - 60_000,  // last minute
  '+inf'
);

if (recentVotesOnNode > 20) {
  // Soft-freeze: accept votes but don't update score until reviewed
  await flagNodeForReview(nodeId, 'VOTE_VELOCITY_ANOMALY');
}
```

---

## 6. Immutable Edit History

From `Argus.md`:
> *"Don't allow silent edits to claims; version them (like Wikipedia's revision history) so debates can't be retroactively rewritten."*

**Rule**: A node's `content` may never be silently overwritten. Instead:

1. The existing `nodes` row keeps its current content (live view).
2. Before any update, the **previous** content is written to `node_versions`.
3. The `version` counter on `nodes` is incremented.

```typescript
// In updateNode resolver
async function updateNode(nodeId: string, newContent: string, userId: string) {
  const existing = await db.node.findUnique({ where: { id: nodeId } });

  if (existing.authorId !== userId) {
    throw new GraphQLError('Cannot edit another user\'s claim', {
      extensions: { code: 'FORBIDDEN' }
    });
  }

  return db.$transaction([
    // Archive old version
    db.nodeVersion.create({
      data: {
        nodeId,
        version: existing.version,
        content: existing.content,
        editedBy: userId
      }
    }),
    // Update node with new content
    db.node.update({
      where: { id: nodeId },
      data: {
        content: sanitizeNodeContent(newContent),
        version: { increment: 1 }
      }
    })
  ]);
}
```

---

## 7. Graph Integrity

### 7.1 Cycle Prevention

Every `addEdge` mutation first runs a cycle-detection query (see `database-plan.md` §4.3). If a cycle would be created, the mutation is rejected:
```typescript
const { would_create_cycle } = await db.$queryRaw`
  WITH RECURSIVE reachable AS (
    SELECT to_node_id AS id FROM edges WHERE from_node_id = ${toNodeId}
    UNION ALL
    SELECT e.to_node_id FROM edges e JOIN reachable r ON r.id = e.from_node_id
  )
  SELECT EXISTS (SELECT 1 FROM reachable WHERE id = ${fromNodeId}) AS would_create_cycle
`;

if (would_create_cycle) {
  throw new GraphQLError('This edge would create a circular reference', {
    extensions: { code: 'CIRCULAR_REFERENCE' }
  });
}
```

### 7.2 Duplicate Edge Prevention

Database constraint enforces no duplicate directed edges of the same type:
```sql
CONSTRAINT uq_edges_unique UNIQUE (from_node_id, to_node_id, type)
```

### 7.3 Cross-Topic Edge Prevention

Nodes can only be connected within the same topic:
```typescript
if (fromNode.topicId !== toNode.topicId) {
  throw new GraphQLError('Cannot connect nodes from different topics');
}
```

---

## 8. CORS & API Security

### 8.1 CORS Configuration

```typescript
await app.register(cors, {
  origin: process.env.CORS_ORIGIN,   // 'https://argus.app' in production
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
});
```

### 8.2 API Key for Internal Services

If background jobs or admin scripts need to call the API without a user JWT, they use a separate `X-Internal-API-Key` header verified by middleware.

### 8.3 Helmet.js Headers

```typescript
await app.register(helmet, {
  contentSecurityPolicy: false,       // handled by nginx on web app
  crossOriginEmbedderPolicy: false,   // Clerk requires this disabled
});
```

---

## 9. Infrastructure Security

| Control | Implementation |
|---|---|
| **Secrets** | Fly.io secrets (never in source code or env files committed to Git) |
| **Least privilege DB user** | Postgres user `argus_app` has only `SELECT, INSERT, UPDATE` on app tables; no `DROP`, `TRUNCATE`, `CREATE` |
| **Connection pooling** | PgBouncer (Fly Postgres includes this); max 20 connections from app |
| **Redis auth** | `requirepass` set; connection string includes password |
| **Private networking** | API → Postgres and API → Redis communicate over Fly.io private IPv6 network (not exposed publicly) |
| **HTTPS enforced** | `force_https = true` in `fly.toml`; HTTP redirects to HTTPS |
| **Dependency scanning** | `pnpm audit` runs in CI on every pull request |

---

## 10. Moderation System

| Feature | Implementation |
|---|---|
| **Flag a node** | Any authenticated user can `POST /api/v1/nodes/:id/flag` with a reason |
| **Moderator role** | `users.is_moderator` boolean; checked in mutation resolvers |
| **Soft delete** | `nodes.status = 'REMOVED'` — node hidden from graph views but record preserved for audit |
| **Audit log** | All moderation actions logged to a `mod_actions` table with `actor_id`, `target_id`, `action`, `reason`, `created_at` |
| **Auto-flag threshold** | If a node receives > 5 flags, it is auto-soft-hidden pending moderator review |

---

## 11. Privacy

| Area | Policy |
|---|---|
| **User email** | Never exposed in GraphQL API responses; stored only for account recovery |
| **User ID in graph data** | Only `username` exposed publicly; internal `UUID` never in API responses |
| **Vote privacy** | Votes are associated with a user internally but not exposed in public API (aggregate scores only) |
| **Data deletion** | On account deletion: user's nodes soft-deleted (content replaced with `[deleted]`), votes removed, account record purged |
| **GDPR** | Clerk handles auth data under GDPR; Argus app data deletion on request via `/api/v1/users/me` `DELETE` endpoint |
