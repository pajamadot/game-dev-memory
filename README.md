# Game Dev Memory

Multi-tenant memory platform for game-dev teams and agents.

This repo provides:

- a web app for org/project memory operations,
- a Cloudflare Worker API as the core memory service,
- a thin MCP layer on top of the API,
- a Rust CLI (`pajama`) published to npm,
- an evolution loop that tunes retrieval based on real agent sessions.

## Production Endpoints

- Web: `https://game-dev-memory.pajamadot.com`
- API: `https://api-game-dev-memory.pajamadot.com`
- MCP + OAuth issuer: `https://mcp-game-dev-memory.pajamadot.com`
- Agent host (same worker): `https://game-dev-agent.pajamadot.com`

## How It Works End-to-End

1. User or agent authenticates.
- Web users sign in with Clerk.
- Service/agent clients use API keys (`gdm_...`).
- MCP clients can use OAuth PKCE via the MCP issuer.

2. API resolves tenant scope.
- Every request is scoped by `tenant_type` + `tenant_id` (`org` or `user`).
- Data access is enforced server-side at query time.

3. Memory and evidence are stored.
- Structured memory records live in Neon Postgres (via Hyperdrive).
- Large files/assets are stored in R2, with metadata + links in Postgres.

4. Retrieval runs through memory + optional docs.
- Memory search supports `fast`, `balanced`, `deep` modes.
- Document evidence is pulled from PageIndex artifact nodes when enabled.

5. Agent replies are generated.
- `/api/agent/*` provides retrieval-first and session-based chat routes.
- `/api/agent-pro/*` runs sandbox-backed streaming sessions.

6. Evolution loop tunes retrieval policy.
- Arena runs evaluate arms over real session traces (`/api/evolve/memory-arena/*`).
- Results are stored in `evolution_events`.
- Agent routes use arena winner automatically when `memory_mode=auto`.

7. CLI and MCP consume the same core API.
- CLI (`pajama`) is an API client with OAuth login and API-key operation.
- MCP server is intentionally thin over memory API operations.

## Repo Layout

```text
game-dev-memory/
  web/               Next.js frontend (Vercel)
  api/               Cloudflare Workers API + MCP + agent routes
  pajama/            Rust CLI source
  packages/pajama/   npm wrapper that installs prebuilt CLI binaries
  packages/pageindex-ts/ TypeScript PageIndex port
  skills/            public agent skills (memory-evolver, unreal-agents, etc.)
  research/          memory + agent research digests/papers
  docs/              architecture, API, deployment, CLI, e2e notes
```

## Local Development

Prereqs:

- Node.js 20+
- npm
- Rust toolchain (for local CLI build)
- Wrangler logged in

Start web + API:

```bash
npm install
npm run dev
```

- Web: `http://localhost:3000`
- API (Wrangler dev): `http://localhost:8787`

Apply DB migrations:

```bash
cd api
npm run db:migrate
```

Build everything:

```bash
npm run build
```

## CLI (`pajama`)

Install from npm:

```bash
npm i -g @pajamadot/pajama
```

Login:

```bash
pajama login
```

Common usage:

```bash
pajama projects list
pajama memories list --project-id <project-id>
pajama assets upload --project-id <project-id> --path <file>
pajama evolve arena-latest --project-id <project-id>
pajama evolve arena-campaign --max-projects 10 --iterations-per-project 200 --time-budget-ms 600000
```

Binary download prefix:

- `https://api-game-dev-memory.pajamadot.com/downloads/pajama/v{version}/{file}`

## Deployment Model

- `web/` deploys with Vercel.
- `api/` deploys with Wrangler.
- API uses Hyperdrive config `game-dev-memory-neon-db` and R2 bucket `game-dev-memory`.

See:

- `docs/deployment.md`

## Core Docs

- `docs/architecture.md`
- `docs/api.md`
- `docs/cli.md`
- `docs/deployment.md`
- `docs/e2e.md`
- `docs/roadmap.md`
