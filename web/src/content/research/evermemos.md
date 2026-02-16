# EverMemOS Adaptation for Game-Dev Memory

Date: 2026-02-16
Source: https://github.com/EverMind-AI/EverMemOS

## Why this matters

EverMemOS emphasizes structured long-term memory instead of storing only raw chat text. That matches our goal: memory must stay useful across coding sessions, team members, and toolchains.

## Key ideas we are borrowing

- Memory derivation pipeline:
  - Convert one source memory into multiple specialized memories.
  - Keep provenance links so derived memories remain auditable.
- Future-oriented memory lane:
  - Distinguish "what happened" from "what should happen next".
  - Treat deadlines and planned actions as first-class retrieval targets.
- Event-style atomicization:
  - Break noisy notes into concise factual units for better retrieval precision.

## Implemented in this repo

### API endpoints

- `POST /api/memories/:id/derive`
  - Derives `event_log` and `foresight` memories from a parent memory.
  - Supports `dry_run`, `max_event_logs`, `max_foresight`, and selective toggles.
  - Writes `entity_links` with relation `derived_from`.
- `GET /api/memories/foresight/active`
  - Returns time-aware foresight memories sorted by nearest due date.
  - Supports filtering (`project_id`, `q`, `include_past`, `within_days`, lifecycle controls).

### Core derivation module

- `api/src/core/memoryDerivation.ts`
  - Sentence candidate extraction from free-form text.
  - Event/future cue detection.
  - Date parsing (absolute + relative cues).
  - Confidence estimation and de-duplication.

## How this improves retrieval quality

- Lower noise in recall: event logs are short and factual.
- Better planning support: foresight lane makes upcoming tasks/querying explicit.
- Better explainability: each derived memory keeps evidence + parent linkage.

## Next evolution steps

- Add MCP tools for `memories.derive` and `memories.foresight_active`.
- Add CLI commands that wrap these endpoints.
- Add evaluator metrics:
  - precision@k for bug-fix recall,
  - deadline hit-rate for foresight effectiveness,
  - latency/cost per retrieval mode.
- Add nightly consolidation job to merge near-duplicate derived items.

## Guardrails

- Derived memories are additive; parent memory remains source-of-truth.
- We do not derive from already-derived categories (`event_log`, `foresight`) to avoid cascading drift.
- Lifecycle flags (`active/superseded/quarantined`) remain the primary retrieval safety control.
