# MVP Scope Checklist

This is the smallest useful slice of the system that matches the intended end-to-end flow: org-scoped project memories + retrieval + evolver audit trail.

## Phase 0: Documentation (now)

- [x] Architecture overview: `docs/architecture.md`
- [x] MVP checklist: `docs/mvp-scope.md`

## Phase 1: Neon + Hyperdrive (API persistence)

- [x] Neon Postgres via Hyperdrive in `api/` (no D1)
- [x] Add SQL migrations for Postgres (single source of truth)
- [x] Keep the API route shapes stable (`/api/projects`, `/api/memories`, `/api/evolve`)
- [x] Remove D1-specific code and config in `api/wrangler.jsonc`

## Phase 2: Clerk Auth + Org Scoping

- [ ] Verify Clerk JWTs in the Worker
- [ ] Derive `org_id` and enforce org scoping in every query
- [ ] Add `org_id`, `created_by`, `updated_by` columns to tables
- [ ] Ensure cross-org data access is impossible (tests)

## Phase 3: Web Dashboard v0

- [ ] Clerk sign-in + org selection
- [ ] Project list + create/edit/delete
- [ ] Memory explorer (search + filters + create/edit/delete)
- [ ] Evolution feed (read-only) + "run evolve" button (optional)

## Phase 4: Evolver Integration

- [ ] Run `skills/memory-evolver` against the deployed API with auth
- [ ] Decide the "session boundary" hook for running evolution (end-of-session is fine)
- [ ] Add safe-only mutations first (prune stale, boost confidence, mark orphaned)
- [ ] Make review mode the default for high-risk operations

## Phase 5: Unreal Example Ingestion (thin slice)

- [ ] Add an `artifacts` table (metadata only)
- [ ] Ingest UE log snippets as `memories` with repro context
- [ ] Store `.utrace` as an artifact pointer, not raw content in DB
- [ ] Add a derived summary memory from a trace (manual at first)

## Exit Criteria (MVP is "done" when)

- A Clerk org user can create a project and write memories under it.
- Another member of the same org can retrieve those memories by search + filters.
- The evolver can record `evolution_events` and the UI can display them.
- No data can be accessed across org boundaries.
