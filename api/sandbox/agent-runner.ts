/* eslint-disable no-console */
/**
 * Project Memory Agent (Sandbox Runner)
 *
 * This runs inside Cloudflare Sandbox Containers and communicates with the
 * Memory API over HTTP (Authorization is passed through from the gateway worker).
 *
 * Conventions:
 * - Emit structured progress on stderr as: `[trace] {json}`
 * - Emit final machine-readable output as a single JSON line on stdout.
 */

type HistoryMessage = { role: "user" | "assistant"; content: string };

type RetrievedMemory = {
  id: string;
  project_id: string;
  category: string;
  title: string;
  content_excerpt: string;
  tags: string[];
  confidence: number;
  updated_at: string;
};

type RetrievedAsset = {
  id: string;
  project_id: string;
  status: string;
  content_type: string;
  byte_size: number;
  original_name: string | null;
  created_at: string;
};

type RetrievedDocument = {
  kind: "pageindex";
  artifact_id: string;
  project_id: string;
  node_id: string;
  title: string;
  path: string[];
  excerpt: string;
  score: number;
};

type AskResponse = {
  ok: boolean;
  query: string;
  project_id: string | null;
  memory_mode?: "fast" | "balanced" | "deep";
  provider?: { kind: "none" | "anthropic"; model?: string };
  retrieved: { memories: RetrievedMemory[]; assets_index: Record<string, RetrievedAsset[]>; documents?: RetrievedDocument[] };
  answer: string | null;
  notes?: string[];
};

type RunnerOutput = {
  success: boolean;
  sessionId: string;
  projectId: string;
  query: string;
  provider: { kind: "none" | "anthropic"; model?: string };
  retrieved: { memories: RetrievedMemory[]; assets_index: Record<string, RetrievedAsset[]>; documents?: RetrievedDocument[] };
  answer: string | null;
  notes: string[];
  error?: string;
};

function trace(event: Record<string, unknown>) {
  try {
    console.error(`[trace] ${JSON.stringify(event)}`);
  } catch {
    // Ignore trace failures; never crash the run for observability.
  }
}

function required(name: string, v: string | undefined | null): string {
  const s = String(v ?? "").trim();
  if (!s) throw new Error(`${name} is required`);
  return s;
}

function truthy(v: string | undefined | null): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function normalizeMemoryMode(v: string | undefined | null): "fast" | "balanced" | "deep" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "fast" || s === "deep") return s;
  return "balanced";
}

function clampInt(v: string | undefined | null, fallback: number, min: number, max: number): number {
  const n = v ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function safeJsonParse<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function excerpt(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}...`;
}

function normalizeBaseUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<any> {
  const timeoutMs = typeof init.timeoutMs === "number" ? init.timeoutMs : 30_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

async function memoryApiJson(
  baseUrl: string,
  authorization: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<any> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  if (authorization) headers.set("Authorization", authorization);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  return fetchJson(url, { ...init, headers, timeoutMs: init.timeoutMs });
}

async function fetchBytes(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const timeoutMs = typeof init.timeoutMs === "number" ? init.timeoutMs : 30_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
    if (!res.ok) {
      const text = buf.byteLength ? new TextDecoder().decode(new Uint8Array(buf)).slice(0, 2000) : "";
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
    }
    const ct = res.headers.get("content-type");
    return { bytes: new Uint8Array(buf), contentType: ct };
  } finally {
    clearTimeout(t);
  }
}

async function memoryApiBytes(
  baseUrl: string,
  authorization: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  if (authorization) headers.set("Authorization", authorization);
  return fetchBytes(url, { ...init, headers, timeoutMs: init.timeoutMs });
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContentBlock[] };
type AnthropicResponse = { content?: AnthropicContentBlock[]; model?: string };

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

async function anthropicRequest(opts: {
  apiKey: string;
  system: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  maxTokens: number;
  model?: string;
  version?: string;
}): Promise<{ blocks: AnthropicContentBlock[]; model: string }> {
  const apiKey = required("ANTHROPIC_API_KEY", opts.apiKey);
  // Opus 4.5 model id per Anthropic announcement.
  const model = (opts.model && opts.model.trim()) || "claude-opus-4-5-20251101";
  const version = (opts.version && opts.version.trim()) || "2023-06-01";

  const tools = Array.isArray(opts.tools) ? opts.tools : undefined;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": version,
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.max(64, Math.min(4096, Math.trunc(opts.maxTokens))),
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(tools ? { tools } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const blocks = Array.isArray(data.content) ? data.content : [];
  return { blocks, model: data.model || model };
}

function buildEvidenceContext(retrieved: AskResponse["retrieved"]): string {
  const ctxLines: string[] = [];
  ctxLines.push("EVIDENCE MEMORIES:");
  for (const m of retrieved.memories.slice(0, 12)) {
    ctxLines.push(`- [mem:${m.id}] category=${m.category} confidence=${Number(m.confidence || 0).toFixed(2)} updated_at=${m.updated_at}`);
    ctxLines.push(`  title: ${m.title}`);
    ctxLines.push(`  content: ${m.content_excerpt}`);
    if (m.tags?.length) ctxLines.push(`  tags: ${m.tags.slice(0, 24).join(", ")}`);

    const assets = retrieved.assets_index?.[m.id] || [];
    if (assets.length) {
      ctxLines.push(`  assets:`);
      for (const a of assets.slice(0, 8)) {
        ctxLines.push(`    - [asset:${a.id}] ${a.original_name || "asset"} (${a.content_type}, ${a.byte_size} bytes, status=${a.status})`);
      }
    }
  }
  if (retrieved.memories.length === 0) {
    ctxLines.push("- (none matched)");
  }

  const docs = Array.isArray(retrieved.documents) ? retrieved.documents : [];
  if (docs.length) {
    ctxLines.push("");
    ctxLines.push("DOCUMENT INDEX MATCHES:");
    for (const d of docs.slice(0, 12)) {
      ctxLines.push(`- [doc:${d.artifact_id}#${d.node_id}] score=${Number(d.score || 0).toFixed(0)} title=${d.title}`);
      if (Array.isArray(d.path) && d.path.length) ctxLines.push(`  path: ${d.path.slice(-5).join(" > ")}`);
      if (d.excerpt) ctxLines.push(`  excerpt: ${excerpt(String(d.excerpt || ""), 900)}`);
    }
  }
  return ctxLines.join("\n");
}

function isTextLikeContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  if (ct.startsWith("text/")) return true;
  if (ct.includes("json")) return true;
  if (ct.includes("xml")) return true;
  if (ct.includes("yaml") || ct.includes("yml")) return true;
  if (ct.includes("toml")) return true;
  if (ct.includes("javascript")) return true;
  if (ct.includes("typescript")) return true;
  if (ct.includes("csv")) return true;
  return false;
}

function mergeRetrieved(
  into: AskResponse["retrieved"],
  next: AskResponse["retrieved"]
): AskResponse["retrieved"] {
  const byId = new Map(into.memories.map((m) => [m.id, m]));
  for (const m of next.memories || []) {
    if (!m || !m.id) continue;
    if (byId.has(m.id)) continue;
    into.memories.push(m);
    byId.set(m.id, m);
  }

  const idx = into.assets_index || (into.assets_index = {});
  const nextIdx = next.assets_index || {};
  for (const [k, assets] of Object.entries(nextIdx)) {
    if (!Array.isArray(assets) || assets.length === 0) continue;
    const existing = idx[k] || [];
    const seen = new Set(existing.map((a) => a.id));
    for (const a of assets) {
      if (!a || !a.id) continue;
      if (seen.has(a.id)) continue;
      existing.push(a);
      seen.add(a.id);
    }
    idx[k] = existing;
  }

  const docs = Array.isArray(into.documents) ? into.documents : ((into as any).documents = []);
  const nextDocs = Array.isArray(next.documents) ? next.documents : [];
  const seenDocs = new Set(docs.map((d: any) => `${String(d.artifact_id)}#${String(d.node_id)}`));
  for (const d of nextDocs) {
    if (!d || !d.artifact_id || !d.node_id) continue;
    const key = `${String((d as any).artifact_id)}#${String((d as any).node_id)}`;
    if (seenDocs.has(key)) continue;
    docs.push(d as any);
    seenDocs.add(key);
  }

  return into;
}

function blocksToText(blocks: AnthropicContentBlock[]): string {
  const out: string[] = [];
  for (const b of blocks || []) {
    if (b && b.type === "text" && typeof (b as any).text === "string") out.push((b as any).text);
  }
  return out.join("").trim();
}

async function main(): Promise<void> {
  const sessionId = required("SESSION_ID", process.env.SESSION_ID);
  const projectId = required("PROJECT_ID", process.env.PROJECT_ID);
  const query = required("PROMPT", process.env.PROMPT);
  const apiBaseUrl = normalizeBaseUrl(required("API_BASE_URL", process.env.API_BASE_URL));

  // IMPORTANT: do not log Authorization. It may be a Clerk JWT or API token.
  const authorization = String(process.env.AUTHORIZATION || "").trim();

  const history = safeJsonParse<HistoryMessage[]>(process.env.HISTORY_JSON, []).filter(
    (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
  );

  const dryRun = truthy(process.env.DRY_RUN);
  const includeAssets = !truthy(process.env.INCLUDE_ASSETS) ? false : true;
  const memoryMode = normalizeMemoryMode(process.env.MEMORY_MODE);
  const evidenceLimit = clampInt(process.env.EVIDENCE_LIMIT, 12, 1, 50);
  const maxTokens = clampInt(process.env.MAX_TOKENS, 900, 128, 2048);

  trace({ type: "status", sessionId, projectId, message: "sandbox agent started" });
  trace({ type: "status", sessionId, message: "retrieving evidence from memory api" });

  const ask: AskResponse = (await memoryApiJson(apiBaseUrl, authorization, "/api/agent/ask", {
    method: "POST",
    body: JSON.stringify({
      query,
      project_id: projectId,
      include_assets: includeAssets,
      include_documents: true,
      memory_mode: memoryMode,
      dry_run: true, // retrieval only; synthesis happens here with conversation history
      limit: evidenceLimit,
    }),
  })) as AskResponse;

  const retrieved = ask?.retrieved || { memories: [], assets_index: {} };
  trace({ type: "evidence", sessionId, memoryCount: retrieved.memories.length, docCount: Array.isArray(retrieved.documents) ? retrieved.documents.length : 0 });

  let provider: RunnerOutput["provider"] = { kind: "none" };
  let answer: string | null = null;
  const notes: string[] = [];

  const anthropicKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  const anthropicModel = String(process.env.ANTHROPIC_MODEL || "").trim();
  const anthropicVersion = String(process.env.ANTHROPIC_VERSION || "").trim();

  if (dryRun) {
    notes.push("dry_run=true: retrieval only (no synthesis).");
  } else if (!anthropicKey) {
    notes.push("ANTHROPIC_API_KEY not configured for sandbox run (no synthesis).");
  } else {
    trace({ type: "status", sessionId, message: "running agent loop (anthropic tools)" });

    const tools: AnthropicTool[] = [
      {
        name: "search_evidence",
        description:
          "Search project memory for relevant evidence (and linked asset metadata). Use this when the initial evidence is insufficient or you need a narrower query.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query to run against project memories." },
            project_id: { type: "string", description: "Optional project id override (defaults to the current session project)." },
            limit: { type: "integer", minimum: 1, maximum: 50 },
            include_assets: { type: "boolean", description: "Whether to include linked asset metadata in results." },
            include_documents: { type: "boolean", description: "Whether to include document index matches (PageIndex artifacts)." },
            document_limit: { type: "integer", minimum: 0, maximum: 50, description: "Max document evidence items to return (0 disables)." },
            retrieval_mode: {
              type: "string",
              enum: ["auto", "memories", "documents", "hybrid"],
              description: "Retrieval mode hint. Use documents/hybrid when searching manuals/specs/PDF sections.",
            },
            memory_mode: {
              type: "string",
              enum: ["fast", "balanced", "deep"],
              description: "Memory retrieval profile: fast (lowest latency), balanced (default), deep (higher recall).",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "read_asset_text",
        description:
          "Read a text chunk from an asset (logs, JSON, YAML, config). Use small ranges. If the file is large, read a small chunk first and then read further ranges as needed.",
        input_schema: {
          type: "object",
          properties: {
            asset_id: { type: "string" },
            byte_start: { type: "integer", minimum: 0 },
            max_bytes: { type: "integer", minimum: 256, maximum: 120000 },
          },
          required: ["asset_id"],
          additionalProperties: false,
        },
      },
      {
        name: "list_assets",
        description:
          "List project assets (files) and optionally filter by filename query or status. Use this to find logs/build outputs to read and attach as evidence.",
        input_schema: {
          type: "object",
          properties: {
            project_id: { type: "string", description: "Optional project id override (defaults to the current session project)." },
            q: { type: "string", description: "Optional search query (matches filename and storage key)." },
            status: { type: "string", description: "Optional status filter (e.g. ready|uploading|aborted)." },
            limit: { type: "integer", minimum: 1, maximum: 200 },
            include_memory_links: { type: "boolean", description: "Include linked memory summaries for each asset." },
          },
          additionalProperties: false,
        },
      },
      {
        name: "record_memory",
        description:
          "Record durable project memory (note/bug/decision/pattern/summary). Use this when the user asks you to save conclusions so the team can retrieve them later.",
        input_schema: {
          type: "object",
          properties: {
            project_id: { type: "string", description: "Optional project id override (defaults to the current session project)." },
            category: { type: "string", description: "Memory category (e.g. note, bug, decision, pattern, architecture, lesson, summary)." },
            title: { type: "string" },
            content: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["title", "content"],
          additionalProperties: false,
        },
      },
      {
        name: "attach_asset_to_memory",
        description:
          "Attach an existing asset (file) to a memory so future retrieval includes it as evidence (logs, screenshots, build artifacts).",
        input_schema: {
          type: "object",
          properties: {
            memory_id: { type: "string" },
            asset_id: { type: "string" },
            relation: { type: "string", description: "Optional relation label (default: attachment)." },
          },
          required: ["memory_id", "asset_id"],
          additionalProperties: false,
        },
      },
      {
        name: "list_artifacts",
        description:
          "List project artifacts (documents). Use this to find indexed docs and then read specific PageIndex nodes.",
        input_schema: {
          type: "object",
          properties: {
            project_id: { type: "string", description: "Optional project id override (defaults to the current session project)." },
            type: { type: "string", description: "Optional artifact type filter." },
            limit: { type: "integer", minimum: 1, maximum: 200 },
          },
          additionalProperties: false,
        },
      },
      {
        name: "index_artifact_pageindex",
        description:
          "Build/rebuild a PageIndex for an artifact so it can be retrieved and cited as [doc:<artifact>#<node>].",
        input_schema: {
          type: "object",
          properties: {
            artifact_id: { type: "string" },
            kind: { type: "string", description: "Index kind: auto|markdown|chunks|pageindex_md|pageindex_pdf" },
          },
          required: ["artifact_id"],
          additionalProperties: false,
        },
      },
      {
        name: "read_document_node",
        description:
          "Read one PageIndex node from an artifact (breadcrumb path + node fields). Use this to quote specific doc sections as evidence.",
        input_schema: {
          type: "object",
          properties: {
            artifact_id: { type: "string" },
            node_id: { type: "string" },
          },
          required: ["artifact_id", "node_id"],
          additionalProperties: false,
        },
      },
    ];

    const system = [
      "You are PajamaDot Game Dev Agent (Claude Code-like tool agent) running in a sandbox.",
      "You are chatting with a user about a game-dev project.",
      "You have access to tools to search project memories, list/read assets (files), list/index/read artifacts (docs), and record durable memories.",
      "Use ONLY project memories and asset contents/metadata as evidence.",
      "Only record new memories or attach files when the user asks you to (or when it's an explicit next step and you call it out).",
      "If evidence is insufficient, say so and propose exactly what to record/upload next.",
      "Cite memories as [mem:<uuid>] and assets as [asset:<uuid>] when used.",
      "Cite documents as [doc:<artifact_uuid>#<node_id>] when used.",
      "Keep the answer concise and action-oriented.",
    ].join("\n");

    const mergedRetrieved: AskResponse["retrieved"] = {
      memories: [...(retrieved.memories || [])],
      assets_index: { ...(retrieved.assets_index || {}) },
      documents: Array.isArray((retrieved as any).documents) ? ([...((retrieved as any).documents as any[])] as any) : [],
    };
    const extraAssets: RetrievedAsset[] = [];
    const searchEvidenceCache = new Map<string, AskResponse>();
    const listAssetsCache = new Map<string, any>();
    const listArtifactsCache = new Map<string, any>();
    const assetMetaCache = new Map<string, any>();
    const assetTextCache = new Map<string, { text: string; truncated: boolean; byteLength: number }>();
    const docNodeCache = new Map<string, any>();
    const indexArtifactCache = new Map<string, any>();

    const older = history.length > 0 ? history.slice(0, Math.max(0, history.length - 1)) : [];
    const messages: AnthropicMessage[] = [...older.map((m) => ({ role: m.role, content: m.content }))];
    messages.push({
      role: "user",
      content: `Question:\n${query}\n\nInitial evidence (from memory search):\n${buildEvidenceContext(mergedRetrieved)}\n\nIf you need more evidence, use the tools.`,
    });

    const MAX_TURNS = 8;
    let modelUsed = anthropicModel || undefined;

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const res = await anthropicRequest({
        apiKey: anthropicKey,
        system,
        messages,
        tools,
        maxTokens,
        model: modelUsed,
        version: anthropicVersion || undefined,
      });

      modelUsed = res.model || modelUsed;
      const blocks = Array.isArray(res.blocks) ? res.blocks : [];
      messages.push({ role: "assistant", content: blocks });

      const toolUses = blocks.filter((b) => b && b.type === "tool_use") as Array<
        Extract<AnthropicContentBlock, { type: "tool_use" }>
      >;

      if (toolUses.length === 0) {
        provider = { kind: "anthropic", model: res.model };
        answer = blocksToText(blocks) || null;
        break;
      }

      const toolResults: AnthropicContentBlock[] = [];

      for (const tu of toolUses.slice(0, 6)) {
        const name = String(tu.name || "").trim();
        const input = tu.input;

        trace({ type: "tool_call", sessionId, name, input: typeof input === "object" ? input : String(input) });

        try {
          if (name === "search_evidence") {
            const anyInput = (input && typeof input === "object" ? (input as any) : {}) as any;
            const q = typeof anyInput.query === "string" ? anyInput.query.trim() : "";
            if (!q) throw new Error("query is required");
            const pid = typeof anyInput.project_id === "string" && anyInput.project_id.trim() ? anyInput.project_id.trim() : projectId;
            const lim = clampInt(String(anyInput.limit ?? ""), evidenceLimit, 1, 50);
            const inc = typeof anyInput.include_assets === "boolean" ? anyInput.include_assets : includeAssets;
            const incDocs = typeof anyInput.include_documents === "boolean" ? anyInput.include_documents : true;
            const docLim = clampInt(String(anyInput.document_limit ?? ""), 8, 0, 50);
            const modeRaw = typeof anyInput.retrieval_mode === "string" ? anyInput.retrieval_mode.trim().toLowerCase() : "";
            const retrieval_mode = modeRaw === "memories" || modeRaw === "documents" || modeRaw === "hybrid" ? modeRaw : "auto";
            const memModeRaw = typeof anyInput.memory_mode === "string" ? anyInput.memory_mode.trim().toLowerCase() : "";
            const memory_mode = memModeRaw === "fast" || memModeRaw === "deep" ? memModeRaw : "balanced";
            const cacheKey = JSON.stringify({
              q,
              pid,
              lim,
              inc,
              incDocs,
              docLim,
              retrieval_mode,
              memory_mode,
            });

            let more = searchEvidenceCache.get(cacheKey);
            if (!more) {
              more = (await memoryApiJson(apiBaseUrl, authorization, "/api/agent/ask", {
                method: "POST",
                body: JSON.stringify({
                  query: q,
                  project_id: pid,
                  include_assets: inc,
                  include_documents: incDocs,
                  document_limit: docLim,
                  retrieval_mode,
                  memory_mode,
                  dry_run: true,
                  limit: lim,
                }),
              })) as AskResponse;
              searchEvidenceCache.set(cacheKey, more);
            } else {
              trace({ type: "cache_hit", sessionId, tool: name });
            }

            if (more && more.retrieved) {
              mergeRetrieved(mergedRetrieved, more.retrieved);
            }

            const docs = Array.isArray(more?.retrieved?.documents) ? more!.retrieved!.documents! : [];

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: true,
                query: q,
                memory_count: (more?.retrieved?.memories || []).length,
                document_count: docs.length,
                memories: (more?.retrieved?.memories || []).slice(0, 12).map((m) => ({
                  id: m.id,
                  category: m.category,
                  title: m.title,
                  updated_at: m.updated_at,
                  excerpt: m.content_excerpt,
                })),
                documents: docs.slice(0, 8).map((d) => ({
                  kind: d.kind,
                  artifact_id: d.artifact_id,
                  node_id: d.node_id,
                  title: d.title,
                  score: d.score,
                  path: d.path,
                  excerpt: d.excerpt,
                })),
              }),
            });

            trace({
              type: "tool_result",
              sessionId,
              name,
              ok: true,
              memories: (more?.retrieved?.memories || []).length,
              documents: docs.length,
            });
            continue;
          }

          if (name === "read_asset_text") {
            const anyInput = (input && typeof input === "object" ? (input as any) : {}) as any;
            const assetId = typeof anyInput.asset_id === "string" ? anyInput.asset_id.trim() : "";
            if (!assetId) throw new Error("asset_id is required");
            const byteStart = typeof anyInput.byte_start === "number" && Number.isFinite(anyInput.byte_start) ? Math.trunc(anyInput.byte_start) : 0;
            const maxBytes = clampInt(String(anyInput.max_bytes ?? ""), 40_000, 256, 120_000);
            if (byteStart < 0) throw new Error("byte_start must be >= 0");
            const textCacheKey = `${assetId}:${byteStart}:${maxBytes}`;
            const cachedText = assetTextCache.get(textCacheKey);

            const cachedMeta = assetMetaCache.get(assetId);
            const meta = cachedMeta
              ? cachedMeta
              : await memoryApiJson(apiBaseUrl, authorization, `/api/assets/${encodeURIComponent(assetId)}`);
            if (!cachedMeta) assetMetaCache.set(assetId, meta);
            else trace({ type: "cache_hit", sessionId, tool: `${name}:meta` });
            const status = meta?.status ? String(meta.status) : "";
            const contentType = meta?.content_type ? String(meta.content_type) : null;
            const byteSize = meta?.byte_size ? Number(meta.byte_size) : null;
            const originalName = meta?.original_name ? String(meta.original_name) : null;

            if (status && status !== "ready") {
              throw new Error(`Asset is not ready (status=${status})`);
            }
            if (!isTextLikeContentType(contentType)) {
              throw new Error(`Asset content_type is not text-like (${contentType || "unknown"})`);
            }

            const byteEnd = byteStart + maxBytes - 1;
            let preview = "";
            let truncated = false;
            let readBytes = 0;
            if (cachedText) {
              trace({ type: "cache_hit", sessionId, tool: name });
              preview = cachedText.text;
              truncated = cachedText.truncated;
              readBytes = cachedText.byteLength;
            } else {
              const { bytes } = await memoryApiBytes(
                apiBaseUrl,
                authorization,
                `/api/assets/${encodeURIComponent(assetId)}/object?byte_start=${byteStart}&byte_end=${byteEnd}`,
                { timeoutMs: 45_000 }
              );

              const text = new TextDecoder().decode(bytes);
              preview = excerpt(text, 12_000);
              truncated = preview.length < text.length;
              readBytes = bytes.length;
              assetTextCache.set(textCacheKey, { text: preview, truncated, byteLength: readBytes });
            }

            const assetSummary: RetrievedAsset = {
              id: assetId,
              project_id: meta?.project_id ? String(meta.project_id) : projectId,
              status: status || "ready",
              content_type: contentType || "text/plain",
              byte_size: typeof byteSize === "number" && Number.isFinite(byteSize) ? Math.trunc(byteSize) : readBytes,
              original_name: originalName,
              created_at: meta?.created_at ? String(meta.created_at) : "",
            };
            if (!extraAssets.find((a) => a.id === assetId)) extraAssets.push(assetSummary);

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: true,
                asset_id: assetId,
                original_name: originalName,
                content_type: contentType,
                byte_size: byteSize,
                byte_start: byteStart,
                byte_end: byteStart + readBytes - 1,
                text: preview,
                truncated,
              }),
            });

            trace({ type: "tool_result", sessionId, name, ok: true, bytes: readBytes });
            continue;
          }

          if (name === "list_assets") {
            const anyInput = (input && typeof input === "object" ? (input as any) : {}) as any;
            const pid = typeof anyInput.project_id === "string" && anyInput.project_id.trim() ? anyInput.project_id.trim() : projectId;
            const q = typeof anyInput.q === "string" ? anyInput.q.trim() : "";
            const status = typeof anyInput.status === "string" ? anyInput.status.trim() : "";
            const lim = clampInt(String(anyInput.limit ?? ""), 30, 1, 200);
            const includeLinks = typeof anyInput.include_memory_links === "boolean" ? anyInput.include_memory_links : false;

            const qs: string[] = [];
            if (pid) qs.push(`project_id=${encodeURIComponent(pid)}`);
            if (q) qs.push(`q=${encodeURIComponent(q)}`);
            if (status) qs.push(`status=${encodeURIComponent(status)}`);
            if (includeLinks) qs.push(`include_memory_links=true`);
            qs.push(`limit=${encodeURIComponent(String(lim))}`);
            const cacheKey = JSON.stringify({ pid, q, status, includeLinks, lim });
            const cached = listAssetsCache.get(cacheKey);
            const data = cached
              ? cached
              : await memoryApiJson(apiBaseUrl, authorization, `/api/assets?${qs.join("&")}`, { method: "GET" });
            if (!cached) listAssetsCache.set(cacheKey, data);
            else trace({ type: "cache_hit", sessionId, tool: name });
            const assets = Array.isArray(data?.assets) ? (data.assets as any[]) : [];

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: true,
                count: assets.length,
                assets: assets.slice(0, Math.min(50, assets.length)).map((a) => ({
                  id: String(a.id || ""),
                  project_id: String(a.project_id || ""),
                  status: String(a.status || ""),
                  content_type: String(a.content_type || ""),
                  byte_size: Number(a.byte_size || 0),
                  original_name: a.original_name ? String(a.original_name) : null,
                  created_at: String(a.created_at || ""),
                  linked_memory_count: typeof a.linked_memory_count === "number" ? a.linked_memory_count : undefined,
                })),
              }),
            });

            trace({ type: "tool_result", sessionId, name, ok: true, assets: assets.length });
            continue;
          }

          if (name === "record_memory") {
            const anyInput = (input && typeof input === "object" ? (input as any) : {}) as any;
            const pid = typeof anyInput.project_id === "string" && anyInput.project_id.trim() ? anyInput.project_id.trim() : projectId;
            const category = typeof anyInput.category === "string" && anyInput.category.trim() ? anyInput.category.trim() : "note";
            const title = typeof anyInput.title === "string" ? anyInput.title.trim() : "";
            const content = typeof anyInput.content === "string" ? anyInput.content.trim() : "";
            if (!title) throw new Error("title is required");
            if (!content) throw new Error("content is required");
            const confidence =
              typeof anyInput.confidence === "number" && Number.isFinite(anyInput.confidence)
                ? Math.max(0, Math.min(1, anyInput.confidence))
                : 0.6;

            const tagsIn = anyInput.tags;
            const tags =
              Array.isArray(tagsIn)
                ? tagsIn.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim()).slice(0, 32)
                : [];

            const created = await memoryApiJson(apiBaseUrl, authorization, "/api/memories", {
              method: "POST",
              body: JSON.stringify({
                project_id: pid,
                session_id: null,
                category,
                source_type: "agent_pro",
                title,
                content,
                tags,
                context: { recorded_by: "agent_pro", agent_session_id: sessionId },
                confidence,
              }),
            });

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({ ok: true, memory_id: String(created?.id || ""), created_at: created?.created_at || null }),
            });

            trace({ type: "tool_result", sessionId, name, ok: true, memory_id: String(created?.id || "") });
            continue;
          }

          if (name === "attach_asset_to_memory") {
            const anyInput = (input && typeof input === "object" ? (input as any) : {}) as any;
            const memoryId = typeof anyInput.memory_id === "string" ? anyInput.memory_id.trim() : "";
            const assetId = typeof anyInput.asset_id === "string" ? anyInput.asset_id.trim() : "";
            const relation = typeof anyInput.relation === "string" && anyInput.relation.trim() ? anyInput.relation.trim() : "attachment";
            if (!memoryId) throw new Error("memory_id is required");
            if (!assetId) throw new Error("asset_id is required");

            const linked = await memoryApiJson(
              apiBaseUrl,
              authorization,
              `/api/memories/${encodeURIComponent(memoryId)}/attach-asset`,
              {
                method: "POST",
                body: JSON.stringify({ asset_id: assetId, relation }),
              }
            );

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({ ok: true, link_id: linked?.link_id || null }),
            });

            trace({ type: "tool_result", sessionId, name, ok: true, memory_id: memoryId, asset_id: assetId });
            continue;
          }

          if (name === "list_artifacts") {
            const anyInput = (input && typeof input === "object" ? (input as any) : {}) as any;
            const pid = typeof anyInput.project_id === "string" && anyInput.project_id.trim() ? anyInput.project_id.trim() : projectId;
            const type = typeof anyInput.type === "string" ? anyInput.type.trim() : "";
            const lim = clampInt(String(anyInput.limit ?? ""), 30, 1, 200);

            const qs: string[] = [];
            if (pid) qs.push(`project_id=${encodeURIComponent(pid)}`);
            if (type) qs.push(`type=${encodeURIComponent(type)}`);
            qs.push(`limit=${encodeURIComponent(String(lim))}`);
            qs.push("include_metadata=false");
            const cacheKey = JSON.stringify({ pid, type, lim });
            const cached = listArtifactsCache.get(cacheKey);
            const data = cached
              ? cached
              : await memoryApiJson(apiBaseUrl, authorization, `/api/artifacts?${qs.join("&")}`, { method: "GET" });
            if (!cached) listArtifactsCache.set(cacheKey, data);
            else trace({ type: "cache_hit", sessionId, tool: name });
            const artifacts = Array.isArray(data?.artifacts) ? (data.artifacts as any[]) : [];

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: true,
                count: artifacts.length,
                artifacts: artifacts.slice(0, Math.min(50, artifacts.length)).map((a) => ({
                  id: String(a.id || ""),
                  project_id: String(a.project_id || ""),
                  type: String(a.type || ""),
                  storage_mode: String(a.storage_mode || ""),
                  content_type: String(a.content_type || ""),
                  byte_size: Number(a.byte_size || 0),
                  has_pageindex: Boolean((a as any).has_pageindex),
                  created_at: String(a.created_at || ""),
                })),
              }),
            });

            trace({ type: "tool_result", sessionId, name, ok: true, artifacts: artifacts.length });
            continue;
          }

          if (name === "index_artifact_pageindex") {
            const anyInput = (input && typeof input === "object" ? (input as any) : {}) as any;
            const artifactId = typeof anyInput.artifact_id === "string" ? anyInput.artifact_id.trim() : "";
            if (!artifactId) throw new Error("artifact_id is required");
            const kind = typeof anyInput.kind === "string" && anyInput.kind.trim() ? anyInput.kind.trim() : "auto";
            const cacheKey = `${artifactId}:${kind}`;
            const cached = indexArtifactCache.get(cacheKey);
            const data = cached
              ? cached
              : await memoryApiJson(
                  apiBaseUrl,
                  authorization,
                  `/api/artifacts/${encodeURIComponent(artifactId)}/pageindex`,
                  { method: "POST", body: JSON.stringify({ kind }) }
                );
            if (!cached) indexArtifactCache.set(cacheKey, data);
            else trace({ type: "cache_hit", sessionId, tool: name });

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: true,
                artifact_id: String(data?.artifact_id || artifactId),
                kind: String(data?.pageindex?.kind || kind),
                node_count: Number(data?.pageindex?.node_count || 0),
              }),
            });

            trace({ type: "tool_result", sessionId, name, ok: true, artifact_id: artifactId });
            continue;
          }

          if (name === "read_document_node") {
            const anyInput = (input && typeof input === "object" ? (input as any) : {}) as any;
            const artifactId = typeof anyInput.artifact_id === "string" ? anyInput.artifact_id.trim() : "";
            const nodeId = typeof anyInput.node_id === "string" ? anyInput.node_id.trim() : "";
            if (!artifactId) throw new Error("artifact_id is required");
            if (!nodeId) throw new Error("node_id is required");
            const cacheKey = `${artifactId}#${nodeId}`;
            const cached = docNodeCache.get(cacheKey);
            const data = cached
              ? cached
              : await memoryApiJson(
                  apiBaseUrl,
                  authorization,
                  `/api/artifacts/${encodeURIComponent(artifactId)}/pageindex/node/${encodeURIComponent(nodeId)}`,
                  { method: "GET" }
                );
            if (!cached) docNodeCache.set(cacheKey, data);
            else trace({ type: "cache_hit", sessionId, tool: name });

            // Add this node into the document evidence set so it is persisted as part of the assistant message evidence.
            const title = typeof data?.node?.title === "string" ? data.node.title : typeof data?.node?.name === "string" ? data.node.name : "";
            const excerptText =
              typeof data?.node?.excerpt === "string"
                ? data.node.excerpt
                : typeof data?.node?.text === "string"
                  ? excerpt(String(data.node.text), 900)
                  : typeof data?.node?.summary === "string"
                    ? excerpt(String(data.node.summary), 900)
                    : "";

            const docEntry: RetrievedDocument = {
              kind: "pageindex",
              artifact_id: String(data?.artifact_id || artifactId),
              project_id: String(data?.project_id || projectId),
              node_id: String(data?.node_id || nodeId),
              title: title || String(data?.node_id || nodeId),
              path: Array.isArray(data?.path) ? data.path.map((p: any) => String(p?.title || "")).filter(Boolean) : [],
              excerpt: excerptText,
              score: 100,
            };

            const docs = Array.isArray((mergedRetrieved as any).documents) ? ((mergedRetrieved as any).documents as any[]) : ((mergedRetrieved as any).documents = []);
            const key = `${docEntry.artifact_id}#${docEntry.node_id}`;
            const seen = new Set(docs.map((d: any) => `${String(d?.artifact_id)}#${String(d?.node_id)}`));
            if (!seen.has(key)) docs.push(docEntry as any);

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({
                ok: true,
                artifact_id: docEntry.artifact_id,
                node_id: docEntry.node_id,
                path: data?.path || [],
                node: data?.node || null,
                children: data?.children || [],
              }),
            });

            trace({ type: "tool_result", sessionId, name, ok: true, artifact_id: artifactId, node_id: nodeId });
            continue;
          }

          throw new Error(`Unknown tool: ${name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({ ok: false, error: msg }),
            is_error: true,
          });
          trace({ type: "tool_result", sessionId, name, ok: false, error: msg });
        }
      }

      // Provide tool results to the model as a user message.
      messages.push({ role: "user", content: toolResults });
    }

    if (!answer) {
      notes.push("Agent loop ended without a final text answer; returning best-effort fallback.");
    }

    // Persist extra assets into the evidence index so the gateway can include them in the assistant message evidence list.
    if (extraAssets.length) {
      (mergedRetrieved.assets_index as any)["__direct_assets__"] = extraAssets;
    }

    provider = provider.kind === "anthropic" ? provider : { kind: "anthropic", model: modelUsed };
    // Replace retrieval output with the merged evidence we actually used.
    (retrieved as any).memories = mergedRetrieved.memories;
    (retrieved as any).assets_index = mergedRetrieved.assets_index;
    (retrieved as any).documents = (mergedRetrieved as any).documents || [];
  }

  if (!answer) {
    // Deterministic fallback for environments without an LLM.
    const top = retrieved.memories.slice(0, 8);
    const lines = [
      "No synthesis answer available.",
      "",
      top.length ? "Top evidence memories:" : "No memories matched this query.",
      ...top.map((m) => `- [mem:${m.id}] ${m.title} (${m.category})`),
      "",
      "Next: record a memory for this topic, and attach logs/screenshots as assets so the agent has evidence to cite.",
    ];
    answer = lines.join("\n");
  }

  trace({ type: "status", sessionId, message: "done" });

  const out: RunnerOutput = {
    success: true,
    sessionId,
    projectId,
    query,
    provider,
    retrieved,
    answer,
    notes,
  };

  console.log(JSON.stringify(out));
}

main().catch((err) => {
  const sessionId = String(process.env.SESSION_ID || "");
  const projectId = String(process.env.PROJECT_ID || "");
  const query = String(process.env.PROMPT || "");
  trace({ type: "error", sessionId, message: err instanceof Error ? err.message : String(err) });

  const out: RunnerOutput = {
    success: false,
    sessionId,
    projectId,
    query,
    provider: { kind: "none" },
    retrieved: { memories: [], assets_index: {} },
    answer: null,
    notes: [],
    error: err instanceof Error ? err.message : String(err),
  };
  // Always emit a final JSON line so the gateway can persist a failure deterministically.
  console.log(JSON.stringify(out));
});
