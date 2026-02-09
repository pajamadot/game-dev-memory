# Game Dev Memory

Project memory infrastructure for game development AI agents. Enables agents to store, retrieve, and evolve knowledge from game dev projects.

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
Cloudflare Workers API powered by Hono. Handles memory CRUD, semantic search, and agent-to-agent knowledge exchange. Uses D1 for structured data and KV for fast retrieval.

### `skills/` - Agent Skills
Claude Code skills that power the self-evolving memory system. The `memory-evolver` skill continuously analyzes, optimizes, and grows the knowledge base.
