#!/usr/bin/env node
/**
 * Fetch arXiv Atom feeds and generate:
 * - a dated digest markdown file
 * - per-paper note stubs (abstract + TODO sections)
 *
 * This is intentionally dependency-free (regex XML parsing) so the skill works
 * in minimal Node environments.
 *
 * Usage:
 *   node skills/agent-memory-research/scripts/fetch_arxiv.js
 *   node skills/agent-memory-research/scripts/fetch_arxiv.js --since-days 90 --max-results 40
 *   node skills/agent-memory-research/scripts/fetch_arxiv.js --query "cat:cs.AI AND all:memory AND all:agent"
 *   node skills/agent-memory-research/scripts/fetch_arxiv.js --url "https://export.arxiv.org/api/query?search_query=all:LongMemEval&start=0&max_results=10"
 *
 * Options:
 *   --out <dir>            Output directory (default: research/agent-memory)
 *   --since-days <n>       Only include papers published in last N days (default: 45)
 *   --max-results <n>      max_results per feed/query URL (default: 25)
 *   --query <q>            arXiv search_query string (repeatable)
 *   --id-list <csv>        comma-separated arXiv ids (repeatable)
 *   --url <u>              full arXiv API query URL (repeatable)
 *   --no-notes             Only write digest, do not create per-paper note files
 *   --overwrite            Overwrite existing per-paper note files (default: false)
 */

const fs = require("fs");
const path = require("path");

function fail(msg) {
  console.error(`[agent-memory-research] ${msg}`);
  process.exit(1);
}

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function parseArgs(argv) {
  const out = {
    outDir: path.join(repoRoot(), "research", "agent-memory"),
    sinceDays: 45,
    maxResults: 25,
    queries: [],
    idLists: [],
    urls: [],
    writeNotes: true,
    overwriteNotes: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) fail(`Missing value for ${a}`);
      i += 1;
      return v;
    };

    if (a === "--out") out.outDir = path.resolve(repoRoot(), next());
    else if (a === "--since-days") out.sinceDays = Math.max(0, parseInt(next(), 10) || 0);
    else if (a === "--max-results") out.maxResults = Math.max(1, Math.min(200, parseInt(next(), 10) || out.maxResults));
    else if (a === "--query") out.queries.push(next());
    else if (a === "--id-list" || a === "--ids") out.idLists.push(next());
    else if (a === "--url") out.urls.push(next());
    else if (a === "--no-notes") out.writeNotes = false;
    else if (a === "--overwrite") out.overwriteNotes = true;
    else if (a === "--help" || a === "-h") {
      console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(0, 40).join("\n"));
      process.exit(0);
    } else {
      fail(`Unknown arg: ${a}`);
    }
  }

  return out;
}

function htmlDecode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "");
}

function normalizeWhitespace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function extractAll(hay, re) {
  const out = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m;
  while ((m = rx.exec(hay))) out.push(m);
  return out;
}

function extractOne(hay, re) {
  const m = re.exec(hay);
  return m ? m[1] : "";
}

function parseArxivAtom(xml) {
  const entries = extractAll(xml, /<entry>([\s\S]*?)<\/entry>/g).map((m) => m[1]);
  const papers = [];

  for (const e of entries) {
    const rawTitle = extractOne(e, /<title>([\s\S]*?)<\/title>/);
    const rawId = extractOne(e, /<id>([\s\S]*?)<\/id>/);
    const rawPublished = extractOne(e, /<published>([\s\S]*?)<\/published>/);
    const rawUpdated = extractOne(e, /<updated>([\s\S]*?)<\/updated>/);
    const rawSummary = extractOne(e, /<summary[^>]*>([\s\S]*?)<\/summary>/);

    const title = normalizeWhitespace(htmlDecode(stripTags(rawTitle)));
    const idUrl = normalizeWhitespace(htmlDecode(stripTags(rawId)));
    const published = normalizeWhitespace(htmlDecode(stripTags(rawPublished)));
    const updated = normalizeWhitespace(htmlDecode(stripTags(rawUpdated)));
    const summary = normalizeWhitespace(htmlDecode(stripTags(rawSummary)));

    const authorMatches = extractAll(e, /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g);
    const authors = authorMatches.map((m) => normalizeWhitespace(htmlDecode(stripTags(m[1])))).filter(Boolean);

    const catMatches = extractAll(e, /<category[^>]*term="([^"]+)"[^>]*\/?>/g);
    const categories = catMatches.map((m) => normalizeWhitespace(htmlDecode(stripTags(m[1])))).filter(Boolean);

    const linkMatches = extractAll(e, /<link\b([^>]+?)\/>/g);
    let absUrl = "";
    let pdfUrl = "";
    for (const lm of linkMatches) {
      const attrs = lm[1];
      const href = extractOne(attrs, /\bhref="([^"]+)"/);
      const titleAttr = extractOne(attrs, /\btitle="([^"]+)"/);
      const rel = extractOne(attrs, /\brel="([^"]+)"/);
      if (!href) continue;
      if (!absUrl && (rel === "alternate" || href.includes("/abs/"))) absUrl = href;
      if (!pdfUrl && (titleAttr.toLowerCase() === "pdf" || href.includes("/pdf/"))) pdfUrl = href;
    }

    // Fallbacks.
    if (!absUrl && idUrl) absUrl = idUrl;

    // Extract arXiv id from URL (strip version suffix).
    let arxivId = "";
    const mAbs = /arxiv\.org\/abs\/([^?#/]+?)(v\d+)?$/.exec(absUrl);
    if (mAbs) arxivId = mAbs[1];
    const mId = /arxiv\.org\/abs\/([^?#/]+?)(v\d+)?$/.exec(idUrl);
    if (!arxivId && mId) arxivId = mId[1];
    arxivId = arxivId.replace(/v\d+$/i, "");

    if (!title || !absUrl || !arxivId) continue;

    papers.push({
      arxivId,
      title,
      absUrl,
      pdfUrl: pdfUrl || "",
      published,
      updated,
      authors,
      categories,
      summary,
    });
  }

  return papers;
}

function buildArxivUrlFromQuery(q, maxResults) {
  const qp = encodeURIComponent(String(q || "").trim());
  if (!qp) return "";
  return `https://export.arxiv.org/api/query?search_query=${qp}&start=0&max_results=${maxResults}`;
}

function buildArxivUrlFromIdList(csv) {
  const ids = String(csv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/v\\d+$/i, ""));
  if (ids.length === 0) return "";
  // NOTE: arXiv supports up to ~300 ids in one call; keep it small for stability.
  return `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(ids.slice(0, 100).join(","))}`;
}

function clampRecent(papers, sinceDays) {
  if (!sinceDays) return papers;
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return papers.filter((p) => {
    const t = Date.parse(p.published || "");
    return Number.isFinite(t) && t >= cutoff;
  });
}

function dedupeById(papers) {
  const by = new Map();
  for (const p of papers) {
    const key = String(p.arxivId || "").toLowerCase();
    if (!key) continue;
    if (!by.has(key)) by.set(key, p);
  }
  return [...by.values()];
}

function sortNewest(papers) {
  return papers.slice().sort((a, b) => Date.parse(b.published || "") - Date.parse(a.published || ""));
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function renderDigest(date, sources, papers) {
  const lines = [];
  lines.push(`# Agent Memory arXiv Digest (${date})`);
  lines.push("");
  lines.push(`Fetched ${papers.length} paper(s). This is a raw candidate list for curation.`);
  lines.push("");
  for (const p of papers) {
    const pub = p.published ? p.published.slice(0, 10) : "";
    const cats = Array.isArray(p.categories) && p.categories.length ? `; ${p.categories.slice(0, 6).join(", ")}` : "";
    lines.push(`- [${p.title}](${p.absUrl}) (${pub || "unknown"}${cats})`);
  }
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  for (const s of sources) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## Next");
  lines.push("");
  lines.push("- Pick 5-10 papers, read abstract/introduction, and add notes to their per-paper files.");
  lines.push("- Promote the best findings into `web/src/content/research/agent-memory.md`.");
  return lines.join("\n");
}

function renderPaperNote(p) {
  const lines = [];
  lines.push(`# ${p.title}`);
  lines.push("");
  lines.push(`- arXiv: ${p.arxivId}`);
  lines.push(`- URL: ${p.absUrl}`);
  if (p.pdfUrl) lines.push(`- PDF: ${p.pdfUrl}`);
  if (p.published) lines.push(`- Published: ${p.published}`);
  if (p.updated) lines.push(`- Updated: ${p.updated}`);
  if (p.categories && p.categories.length) lines.push(`- Categories: ${p.categories.join(", ")}`);
  if (p.authors && p.authors.length) lines.push(`- Authors: ${p.authors.join(", ")}`);
  lines.push("");
  lines.push("## Abstract");
  lines.push("");
  lines.push(p.summary ? p.summary : "_(no abstract parsed)_");
  lines.push("");
  lines.push("## What This Adds (fill in)");
  lines.push("");
  lines.push("- Problem:");
  lines.push("- Memory mechanism (write/update/retrieve/forget):");
  lines.push("- Evaluation / benchmarks:");
  lines.push("- Failure modes / tradeoffs:");
  lines.push("");
  lines.push("## How This Maps To game-dev-memory (fill in)");
  lines.push("");
  lines.push("- What to store (tables/assets):");
  lines.push("- Retrieval pattern:");
  lines.push("- Evolution trigger:");
  lines.push("- UI affordance:");
  return lines.join("\n");
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "game-dev-memory/0.1 (agent-memory-research; +https://pajamadot.com)",
      accept: "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return await res.text();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const defaultQueries = [
    'cat:cs.AI AND all:memory AND all:agent',
    'cat:cs.CL AND (all:"long-term" OR all:retrieval) AND all:memory',
    'all:"workflow memory" AND (all:agent OR all:llm)',
    'all:LongMemEval OR all:LoCoMo',
  ];

  const urls = [];
  for (const q of (opts.queries.length ? opts.queries : defaultQueries)) {
    const u = buildArxivUrlFromQuery(q, opts.maxResults);
    if (u) urls.push(u);
  }
  for (const csv of opts.idLists) {
    const u = buildArxivUrlFromIdList(csv);
    if (u) urls.push(u);
  }
  for (const u of opts.urls) urls.push(u);

  if (urls.length === 0) fail("No queries/urls provided");

  ensureDir(opts.outDir);
  const digestDir = path.join(opts.outDir, "digests");
  const paperDir = path.join(opts.outDir, "papers");
  ensureDir(digestDir);
  ensureDir(paperDir);

  const all = [];
  for (const u of urls) {
    process.stderr.write(`[agent-memory-research] fetching ${u}\n`);
    const xml = await fetchText(u);
    const parsed = parseArxivAtom(xml);
    for (const p of parsed) all.push(p);
  }

  const recent = sortNewest(clampRecent(dedupeById(all), opts.sinceDays)).slice(0, 80);

  const date = todayUtc();
  const digestPath = path.join(digestDir, `arxiv-${date}.md`);
  fs.writeFileSync(digestPath, renderDigest(date, urls, recent), "utf8");

  if (opts.writeNotes) {
    for (const p of recent) {
      const notePath = path.join(paperDir, `${p.arxivId}.md`);
      if (!opts.overwriteNotes && fs.existsSync(notePath)) continue;
      fs.writeFileSync(notePath, renderPaperNote(p), "utf8");
    }
  }

  console.log(`[agent-memory-research] wrote digest: ${path.relative(repoRoot(), digestPath)}`);
  if (opts.writeNotes) console.log(`[agent-memory-research] notes dir: ${path.relative(repoRoot(), paperDir)}`);
}

main().catch((err) => {
  console.error(`[agent-memory-research] error: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
