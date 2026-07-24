# Argus — Deployment Plan

> Fly.io for MVP. All services (Postgres, Redis, Node API, React web) deployable from a single monorepo with one `fly.toml` per app.

---

## 1. Deployment Topology

```
                        ┌─────────────────────────┐
                        │     Cloudflare CDN       │  (Static assets + DDoS)
                        └────────────┬────────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                   │
          ┌────────▼───────┐   ┌─────▼──────┐   ┌──────▼──────┐
          │  Web App       │   │  API App   │   │  API App    │
          │  (React/Vite)  │   │  (Fastify) │   │  (Fastify)  │
          │  Fly.io Region │   │  Node 1    │   │  Node 2     │
          └────────────────┘   └─────┬──────┘   └──────┬──────┘
                                     │                   │
                         ┌───────────┴───────────┐
                         │                       │
              ┌──────────▼──────┐    ┌──────────▼──────┐
              │  Fly Postgres   │    │  Fly Redis       │
              │  (Primary +     │    │  (Cache +        │
              │   Replica)      │    │   Pub/Sub)        │
              └─────────────────┘    └─────────────────┘
```

---

## 2. Environment Stages

| Stage | Purpose | Infrastructure |
|---|---|---|
| **development** | Local dev | Docker Compose (Postgres + Redis) + `npm run dev` |
| **staging** | Pre-release testing | Fly.io (single-instance, shared DB) |
| **production** | Live users | Fly.io (multi-region, HA Postgres, Redis cluster) |

---

## 3. Local Development Setup

### 3.1 Prerequisites
- Node.js 20 LTS + pnpm
- Docker Desktop
- Clerk account (free tier sufficient for dev)

### 3.2 `docker-compose.yml` (local infra)

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    container_name: argus-postgres
    environment:
      POSTGRES_DB: argus
      POSTGRES_USER: argus
      POSTGRES_PASSWORD: argus_local_secret
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U argus"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: argus-redis
    ports:
      - "6379:6379"
    command: redis-server --save 60 1
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

### 3.3 Local `.env` Files

**`apps/api/.env`**:
```env
DATABASE_URL="postgresql://argus:argus_local_secret@localhost:5432/argus"
REDIS_URL="redis://localhost:6379"
CLERK_SECRET_KEY="sk_test_..."        # from Clerk dashboard
PORT=4000
NODE_ENV=development
CORS_ORIGIN="http://localhost:5173"
MAX_NODES_PER_HOUR=30
MAX_TOPICS_PER_DAY=5
```

**`apps/web/.env`**:
```env
VITE_API_URL="http://localhost:4000/graphql"
VITE_WS_URL="ws://localhost:4000/graphql"
VITE_CLERK_PUBLISHABLE_KEY="pk_test_..."   # from Clerk dashboard
```

### 3.4 Start Commands
```bash
# Terminal 1 — Infrastructure
docker compose up

# Terminal 2 — API (from monorepo root)
pnpm --filter api run dev

# Terminal 3 — Web (from monorepo root)
pnpm --filter web run dev
```

---

## 4. Fly.io Production Deployment

### 4.1 Fly Apps Structure

```
Fly.io Organization: argus
├── argus-api          (Fastify API)
├── argus-web          (Vite SPA served by nginx)
├── argus-db           (Fly Postgres)
└── argus-redis        (Fly Redis / Upstash)
```

### 4.2 API `fly.toml`

```toml
app = "argus-api"
primary_region = "ams"                    # Amsterdam (adjust to your user base)

[build]
  dockerfile = "apps/api/Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "4000"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1               # always at least one instance warm
  processes = ["app"]

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  path = "/health"
  protocol = "http"
  timeout = "5s"

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1

[mounts]
  # No persistent volumes needed for stateless API
```

### 4.3 Web `fly.toml`

```toml
app = "argus-web"
primary_region = "ams"

[build]
  dockerfile = "apps/web/Dockerfile"

[http_service]
  internal_port = 80
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

### 4.4 Dockerfiles

**`apps/api/Dockerfile`**:
```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

# Install deps
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
COPY . .
RUN pnpm --filter api run build

# Runtime
FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./

EXPOSE 4000
CMD ["node", "dist/server.js"]
```

**`apps/web/Dockerfile`**:
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_CLERK_PUBLISHABLE_KEY
RUN pnpm --filter web run build

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**`apps/web/nginx.conf`** (SPA fallback):
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA routing — all non-file requests → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json;
}
```

---

## 5. Secrets Management

All secrets injected via `fly secrets set` — never committed to source control.

```bash
# API secrets
fly secrets set \
  DATABASE_URL="postgresql://..." \
  REDIS_URL="redis://..." \
  CLERK_SECRET_KEY="sk_live_..." \
  CORS_ORIGIN="https://argus.app" \
  --app argus-api

# Web secrets (build-time, set as build args in CI)
fly secrets set \
  VITE_CLERK_PUBLISHABLE_KEY="pk_live_..." \
  VITE_API_URL="https://api.argus.app/graphql" \
  VITE_WS_URL="wss://api.argus.app/graphql" \
  --app argus-web
```

---

## 6. CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy Argus

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_DB: argus_test
          POSTGRES_USER: argus
          POSTGRES_PASSWORD: test_secret
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter api run test
        env:
          DATABASE_URL: postgresql://argus:test_secret@localhost:5432/argus_test
          REDIS_URL: redis://localhost:6379

  deploy-api:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --app argus-api --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

  deploy-web:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --app argus-web --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

---

## 7. Database Migration Strategy

Migrations run automatically on every API container start (before the HTTP server begins accepting traffic).

```typescript
// apps/api/src/server.ts
import { execSync } from 'child_process';

async function bootstrap() {
  // Run pending Prisma migrations before starting server
  execSync('prisma migrate deploy', { stdio: 'inherit' });

  // Then start Fastify...
  await app.listen({ port: 4000, host: '0.0.0.0' });
}
```

**Safe for zero-downtime deployments** because:
1. Fly.io does rolling restarts (new instance up before old one down)
2. All migrations must be backward-compatible with the previous version of the app (additive only; no destructive changes in same deploy)

---

## 8. Health & Monitoring

### Health Endpoint
```typescript
// GET /health — checked every 30s by Fly.io
app.get('/health', async (req, reply) => {
  const dbOk = await db.$queryRaw`SELECT 1`;
  const cacheOk = await redis.ping();
  return {
    status: 'ok',
    db: dbOk ? 'ok' : 'error',
    cache: cacheOk === 'PONG' ? 'ok' : 'error',
    uptime: process.uptime()
  };
});
```

### Observability Stack (MVP)
| Tool | Purpose | Cost |
|---|---|---|
| **Fly.io Metrics** | CPU, memory, request rate | Free |
| **Fly.io Logs** | Application logs (structured JSON) | Free |
| **Sentry** | Error tracking + performance traces | Free tier |
| **Upstash Redis** | Redis metrics dashboard | Free tier |

---

## 9. Production Scaling Path

### Phase 1 — Fly.io MVP
- 1× `argus-api` machine (512 MB, shared CPU)
- 1× `argus-web` machine (256 MB)
- 1× Fly Postgres (single primary, 1 GB)
- 1× Fly Redis (256 MB)
- **Cost estimate**: ~$20–40/month

### Phase 2 — Multi-Region Read Scaling
- Add Fly.io Postgres read replicas in additional regions (e.g., `sin`, `iad`)
- Direct read queries to nearest replica via `DATABASE_URL_REPLICA`
- Scale `argus-api` to `min_machines_running = 2`
- **Cost estimate**: ~$80–120/month

### Phase 3 — AWS/GCP Migration (when needed)
Triggers: >10k DAU, need for custom VPC, compliance requirements, or cost optimization at scale.

- **RDS PostgreSQL Multi-AZ** for HA database
- **ElastiCache Redis** cluster mode for horizontal cache scaling
- **ECS Fargate** or **GKE** for container orchestration
- **CloudFront** CDN for web app static assets
- Consider **Neo4j** at this point if graph traversal is bottleneck (see `database-plan.md`)
