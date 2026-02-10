/* eslint-disable no-console */
/**
 * Project Memory Pro Agent (Sandbox Runner)
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
    ];

    const system = [
      "You are PajamaDot Game Dev Agent (Claude Code-like tool agent) running in a sandbox.",
      "You are chatting with a user about a game-dev project.",
      "You have access to tools to search project memories and to read chunks of text assets (logs/config).",
      "Use ONLY project memories and asset contents/metadata as evidence.",
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

            const more: AskResponse = (await memoryApiJson(apiBaseUrl, authorization, "/api/agent/ask", {
              method: "POST",
              body: JSON.stringify({
                query: q,
                project_id: pid,
                include_assets: inc,
                include_documents: incDocs,
                document_limit: docLim,
                retrieval_mode,
                dry_run: true,
                limit: lim,
              }),
            })) as AskResponse;

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

            const meta = await memoryApiJson(apiBaseUrl, authorization, `/api/assets/${encodeURIComponent(assetId)}`);
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
            const { bytes } = await memoryApiBytes(
              apiBaseUrl,
              authorization,
              `/api/assets/${encodeURIComponent(assetId)}/object?byte_start=${byteStart}&byte_end=${byteEnd}`,
              { timeoutMs: 45_000 }
            );

            const text = new TextDecoder().decode(bytes);
            const preview = excerpt(text, 12_000);

            const assetSummary: RetrievedAsset = {
              id: assetId,
              project_id: meta?.project_id ? String(meta.project_id) : projectId,
              status: status || "ready",
              content_type: contentType || "text/plain",
              byte_size: typeof byteSize === "number" && Number.isFinite(byteSize) ? Math.trunc(byteSize) : bytes.length,
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
                byte_end: byteStart + bytes.length - 1,
                text: preview,
                truncated: preview.length < text.length,
              }),
            });

            trace({ type: "tool_result", sessionId, name, ok: true, bytes: bytes.length });
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
