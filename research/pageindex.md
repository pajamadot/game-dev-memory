# PageIndex (VectifyAI) Notes + How It Fits Game-Dev-Memory

Repo: `https://github.com/VectifyAI/PageIndex`

## What It Is

PageIndex is a "vectorless" retrieval approach aimed at long documents:

- Build a hierarchical, TOC-like tree index of a document.
- Retrieve by navigating that tree (section-level retrieval) rather than by chunk embeddings.

The important product idea for game-dev-memory:

- Treat *documents* (manuals/specs/design docs) as first-class evidence sources.
- Let agents retrieve *sections* with stable identifiers and traceable paths.

## What We Implemented Here (First Cut)

We added `PageIndex-TS` as a small TypeScript module under:

- `packages/pageindex-ts`

It currently supports:

- Markdown heading extraction into a tree (TOC-like structure)
- A cheap deterministic scorer for searching nodes (title + excerpt)

We integrated it into the Memory API as:

- Artifact-level indexing stored in `artifacts.metadata.pageindex`
- Agent retrieval can include "document matches" as evidence

## Next Enhancements (Practical)

1. Better sources:
   - Add an artifact viewer + text extraction pipeline for PDFs (store extracted text in `artifact_chunks.text`)
   - Run PageIndex over extracted markdown/text from PDFs
2. Better retrieval:
   - Add Postgres FTS index over `artifact_chunks.text` (hybrid: tree + keyword)
   - Add optional LLM "tree search" (choose which nodes to expand) when configured
3. Better evidence UX:
   - UI to browse an artifact's pageindex tree
   - Deep links: `artifact_id + node_id` -> show exact section text

