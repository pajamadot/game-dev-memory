export type YesNo = "yes" | "no";

// A flexible node shape that can represent:
// - Markdown index nodes (line_num/start_line/end_line)
// - Chunk index nodes (chunk_index)
// - PDF/page index nodes (start_index/end_index/physical_index)
//
// This intentionally mirrors the upstream PageIndex JSON shapes where practical,
// while still supporting our "lite" deterministic indexing/search use-cases.
export type PageIndexNode = {
  title: string;
  node_id?: string;

  // A lightweight depth indicator used by the "lite" search scorer.
  // For PageIndex-style trees, this is derived from tree depth.
  level?: number;

  // Markdown indexing (1-based line numbers, inclusive).
  line_num?: number;
  start_line?: number;
  end_line?: number;

  // Chunk indexing (0-based chunk index, inclusive).
  chunk_index?: number;

  // Page/PDF indexing (1-based page indices, inclusive).
  physical_index?: number;
  start_index?: number;
  end_index?: number;

  // Optional content fields (upstream uses text/summary/prefix_summary).
  text?: string;
  summary?: string;
  prefix_summary?: string;

  // Short human-friendly representations. Keep these small when stored as metadata.
  excerpt?: string;

  nodes?: PageIndexNode[];
};

export type PageIndexMatch = {
  node_id: string;
  title: string;
  level: number;
  score: number;
  path: string[];
  excerpt: string;

  line_num?: number;
  start_line?: number;
  end_line?: number;

  chunk_index?: number;

  physical_index?: number;
  start_index?: number;
  end_index?: number;
};

export type PageIndexConfig = {
  model: string;
  toc_check_page_num: number;
  max_page_num_each_node: number;
  max_token_num_each_node: number;
  if_add_node_id: YesNo;
  if_add_node_summary: YesNo;
  if_add_doc_description: YesNo;
  if_add_node_text: YesNo;
};

export type PageIndexDoc = {
  doc_name: string;
  doc_description?: string;
  structure: PageIndexNode[];
};

