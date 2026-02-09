# Agent Memory: How To Organize And Implement It

This report summarizes practical patterns from recent agent-memory research and tooling, and maps them onto an implementation that looks like:

- **Relational store** for metadata, policy, and auditability (Postgres)
- **Object store** for large artifacts (R2)
- Optional **vector index** for semantic retrieval (Postgres + pgvector or a dedicated vector DB later)

## TL;DR

1. Treat "memory" as **multiple layers**, not one blob: working (prompt context), episodic (session/event stream), semantic (facts/knowledge), procedural (how-to/tool policies), and artifact (large files).
2. Use **sessions** as the "unit of evolution": ingest -> reflect/summarize -> consolidate -> index.
3. Retrieval should be **evidence-first**: return items with source pointers (artifact chunks, logs, traces) and keep the LLM as the synthesis layer.
4. Make memory management explicit: **summarize, compress, and page** context (MemGPT-style) rather than blindly stuffing more into the prompt.
5. Keep changes auditable: every evolution step should emit an **event** describing what changed and why.

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

## Mapping To This Repo's Current Architecture

Today the system already supports the core primitives:

- `projects` (tenant-scoped)
- `sessions` (the evolution boundary)
- `memories` (typed text entries)
- `artifacts` + `artifact_chunks` (R2-backed, partial retrieval)
- `entity_links` (generic evidence/relationship edges)
- `evolution_events` (audit log)

The most important missing piece for "semantic search" is an embeddings index. Minimal extension options:

1. Add `memories.embedding` (vector) + `artifact_chunks.embedding` (vector) and use pgvector.
2. Create separate `embeddings` table keyed by `(entity_type, entity_id, chunk_index?)` so you can re-embed without rewriting source tables.

## Recommended Next Steps

1. Replace temporary tenant headers with Clerk JWT verification in the API.
2. Add Postgres full-text search for `memories` + `artifact_chunks.text`.
3. Add optional embeddings and hybrid retrieval.
4. Add an artifact upload + chunk viewer UI in the web console.
5. Grow the evolver beyond summaries: dedupe, prune, confidence calibration, and cross-project "bridges" (within tenant).

## References

- Park, J. S. et al. "Generative Agents: Interactive Simulacra of Human Behavior" (2023). arXiv:2304.03442. https://arxiv.org/abs/2304.03442
- Packer, C. et al. "MemGPT: Towards LLMs as Operating Systems" (2023). arXiv:2310.08560. https://arxiv.org/abs/2310.08560
- Shinn, N. et al. "Reflexion: Language Agents with Verbal Reinforcement Learning" (2023). arXiv:2303.11366. https://arxiv.org/abs/2303.11366
- Yao, S. et al. "ReAct: Synergizing Reasoning and Acting in Language Models" (2022). arXiv:2210.03629. https://arxiv.org/abs/2210.03629
- Wang, G. et al. "Voyager: An Open-Ended Embodied Agent with Large Language Models" (2023). arXiv:2305.16291. https://arxiv.org/abs/2305.16291
- LangGraph docs: Memory. https://langchain-ai.github.io/langgraph/concepts/memory/
- LlamaIndex docs: Agent Memory. https://docs.llamaindex.ai/en/stable/understanding/agent/memory/
- LangMem (LangChain) repo. https://github.com/langchain-ai/langmem
