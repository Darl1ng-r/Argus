# Argus — Implementation Plan

> **Tagline**: Ratio, in the open.  
> **Concept**: A collaborative argument-mapping platform where discussions are directed graphs, not threads.

---

## 1. What We're Building

Argus replaces linear comment threads with a **directed graph of claims**. Every node is one atomic claim; every edge is a typed logical relationship (`supports`, `refutes`, `clarifies`, `requires_evidence`, `equivalent_to`). The shape of the graph *is* the insight — you can see at a glance whether a counterargument was ever addressed.

The prototype (`argus-prototype.html`) establishes the complete visual language:
- **Marble/parchment aesthetic** with a Greek-temple-inspired root node (pediment triangle)
- **Graph view** (interactive pan/zoom canvas with SVG cubic-bezier edges)
- **Steelman view** (dims non-strongest nodes, `data-steel="1"` attribute controls visibility)
- **Diff view** (side-by-side fork comparison — placeholder in v1)
- **Side panel** — selected node detail with support/contest score bars, vote buttons, and "Add a Response" form

---

## 2. MVP Scope (v1 Feature Set)

| # | Feature | Status |
|---|---|---|
| 1 | Create a topic (root claim) | **MVP** |
| 2 | Add claim nodes with typed edges (supports/refutes/clarifies/requires_evidence) | **MVP** |
| 3 | Vote on nodes — support or contest (separate axes) | **MVP** |
| 4 | Graph view (interactive canvas, pan, zoom) | **MVP** |
| 5 | Steelman view (auto-dim weakest nodes) | **MVP** |
| 6 | User auth (sign-up, sign-in) | **MVP** |
| 7 | Fork a graph | **Post-MVP** |
| 8 | Diff view (compare two forks side-by-side) | **Post-MVP** |
| 9 | Flag fallacies / circular reference detection | **Post-MVP** |
| 10 | Cross-graph search | **Post-MVP** |

---

## 3. Recommended Tech Stack

### Frontend
| Layer | Choice | Reason |
|---|---|---|
| Framework | **React 18 + Vite** | Fast HMR, ecosystem breadth |
| Graph render | **Cytoscape.js** | Mature, built-in force-directed/hierarchical layouts, handles 500+ nodes, built-in virtualization |
| State | **Zustand** | Lightweight; ideal for the derived state (selected node, filter mode, highlight sets) the prototype already shows |
| Auth UI | **Clerk** | Drop-in components; handles SSO, session, JWT issuance with zero backend work |
| Styling | **Vanilla CSS** (design tokens matching prototype) | The prototype's CSS variable system (`--marble`, `--gold`, etc.) is already complete and clean |
| Routing | **React Router v6** | Topic pages at `/t/:topicId`, user profile at `/u/:userId` |

### Backend
| Layer | Choice | Reason |
|---|---|---|
| Runtime | **Node.js 20 LTS** | Fast iteration; strong WebSocket & REST ecosystem |
| Framework | **Fastify** | Faster than Express; built-in JSON schema validation; plugin system |
| API style | **GraphQL (Apollo Server)** | The API surface is *literally* graph traversal — `node { neighbors { neighbors } }` maps perfectly; also makes the Diff view trivial |
| ORM | **Prisma** | Works with PostgreSQL + recursive CTEs; type-safe queries |
| Auth | **Clerk SDK (server)** | Verifies JWTs issued by Clerk on the frontend |
| Real-time | **WebSocket (Fastify WS plugin)** | Live graph updates when another user adds a node to a topic you're viewing |

### Infrastructure
| Component | Choice |
|---|---|
| Database | **PostgreSQL 15** (nodes/edges as tables with recursive CTEs for traversal) |
| Cache | **Redis** (cache full topic graph JSON; invalidate on write) |
| File/CDN | **Cloudflare R2** (optional — for eventual profile images) |
| Hosting (MVP) | **Fly.io** (Postgres + Redis + Node all deployable from one `fly.toml`) |
| Auth provider | **Clerk** |

---

## 4. Project Structure

```
argus/
├── apps/
│   ├── web/                      # React + Vite frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── GraphCanvas/  # Cytoscape.js wrapper
│   │   │   │   ├── NodeCard/     # Floating claim card (matches prototype .node)
│   │   │   │   ├── SidePanel/    # Claim detail + vote + add-form
│   │   │   │   ├── Header/       # Mode switcher + fork button
│   │   │   │   └── Legend/       # Edge-type legend overlay
│   │   │   ├── pages/
│   │   │   │   ├── TopicPage.tsx
│   │   │   │   ├── HomePage.tsx  # Browse topics
│   │   │   │   └── ProfilePage.tsx
│   │   │   ├── store/
│   │   │   │   └── graphStore.ts # Zustand — selected node, mode, zoom, filter
│   │   │   ├── graphql/
│   │   │   │   ├── queries.ts
│   │   │   │   └── mutations.ts
│   │   │   ├── App.tsx
│   │   │   └── index.css         # Design tokens from prototype
│   │   └── vite.config.ts
│   └── api/                      # Fastify + Apollo Server backend
│       ├── src/
│       │   ├── graphql/
│       │   │   ├── schema.graphql
│       │   │   ├── resolvers/
│       │   │   │   ├── topicResolvers.ts
│       │   │   │   ├── nodeResolvers.ts
│       │   │   │   └── voteResolvers.ts
│       │   ├── db/
│       │   │   ├── prisma/schema.prisma
│       │   │   └── migrations/
│       │   ├── services/
│       │   │   ├── graphTraversal.ts   # recursive CTE helpers
│       │   │   ├── steelmanScorer.ts   # compute steel=true/false
│       │   │   ├── cycleDetector.ts    # fallacy detection (post-MVP)
│       │   │   └── cache.ts            # Redis graph caching
│       │   ├── middleware/
│       │   │   ├── auth.ts             # Clerk JWT verification
│       │   │   └── rateLimiter.ts      # per-user creation rate limit
│       │   └── server.ts
│       └── package.json
├── packages/
│   └── shared-types/             # TS types shared between web + api
└── package.json                  # pnpm workspaces root
```

---

## 5. GraphQL Schema

```graphql
type Topic {
  id: ID!
  title: String!
  rootNode: Node!
  createdAt: DateTime!
  forkCount: Int!
  forkedFrom: Topic
}

type Node {
  id: ID!
  content: String!
  author: User!
  topic: Topic!
  supportScore: Int!
  contestScore: Int!
  isSteel: Boolean!           # computed: support > contest * 1.8
  createdAt: DateTime!
  version: Int!               # immutable edit versioning
  outgoingEdges: [Edge!]!
  incomingEdges: [Edge!]!
  children(depth: Int): [Node!]!   # traversal with depth limit
}

type Edge {
  id: ID!
  fromNode: Node!
  toNode: Node!
  type: EdgeType!
  author: User!
  createdAt: DateTime!
}

enum EdgeType {
  SUPPORTS
  REFUTES
  CLARIFIES
  REQUIRES_EVIDENCE
  EQUIVALENT_TO
}

type User {
  id: ID!
  username: String!
  clerkId: String!
  reputation: Int!
}

type Query {
  topic(id: ID!): Topic
  topics(cursor: String, limit: Int): TopicConnection
  node(id: ID!): Node
  # Returns node + all nodes within N hops
  subgraph(rootNodeId: ID!, depth: Int!): [Node!]!
  searchClaims(query: String!, topicId: ID): [Node!]!
}

type Mutation {
  createTopic(title: String!, rootClaim: String!): Topic!
  addNode(parentNodeId: ID!, edgeType: EdgeType!, content: String!): Node!
  voteNode(nodeId: ID!, voteType: VoteType!): Node!
  forkTopic(topicId: ID!): Topic!
  updateNodeStatus(nodeId: ID!, status: NodeStatus!): Node!
}

enum VoteType { SUPPORT  CONTEST }
enum NodeStatus { ACTIVE  FLAGGED  REMOVED }

type Subscription {
  nodeAdded(topicId: ID!): Node!
  nodeVoted(topicId: ID!): Node!
}
```

---

## 6. Build Order (Following Argus.md Recommendation)

### Phase 1 — Data Foundation
1. Design PostgreSQL schema (see `database-plan.md`)
2. Stand up Prisma + migrations
3. Write `graphTraversal.ts` service with recursive CTE helpers
4. Implement basic CRUD resolvers (no auth) — test with GraphQL Playground

### Phase 2 — Graph Render
1. Create Cytoscape.js `GraphCanvas` component with static hardcoded data
2. Port all CSS design tokens from prototype `index.html` → `index.css`
3. Wire up node click → `SidePanel` display (matching prototype side panel behavior)
4. Implement pan/zoom controls (matching prototype zoom buttons)
5. Implement edge legend overlay

### Phase 3 — Wire Frontend to API
1. Replace static graph data with live GraphQL `subgraph(rootNodeId, depth: 2)` query
2. Implement `addNode` mutation flow (side panel "Add a Response" form)
3. Implement `voteNode` mutation (support/contest buttons)
4. Implement WebSocket subscriptions for live graph updates

### Phase 4 — Auth
1. Integrate Clerk on frontend (sign-in modal, auth guard on mutations)
2. Add Clerk JWT verification middleware on API
3. Attach `authorId` to all created nodes/edges

### Phase 5 — Steelman View
1. Implement `steelmanScorer.ts` to compute `isSteel` on every query
2. Pass `data-steel` attribute through Cytoscape node data
3. Implement CSS dim-filter via Zustand mode toggle (matching prototype `mode-steelman` class)

### Phase 6 — Fork
1. Implement `forkTopic` mutation (deep-copy nodes+edges with new topic ID)
2. Show fork count and "forked from" attribution on topic header
3. Connect fork button to mutation + toast notification (matching prototype toast)

### Phase 7 — Diff View
1. Two-pane layout with left/right Cytoscape instances
2. Overlay matching nodes (by content hash similarity) with highlighted diff edges

---

## 7. Steelman Scoring Algorithm

A node receives `isSteel = true` when: `support > contest × 1.8` (directly from the prototype).

**Enhanced version for production**:
```
steelScore = support / (support + contest + 1)   // Laplace smoothed ratio
isSteel    = steelScore > 0.65 AND support >= 10  // minimum vote threshold prevents new nodes from instantly being "steel"
```

Recompute on every vote mutation; cache result in the `is_steel` column.

---

## 8. Real-Time Updates

Use WebSocket subscriptions so that when User A adds a node to a topic, User B (viewing the same topic) sees it appear without a refresh.

- Fastify-ws plugin runs alongside Apollo Server
- Apollo Server with `graphql-ws` transport for subscriptions
- Redis Pub/Sub as the subscription event bus (allows horizontal scaling of API pods)

---

## 9. Missing / Future Items

> [!IMPORTANT]
> Not in MVP scope but should be planned for early:

- [ ] **Immutable edit history** — once a claim is submitted, content cannot silently change; create a `node_versions` table and version counter
- [ ] **Circular reference detection** — DFS cycle check on edge creation (`cycleDetector.ts`)
- [ ] **Full-text search** — `pg_trgm` or Elasticsearch index on `node.content`
- [ ] **Reputation-weighted voting** — new user votes count less; high-rep user votes count more
- [ ] **Fallacy flags** — UI affordance to flag common fallacies on nodes (post-MVP)
- [ ] **Mobile responsive layout** — prototype is desktop-only; Cytoscape touch support needed
- [ ] **Accessibility** — graph canvas needs keyboard navigation and screen-reader descriptions of claim relationships
