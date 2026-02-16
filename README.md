# Game Dev Memory

Multi-tenant memory infrastructure for game development teams and agents.

This project is built around one core rule:

- The **Memory API** is the source of truth.
- MCP is a thin compatibility layer on top.
- Web, CLI, and agents all use the same API and data model.

## Status Snapshot (February 16, 2026)

### Production endpoints

- Web: `https://game-dev-memory.pajamadot.com`
- API: `https://api-game-dev-memory.pajamadot.com`
- MCP + OAuth issuer: `https://mcp-game-dev-memory.pajamadot.com`
- Agent host: `https://game-dev-agent.pajamadot.com`

### Current release state

- Worker/API latest deployed version: `e69d4774-32f3-400f-81a2-ea20afd2b586`
- CLI latest npm package: `@pajamadot/pajama@0.1.10`
- Last end-to-end verification: February 16, 2026 (local build + Playwright e2e smoke)
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
- EverMemOS-inspired derivation pipeline (/api/memories/:id/derive) for event logs + foresight memories.
- Time-aware foresight lane (/api/memories/foresight/active) for deadline/planning retrieval.
- Daily research digests ingested into memory via cron.
- Live end-to-end smoke suite for web/API/MCP/agent/CLI (Playwright + `npx @pajamadot/pajama`).

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

## Production Quickstart

### Install CLI

```powershell
npm i -g @pajamadot/pajama
pajama --version
```

Or run without installing (downloads binary on first run):

```powershell
npx -y @pajamadot/pajama --version
```

### Login (OAuth PKCE)

```powershell
pajama login
```

This stores an API key locally (same auth used by MCP clients). You can always override with:

```powershell
pajama --token "gdm_..." projects list
```

### Create a project and record memory

```powershell
pajama projects create --name "My Unreal Project" --engine unreal --description "UE5 build + performance notes"
```

```powershell
pajama memories create --project-id "<project_uuid>" --category "build" --title "UE5 packaging failed" --content "Repro steps + fix"
```

### Progressive retrieval (cheap index hits -> fetch full records)

Index search:

```powershell
pajama memories search-index --project-id "<project_uuid>" --query "packaging error" --limit 5
```

Then fetch the records you want:

```powershell
pajama memories batch-get --ids "<uuid1>,<uuid2>" --no-content
```

### Upload a large file (10GB+ capable via multipart) and link it to a memory

```powershell
pajama assets upload --project-id "<project_uuid>" --path "C:\\logs\\build.zip" --memory-id "<memory_uuid>"
```

### Ask the agent (retrieval-first)

```powershell
pajama agent ask --project-id "<project_uuid>" --query "What changed in build times this week?" --dry-run`r`npajama agent ask --project-id "<project_uuid>" --query "What changed in build times this week?" --dry-run --diagnostics
```

Remove `--dry-run` to request synthesis when LLM is configured on the Worker.

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
- `research/evermemos.md`
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

### Progressive-disclosure retrieval model

Most agent flows should not pull full memory bodies immediately. We support a 2-step retrieval pattern:

1. Search a compact index (id/title/excerpt/tokens).
2. Batch fetch full records only for selected IDs.

This is implemented in:

- `api/src/core/memoryRetrieval.ts`
- API routes: `/api/memories/search-index`, `/api/memories/batch-get`, `/api/memories/timeline`
- MCP tools: `memories.search_index`, `memories.batch_get`, `memories.timeline`
- CLI commands: `pajama memories search-index|batch-get|timeline`

Providers/strategies are pluggable (`memories_fts`, `recent_activity`) and can be extended without changing clients.

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

### Asset design (large file storage)

Large binary objects live in R2; Postgres stores the metadata and upload state:

- `assets`: one row per object (status, size, sha256, r2_key, upload_id, etc.)
- `asset_upload_parts`: part ETags for resumable completion

Assets can be linked to memories via `entity_links` using `/api/memories/:id/attach-asset`.

### Artifact + PageIndex design (long document retrieval)

Artifacts are for documents and text corpora that benefit from chunking + indexing:

- `artifacts`: document metadata + R2 location (single or chunked)
- `artifact_chunks`: extracted text chunks (optional)
- `artifacts.metadata.pageindex`: hierarchical index (PageIndex-TS port)

Core endpoints:

- `POST /api/artifacts/:id/pageindex` build/rebuild an index
- `GET /api/artifacts/:id/pageindex/query?q=...` retrieve best matching nodes
- `GET /api/artifacts/:id/pageindex/node/:nodeId` fetch one node + breadcrumbs

This enables agents to cite doc sections as evidence without vector DB dependencies.

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
- Binary distribution:
  - upload binaries to R2 under `releases/pajama/vX.Y.Z/...` (`scripts/release-pajama.ps1`)
  - the API serves them under `/downloads/pajama/vX.Y.Z/...`
  - the npm package downloads the right binary at install time (and refreshes on version mismatch)
- Current notable commands:
  - `pajama projects ...`
  - `pajama memories list|search-index|batch-get|timeline|create`
  - `pajama assets ...`
  - `pajama evolve policy|arena-*`
  - `pajama agent status`
  - `pajama agent ask`

### PageIndex-TS (`packages/pageindex-ts/`)

- Worker-friendly TypeScript port inspired by `VectifyAI/PageIndex` (MIT).
- Used to build hierarchical indexes for artifacts and enable 鈥渄ocument node鈥?retrieval without a vector DB.
- Research notes and port status:
  - `research/pageindex.md`
- `research/evermemos.md`
  - `packages/pageindex-ts/PORT_STATUS.md`

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
- Agent routes include deterministic fallback synthesis to avoid empty conversation responses.`r`n- Worker-side ephemeral retrieval caches now reduce repeated query latency (tenant/project/query scoped).`r`n- `/api/agent/ask` exposes optional `diagnostics` payload (cache hit state + stage timings) for live tuning.`r`n- Use `./scripts/benchmark-agent-retrieval.ps1` to compare cache on/off and retrieval mode latency against production.

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

- Web: `http://localhost:3000` (Next dev)
- API: `http://localhost:8787` (Wrangler dev)
- Playwright local E2E: `http://localhost:3040` (configurable via `PLAYWRIGHT_BASE_URL`)

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

- Expand automated end-to-end coverage to include Clerk login automation and streaming session flows.
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
