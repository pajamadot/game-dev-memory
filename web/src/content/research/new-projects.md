# New Projects Radar: From Daily Discovery To Durable Memory

This page defines how we continuously scan new projects and turn raw findings into reusable memory for teams.

## Goal

1. Detect relevant new projects quickly (tools, frameworks, papers, launches).
2. Store the signal as tenant-scoped memory so agents can cite it later.
3. Keep the loop cheap and automated: cron + optional manual refresh.

## What Gets Ingested

- Product and launch signals (Hacker News, vendor blogs, release feeds).
- Open-source movement (project announcements, major release notes).
- Research-to-product signals (selected arXiv queries for agentic tooling and software workflows).

## Memory Shape

Daily digest memories are stored as:

- `category`: `research`
- `tags`: `research`, `new-projects`, `daily`, `<YYYY-MM-DD>`
- `title`: `New Projects Daily Digest <YYYY-MM-DD>`
- `context.kind`: `new-projects-digest`
- `context.items`: normalized source entries (title, URL, publish date, source)

This keeps retrieval simple for both the web app and the MCP layer.

## How To Use It In Agents

1. Query recent `new-projects` digests for the current tenant.
2. Extract candidate tools/projects by relevance to the active project memory.
3. Promote high-signal findings into explicit project memories:
   - migration ideas
   - architecture options
   - risks and adoption notes

## Iteration Rules

- Prefer reliable machine-readable feeds over brittle scraping.
- Keep the feed list small and auditable; rotate sources by measured signal quality.
- Keep digests evidence-first with direct links.
- Add source-specific confidence later (e.g., official docs > social posts).

## Next Up

1. Add dedupe across days (same URL tracked as an update, not a new memory).
2. Add relevance scoring against current project stack tags.
3. Add "promote to project memory" action directly in the digest UI.
