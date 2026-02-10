import type { PageIndexMatch, PageIndexNode } from "./types";

export { type PageIndexMatch, type PageIndexNode };

export function countNodes(nodes: PageIndexNode[] | null | undefined): number {
  if (!nodes || nodes.length === 0) return 0;
  let n = 0;
  const stack = [...nodes];
  while (stack.length) {
    const cur = stack.pop()!;
    n++;
    if (cur.nodes && cur.nodes.length) stack.push(...cur.nodes);
  }
  return n;
}

function padId(n: number): string {
  const s = String(Math.max(0, Math.trunc(n)));
  if (s.length >= 4) return s;
  return s.padStart(4, "0");
}

function normalizeWhitespace(s: string): string {
  return (s || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function excerpt(text: string, maxChars: number): string {
  const t = normalizeWhitespace(text);
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars).trimEnd()}...`;
}

export function buildMarkdownPageIndex(
  markdown: string,
  opts?: { maxNodes?: number; excerptChars?: number }
): PageIndexNode[] {
  const maxNodes = Math.max(1, Math.min(50_000, Math.trunc(opts?.maxNodes ?? 5000)));
  const excerptChars = Math.max(80, Math.min(8000, Math.trunc(opts?.excerptChars ?? 800)));

  const src = (markdown || "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");

  const headingRe = /^(#{1,6})\s+(.+)\s*$/;
  const fenceRe = /^```/;

  let inCode = false;
  const headings: { level: number; title: string; lineNum: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const s = raw.trimEnd();

    if (fenceRe.test(s.trim())) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    const m = headingRe.exec(s.trim());
    if (!m) continue;

    const level = m[1]?.length ?? 1;
    const title = (m[2] || "").trim();
    if (!title) continue;

    headings.push({ level, title, lineNum: i + 1 }); // 1-based
    if (headings.length >= maxNodes) break;
  }

  if (headings.length === 0) return [];

  const flat: Array<{ level: number; title: string; start_line: number; end_line: number; text: string }> = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const start = h.lineNum;
    const end = i + 1 < headings.length ? headings[i + 1].lineNum - 1 : lines.length;
    const text = lines.slice(start - 1, end).join("\n").trim();
    flat.push({ level: h.level, title: h.title, start_line: start, end_line: end, text });
  }

  const roots: PageIndexNode[] = [];
  const stack: Array<{ level: number; node: PageIndexNode }> = [];
  let counter = 1;

  for (const f of flat) {
    const node: PageIndexNode = {
      node_id: padId(counter++),
      title: f.title,
      level: f.level,
      start_line: f.start_line,
      end_line: f.end_line,
      excerpt: excerpt(f.text, excerptChars),
      summary: excerpt(f.text, Math.min(400, excerptChars)),
      nodes: [],
    };

    while (stack.length && (stack[stack.length - 1]!.level ?? 0) >= f.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else (stack[stack.length - 1]!.node.nodes ||= []).push(node);
    stack.push({ level: f.level, node });
  }

  return roots;
}

export function buildChunkPageIndex(
  chunks: Array<{ chunk_index: number; text: string; title?: string | null }>,
  opts?: { excerptChars?: number; rootTitle?: string }
): PageIndexNode[] {
  const excerptChars = Math.max(80, Math.min(8000, Math.trunc(opts?.excerptChars ?? 800)));
  const rootTitle = (opts?.rootTitle || "Document").trim() || "Document";

  const root: PageIndexNode = {
    node_id: "0000",
    title: rootTitle,
    level: 0,
    summary: `Chunk index (${chunks.length} chunk${chunks.length === 1 ? "" : "s"})`,
    excerpt: "",
    nodes: [],
  };

  for (const ch of chunks) {
    const idx = Number.isFinite(ch.chunk_index) ? Math.trunc(ch.chunk_index) : -1;
    if (idx < 0) continue;
    const text = String(ch.text || "");
    const firstLine = normalizeWhitespace(text).split("\n")[0]?.trim() || "";
    const title = (ch.title || firstLine || `Chunk ${idx}`).trim();

    root.nodes!.push({
      node_id: padId(idx),
      title,
      level: 1,
      chunk_index: idx,
      excerpt: excerpt(text, excerptChars),
      summary: excerpt(text, Math.min(400, excerptChars)),
      nodes: [],
    });
  }

  return [root];
}

function tokenizeQuery(q: string): string[] {
  const s = (q || "").toLowerCase();
  const parts = s
    .split(/[^a-z0-9_]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= 1) continue;
    if (out.includes(p)) continue;
    out.push(p);
    if (out.length >= 24) break;
  }
  return out;
}

function scoreHaystack(hay: string, term: string): number {
  if (!hay || !term) return 0;
  let score = 0;
  let i = 0;
  while (true) {
    const idx = hay.indexOf(term, i);
    if (idx === -1) break;
    score += 1;
    i = idx + term.length;
    if (score >= 25) break;
  }
  return score;
}

function nodeSearchText(n: PageIndexNode): string {
  // Prefer the most information-dense text without inflating stored metadata.
  return String(n.excerpt || n.summary || n.prefix_summary || n.text || "");
}

function nodeLevel(n: PageIndexNode, fallback: number): number {
  const v = n.level;
  return Number.isFinite(v as any) ? Math.trunc(v as any) : fallback;
}

export function searchPageIndex(
  roots: PageIndexNode[],
  query: string,
  opts?: { limit?: number }
): PageIndexMatch[] {
  const limit = Math.max(1, Math.min(200, Math.trunc(opts?.limit ?? 12)));
  const terms = tokenizeQuery(query);
  const qLower = (query || "").toLowerCase().trim();
  if (!qLower) return [];

  const matches: PageIndexMatch[] = [];

  function walk(nodes: PageIndexNode[], path: string[], depth: number) {
    for (const n of nodes) {
      const titleLower = String(n.title || "").toLowerCase();
      const bodyLower = nodeSearchText(n).toLowerCase();

      let score = 0;

      if (qLower.length >= 3) {
        if (titleLower.includes(qLower)) score += 8;
        if (bodyLower.includes(qLower)) score += 3;
      }

      for (const t of terms) {
        score += scoreHaystack(titleLower, t) * 5;
        score += scoreHaystack(bodyLower, t) * 1;
      }

      if (score > 0) {
        matches.push({
          node_id: String(n.node_id || ""),
          title: String(n.title || ""),
          level: nodeLevel(n, depth),
          score,
          path: [...path, String(n.title || "")],
          excerpt: nodeSearchText(n),
          line_num: n.line_num,
          start_line: n.start_line,
          end_line: n.end_line,
          chunk_index: n.chunk_index,
          physical_index: n.physical_index,
          start_index: n.start_index,
          end_index: n.end_index,
        });
      }

      if (n.nodes && n.nodes.length) walk(n.nodes, [...path, String(n.title || "")], depth + 1);
    }
  }

  walk(roots || [], [], 0);

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}

