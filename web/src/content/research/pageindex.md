# PageIndex: Document Indexing Without Vectors (And How We Use It)

This note covers what `VectifyAI/PageIndex` is proposing and what it means for **Game Dev Memory**.

Repo: `https://github.com/VectifyAI/PageIndex`

## The Core Idea

For long documents, "semantic similarity" retrieval often returns *similar* text but misses the *relevant* section.

PageIndex's approach:

1. Build a **hierarchical tree index** (TOC-like) from the document.
2. Retrieve by selecting **sections** (nodes) rather than arbitrary fixed-size chunks.

For us, the key benefit is evidence quality:

- A retrieved item is a **section** with a stable id and path.
- It's easier to cite, audit, and share across a project.

## How It Maps To Game Dev Memory

We already separate:

- **structured memory** in Postgres (`memories`)
- **large artifacts** in R2 (`artifacts`, `assets`)
- **evidence links** via `entity_links`

PageIndex adds a missing layer for long docs:

- a light-weight **document index** that agents can query without stuffing the whole doc into context

## What We Implemented (First Cut)

- `packages/pageindex-ts`: a minimal TypeScript "PageIndex-TS" module
  - Markdown heading extraction into a TOC-like tree
  - Cheap deterministic search (title + excerpt scoring)
- Memory API integration:
  - Store indexes in `artifacts.metadata.pageindex`
  - Agent retrieval can include **document matches** (as `[doc:<artifact_uuid>#<node_id>]`)

## Next

1. Add an artifact UI to browse the tree and deep-link into a section.
2. Add extraction pipelines for PDFs into `artifact_chunks.text` so PageIndex can run on real PDFs.
3. Add hybrid retrieval: tree index + Postgres FTS on node summaries / extracted text.

