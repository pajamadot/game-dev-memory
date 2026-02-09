# Game Dev Memory: End-to-End Architecture

This repo is a multi-tenant memory system for game dev agent workflows. It ingests signals from dev sessions, normalizes them into durable org + project scoped records, supports fast retrieval for agents and humans, and runs a continuous "evolver" loop that improves memory quality over time.

This document describes the target architecture and the current implementation gaps.

## Goals

- Make agent sessions cumulative: decisions, bugs, fixes, perf investigations, and learnings should become queryable memory.
- Keep memories scoped by Clerk org and project, with explicit cross-project search as a separate mode.
- Start small (CRUD + search + evolution feed), then iterate towards richer ingestion (UE traces/logs) and better retrieval (hybrid + embeddings).

## Non-Goals (for MVP)

- Perfect ingestion automation from Unreal on day one.
- A separate vector database service.
- Full-blown knowledge graph UI.

## System Components

- `web/` (Next.js on Vercel)
- `api/` (Cloudflare Workers + Hono)
- DB: Neon Postgres via Cloudflare Hyperdrive
- Auth: Clerk (users + orgs)
- Optional storage later: Cloudflare R2 for large artifacts (logs, traces, screenshots), with metadata in Postgres
- `skills/` includes a local evolver runner (Node) for agentic coding sessions

## High-Level Flow

1. Ingest
- Agents and tools POST memories to `api/` with org + project scope.
- Large raw files are uploaded to R2 (future); API stores only metadata + pointers.

2. Retrieve
- Web UI and agents query via filters and full-text (MVP).
- Later: hybrid retrieval (full-text + vector) using Postgres `pgvector`.

3. Evolve
- Evolution runs inside agentic coding sessions (like this) or manually from the dashboard.
- Evolver reads system "signals", selects a gene (mutation strategy), applies a safe change set, and records an auditable evolution event.

## Data Model (Target)

Clerk provides org membership. The database stores `org_id` on every row and all queries must filter by `org_id`.

Tables (minimum viable):

- `projects`
- `memories`
- `evolution_events`

Tables (near-term additions):

- `artifacts`
- `memory_links` (optional, for explicit relationships)

### `projects`

- `id` (uuid)
- `org_id` (string, Clerk org id)
- `name`
- `engine` (`unreal` | `unity` | `godot` | `custom`)
- `description`
- `created_at`, `updated_at`
- `created_by`, `updated_by` (Clerk user id)

### `memories`

Core retrieval unit. A memory is human- and agent-readable, and should usually be derived from raw artifacts rather than storing huge blobs.

- `id` (uuid)
- `org_id`
- `project_id`
- `category` (`pattern` | `decision` | `bug` | `architecture` | `asset` | `lesson`)
- `title`
- `content`
- `tags` (jsonb array of strings)
- `context` (jsonb; build id, engine version, platform, file paths, repro steps)
- `confidence` (0..1)
- `access_count`
- `created_at`, `updated_at`
- `created_by`, `updated_by`

### `evolution_events`

Audit log for evolver actions and human edits.

- `id` (uuid)
- `org_id`
- `project_id` (nullable)
- `type` (`repair` | `optimize` | `innovate`)
- `parent_id` (nullable)
- `description`
- `changes` (jsonb)
- `result` (`success` | `failure` | `partial`)
- `created_at`
- `created_by` (nullable; system vs user)

### `artifacts` (planned)

References to raw inputs stored elsewhere. Examples: Unreal `.utrace`, `Saved/Logs`, crash dumps, CI logs, screenshots, build zips.

- `id` (uuid)
- `org_id`
- `project_id`
- `type` (`ue_trace` | `ue_log` | `build_log` | `crash_dump` | `screenshot` | `config_snapshot` | ...)
- `uri` (R2 key or external URL)
- `sha256` (optional)
- `metadata` (jsonb)
- `created_at`

## API Surface (Current + Target)

Current routes exist in:

- `api/src/routes/projects.ts`
- `api/src/routes/memories.ts`
- `api/src/routes/evolve.ts`

Target expectations:

- Every request is authenticated (Clerk).
- API derives `org_id` from the session token and enforces scope in DB queries.
- `project_id` remains a client-visible identifier but is always org-scoped server-side.

Endpoints (MVP):

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`

- `GET /api/memories?project_id=&category=&q=&limit=`
- `POST /api/memories`
- `GET /api/memories/:id`
- `PUT /api/memories/:id`
- `DELETE /api/memories/:id`

- `GET /api/evolve/signals`
- `GET /api/evolve/events?limit=`
- `POST /api/evolve/events`

Near-term additions:

- `POST /api/artifacts` (create artifact metadata, later generate signed upload URL)
- `GET /api/memories/:id/related`
- `POST /api/evolve/run` (server-triggered evolution cycle; optional)

## Retrieval Patterns (MVP -> v1)

MVP (fast to ship):

- Full-text `LIKE` search over `title` and `content`.
- Filters by `project_id`, `category`, `tags`.
- Sort by `updated_at` and boost by `access_count` and `confidence`.

v1:

- Postgres full-text search (tsvector + tsquery).
- Hybrid retrieval: full-text + embeddings via `pgvector`.
- Cross-project retrieval is explicit: `scope=org` vs `scope=project`.

## Evolution Model

Evolution is "ops for memory", not magic.

Inputs:

- System health signals from `GET /api/evolve/signals` (stale memories, low confidence, category gaps, recent failures).
- Optional project focus (`project_id`).

Process:

1. Select a gene (mutation strategy) from `skills/memory-evolver/assets/genes/genes.json`.
2. Optionally apply a known-good capsule from `skills/memory-evolver/assets/genes/capsules.json`.
3. Execute a bounded mutation (prune stale, boost confidence, mark orphaned, dedupe).
4. Record `evolution_events` and append to the local audit log (`skills/.../events.jsonl`).
5. Solidify: validate outcomes and save successful capsules for reuse.

Triggering:

- Primary: run inside agentic coding sessions (manual or end-of-session hook).
- Secondary: on-demand from the dashboard.
- Later: scheduled maintenance.

## Auth and Multi-Tenancy

Source of truth for identity:

- Clerk user id
- Clerk org id

Rules:

- All DB rows include `org_id`.
- Every query filters by `org_id`.
- Writes store `created_by` and `updated_by`.
- Cross-project search never crosses org boundaries.

## Infrastructure and Deployment

Web:

- Vercel deployment.
- Clerk env comes from `secrets/clerk.production.env` (do not commit real values long-term).

API:

- Cloudflare Workers deployed via `wrangler`.
- Hyperdrive binds a Neon connection string to a Workers binding.
- Neon connection info currently lives in `secrets/neondb.env` (do not commit real values long-term).

Implementation note: `api/wrangler.jsonc` binds a Hyperdrive configuration as `HYPERDRIVE`.
For local development, Wrangler emulates Hyperdrive using a local Postgres connection string via:
`WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`.
This should point at a local Postgres instance, not Neon.

## Unreal-Specific Ingestion (Example Roadmap)

Start with derived summaries, not raw gigabytes.

- Parse UE logs into `memories` (`category=bug`, `context` includes map, build id, callstack hash).
- Store UE Insights `.utrace` as `artifacts`, then persist summarized hot spots as `memories` (`category=pattern` or `lesson`).
- Record config snapshots as `artifacts` and extract diffs into `memories` (`category=decision`).
