# ============================================================
# Argus API Production Multi-Stage Dockerfile
# ============================================================

# Stage 1: Build & Compile TypeScript
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Minimal Production Runtime with jemalloc
FROM node:20-alpine AS runner
WORKDIR /app

# Install jemalloc to eliminate V8 heap fragmentation during continuous SSE streaming
RUN apk add --no-cache jemalloc

ENV NODE_ENV=production
ENV PORT=4000
ENV LD_PRELOAD=/usr/lib/libjemalloc.so.2
ENV NODE_OPTIONS="--max-old-space-size=512 --optimize-for-size"

# Install runtime dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled JavaScript output
COPY --from=builder /app/dist ./dist

# Run as non-root unprivileged node user
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "dist/server.js"]
