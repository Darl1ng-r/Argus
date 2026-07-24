**Argus**



\## Core idea



A platform where discussions aren't threads, they're \*\*directed graphs\*\*:

\- Each \*\*node\*\* = a single claim (atomic, one idea per node)

\- Each \*\*edge\*\* = a relationship (supports, refutes, requires-evidence, is-equivalent-to)

\- Users build the graph collaboratively as they debate a topic

\- The shape of the graph becomes the insight: dead-end nodes (nobody rebutted, discussion just stopped), hub nodes (heavily contested central claims), convergence points (where two "sides" actually agree)



The pitch: instead of scrolling 400 replies to find out if anyone actually addressed the counterargument, you \*see\* whether it was addressed.



\## Basic functions (MVP scope)



1\. \*\*Create a topic\*\* — a root node stating the question/claim being debated

2\. \*\*Add a claim node\*\* — attach it to an existing node with a relationship type (supports / refutes / clarifies / requires-evidence)

3\. \*\*Vote/weight nodes\*\* — not upvote-for-agreement, but "is this well-supported" vs "is this contested" — separates \*popularity\* from \*logical strength\*

4\. \*\*View modes\*\*:

&#x20;  - Graph view (the visual web)

&#x20;  - "Steelman" view — auto-collapse to just the strongest node on each side

&#x20;  - Diff view — compare two people's sub-graphs on the same topic

5\. \*\*Fork a graph\*\* — take someone's argument map and branch it, like a git fork

6\. \*\*Flag fallacies/circular references\*\* — basic structural checks (a node that only cites itself, a cycle A→B→A)

7\. \*\*Search across graphs\*\* — find claims made about a topic across many debates



That's already a lot for v1 — I'd cut to (1), (2), (3), (4a) for a real MVP and add the rest after.



\## Data model (this is the crux of the whole system)



Graph-shaped data, so don't fight it with a relational DB for the core structure.



```

Node {

&#x20; id, content (text, short — enforce atomicity),

&#x20; author\_id, topic\_id, created\_at,

&#x20; support\_score, contest\_score  // separate axes

}



Edge {

&#x20; id, from\_node\_id, to\_node\_id,

&#x20; type: enum(supports, refutes, clarifies, requires\_evidence, equivalent\_to),

&#x20; author\_id, created\_at

}



Topic {

&#x20; id, root\_node\_id, title, created\_at

}

```



\## Recommended stack



\*\*Database — the most important decision here\*\*

\- \*\*Neo4j\*\* (or \*\*PostgreSQL + Apache AGE\*\* if you want to avoid running two DB systems) for the graph itself — you'll be doing traversal queries constantly ("show me all nodes within 2 hops of this contested claim") and relational JOINs get ugly fast for that.

\- Practical MVP move: start with \*\*Postgres alone\*\* (nodes/edges as tables, recursive CTEs for traversal) — it's "good enough" until you have real scale, and it means one less system to run. Migrate to Neo4j only if traversal queries become your bottleneck (they will show up clearly in query logs).



\*\*Backend\*\*

\- \*\*Node.js (NestJS) or Python (FastAPI)\*\* — either is fine; FastAPI if you want to eventually run graph algorithms (NetworkX, community detection, centrality scoring) server-side, since that ecosystem is stronger in Python.

\- REST for basic CRUD, but consider \*\*GraphQL\*\* — the API surface here is literally about graph traversal, and GraphQL's shape maps naturally to "give me this node plus its neighbors plus their neighbors."



\*\*Frontend\*\*

\- \*\*React\*\* + \*\*react-flow\*\* or \*\*Cytoscape.js\*\* for the actual graph rendering — both handle large interactive node/edge graphs with pan/zoom/layout out of the box. Cytoscape.js is more mature for graph-algorithm-heavy use (built-in layout algorithms like force-directed, hierarchical).

\- \*\*Zustand or Redux\*\* for state — you'll have a lot of derived state (which nodes are highlighted, filtered, collapsed).



\*\*Auth\*\*

\- \*\*Auth0 or Clerk\*\* rather than rolling your own — get SSO, session management, and rate-limit-friendly auth for free early on.



\*\*Infra\*\*

\- \*\*Fly.io or Railway\*\* for MVP hosting (cheap, fast to iterate) → move to \*\*AWS/GCP\*\* once you need real scaling controls.

\- \*\*Redis\*\* for caching hot graphs (popular debate topics will get read far more than written).



\## Security



\- \*\*Rate-limit node/edge creation\*\* aggressively — a graph structure is \*very\* easy to spam/vandalize (bots creating thousands of nodes to bury real discussion).

\- \*\*Immutable edit history\*\* — don't allow silent edits to claims; version them (like Wikipedia's revision history) so debates can't be retroactively rewritten.

\- \*\*Input sanitization\*\* on node content — this is user-generated text rendered back to other users, so standard XSS precautions.

\- \*\*Abuse-resistant scoring\*\* — vote manipulation (brigading a "well-supported" score) needs the same protections as any voting system: rate limits, reputation-weighted votes, anomaly detection on vote velocity.



\## Scalability



\- Real bottleneck will be \*\*graph traversal at read time\*\*, not writes (debates don't get \*that\* many nodes/edges compared to, say, a chat app's message volume).

\- Cache full graph structure per topic in Redis, invalidate on writes — most topics will have far more reads than writes.

\- Precompute expensive stuff (centrality scores, "most contested node") on a cron/queue rather than live — nobody needs that in under 50ms.



\## Performance



\- Client-side: \*\*virtualize\*\* the graph render — don't mount 500 SVG nodes if only 40 are in viewport. Cytoscape.js handles this reasonably; react-flow needs manual work at scale.

\- Server-side: paginate traversal depth (never return "the whole graph" — return "this node + 2 hops," load more on demand).



\## Suggested build order



1\. Postgres schema + basic node/edge CRUD API (no auth yet, just get the shape right)

2\. Cytoscape.js render of a static graph, hardcoded data

3\. Wire up create-node / create-edge from UI to API

4\. Add auth

5\. Add scoring (support/contest)

6\. Add fork

7\. Add steelman/diff views last — they're the most "interesting" but least essential to prove the concept



