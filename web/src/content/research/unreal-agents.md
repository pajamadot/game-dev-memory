# Unreal Agents (Unreal Engine + AI Agents)

## TL;DR

Build games faster by treating Unreal as an observable, automatable system:

- Capture everything (build logs, runtime logs, Insights traces, editor warnings, asset metadata, playtest notes).
- Store raw artifacts in R2, store metadata + summaries in Postgres (Neon via Hyperdrive).
- Retrieve by project, tags, time, and evidence links.
- Evolve continuously: per-session auto-summaries, plus daily research digests.

This repo is the memory backbone. The "Unreal Agent" is just a client that feeds and queries it.

## What "Unreal Agents" Means Here

An Unreal agent is an AI assistant that can:

- **Observe**: ingest UE logs, UBT/UAT build output, crash reports, Insights sessions, performance stats, and editor events.
- **Explain**: turn noisy artifacts into actionable summaries (root cause hypotheses, repro steps, suspects, next checks).
- **Act**: propose concrete changes (settings, code diffs, asset tweaks) and track what worked across iterations.

## Memory Sources To Capture (Recommended MVP)

### 1) Coding / build pipeline

- UBT compiler errors and warnings
- UAT packaging/cook failures
- shader compilation failures
- derived data cache (DDC) misses, build time spikes

### 2) Runtime and editor

- `Saved/Logs/*.log`
- crash reporter dumps and callstacks
- editor warnings (asset load, redirectors, PIE errors)

### 3) Performance evidence

- Unreal Insights `.utrace` sessions
- key performance counters (frame time, CPU/GPU breakdown)
- map or test-case context (level name, scalability settings, hardware)

### 4) Assets and content

- import settings (textures, skeletal meshes, LODs)
- blueprint complexity signals (tick usage, node counts, expensive loops)
- naming + folder conventions and violations

## Retrieval Patterns (How Agents Should Query)

Start with deterministic filters (fast + precise), then layer semantic search later.

- **Project scoped**: Always include `project_id` when possible.
- **Session scoped**: For "what did we do today", filter by `session_id`.
- **Tag scoped**: Normalize recurring topics into tags (e.g. `shader`, `dx12`, `cook`, `nanite`, `metahuman`).
- **Evidence first**: Link summaries to artifacts (logs/traces) so answers are debuggable.

## Product / Tooling Landscape (Keep This List Updated)

Unreal-adjacent "agent inputs" and "agent outputs" often come from:

- Unreal Engine (UE5), UEFN, Verse
- MetaHuman, Fab/Quixel pipeline, PCG framework
- IDE coding copilots (for C++/Blueprint tooling and automation glue)
- NPC/dialogue AI vendors and runtime agent frameworks (varies by project)

## How This Repo Fits

This system stores:

- **Memories**: summaries, bugs, decisions, patterns, lessons.
- **Artifacts**: large files in R2 (logs, traces, screenshots) with chunk metadata for partial retrieval.
- **Sessions**: the unit of work; closing a session can auto-evolve (summary + pattern extraction).
- **Daily research**: cron-generated digests tagged `unreal-agents`.

## Next Steps (Practical)

1. Add an Unreal-side uploader (plugin or CLI) to create artifact records and upload logs/traces to R2.
2. Add a parser that converts logs into searchable text chunks and links them to memories.
3. Add a "triage agent" that turns a failing build into: repro, suspects, and a checklist.

## References (Starting Points)

- Unreal Engine feed: https://www.unrealengine.com/en-US/rss
- arXiv (game + agent query): https://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+all:game+AND+all:agent&start=0&max_results=10
- AI and Games feed: https://www.aiandgames.com/feed

