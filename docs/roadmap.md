# Roadmap / Evolution Plan

This repo is intentionally iterative. We start with durable multi-tenant memory primitives (Neon + Hyperdrive + R2) and evolve ingestion, retrieval, and tooling in small safe steps.

## North Star

- Shared **project memory** for an org: every member and every agent can read/write within the org scope.
- Private **personal memory**: a separate scope, never visible to org members unless explicitly copied.
- "Auto sync your memory everywhere": web, CLI, and agents all talk to the same core Memory API.

## Next Milestones

### 1) Pajama CLI (Rust) + OAuth Login

Goal: a first-class developer tool for interacting with the Memory API from terminals and scripts.

- Implement a Rust CLI (`pajama/`) with OAuth PKCE login (Claude Code / Codex style loopback redirect).
- After login, store an API key locally and use it as `Authorization: Bearer gdm_...`.
- Add commands that cover the core workflows:
  - projects: list/create
  - memories: list/get/create
  - assets: upload/download/list (large file support)
- Publish an agent skill in-repo documenting how to use the CLI in agentic coding sessions.

Success criteria:

- A user can run `pajama login`, approve in the web UI, and immediately run `pajama projects list`.
- A user can upload a multi-GB asset via multipart and link it to a memory.

### 2) Scopes and Access Control Hardening

Currently we store token scopes but do not enforce them everywhere.

- Enforce scopes for REST routes and MCP tools (deny by default).
- Add explicit "org vs personal" selection guidance in UX.

### 3) Retrieval v1 (Postgres-native)

- Add Postgres FTS (tsvector) for memories and chunk text.
- Add hybrid retrieval later (pgvector) without introducing new infra until needed.

### 4) Ingestion v1 (Unreal Example)

- Add UE log ingestion helpers that summarize into memories and store raw files as assets.
- Keep raw ingestion optional; prefer derived summaries for the memory core.

