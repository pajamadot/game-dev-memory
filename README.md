# Game Dev Memory

Multi-tenant memory infrastructure for game development teams and agents.

This project is built around one core rule:

- The **Memory API** is the source of truth.
- MCP is a thin compatibility layer on top.
- Web, CLI, and agents all use the same API and data model.

## Status Snapshot (February 14, 2026)

### Production endpoints

- Web: `https://game-dev-memory.pajamadot.com`
- API: `https://api-game-dev-memory.pajamadot.com`
- MCP + OAuth issuer: `https://mcp-game-dev-memory.pajamadot.com`
- Agent host: `https://game-dev-agent.pajamadot.com`

### Current release state

- Worker/API latest deployed version: `0b64b801-77a3-4ad7-bc38-10db43ce5b38`
- CLI latest npm package: `@pajamadot/pajama@0.1.8`
- CLI binary download prefix:
  - `https://api-game-dev-memory.pajamadot.com/downloads/pajama/v{version}/{file}`
- DB backend: Neon Postgres via Cloudflare Hyperdrive
  - Hyperdrive config ID: `bf4313a26dc64a7080f23b9932a4c8a0`
- File storage: Cloudflare R2 bucket `game-dev-memory`

### What is already working end-to-end

- Clerk-authenticated web app for org/user scoped memory operations.
- API key system for service/agent access.
- OAuth PKCE for MCP/CLI login.
- Project/session/memory CRUD + retrieval.
- Progressive-disclosure memory retrieval (`search-index`, `batch-get`, `timeline`, provider discovery).
- Large file multipart upload to R2 (10GB+ capable with multipart part sizing).
- Artifact indexing with PageIndex (TypeScript port) and document-node retrieval.
- Streaming agent sessions (`agent-pro`) backed by Cloudflare Sandbox.
- Deterministic fallback answers when LLM synthesis fails or is unavailable.
- Retrieval evolution arena with project policy materialization and campaign mode.
- Daily research digests ingested into memory via cron.

## E2E Tests

Local web UX smoke (starts `web` on `http://localhost:3040`):

```powershell
npm run e2e
```

Deployed/live smoke (web + API + MCP + agent host + CLI via `npx`):

```powershell
./scripts/e2e-live.ps1
```

Optionally enable authenticated checks (MCP tools/list, memory providers, CLI query):

```powershell
./scripts/e2e-live.ps1 -ApiToken "<your_api_key>"
```

## Why This Exists

Game dev teams generate high-value operational knowledge that gets lost across:

- coding sessions,
- build failures,
- playtest outcomes,
- profiling traces,
- ad-hoc chat decisions.

This system converts those events into durable, queryable, evidence-linked memory:

- shared project memory for org collaboration,
- private personal memory for individuals,
- retrieval and evolution loops to continuously improve relevance and latency.

## Research -> Design -> Implementation

## 1) Research Inputs

Primary research artifacts live in:

- `research/agent-memory.md`
- `research/ue-memory.md`
- `research/pageindex.md`
- `research/new-projects.md`
- `web/src/content/research/*` (published versions)

Key themes from research that directly shaped implementation:

- Memory must be **evidence-first**, not only generated summaries.
- Long-term utility requires explicit **memory lifecycle operations** (create/update/quarantine/supersede).
- Retrieval quality depends on **policy selection**, not one static query strategy.
- Cost and latency improve when retrieval is **budgeted and mode-based** (`fast`, `balanced`, `deep`).
- Procedural and operational memory is first-class for dev workflows.

These are reflected in current API behaviors and schema fields.

## 2) System Design

### Tenancy and access model

- All core tables are tenant scoped by `tenant_type` + `tenant_id`.
  - `tenant_type`: `org` or `user`
  - `tenant_id`: org id or user id
- Shared org memory and private user memory are enforced server-side.
- API accepts:
  - Clerk JWTs (web flows)
  - API keys (`gdm_...`) for agents/services
  - OAuth token flows for MCP-compatible clients

### Memory model

Core memory object includes:

- content fields (`title`, `content`, `tags`, `category`)
- confidence and usage signals (`confidence`, `access_count`)
- lifecycle quality flags (`state`, `quality`)
- provenance (`source_type`, `session_id`, actor metadata)
- context JSON for structured operational metadata

Memory lifecycle events are captured in `memory_events` for auditability.

### Evidence model

Two evidence classes are first-class:

- Assets (large files in R2, metadata in Postgres)
- Artifacts (document structures + optional PageIndex nodes)

Entity links connect memory <-> assets and other object relationships.

### Retrieval design

Memory retrieval supports three modes in `api/src/core/memories.ts`:

- `fast`: direct FTS path, low latency
- `balanced`: FTS + fallback blending
- `deep`: expanded candidate retrieval + contextual neighbors

Document retrieval uses PageIndex nodes when enabled (`hybrid`/`documents` paths).

### Evolution design

Arena-based retrieval optimization:

- replay agent sessions as weak supervision
- evaluate multiple retrieval arms
- score latency + evidence recall/precision/diversity
- persist outcomes to `evolution_events`
- materialize active project policy in `project_retrieval_policies`

This policy is used in runtime auto mode for agent requests.

### Agent design

Two agent modes:

- `agent`: retrieval-first route with optional synthesis
- `agent-pro`: streaming, tool-using sandbox agent

Both now guarantee usable response payloads with deterministic fallback text when synthesis fails.

### MCP design

MCP endpoint is intentionally thin:

- It maps tool calls to underlying Memory API behavior.
- It does not duplicate domain logic.
- This keeps one source of truth for auth, tenancy, and schema semantics.

## 3) Implementation Status by Layer

### Web (`web/`)

- Next.js app on Vercel.
- Clerk auth integration.
- Pages for projects, memories, assets, research, evolve dashboards, and streaming agent sessions.
- Documentation pages for CLI and skills.

### API (`api/`)

- Cloudflare Worker + Hono routing.
- Auth middleware supports Clerk and API keys.
- Core routes:
  - `/api/projects`
  - `/api/memories`
  - `/api/sessions`
  - `/api/assets`
  - `/api/artifacts`
  - `/api/evolve`
  - `/api/agent`
  - `/api/agent-pro`
  - `/api/tokens`
  - `/api/oauth`
- Public binary distribution route:
  - `/downloads/pajama/...`

### Database schema (migrations applied)

Migrations in `api/migrations/`:

- `0001_init.sql`: projects/memories/evolution_events base
- `0002_tenant_sessions_artifacts.sql`: tenant scoping + sessions/artifacts/entity links
- `0003_identity_tokens_oauth.sql`: app identity, API tokens, OAuth tables
- `0004_assets_multipart.sql`: asset storage + multipart upload tracking
- `0005_memory_state_fts.sql`: memory state/quality + FTS
- `0006_memory_events.sql`: memory event log
- `0007_agent_perf_indexes.sql`: agent query performance indexes
- `0008_evolve_arena_indexes.sql`: arena event lookup indexes
- `0009_project_retrieval_policies.sql`: materialized retrieval policy table

### CLI (`pajama/` + `packages/pajama/`)

- Rust CLI with OAuth login and API-key operation.
- npm-distributed installer package for prebuilt binaries.
- Current notable commands:
  - `pajama projects ...`
  - `pajama memories list|search-index|batch-get|timeline|create`
  - `pajama assets ...`
  - `pajama evolve policy|arena-*`
  - `pajama agent status`
  - `pajama agent ask`

### Research pipeline

- Worker cron (`0 9 * * *`) triggers daily digest generation.
- Current digest families:
  - unreal-agents
  - agent-memory
  - new-projects
- Digests are stored back into project memory for retrieval and audit.

## End-to-End Flows

### Flow A: Web user (org member)

1. Sign in with Clerk.
2. Web calls API with Clerk token.
3. API resolves tenant scope and enforces project ownership.
4. User creates/queries memory and linked evidence.
5. Agent session responses cite evidence IDs.

### Flow B: Service agent using API key

1. Create API key from web settings.
2. Agent calls API using `Authorization: Bearer gdm_...`.
3. Same data and routing semantics as web.
4. Can operate non-interactively across memory/assets/evolve endpoints.

### Flow C: CLI OAuth

1. `pajama login` starts OAuth PKCE.
2. Browser consent flow completes against OAuth endpoints.
3. Token saved locally by CLI.
4. CLI commands operate directly against memory API.

### Flow D: Streaming agent (`agent-pro`)

1. User posts message to `/api/agent-pro/sessions/:id/continue`.
2. Worker launches sandbox runner with scoped env.
3. Runner performs retrieval/tool calls/synthesis.
4. Worker streams progress events (SSE).
5. Assistant response is persisted with evidence references.
6. If synthesis fails, deterministic fallback answer still returns.

### Flow E: Evolution loop

1. Arena run or campaign executed via API/CLI.
2. Session traces are evaluated across retrieval arms.
3. Winner policies are persisted and materialized.
4. Runtime auto mode consumes policy for future agent requests.

## Performance and Robustness Notes

- Retrieval mode routing (`fast`, `balanced`, `deep`) controls latency/recall tradeoffs.
- Additional indexes added for session/memory/evolution hot paths.
- Arena campaign mode supports bounded multi-project evaluation.
- Asset multipart path enforces part sizing and max part count safety.
- Agent routes now include deterministic fallback synthesis to avoid empty conversation responses.

## Security and Compliance Posture

- No D1 dependency; Postgres only (Neon via Hyperdrive).
- Server-side tenant checks on all scoped routes.
- API token hashes stored server-side (not plaintext key storage).
- OAuth metadata and authorization endpoints for standards-compatible clients.
- Sensitive secrets are expected from deployment environment bindings, not committed values.

## Local Development

Prerequisites:

- Node.js 20+
- npm
- Rust toolchain
- Wrangler CLI logged in

Run web + API:

```bash
npm install
npm run dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:8787`

Apply DB migrations:

```bash
cd api
npm run db:migrate
```

Build all:

```bash
npm run build
```

## Deployment Model

- `web/` deploys via Vercel CLI.
- `api/` deploys via Wrangler CLI.
- API binds:
  - Hyperdrive: `HYPERDRIVE` -> `game-dev-memory-neon-db`
  - R2: `MEMORY_BUCKET` -> `game-dev-memory`

Detailed runbook:

- `docs/deployment.md`

## Current Gaps and Next Priorities

- Expand automated end-to-end coverage (streaming UX + auth flows).
- Add structured retrieval benchmarking dashboards (quality + latency trends).
- Improve CLI cross-platform binary matrix beyond current Windows x64 default path.
- Continue hardening memory curation policies (quarantine, dedupe, decay, promotion).
- Expand agent tooling ergonomics while preserving Memory API as the single source of truth.

## Core Documentation

- `docs/architecture.md`
- `docs/api.md`
- `docs/cli.md`
- `docs/deployment.md`
- `docs/e2e.md`
- `docs/roadmap.md`
