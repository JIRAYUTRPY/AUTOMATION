# UI Inspector & Hybrid Automated UI Testing Platform

Monorepo for a platform that discovers public website UI elements, lets users design test cases,
and runs **explicitly approved** Playwright tests (read-only by default).

## Status: Milestone 1 - scaffold only

Implemented: monorepo layout, strict TypeScript, ESLint/Prettier/Vitest setup, validated
environment config with server-side upper bounds, redacting structured logger, web app skeleton
with `/api/health`, worker skeleton with `/health` and `/health/ready` (launches Chromium),
Dockerfiles and Docker Compose.

**Not implemented yet:** database/migrations, projects, URL validation, crawler, scanner, test
builder, test runner, reports, egress restriction. Nothing here claims those work.

## Layout

| Path              | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `apps/web`        | Next.js (App Router) dashboard + API routes                    |
| `apps/worker`     | Node worker that owns Playwright/Chromium (scanner, runner)    |
| `packages/shared` | Zod config, structured logger, URL redaction (shared by both)  |

The web app never launches a browser. Only the worker does, in its own container.

## Run locally

```bash
cp .env.example .env
pnpm install            # generates pnpm-lock.yaml on first run - commit it
pnpm check              # typecheck + lint + format check + tests
pnpm dev:web            # http://localhost:3000
pnpm dev:worker         # http://localhost:4001/health
```

## Run with Docker Compose

```bash
cp .env.example .env
docker compose up --build
curl http://localhost:3000/api/health
```

- `web` publishes `APP_PORT` (default 3000). `worker` publishes nothing.
- `web` and `worker` share the `app-data` volume (`/data`: SQLite file and artifacts). Both run as
  uid/gid 10001 so they can write to it.
- `backend` is an `internal` network (web <-> worker only). `egress` gives the worker internet.

## Known limitations / required next steps

- **Egress is not restricted yet.** The `egress` network allows any outbound destination from the
  worker. Requirement FR-02 needs network-level blocking of loopback, private, link-local and cloud
  metadata ranges (e.g. an egress proxy or firewall rules). Do not scan untrusted targets before
  that exists; application-level URL validation alone is insufficient.
- Playwright version is pinned to `1.55.0` and the worker image tag `v1.55.0-noble` must match it.
  Bump both together.
- If Chromium fails to start under Docker's default seccomp profile, use Playwright's recommended
  seccomp profile. Do not disable the Chromium sandbox.
- The worker runs TypeScript through `tsx`; there is no compiled build output.
