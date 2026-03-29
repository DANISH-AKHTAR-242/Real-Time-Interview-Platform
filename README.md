# Real-Time-Interview-Platform

This repository is a `pnpm` monorepo with multiple packages under `apps/*` and shared config packages under `packages/*`.

## Is it okay to have multiple packages and node_modules?

Yes. This is expected in a production monorepo:

- `apps/*` contains independently deployable services.
- `packages/*` contains shared lint/ts/prettier settings.
- `pnpm` uses a content-addressed store and symlinks, so dependency layout can look different from npm/yarn.

## Services

- `auth-service` (Fastify + Redis + JWT)
- `session-service` (Fastify + Prisma + PostgreSQL)
- `collab-service` (WebSocket + Yjs, token/session authorization)
- `frontend` (Vite + React + Monaco + Yjs)

## Production Hardening Included

- stricter environment parsing and safer defaults
- explicit readiness endpoints (`/ready`) in backend services
- graceful shutdown handling (`SIGINT`, `SIGTERM`)
- security response headers on HTTP services
- auth request throttling for login/register
- websocket auth validation with timeout handling
- pinned PostgreSQL major version in Docker (`postgres:16-alpine`)

## Local Infrastructure (PostgreSQL + Redis)

Start dependencies:

```bash
docker compose up -d
```

Stop dependencies:

```bash
docker compose down
```

Check status:

```bash
docker compose ps
```

## Environment Setup

Copy template:

```bash
cp .env.example .env
```

Generate RSA keypair for JWT (example):

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Use the key contents for `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`.

## Run Services (Production-Like)

Install dependencies:

```bash
pnpm install
```

Build all packages:

```bash
pnpm build
```

Run the local quality gate (same checks as CI):

```bash
pnpm check
```

Run services with explicit ports:

```bash
# auth-service
PORT=3001 pnpm --filter=@repo/auth-service start

# session-service
PORT=3003 pnpm --filter=@repo/session-service start

# collab-service
PORT=3002 pnpm --filter=@repo/collab-service start

# frontend preview (optional)
pnpm --filter=@repo/frontend build
pnpm --filter=@repo/frontend preview
```

## CI (GitHub Actions)

- Workflow: `.github/workflows/ci.yml`
- Triggers: pushes and pull requests to `main`
- Checks: dependency install, Prisma client generation, `pnpm check`

## Health / Readiness Endpoints

- `auth-service`: `/health`, `/ready`
- `session-service`: `/health`, `/ready`
- `collab-service`: `/health`, `/ready`

Use readiness endpoints for deployment probes.
