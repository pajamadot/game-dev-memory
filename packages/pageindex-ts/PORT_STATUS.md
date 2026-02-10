# PageIndex-TS Port Status

Upstream: `VectifyAI/PageIndex` (Python, MIT).

This folder contains a TypeScript port designed to run in Cloudflare Workers (no filesystem access, minimal deps).

## What "Full Port" Means Here

- The **indexing algorithms** and **LLM prompts/control flow** from:
  - `pageindex/page_index_md.py`
  - `pageindex/page_index.py`
  - `pageindex/utils.py`
  are implemented in TypeScript.

- **PDF parsing/text extraction** (PyPDF2/PyMuPDF equivalents) is **not** bundled into the Worker build.
  - The PDF/page pipeline expects **extracted page text** as `page_list: Array<[pageText, tokenCount]>`.
  - In this repo, page text is expected to come from the artifact extraction/chunking pipeline.

## Coverage Checklist

### `page_index_md.py` (Markdown)
- Implemented: header extraction (skipping fenced code blocks)
- Implemented: node text slicing by header boundaries
- Implemented: token-based thinning (`if_thinning`, `min_token_threshold`)
- Implemented: summary generation (`if_add_node_summary`, `summary_token_threshold`) via `PageIndexLlm`
- Implemented: optional doc description (`if_add_doc_description`) via `PageIndexLlm`
- Implemented: node id assignment (`if_add_node_id`) using upstream `write_node_id` behavior
- Implemented: `mdToTree()` result shape `{ doc_name, doc_description?, structure }`

### `page_index.py` (PDF/page text)
- Implemented: TOC page detection (`tocDetectorSinglePage`, `findTocPages`)
- Implemented: TOC page-number detection (`detectPageIndex`)
- Implemented: TOC -> JSON transformation with continuation loop (`tocTransformer`)
- Implemented: physical index mapping (`tocIndexExtractor`, offset calc, `addPageOffsetToTocJson`)
- Implemented: no-TOC mode via page grouping + incremental TOC generation (`processNoToc`, `generateTocInit/Continue`)
- Implemented: verify + fix loops (`verifyToc`, `fixIncorrectTocWithRetries`)
- Implemented: node range post-processing into tree (`postProcessing`)
- Implemented: recursive splitting for large nodes (`processLargeNodeRecursively`)
- Implemented: full pipeline entry: `pageIndexFromPages()` and convenience `pageIndex()`

### `utils.py` (Utilities)
- Implemented: JSON extraction (`extractJson`, `getJsonContent`)
- Implemented: tree helpers (`writeNodeId`, `structureToList`, `listToTree`, `addPrefaceIfNeeded`, `postProcessing`)
- Implemented: node text attachment/removal for page ranges (`addNodeText`, `removeStructureText`)
- Implemented: summary + doc description helpers (LLM-driven)
- Implemented: `ConfigLoader` with upstream default config values (embedded, YAML-free)

## Known Differences vs Upstream

- Token counting is **approximate** (`chars/4`) by default for portability.
  - Upstream uses `tiktoken` model-specific encodings.
- No built-in PDF parsing in Workers.
  - You must supply extracted page text to the PDF/page pipeline.
- Logging is in-memory (`JsonLogger.entries`) rather than writing to `./logs/*.json`.

