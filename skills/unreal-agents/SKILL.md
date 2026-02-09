---
name: unreal-agents
description: "Internet-backed research and practical workflows for using Unreal Engine with AI agents to build games, including what data to capture (UBT/UAT/build logs, runtime/editor logs, Unreal Insights traces, asset metadata), how to store/retrieve it in this repo (Neon Postgres via Hyperdrive + R2 chunking), and how to refresh/publish the Unreal Agents report at /research/unreal-agents. Use when asked to design Unreal-specific memory ingestion, agent workflows, or to update the daily cron-generated digest pipeline."
---

# Unreal Agents

## Workflow (End-To-End)

Maintain a curated Unreal+AI-agent report and keep the daily digest cron running.

### 1) Gather sources (use web.run)

- Prefer official docs + feeds first, then add third-party tools.
- Keep notes citation-oriented (you will link them in the report).

Suggested queries:

- "Unreal Engine AI assistant" (product + docs)
- "Unreal Insights trace format utrace"
- "UEFN Verse AI agent NPC"
- "NVIDIA ACE Unreal Engine integration"
- "Inworld Unreal plugin"

If you need a starting list, open `skills/unreal-agents/references/sources.md`.

### 2) Update the published report (curated doc)

Edit:

- `web/src/content/research/unreal-agents.md`

Keep it scannable:

- TL;DR (direction + target)
- Memory sources to capture (Unreal-specific)
- Retrieval patterns (project/session/tag/evidence)
- Product landscape (what to watch)
- Next steps (what to implement in this repo)
- References (URLs)

Published route:

- `web/src/app/research/unreal-agents/page.tsx`

### 3) Daily digest cron (automated)

The API worker runs a daily cron that:

- fetches a small set of feeds
- generates a markdown digest
- stores it as a `memories` row:
  - `category = 'research'`
  - `tags` include `unreal-agents`
  - `source_type = 'cron'`

Implementation:

- `api/src/research/unrealAgents.ts`
- Cron trigger: `api/wrangler.jsonc` (`triggers.crons`)

Manual trigger (tenant-scoped, useful for testing):

- `POST /api/research/unreal-agents/run`

Front-end display:

- `web/src/app/research/unreal-agents/page.tsx` (shows latest digests when signed in)

### 4) Validate locally

Report sanity:

```bash
node skills/unreal-agents/scripts/check_report.js
```

Build:

```bash
npm run build
```

API cron test (local):

```bash
cd api
npx wrangler dev --test-scheduled
```

### 5) Commit + push

- Commit message should mention Unreal Agents research/cron updates.
- Push to `origin/main`.

### 6) Deploy (CLI only; no CI)

Web (Vercel, monorepo root is `web`):

```bash
cd web
npx vercel deploy .. --prod --yes
```

API (Wrangler):

```bash
cd api
npm run deploy
```
