# Real-Time Interview Platform

Production-oriented monorepo for live coding interviews with collaborative editing, auth/session management, and secure code execution.

## What This Project Provides

- Real-time collaborative editor built on Monaco + Yjs.
- JWT-based authentication service.
- Session lifecycle service backed by PostgreSQL + Prisma.
- WebSocket collaboration service with session/user authorization.
- Sandboxed code execution service using queue + worker + Docker isolation.
- Monorepo workflow with pnpm workspaces and Turbo.

## Monorepo Layout

```text
apps/
	auth-service/        Fastify auth API + Redis session store
	session-service/     Fastify session API + Prisma + Postgres
	collab-service/      WebSocket/Yjs real-time collaboration
	execution-service/   Fastify enqueue/result API + BullMQ worker + Docker sandbox
	frontend/            Vite + React + Monaco client

packages/
	eslint-config/       Shared lint config
	prettier-config/     Shared prettier config
	tsconfig/            Shared TypeScript config presets
```

## Architecture Overview

1. User logs in or registers via auth-service and gets JWT.
2. Frontend connects to collab-service over WebSocket with session params (and token when required).
3. Frontend can submit code to execution-service.
4. execution-service API enqueues jobs to Redis-backed BullMQ.
5. execution worker runs code in constrained Docker containers.
6. Frontend polls result endpoint and displays stdout, stderr, and runtime errors.

## Services and Ports

| Component                | Default Port | Purpose                                        |
| ------------------------ | ------------ | ---------------------------------------------- |
| frontend                 | 5173         | Interview UI + Monaco editor                   |
| auth-service             | 3001         | JWT auth and user/session identity             |
| collab-service           | 3002         | Real-time collaborative editing over WebSocket |
| session-service          | 3003         | Interview session CRUD and status              |
| execution-service API    | 3004         | Enqueue execution + fetch result               |
| execution-service worker | n/a          | Asynchronous code execution processor          |
| postgres (docker)        | 5432         | Session persistence                            |
| redis (docker)           | 6379         | Auth/session cache and execution queue         |

## Tech Stack

- Runtime: Node.js + TypeScript
- HTTP APIs: Fastify
- Realtime: ws, y-websocket, yjs, y-monaco
- Database: PostgreSQL + Prisma
- Queue: BullMQ + ioredis
- Frontend: Vite + React + Monaco Editor
- Tooling: pnpm workspaces + Turbo + ESLint + Prettier

## Prerequisites

- Node.js 18+
- pnpm 9+
- Docker Desktop (or Docker Engine + Compose)
- OpenSSL (for generating JWT keypair)

## Quick Start

### 1) Install dependencies

```bash
pnpm install
```

### 2) Start infrastructure

```bash
docker compose up -d
docker compose ps
```

### 3) Create environment file

macOS/Linux:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 4) Generate JWT keypair (one-time)

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Copy key contents into `.env` values for `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`.

### 5) Run database migration/generation

```bash
pnpm --filter @repo/session-service db:generate
pnpm --filter @repo/session-service db:migrate
```

### 6) Build runner images for execution sandbox

```bash
docker build -f apps/execution-service/src/docker/Dockerfile.python -t code-runner-python .
docker build -f apps/execution-service/src/docker/Dockerfile.javascript -t code-runner-javascript .
```

### 7) Start services (development)

Use separate terminals:

```bash
pnpm --filter @repo/auth-service dev
pnpm --filter @repo/session-service dev
pnpm --filter @repo/collab-service dev
pnpm --filter @repo/execution-service dev
pnpm --filter @repo/execution-service dev:worker
pnpm --filter @repo/frontend dev
```

## Environment Variables

See `.env.example` for defaults and comments.

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

- `JWT_PRIVATE_KEY` (required)
- `JWT_PUBLIC_KEY` (required)
- `JWT_EXPIRES_IN`
- `MAX_AUTH_ATTEMPTS_PER_MINUTE`

### collab-service

- `JWT_PUBLIC_KEY` (required)
- `SESSION_SERVICE_URL`
- `ALLOW_MOCK_SESSION_ACCESS`
- `SESSION_SERVICE_TIMEOUT_MS`
- `MAX_PAYLOAD_BYTES`

### execution-service

- `REDIS_URL`
- `WORKER_CONCURRENCY`

### frontend

- `VITE_WS_URL`
- `VITE_EXECUTION_API_URL` (optional; if empty, Vite proxy is used)

## API Surface

### auth-service

- `POST /register`
- `POST /login`
- `GET /me` (requires bearer token)
- `GET /health`
- `GET /ready`

### session-service

- `POST /sessions`
- `GET /sessions/:id`
- `PATCH /sessions/:id`
- `GET /health`
- `GET /ready`

### collab-service

- WebSocket upgrade endpoint on the same host/port.
- HTTP endpoints:
  - `GET /health`
  - `GET /ready`

### execution-service

- `POST /execute`
  - Body: `{ code: string, language: "python" | "javascript" }`
  - Response: `202 { jobId }`
- `GET /result/:jobId`
  - Response includes one of status values: `waiting`, `active`, `completed`, `failed`
  - For terminal execution outcomes, inspect `result.stdout`, `result.stderr`, and `result.error`
- `GET /health`
- `GET /ready`

Note: execution result access is owner-scoped. The same requester identity is expected when polling.

## Frontend Behavior

Frontend includes:

- Collaborative editor connection controls.
- Run Code action for Python/JavaScript.
- Polling result flow with output panels:
  - stdout
  - stderr
  - errors

For local development, Vite proxies `/execute` and `/result/*` to `http://localhost:3004`.

## Execution Security Model

execution-service is hardened for hostile input:

- Language whitelist: python, javascript.
- Max code size: 16 KiB.
- Hard timeout: 5s max.
- Docker constraints:
  - memory 256MB
  - CPU capped
  - no network
  - read-only FS
  - PID/process limits
  - file-size and open-file limits
- Output capture cap to prevent unbounded memory use.
- Queue abuse controls:
  - per-user/IP rate limits
  - global pending queue cap
  - per-owner pending job cap
- Result ownership checks to prevent cross-user probing.

## Local Quality Gates

From repository root:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm check
```

## QA and Validation Assets

The repository includes a full QA package:

- `COLLAB_VALIDATION_GUIDE.md`
- `QA_QUICK_REFERENCE.md`
- `TEST_SCRIPT_BROWSER_CONSOLE.js`
- `README_QA_VALIDATION.md`
- `IMPLEMENTATION_GUIDE.md`
- `QA_PACKAGE_OVERVIEW.md`

Use these docs to validate collaborative editing behavior, resilience, and performance.

## CI

- GitHub Actions workflow runs workspace validation checks.
- Use `pnpm check` locally before creating PRs.

## Troubleshooting

### Services fail to start

- Confirm Docker dependencies are healthy:

```bash
docker compose ps
```

- Verify required env vars are present (`JWT_*`, `DATABASE_URL`, `REDIS_URL`).

### Prisma errors

- Regenerate client and run migrations:

```bash
pnpm --filter @repo/session-service db:generate
pnpm --filter @repo/session-service db:migrate
```

### Execution jobs never complete

- Ensure worker is running:

```bash
pnpm --filter @repo/execution-service dev:worker
```

- Ensure runner images exist (`code-runner-python`, `code-runner-javascript`).

### 404/401 style result polling issues

- Poll with the same requester identity used when creating the job.

## Production Notes

- Put services behind an API gateway or ingress with TLS.
- Do not expose internal services directly without auth/rate controls.
- Keep Redis and Postgres private to trusted network segments.
- Rotate JWT keys and secrets regularly.

## License

No license file is currently defined in this repository.
