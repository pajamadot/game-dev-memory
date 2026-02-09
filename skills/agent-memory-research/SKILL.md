---
name: agent-memory-research
description: Internet-backed research and synthesis on how agent memory can be organized and implemented (working, episodic, semantic, procedural, and artifact memory), producing actionable guidance for this repo and updating the published report at the web route /research/agent-memory with citations. Use when asked to research agent memory architectures, retrieval patterns, evolution loops, or to refresh/publish the public report.
---

# Agent Memory Research

## Workflow (End-To-End)

Research agent memory patterns using the internet and publish an updated report page inside the `web/` app.

### 1) Gather sources (use web.run)

- Prefer primary sources first (papers, official docs).
- Pull 6-12 sources covering both research + implementation docs.
- Keep notes short and citation-oriented (you will link them in the report).

Suggested queries:

- "MemGPT paper long-term memory LLM"
- "Generative Agents memory stream reflection planning"
- "Reflexion language agents reflection"
- "LangGraph memory docs"
- "LlamaIndex agent memory docs"
- "LangMem LangChain"

If you need a starting list of canonical sources, open `skills/agent-memory-research/references/sources.md`.

### 2) Update the published report

Edit the markdown report:

- `web/src/content/research/agent-memory.md`

Keep the report structure stable so it stays scannable:

- TL;DR
- Memory taxonomy (working/episodic/semantic/procedural/artifact)
- Implementation patterns (ingestion, chunking, retrieval, reflection)
- Mapping to this repo (Postgres + R2 + Hyperdrive, multi-tenancy)
- Next steps
- References (URLs)

Guidelines:

- Avoid long verbatim quotes. Paraphrase and cite.
- Keep it actionable for this repo (what to implement next).
- Do not propose D1. This project uses Neon Postgres via Hyperdrive + R2 for large artifacts.

The report is published at:

- `web/src/app/research/agent-memory/page.tsx` (renders the markdown)

### 3) Validate locally

- Run `npm run build` from repo root.
- If you changed only web content, `cd web; npm run build` is sufficient.
- Optional: `node skills/agent-memory-research/scripts/check_report.js` for a quick report sanity check.

### 4) Commit + push

- Commit message should mention report refresh (and why).
- Push to `origin/main`.

### 5) Deploy the report (Vercel CLI)

This is a monorepo. The Vercel project root directory is `web`, so deploy from the repo root path:

```bash
cd web
npx vercel deploy .. --prod --yes
```

If env vars are required, set them with `vercel env` (see `docs/deployment.md`).
