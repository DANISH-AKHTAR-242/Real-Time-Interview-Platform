# Real-Time Interview Platform

A production-oriented **pnpm + Turbo monorepo** for running live coding interviews with:

- JWT-based auth
- interview session lifecycle management
- real-time collaborative editing (Yjs + WebSocket)
- sandboxed code execution (queue + Docker runners)
- a React + Monaco frontend

---

## Table of Contents

1. [Repository Overview](#repository-overview)
2. [Top-Level File Guide](#top-level-file-guide)
3. [Monorepo Structure](#monorepo-structure)
4. [Services and Responsibilities](#services-and-responsibilities)
5. [Architecture and Request Flow](#architecture-and-request-flow)
6. [Ports and Runtime Matrix](#ports-and-runtime-matrix)
7. [Tech Stack](#tech-stack)
8. [Prerequisites](#prerequisites)
9. [Local Setup (End-to-End)](#local-setup-end-to-end)
10. [Environment Variables](#environment-variables)
11. [API and WebSocket Surface](#api-and-websocket-surface)
12. [Code Execution Security Model](#code-execution-security-model)
13. [Development Commands](#development-commands)
14. [Quality Gates and Validation](#quality-gates-and-validation)
15. [QA Package Included in Repo](#qa-package-included-in-repo)
16. [Troubleshooting](#troubleshooting)
17. [Production Notes](#production-notes)
18. [License](#license)

---

## Repository Overview

This repository is organized as a workspace monorepo with apps under `apps/*` and shared config packages under `packages/*`.

Core platform modules:

- **`auth-service`**: registration, login, token issuance, identity endpoint
- **`session-service`**: interview session creation/read/update backed by PostgreSQL + Prisma
- **`collab-service`**: Yjs synchronization server over WebSocket with upgrade authentication
- **`execution-service`**: async code execution API + queue worker using Docker-based runners
- **`frontend`**: React app with Monaco editor, collaboration connection controls, run-code UI

---

## Top-Level File Guide

### Project and tooling

- `package.json` — root scripts (`dev`, `build`, `lint`, `typecheck`, `check`)
- `pnpm-workspace.yaml` — workspace mapping for `apps/*` and `packages/*`
- `pnpm-lock.yaml` — workspace lockfile
- `turbo.json` — task graph (`build`, `lint`, `typecheck`, `format`, `dev`)
- `prettier.config.cjs`, `.prettierignore` — formatting config
- `.gitignore` — ignored files

### Infrastructure and env

- `docker-compose.yml` — local PostgreSQL + Redis
- `.env.example` — shared and service-specific environment variables

### QA / validation package

- `COLLAB_VALIDATION_GUIDE.md`
- `QA_QUICK_REFERENCE.md`
- `README_QA_VALIDATION.md`
- `QA_PACKAGE_OVERVIEW.md`
- `IMPLEMENTATION_GUIDE.md`
- `START_HERE.md`
- `TEST_SCRIPT_BROWSER_CONSOLE.js`
- `METRICS_MONITORING.ts`
- `e2e-integration-test.mjs`

---

## Monorepo Structure

```text
apps/
  auth-service/
  session-service/
  collab-service/
  execution-service/
  frontend/

packages/
  eslint-config/
  prettier-config/
  tsconfig/
```

---

## Services and Responsibilities

### 1) `apps/auth-service`

Fastify API for authentication and identity.

- Hashes passwords with `bcrypt`
- Stores users/sessions in Redis
- Issues JWT access tokens
- Endpoints: `/register`, `/login`, `/me`, `/health`, `/ready`

### 2) `apps/session-service`

Fastify API for interview sessions (PostgreSQL + Prisma).

- Creates sessions with candidate/interviewer UUIDs
- Reads a session by ID
- Updates session status (`scheduled`, `active`, `completed`)
- Endpoints: `/sessions`, `/sessions/:id`, `/health`, `/ready`

### 3) `apps/collab-service`

Node HTTP + `ws` WebSocket service for collaborative editing.

- Handles HTTP upgrade auth checks
- Uses Yjs + y-websocket for CRDT sync
- Tracks active WebSocket connections
- HTTP endpoints: `/health`, `/ready`

### 4) `apps/execution-service`

Fastify API + queue worker for secure code execution.

- `POST /execute` enqueues job
- `GET /result/:jobId` fetches execution status/result
- Uses BullMQ + Redis
- Worker executes code in constrained Docker containers

### 5) `apps/frontend`

Vite + React + Monaco client application.

- Connects to collaboration backend via WebSocket
- Accepts JWT token for auth-enabled sessions
- Supports JavaScript and Python run-code flow
- Polls execution results and renders stdout/stderr/errors

---

## Architecture and Request Flow

1. User registers/logs in through **auth-service** and receives JWT.
2. Frontend opens WebSocket to **collab-service** with session context (+ token when required).
3. Session metadata operations go through **session-service**.
4. Frontend submits code to **execution-service**.
5. Execution API enqueues job in Redis/BullMQ.
6. Execution worker runs code using language-specific Docker runner image.
7. Frontend polls result endpoint and displays final output.

---

## Ports and Runtime Matrix

| Component | Default Port | Purpose |
| --- | ---: | --- |
| frontend | 5173 | React/Vite UI |
| auth-service | 3001 | auth + JWT |
| collab-service | 3002 | WebSocket collaboration |
| session-service | 3003 | interview session lifecycle |
| execution-service API | 3004 | enqueue + query execution results |
| execution worker | n/a | async job processing |
| postgres (docker) | 5432 | session persistence |
| redis (docker) | 6379 | auth/session cache + queue |

---

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **HTTP services:** Fastify
- **Realtime:** `ws`, `yjs`, `y-websocket`, `@y/websocket-server`
- **Database:** PostgreSQL + Prisma
- **Queue:** BullMQ + ioredis
- **Frontend:** Vite + React + Monaco Editor
- **Tooling:** pnpm workspaces, Turbo, ESLint, Prettier

---

## Prerequisites

- Node.js 18+
- pnpm 9+
- Docker + Docker Compose
- OpenSSL (JWT key generation)

If `pnpm` is unavailable in your shell, enable it with Corepack:

```bash
corepack enable
```

---

## Local Setup (End-to-End)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Start infrastructure

```bash
docker compose up -d
docker compose ps
```

### 3) Create `.env`

```bash
cp .env.example .env
```

### 4) Generate JWT keypair

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Then copy key contents into `.env`:

- `JWT_PRIVATE_KEY`
- `JWT_PUBLIC_KEY`

### 5) Generate Prisma client and migrate DB

```bash
pnpm --filter @repo/session-service db:generate
pnpm --filter @repo/session-service db:migrate
```

### 6) Build execution runner Docker images

```bash
docker build -f apps/execution-service/src/docker/Dockerfile.python -t code-runner-python .
docker build -f apps/execution-service/src/docker/Dockerfile.javascript -t code-runner-javascript .
```

### 7) Run services (recommended separate terminals)

```bash
pnpm --filter @repo/auth-service dev
pnpm --filter @repo/session-service dev
pnpm --filter @repo/collab-service dev
pnpm --filter @repo/execution-service dev
pnpm --filter @repo/execution-service dev:worker
pnpm --filter @repo/frontend dev
```

---

## Environment Variables

Source of truth: `.env.example`

### Shared

- `DATABASE_URL`
- `REDIS_URL`
- `HOST`
- `LOG_LEVEL`
- `REQUEST_TIMEOUT_MS`
- `BODY_LIMIT_BYTES`
- `TRUST_PROXY`
- `SHUTDOWN_GRACE_PERIOD_MS`

### auth-service

- `JWT_PRIVATE_KEY` (**required**)
- `JWT_PUBLIC_KEY` (**required**)
- `JWT_EXPIRES_IN`
- `MAX_AUTH_ATTEMPTS_PER_MINUTE`

### collab-service

- `JWT_PUBLIC_KEY` (required if auth enabled)
- `SESSION_SERVICE_URL`
- `ALLOW_MOCK_SESSION_ACCESS`
- `SESSION_SERVICE_TIMEOUT_MS`
- `MAX_PAYLOAD_BYTES`

### execution-service

- `REDIS_URL`
- `WORKER_CONCURRENCY`

### frontend

- `VITE_WS_URL`
- `VITE_EXECUTION_API_URL` (optional; if empty, Vite proxy path is used)

---

## API and WebSocket Surface

### auth-service

- `POST /register`
- `POST /login`
- `GET /me` (Bearer token)
- `GET /health`
- `GET /ready`

### session-service

- `POST /sessions`
- `GET /sessions/:id`
- `PATCH /sessions/:id`
- `GET /health`
- `GET /ready`

### collab-service

- WebSocket upgrade endpoint on service host/port
- `GET /health`
- `GET /ready`

### execution-service

- `POST /execute` with body:
  - `{ code: string, language: "python" | "javascript" }`
- `GET /result/:jobId`
  - status values include: `waiting`, `active`, `completed`, `failed`
  - final payload includes `stdout`, `stderr`, `error` fields where applicable
- `GET /health`
- `GET /ready`

---

## Code Execution Security Model

Execution pipeline protections include:

- Language allowlist (`python`, `javascript`)
- Code size limits
- Timeouts
- Docker isolation with constraints (memory/CPU/process/file/network restrictions)
- Output caps to prevent unbounded growth
- Queue abuse controls (rate limits and pending job limits)
- Ownership checks for result access

---

## Development Commands

## Root (workspace)

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
pnpm check
pnpm format
pnpm format:write
```

### Per-app commands (high frequency)

- `pnpm --filter @repo/auth-service dev`
- `pnpm --filter @repo/session-service dev`
- `pnpm --filter @repo/collab-service dev`
- `pnpm --filter @repo/execution-service dev`
- `pnpm --filter @repo/execution-service dev:worker`
- `pnpm --filter @repo/frontend dev`

---

## Quality Gates and Validation

Workspace validation command:

```bash
pnpm check
```

This runs:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm build`

> Current repository snapshot may include pre-existing failures unrelated to README/documentation edits. Address service-level type/runtime issues before treating workspace validation as green.

---

## QA Package Included in Repo

The repository includes a large collaborative-editing QA kit:

- **`START_HERE.md`**: onboarding entry point
- **`README_QA_VALIDATION.md`**: QA package overview
- **`COLLAB_VALIDATION_GUIDE.md`**: deep validation procedures
- **`QA_QUICK_REFERENCE.md`**: condensed checklist
- **`IMPLEMENTATION_GUIDE.md`**: setup + walkthrough
- **`TEST_SCRIPT_BROWSER_CONSOLE.js`**: browser-side automated checks
- **`METRICS_MONITORING.ts`**: optional monitoring integration example
- **`QA_PACKAGE_OVERVIEW.md`**: high-level summary

Use these docs when validating synchronization quality, conflict resolution behavior, resilience, and performance.

---

## Troubleshooting

### `pnpm: command not found`

```bash
corepack enable
```

### Services fail to boot

- Check Docker infra (`docker compose ps`)
- Verify `.env` has required values
- Ensure ports 3001-3004/5173/5432/6379 are not already occupied

### Prisma/session-service issues

```bash
pnpm --filter @repo/session-service db:generate
pnpm --filter @repo/session-service db:migrate
```

### Execution jobs never finish

- Ensure worker is running: `pnpm --filter @repo/execution-service dev:worker`
- Verify Docker runner images exist:
  - `code-runner-python`
  - `code-runner-javascript`

### Collaboration connection problems

- Confirm frontend points to correct `VITE_WS_URL`
- Confirm valid session/token settings used by collab-service auth path
- Check `/health` and `/ready` on collab-service

---

## Production Notes

- Front services with TLS and a controlled ingress/gateway
- Keep Redis/Postgres on private network segments
- Apply auth/rate limits at edges and services
- Rotate JWT keys/secrets periodically
- Centralize logs/metrics/alerts before production rollout

---

## License

No license file is currently defined in this repository.
