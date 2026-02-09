# Game Dev Memory

Project memory infrastructure for game development AI agents. Enables agents to store, retrieve, and evolve knowledge from game dev projects.

## Docs

- `docs/architecture.md` - Target end-to-end architecture (Web + API + Neon/Hyperdrive + Clerk)
- `docs/mvp-scope.md` - MVP checklist
- `docs/deployment.md` - Vercel + Workers deployment wiring (root dirs + required GitHub secrets)

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

Persistence is Neon Postgres via Cloudflare Hyperdrive (multi-tenant org + project scoping via Clerk).

### `skills/` - Agent Skills
Claude Code skills that power the self-evolving memory system. The `memory-evolver` skill continuously analyzes, optimizes, and grows the knowledge base.
