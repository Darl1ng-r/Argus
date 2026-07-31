**Security**

\## 🔑 Most Critical Findings (Act On These First)



\### 🔐 Security

1\. \*\*Auth bypass in `getOrCreateUser`\*\* — \[`graphService.ts:129`](file:///c:/Users/User/.gemini/antigravity/scratch/Argus/apps/api/src/services/graphService.ts#L129): empty Clerk ID falls through to the privileged `system` user

2\. \*\*DNS Rebinding SSRF\*\* — \[`linkPreviewService.ts`](file:///c:/Users/User/.gemini/antigravity/scratch/Argus/apps/api/src/services/linkPreviewService.ts): hostname-only check is bypassable via DNS TTL rebinding; you need to resolve the IP post-lookup

3\. \*\*Redis `KEYS` blocks the event loop\*\* — \[`redis.ts:57`](file:///c:/Users/User/.gemini/antigravity/scratch/Argus/apps/api/src/redis.ts#L57): `KEYS pattern` is O(N) blocking; replace with `SCAN` cursor

4\. \*\*`.env` file committed to repo\*\* — rotate all secrets immediately if this was ever pushed to a remote

5\. \*\*RLS is a no-op\*\* — the DB connects as a superuser who bypasses all Row-Level Security policies



\### ⚡ Performance

6\. \*\*Cache keys include `userId`\*\* — \[`graphService.ts:238`](file:///c:/Users/User/.gemini/antigravity/scratch/Argus/apps/api/src/services/graphService.ts#L238): 10,000 users = 10,000 Redis copies of the same graph

7\. \*\*Recursive CTE has no row LIMIT\*\* — a 10,000-node topic at depth=10 can OOM the Node.js process in one query

8\. \*\*Offset pagination\*\* — comment says cursor-based, code uses `OFFSET`; degrades linearly at scale



\### 🏗️ Architecture

9\. \*\*Monolithic \[`server.ts`](file:///c:/Users/User/.gemini/antigravity/scratch/Argus/apps/api/src/server.ts) — 644 lines, 16 routes, no separation of concerns

10\. \*\*EventEmitter SSE won't work with multiple API instances\*\* — events are local to one process

11\. \*\*Two conflicting schemas\*\* (`schema.sql` vs `init.sql`) — neither is truly authoritative

12\. \*\*Prisma installed but zero code uses it\*\* — remove it or commit to it



\### 💡 Product

13\. \*\*Search across graphs is missing entirely\*\* — listed as a core feature in `Argus.md`, no API endpoint exists

14\. \*\*Immutable edit history is missing\*\* — explicitly promised in the design doc; `updateRootClaim` silently overwrites content

15\. \*\*AI analysis runs synchronously in a request handler\*\* — Gemini can take 30s+; this needs a BullMQ job queue

