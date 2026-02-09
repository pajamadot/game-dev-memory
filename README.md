# Game Dev Memory

Project memory infrastructure for game development AI agents. Enables agents to store, retrieve, and evolve knowledge from game dev projects.

## Docs

- `docs/architecture.md` - Target end-to-end architecture (Web + API + Neon/Hyperdrive + Clerk)
- `docs/roadmap.md` - Evolution plan / next milestones
- `docs/mvp-scope.md` - MVP checklist
- `docs/deployment.md` - Vercel + Workers deployment wiring (CLI, correct root dirs)
- `docs/api.md` - Current API usage (API keys, sessions, artifacts, MCP)
- `docs/cli.md` - `pajama` CLI (Rust) + OAuth login flow
- `docs/e2e.md` - E2E UX tests (Playwright) + optional cloud runner

## Architecture

```
game-dev-memory/
  web/          - Next.js frontend (dashboard, memory explorer, project views)
  api/          - Cloudflare Workers API (memory storage, retrieval, evolution)
  skills/       - Agent skills (memory-evolver, etc.)
```

## Quick Start

```bash
npm install
npm run dev
```

- **Web**: http://localhost:3000
- **API**: http://localhost:8787

## Packages

### `web/` - Frontend Dashboard
Next.js app for browsing and managing game dev memories. Visualize project knowledge graphs, search memories, and configure agent behaviors.

### `api/` - Memory API
Cloudflare Workers API powered by Hono. Handles memory CRUD, retrieval, and evolution.

Persistence is Neon Postgres via Cloudflare Hyperdrive.

Auth model:
- Web uses Clerk for login + org invites.
- Web can dispatch API keys at `/settings/tokens`.
- Agents/services use `Authorization: Bearer gdm_...`.
- MCP (`/mcp`) is a thin tool layer over the Memory API, with OAuth endpoints for clients that prefer PKCE.

### `skills/` - Agent Skills
Claude Code skills that power the self-evolving memory system. The `memory-evolver` skill continuously analyzes, optimizes, and grows the knowledge base.
