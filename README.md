# Argus 👁️

> **Ratio, in the open.** Directed argument-mapping platform.

Argus transforms online debate from linear, noise-heavy reply chains into **structured directed graphs**. Instead of scrolling through hundreds of comments to see if a counterargument was ever addressed, Argus lets users visually map claims, logical relationships, and structural evidence.

---

## 🌟 Core Concept

- **Nodes**: Atomic claims (one core idea per node).
- **Edges**: Express logical relationships between claims (`Supports`, `Refutes`, `Clarifies`, `Requires Evidence`, `Is Equivalent To`).
- **Graph Topology**: Reveals structural insights—identifying un-rebutted dead ends, central hub claims, and common points of convergence.
- **Logical Strength vs. Popularity**: Evaluates argument validity independently from simple upvote counters.

---

## 🏗️ Tech Stack

### Monorepo Structure

```text
Argus/
├── apps/
│   ├── api/             # Express + TypeScript backend service
│   └── web/             # React + Vite + Cytoscape.js frontend app
├── Docs/                # Architecture, DB, security & deployment plans
├── sql/                 # Database migrations and schema scripts
└── docker-compose.yml   # PostgreSQL infrastructure setup
```

### Stack Highlights

- **Frontend**: React 18, Vite, TypeScript, Cytoscape.js (Graph Visualization), Lucide React, Clerk (`@clerk/clerk-react`).
- **Backend**: Express, TypeScript, PostgreSQL (`pg`), Prisma, Clerk (`@clerk/backend`), DOMPurify.
- **Database**: PostgreSQL 15 (Dockerized).

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/)
- [Docker & Docker Compose](https://www.docker.com/) (for running local PostgreSQL)

### 1. Repository Setup

Clone the repository and install dependencies in workspace packages:

```bash
# Install root tools (if applicable) and app dependencies
npm --prefix apps/api install
npm --prefix apps/web install
```

### 2. Environment Configuration

Set up local environment variables for the API:

```bash
# Copy or create apps/api/.env with:
DATABASE_URL="postgresql://argus:argus_dev_secret@localhost:5433/argus"
PORT=3000
```

### 3. Start Database

Spin up PostgreSQL via Docker Compose:

```bash
docker compose up -d
```

### 4. Run Development Servers

Start both the backend API and frontend web application concurrently:

```bash
npm run dev
```

Or run individual apps separately:

- **API Server** (Runs on http://localhost:3000):
  ```bash
  npm run dev:api
  ```
- **Web App** (Runs on Vite dev port, e.g. http://localhost:5173):
  ```bash
  npm run dev:web
  ```

---

## 📜 Available Scripts

From the repository root:

- `npm run dev`: Runs both API and Web in development mode concurrently.
- `npm run dev:api`: Runs API server with `tsx watch`.
- `npm run dev:web`: Starts Vite dev server for the frontend.
- `npm run build`: Compiles both API and Web packages for production.
- `npm run build:api`: Builds TypeScript backend to `dist/`.
- `npm run build:web`: Builds Vite bundle to `dist/`.

---

## 📚 Documentation

For deeper architectural design, security models, and deployment strategies, see the [`Docs/`](./Docs) directory:

- [Argus Platform Blueprint](./Docs/Argus.md)
- [Database Plan & Schema](./Docs/database-plan.md)
- [Implementation Plan](./Docs/implementation-plan.md)
- [Security Plan](./Docs/security-plan.md)
- [Deployment Plan](./Docs/deployment-plan.md)

---

## 📄 License

Private / Proprietary. All rights reserved.
