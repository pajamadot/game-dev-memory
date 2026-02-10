# PageIndex-TS

TypeScript port of `VectifyAI/PageIndex` (MIT), with a Worker-friendly design.

Scope (this repo):

- "Lite" deterministic indexing + search (safe to run inside Cloudflare Workers):
  - Build a hierarchical, TOC-like index from Markdown headings.
  - Build a chunk index from `artifact_chunks.text`.
  - Cheap lexical search over the index (title + excerpt/summary/text scoring).

- "Full" algorithmic port of the upstream PageIndex pipelines (LLM-driven):
  - Markdown: thinning, summaries, optional doc description.
  - PDF/page text: TOC detection, TOC-to-JSON, verify/fix loops, recursive splitting, summaries, optional doc description.

Important: PDF parsing is intentionally not included in the Worker path. The PDF/page pipeline expects extracted per-page text (`page_list: Array<[pageText, tokenCount]>`). In this repo, that typically comes from the artifact chunking/extraction pipeline rather than parsing PDFs in-process.

This is intentionally a small primitive we can embed inside Cloudflare Workers and evolve over time into a richer "reasoning retrieval" stack.

## Attribution

Inspired by: `https://github.com/VectifyAI/PageIndex` (MIT).
