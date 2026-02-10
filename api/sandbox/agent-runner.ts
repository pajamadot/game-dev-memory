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

type AskResponse = {
  ok: boolean;
  query: string;
  project_id: string | null;
  provider?: { kind: "none" | "anthropic"; model?: string };
  retrieved: { memories: RetrievedMemory[]; assets_index: Record<string, RetrievedAsset[]> };
  answer: string | null;
  notes?: string[];
};

type RunnerOutput = {
  success: boolean;
  sessionId: string;
  projectId: string;
  query: string;
  provider: { kind: "none" | "anthropic"; model?: string };
  retrieved: { memories: RetrievedMemory[]; assets_index: Record<string, RetrievedAsset[]> };
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

type AnthropicMessage = { role: "user" | "assistant"; content: string };
type AnthropicResponse = { content?: { type?: string; text?: string }[]; model?: string };

async function anthropicMessages(opts: {
  apiKey: string;
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
  model?: string;
  version?: string;
}): Promise<{ text: string; model: string }> {
  const apiKey = required("ANTHROPIC_API_KEY", opts.apiKey);
  const model = (opts.model && opts.model.trim()) || "claude-3-5-sonnet-20241022";
  const version = (opts.version && opts.version.trim()) || "2023-06-01";

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
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const parts = Array.isArray(data.content) ? data.content : [];
  const out = parts
    .filter((p) => p && (p.type === "text" || p.type === undefined) && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();

  return { text: out, model: data.model || model };
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
  return ctxLines.join("\n");
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
      dry_run: true, // retrieval only; synthesis happens here with conversation history
      limit: evidenceLimit,
    }),
  })) as AskResponse;

  const retrieved = ask?.retrieved || { memories: [], assets_index: {} };
  trace({ type: "evidence", sessionId, memoryCount: retrieved.memories.length });

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
    trace({ type: "status", sessionId, message: "synthesizing answer (anthropic)" });
    const system = [
      "You are PajamaDot Project Memory Pro Agent.",
      "You are chatting with a user about a game-dev project.",
      "Use ONLY the provided project memories and linked assets metadata as evidence.",
      "If the evidence is insufficient, say so and propose exactly what to record/upload next.",
      "Cite memories as [mem:<uuid>] and assets as [asset:<uuid>] when used.",
      "Keep the answer concise and action-oriented.",
    ].join("\n");

    const evidenceCtx = buildEvidenceContext(retrieved);

    const older = history.length > 0 ? history.slice(0, Math.max(0, history.length - 1)) : [];
    const messages: AnthropicMessage[] = [
      ...older.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: `Question:\n${query}\n\nEvidence:\n${evidenceCtx}\n` },
    ];

    const res = await anthropicMessages({
      apiKey: anthropicKey,
      system,
      messages,
      maxTokens,
      model: anthropicModel || undefined,
      version: anthropicVersion || undefined,
    });

    provider = { kind: "anthropic", model: res.model };
    answer = res.text || null;
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

