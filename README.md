# Real-Time-Interview-Platform

## Local infrastructure (PostgreSQL + Redis)

Start dependencies:

```bash
docker compose up -d
```

Stop dependencies:

```bash
docker compose down
```

Copy env template:

```bash
cp .env.example .env
```

Service connection strings for local Node apps:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/interview_platform?schema=public`
- `REDIS_URL=redis://localhost:6379`

Optional health checks:

```bash
docker compose ps
```
