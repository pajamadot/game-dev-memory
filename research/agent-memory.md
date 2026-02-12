# Agent Memory Research Notes (Working)

This folder/file is the "scratchpad" for agent-memory research: annotated paper notes, benchmarks, and implementation takeaways that later get promoted into the published report:

- Published report: `web/src/content/research/agent-memory.md` (served at `/research/agent-memory`)

## Scope

Focus: how to organize and implement memory for LLM agents in a way that stays:

- evidence-first (links to logs/assets/chunks)
- auditable (who/what changed memory and why)
- cheap to operate (summaries + partial retrieval instead of infinite context)
- multi-tenant (org-shared project memory + private personal memory)

## Paper Map (High-Signal)

- CoALA (Sumers et al., 2023): proposes a cognitive architecture for language agents with distinct memory modules (working/short-term vs long-term) and action planning components.
  - https://arxiv.org/abs/2309.02427
- MemGPT (Packer et al., 2023): treats memory as an OS concern with explicit read/write/summarize/paging to stay within context limits.
  - https://arxiv.org/abs/2310.08560
- Generative Agents (Park et al., 2023): "memory stream" + periodic reflection that synthesizes higher-level insights from raw events.
  - https://arxiv.org/abs/2304.03442
- Survey: Memory Mechanisms of LLM Agents (Yao et al., 2024): taxonomy + design patterns for memory writing, updating, retrieval, and forgetting in agent systems.
  - https://arxiv.org/abs/2404.13501
- Agent Workflow Memory (Wang et al., 2024): targets *procedural* memory: storing/reusing workflows (multi-step tool plans) rather than only facts.
  - https://arxiv.org/abs/2409.07429
- LongMemEval (Gao et al., 2024): benchmark for long-term memory abilities; highlights that "store everything" is not enough without good retrieval and update policies.
  - https://arxiv.org/abs/2410.10813
- LoCoMo (Wang et al., 2024): benchmark focused on long-term conversation memory.
  - https://arxiv.org/abs/2402.17753
- Memory management impacts (Bond et al., 2025): empirical evidence that memory curation/update decisions materially affect agent task success.
  - https://arxiv.org/abs/2505.16067
- Hindsight is 20/20 (Jang et al., 2025): builds agent memory from failures; pushes toward *structured* "mistake -> fix -> policy" memories.
  - https://arxiv.org/abs/2512.12818

## Recent arXiv Themes (2025-2026)

From the generated digest in `research/agent-memory/digests/`:

- Graph-structured / multi-network memory (separating facts vs experiences vs beliefs).
- Temporal indexing and time-aware retrieval (recency, time-scoped queries, event segmentation).
- Procedural memory for workflows (reusable action traces, tool plans).
- Explicit memory operations (add/delete/merge) and quality/poisoning controls.
- Privacy-aware memory (what to store vs what to forget).

## Implementation Takeaways For game-dev-memory

### 1) Separate evidence from beliefs

For game dev, the most reliable "ground truth" is usually:

- build logs
- crash dumps
- profiler traces
- config snapshots

Design rule:

- a memory entry should always be able to point to evidence (asset id + byte range / chunk id)

### 2) Treat memory updates as first-class events

Most systems nail "write memory", but under-specify:

- memory edits
- deletions
- merges/dedup
- confidence adjustments

Make them explicit as events:

- what changed
- why (prompt/heuristic/actor)
- which evidence supports the change

### 3) Procedural memory is a product feature (not a footnote)

If you want a "Claude Code-like" agent for a studio, you need durable procedures:

- "how to capture a repro trace"
- "how to bisect a regression"
- "how to file a bug with the right attachments"

This maps cleanly onto:

- org-scoped project memory (shared)
- skill docs / playbooks (procedural category)

### 4) Benchmarks should influence schema

Benchmarks like LongMemEval and LoCoMo push you toward:

- time-aware metadata (created_at/updated_at + recency ranking)
- explicit memory update policies
- evaluation harnesses that measure retrieval quality and not just generation quality

## Local Workflow (Skill Support)

Generate arXiv candidate digests and per-paper note stubs:

```bash
node skills/agent-memory-research/scripts/fetch_arxiv.js
```

Outputs:

- `research/agent-memory/digests/arxiv-YYYY-MM-DD.md`
- `research/agent-memory/papers/<arxiv-id>.md`

## Iteration: 2026-02-12 (Synthesis)

Source digest:

- `research/agent-memory/digests/arxiv-2026-02-12.md`

Shortlist reviewed in detail:

- LoCoMo-Plus (2602.10715): cognitive-memory evaluation beyond factual recall.
- MemAdapter (2602.08369): cross-paradigm memory alignment + retrieval.
- BudgetMem (2602.06025): query-aware runtime budget routing.
- xMemory (2602.02007): decoupled hierarchical retrieval for correlated memory streams.
- FadeMem (2601.18642): active forgetting and storage-efficiency tradeoffs.
- AgeMem (2601.01885): unified STM/LTM as explicit memory actions.
- A-MemGuard (2510.02373): proactive memory-poisoning defense.
- PAMU (2510.09720): preference-aware update policy for evolving user behavior.

### Pattern shifts worth adopting

1. Runtime policy selection is now central.
   - Retrieval should choose low/mid/high memory strategies per query.
   - Static top-k retrieval is no longer enough for cost-quality control.
2. Retrieval should be hierarchical and diverse, not only nearest-neighbor.
   - Correlated memory streams need theme/episode/message staged retrieval.
3. Forgetting and memory compression should be explicit and measurable.
   - Keep a decay + reinforcement policy based on access and usefulness.
4. Memory security must be built in.
   - Detect potentially poisoned/contradictory memory and gate promotion.
5. Evaluation should include latent-constraint consistency.
   - Do not overfit on factual recall benchmarks alone.

### Concrete implementation deltas for game-dev-memory

1. Add retrieval budgets to the memory API.
   - Proposed request shape: `mode: "fast" | "balanced" | "deep"`.
   - `fast`: FTS + strict filters + small context.
   - `balanced`: current hybrid with recency/confidence weighting.
   - `deep`: hierarchical expansion (theme -> episode -> evidence chunks).
2. Add memory maintenance metadata.
   - Per memory: `decay_score`, `reinforcement_count`, `last_validated_at`.
   - Scheduled compaction job: summarize/merge low-value duplicates.
3. Add safety pipeline before promotion.
   - Quarantine tag for suspicious memories.
   - Cross-check candidate memory against multiple evidence links.
4. Add preference-aware updates for personal memory.
   - Maintain short-term and long-term preference views and fuse during retrieval.
5. Add evaluation harness for regressions.
   - Track not only answer quality, but also citation quality, token cost, and latency.

### Next coding iteration candidates

1. Implement query `mode` routing in `api/src/core/memories.ts`.
2. Introduce basic decay/compaction fields + scheduled maintenance pass.
3. Add memory quarantine flag and UI indicator for untrusted entries.
4. Add an `/api/evals/memory` endpoint to run fixed retrieval test cases.

## Implemented: Session-Driven Memory Arena (RL-style selection)

We now have a first evolution loop that compares retrieval organizations using real agent-session traces.

### What it does

1. Replays prompts from completed `agent` / `agent_pro` sessions.
2. Uses the next assistant message evidence links as weak supervision labels.
3. Evaluates multiple retrieval arms:
   - `fast_memories`
   - `balanced_memories`
   - `deep_memories`
   - `balanced_hybrid`
   - `deep_hybrid`
4. Scores each arm on:
   - evidence recall/precision (memory + doc),
   - latency,
   - category diversity.
5. Writes results to `evolution_events` and maintains a UCB-style bandit recommendation.

### API endpoints

- `POST /api/evolve/memory-arena/run`
- `GET /api/evolve/memory-arena/latest`

This gives us a practical "test and win" loop grounded in actual project interactions rather than synthetic prompts.
