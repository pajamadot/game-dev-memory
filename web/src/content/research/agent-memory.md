# Agent Memory: How To Organize And Implement It

This report summarizes practical patterns from recent agent-memory research and tooling, and maps them onto an implementation that looks like:

- **Relational store** for metadata, policy, and auditability (Postgres)
- **Object store** for large artifacts (R2)
- Optional **vector index** for semantic retrieval (Postgres + pgvector or a dedicated vector DB later)

It also calls out a "gateway + control UI" pattern inspired by Cloudflare's `moltworker` (OpenClaw on Workers) and shows how that maps to a **Project Memory Agent** that is retrieval-first and evidence-driven.

## TL;DR

1. Treat "memory" as **multiple layers**, not one blob: working (prompt context), episodic (session/event stream), semantic (facts/knowledge), procedural (how-to/tool policies), and artifact (large files).
2. Use **sessions** as the "unit of evolution": ingest -> reflect/summarize -> consolidate -> index.
3. Retrieval should be **evidence-first**: return items with source pointers (artifact chunks, logs, traces) and keep the LLM as the synthesis layer.
4. Make memory management explicit: **summarize, compress, and page** context (MemGPT-style) rather than blindly stuffing more into the prompt.
5. Keep changes auditable: every evolution step should emit an **event** describing what changed and why.
6. Treat memory *updates* (edit/merge/delete/forget) as a feature, not an afterthought. This strongly affects agent performance in practice.
7. Use benchmarks (LongMemEval; LoCoMo) to drive schema and retrieval design, not just model choice.

## 2026 Update: What Changed In The Literature

Recent 2025-2026 papers push a stronger stance: memory quality is mostly a **runtime policy** problem, not only a storage problem.

- Budget-aware routing: choose retrieval complexity per query and budget instead of one fixed pipeline.
- Hierarchical retrieval: retrieve theme -> episode -> raw evidence to reduce redundant context.
- Active forgetting: use decay and reinforcement to control memory growth.
- Memory safety: treat poisoning and self-reinforcing bad memory as first-class threats.
- Cognitive evaluation: test latent constraints/consistency, not only explicit factual recall.

Representative sources:

- BudgetMem (2026-02-05): https://arxiv.org/abs/2602.06025
- xMemory (2026-02-02): https://arxiv.org/abs/2602.02007
- FadeMem (2026-01-26): https://arxiv.org/abs/2601.18642
- AgeMem (2026-01-05): https://arxiv.org/abs/2601.01885
- LoCoMo-Plus (2026-02-11): https://arxiv.org/abs/2602.10715
- A-MemGuard (2025-09-29): https://arxiv.org/abs/2510.02373

## Memory Taxonomy (What To Store)

### 1) Working memory (short-term)

- The current conversation + minimal scratch state needed to act.
- Implementation: LLM context + a small "state" object (current project, session id, open tasks).

### 2) Episodic memory (event stream)

- What happened in a specific run/session: build logs, stack traces, profiling runs, playtests, decisions made during debugging.
- "Generative Agents" showed that storing a memory stream and performing periodic **reflection** can synthesize higher-level takeaways. This is a good model for game dev sessions: raw events -> reflection notes -> summaries.  
  Source: "Generative Agents: Interactive Simulacra of Human Behavior" (Park et al., 2023).

### 3) Semantic memory (facts / knowledge base)

- Stable knowledge: "In UE5, shader compile failures often show up as ...", "This project uses DX12 + SM6", "We fixed crash X by ...".
- Often derived from episodic memories via summarization + dedupe.

### 4) Procedural memory (skills / policies)

- Reusable procedures: "How to capture an Unreal Insights trace", "How to reproduce crash categories", "How to upload artifacts", "Release checklist".
- Agent tool-use papers (ReAct; Voyager) motivate separating "how to do things" from raw facts.  
  Sources: ReAct (Yao et al., 2022/2023); Voyager (Wang et al., 2023).
- Workflow-memory work (CoALA; AWM) suggests representing procedures as reusable *plans* (tool chains + constraints), not just text instructions.
  Sources: CoALA (Sumers et al., 2023); Agent Workflow Memory (Wang et al., 2024).

### 5) Artifact memory (large files)

- Big binaries and logs: `.utrace`, crash dumps, editor logs, perf captures, screenshots/video.
- These should not live in the relational DB. Store in R2 with metadata + chunk pointers.

## Organization Model (How It Hangs Together)

### Sessions as the boundary

Use a session as the top-level container for:

- **Inputs**: memories + artifacts created during the session
- **Derived**: session summary, extracted patterns, decisions, and links
- **Evolution event**: what was auto-generated or changed when the session ended

This aligns with reflection-based approaches (Generative Agents) and makes "auto evolve per session" natural.

### Evidence-first linking

Memories should be able to cite:

- An artifact (`artifacts`) and optionally a specific chunk (`artifact_chunks`)
- A related memory (e.g., a "bug" memory cites a "decision" memory that resolved it)

This reduces hallucination risk and supports fast inspection ("show me the exact log chunk").

### Explicit memory management

MemGPT frames long-term memory as an OS-like system where the agent can page information in/out and summarize to stay within context limits. The key practical lesson is to make memory operations explicit (write summary, read chunk, compress) rather than relying on a single monolithic prompt.  
Source: MemGPT (Packer et al., 2023).

## Implementation Patterns (How To Build It)

### Ingestion pipeline (small and reliable)

1. Create/attach a `session`
2. Upload artifacts (R2)
3. Write memories with rich metadata
4. On session close:
   - create a `summary` memory
   - emit an `evolution_event`

### Chunking + partial retrieval for large artifacts

For very large artifacts, chunking solves three problems:

- network timeouts and retries
- partial retrieval (read only the segment you need)
- indexing: attach extracted text snippets per chunk for retrieval

Store:

- R2 object(s) keyed by artifact id + chunk index
- DB rows describing each chunk (byte ranges, text extraction, metadata)

### Retrieval pipeline (progressively richer)

Start simple:

- metadata filters: `tenant`, `project`, `session`, `category`, `tags`
- keyword search (ILIKE / FTS)

Then add semantic retrieval:

- generate embeddings for memory content and artifact chunk text
- use hybrid ranking: (FTS score + vector similarity) + recency boost

LangGraph and LlamaIndex both describe "memory" as a combination of stores + retrieval strategies rather than a single mechanism.  
Sources: LangGraph memory docs; LlamaIndex agent memory docs.

### Reflection / self-improvement loop

Reflexion formalizes a loop of: act -> observe -> reflect -> improve behavior. For a memory system, the analog is:

- write raw memory/events
- produce reflection and/or summary
- adjust confidence, dedupe, or link related items

Source: Reflexion (Shinn et al., 2023).

### Memory update policies (write / merge / forget)

If you store "everything", you will eventually retrieve noisy or outdated items.

Practical implications:

- explicitly track **confidence** and **recency**
- allow "superseded by" links (new knowledge replaces old)
- treat deletion/forgetting as a first-class operation with an audit trail (who/what/why)

Recent empirical work shows that memory management choices materially impact LLM agent performance on tasks and benchmarks.  
Source: "How Memory Management Impacts LLM Agent Performance" (Bond et al., 2025).

## Benchmarks (Use These To Drive Design)

- LongMemEval: benchmark for long-term memory behaviors in LLMs.
  - It’s useful for evaluating retrieval + update policies, not just raw context length.
- LoCoMo: benchmark for long-term conversation memory.

Sources: LongMemEval (Gao et al., 2024); LoCoMo (Wang et al., 2024).

## A Moltworker-Inspired Agent Pattern (Gateway + Control UI)

Cloudflare's `moltworker` packages an agent runtime behind a "gateway" and exposes a web-based control UI. The parts worth copying for a project-memory product are:

- **Control UI**: one place to ask questions and inspect evidence.
- **Gateway / API boundary**: a thin layer that mediates auth, retrieval, and tool calls.
- **Persistence**: separate large files (object storage) from structured metadata (DB).

For Game Dev Memory, we do not need the "agent-in-a-container" piece to start. Instead, we implement a **Project Memory Agent** as:

- A **thin agent API** endpoint that performs retrieval over tenant-scoped memory (and optionally asks an LLM to synthesize an answer).
- A **web UI route** that serves as the control panel for humans.
- MCP remains a **thin tool layer** over the same underlying memory primitives.

## Mapping To This Repo's Current Architecture

Today the system already supports the core primitives:

- `projects` (tenant-scoped)
- `sessions` (the evolution boundary)
- `memories` (typed text entries with lifecycle + quality flags + Postgres FTS)
- `assets` (R2-backed large files with multipart upload + range download)
- `artifacts` + `artifact_chunks` (R2-backed, partial retrieval for chunked text/logs)
- `entity_links` (generic evidence/relationship edges)
- `evolution_events` (evolution/audit log)
- `memory_events` (fine-grained audit trail for memory edits/links/lifecycle)

And now includes a first-cut **Project Memory Agent**:

- `POST /api/agent/ask` (retrieval-first; optional LLM synthesis when configured)
- `/agent` (web control UI)

The most important missing piece for "semantic search" is an embeddings index. Minimal extension options:

1. Add `memories.embedding` (vector) + `artifact_chunks.embedding` (vector) and use pgvector.
2. Create separate `embeddings` table keyed by `(entity_type, entity_id, chunk_index?)` so you can re-embed without rewriting source tables.

## Recommended Next Steps

1. Add retrieval modes to API (`fast`, `balanced`, `deep`) with query-aware routing and explicit cost/latency controls.
2. Extend retrieval beyond memories: add FTS for chunk text / asset text previews and hierarchical expansion for deep mode.
3. Add optional embeddings and hybrid retrieval (FTS + vector similarity), with tenant/project filters as hard constraints.
4. Add memory maintenance metadata (`decay_score`, reinforcement, validation timestamp) and a scheduled compaction/forgetting pass.
5. Add memory safety controls: quarantine suspicious memories and require multi-evidence checks before promotion.
6. Expand the `/agent` control UI with "Save as memory" + evidence deep links (memory + asset viewers).
7. Add a retrieval eval harness that tracks answer quality, citation quality, token cost, and latency over time.

## Implemented Evolution Loop: Session-Driven Memory Arena

The API now includes a first RL-style evolution harness to compare retrieval organizations using real agent sessions.

- Endpoint: `POST /api/evolve/memory-arena/run`
- Snapshot: `GET /api/evolve/memory-arena/latest`

How it works:

1. Replays user prompts from completed agent sessions (`agent` and `agent_pro`).
2. Uses evidence references from the next assistant message as weak labels.
3. Evaluates multiple retrieval arms (`fast/balanced/deep` with memories/hybrid).
4. Scores arms by recall/precision, latency, and evidence diversity.
5. Stores the run in `evolution_events` and computes a UCB-style next arm recommendation.

This turns retrieval tuning into a continuous data-driven process.

## References

- Park, J. S. et al. "Generative Agents: Interactive Simulacra of Human Behavior" (2023). arXiv:2304.03442. https://arxiv.org/abs/2304.03442
- Packer, C. et al. "MemGPT: Towards LLMs as Operating Systems" (2023). arXiv:2310.08560. https://arxiv.org/abs/2310.08560
- Sumers, T. R. et al. "Cognitive Architectures for Language Agents (CoALA)" (2023). arXiv:2309.02427. https://arxiv.org/abs/2309.02427
- Shinn, N. et al. "Reflexion: Language Agents with Verbal Reinforcement Learning" (2023). arXiv:2303.11366. https://arxiv.org/abs/2303.11366
- Yao, S. et al. "ReAct: Synergizing Reasoning and Acting in Language Models" (2022). arXiv:2210.03629. https://arxiv.org/abs/2210.03629
- Wang, G. et al. "Voyager: An Open-Ended Embodied Agent with Large Language Models" (2023). arXiv:2305.16291. https://arxiv.org/abs/2305.16291
- Yao, H. et al. "A Survey on the Memory Mechanism of Large Language Model based Agents" (2024). arXiv:2404.13501. https://arxiv.org/abs/2404.13501
- Wang, Z. Z. et al. "Agent Workflow Memory (AWM)" (2024). arXiv:2409.07429. https://arxiv.org/abs/2409.07429
- Gao, J. et al. "LongMemEval: Benchmarking LLMs for Long-Term Memory" (2024). arXiv:2410.10813. https://arxiv.org/abs/2410.10813
- Wang, X. et al. "LoCoMo: Evaluating LLMs on Long-Term Conversation Memory" (2024). arXiv:2402.17753. https://arxiv.org/abs/2402.17753
- Bond, H. et al. "How Memory Management Impacts LLM Agent Performance" (2025). arXiv:2505.16067. https://arxiv.org/abs/2505.16067
- Li, Y. et al. "Locomo-Plus: Beyond-Factual Cognitive Memory Evaluation Framework for LLM Agents" (2026). arXiv:2602.10715. https://arxiv.org/abs/2602.10715
- Zhang, H. et al. "Learning Query-Aware Budget-Tier Routing for Runtime Agent Memory" (2026). arXiv:2602.06025. https://arxiv.org/abs/2602.06025
- Hu, Z. et al. "Beyond RAG for Agent Memory: Retrieval by Decoupling and Aggregation" (2026). arXiv:2602.02007. https://arxiv.org/abs/2602.02007
- Wei, L. et al. "FadeMem: Biologically-Inspired Forgetting for Efficient Agent Memory" (2026). arXiv:2601.18642. https://arxiv.org/abs/2601.18642
- Yu, Y. et al. "Agentic Memory: Learning Unified Long-Term and Short-Term Memory Management for Large Language Model Agents" (2026). arXiv:2601.01885. https://arxiv.org/abs/2601.01885
- Wei, Q. et al. "A-MemGuard: A Proactive Defense Framework for LLM-Based Agent Memory" (2025). arXiv:2510.02373. https://arxiv.org/abs/2510.02373
- Cloudflare `moltworker` (OpenClaw on Workers): https://github.com/cloudflare/moltworker
- LangGraph docs: Memory. https://langchain-ai.github.io/langgraph/concepts/memory/
- LlamaIndex docs: Agent Memory. https://docs.llamaindex.ai/en/stable/understanding/agent/memory/
- LangMem (LangChain) repo. https://github.com/langchain-ai/langmem
