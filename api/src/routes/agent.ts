import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import { createMemory, listMemories } from "../core/memories";
import { anthropicMessages } from "../agent/anthropic";
import { retrievePageIndexEvidence, type PageIndexEvidence } from "../agent/pageindex";
import { heuristicRetrievalPlan, llmRetrievalPlan, type RetrievalPlan } from "../agent/retrievalPlanner";

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeTags(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((t) => typeof t === "string");
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === "string");
    } catch {
      // ignore
    }
  }
  return [];
}

function excerpt(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}...`;
}

function fallbackSynthesis(opts: {
  query: string;
  projectId: string | null;
  dryRun: boolean;
  llmConfigured: boolean;
  memoryCount: number;
  docCount: number;
}): { answer: string; notes: string[] } {
  const scope = opts.projectId ? `project ${opts.projectId}` : "all projects";
  const notes: string[] = [];

  if (opts.dryRun) {
    notes.push("dry_run=true (retrieval only): no LLM synthesis requested.");
  } else if (!opts.llmConfigured) {
    notes.push("LLM is not configured on the API. Set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL/ANTHROPIC_VERSION).");
  } else {
    notes.push("LLM synthesis was unavailable (or returned empty). Showing a deterministic summary instead.");
  }

  if (opts.memoryCount === 0 && opts.docCount === 0) {
    notes.push("No matching memories/documents were retrieved for this query.");
  }

  const answer = [
    `I searched ${scope} for: "${opts.query}"`,
    "",
    `Retrieved evidence: ${opts.memoryCount} memories, ${opts.docCount} document matches.`,
    "",
    opts.memoryCount === 0 && opts.docCount === 0
      ? [
          "I don't have enough recorded project memory to answer yet.",
          "",
          "Next steps to make this work:",
          "- Record a memory describing the issue/decision (include reproduction steps, expected vs actual, and outcome).",
          "- Upload logs/build output/profiling captures as assets and link them to that memory.",
          "- (Optional) Upload docs (PDF/MD) as artifacts and run indexing so the agent can cite them.",
        ].join("\n")
      : [
          "Use the retrieved evidence below as starting context.",
          "If you want a synthesized answer, ensure LLM is configured and re-run with dry_run unchecked.",
        ].join("\n"),
  ].join("\n");

  return { answer, notes };
}

type MemorySummary = {
  id: string;
  project_id: string;
  category: string;
  title: string;
  content_excerpt: string;
  tags: string[];
  confidence: number;
  updated_at: string;
};

type AssetSummary = {
  id: string;
  project_id: string;
  status: string;
  content_type: string;
  byte_size: number;
  original_name: string | null;
  created_at: string;
};

type DocumentEvidence = PageIndexEvidence;

function summarizeMemory(m: any): MemorySummary {
  return {
    id: String(m.id),
    project_id: String(m.project_id),
    category: String(m.category || ""),
    title: String(m.title || ""),
    content_excerpt: excerpt(String(m.content || ""), 900),
    tags: normalizeTags(m.tags),
    confidence: typeof m.confidence === "number" ? m.confidence : 0.5,
    updated_at: String(m.updated_at || ""),
  };
}

export const agentRouter = new Hono<AppEnv>();

agentRouter.get("/status", async (c) => {
  const hasAnthropic = Boolean(c.env.ANTHROPIC_API_KEY && String(c.env.ANTHROPIC_API_KEY).trim());
  return c.json({
    ok: true,
    service: "project-memory-agent",
    timestamp: new Date().toISOString(),
    llm: {
      anthropic_configured: hasAnthropic,
      model: c.env.ANTHROPIC_MODEL || null,
      version: c.env.ANTHROPIC_VERSION || null,
    },
  });
});

// Project Memory Agent: retrieval-first "ask" endpoint.
//
// This is intentionally deterministic unless an LLM provider is configured.
agentRouter.post("/ask", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const query = asString(body.query || body.q).trim();
  if (!query) return c.json({ ok: false, error: "query is required" }, 400);

  const projectId = asString(body.project_id || body.projectId).trim() || null;
  const limit = clampInt(body.limit, 12, 1, 50);
  const includeAssets = Boolean(body.include_assets ?? true);
  const includeDocuments = Boolean(body.include_documents ?? body.include_docs ?? true);
  const documentLimit = clampInt(body.document_limit, 8, 0, 50);
  const retrievalMode = asString(body.retrieval_mode || body.retrievalMode || body.mode).trim().toLowerCase() || "auto";

  const dryRun = Boolean(body.dry_run ?? false);

  const allowDocuments = Boolean(projectId && includeDocuments && documentLimit > 0);

  let retrieval_plan: RetrievalPlan = heuristicRetrievalPlan(query, { allowDocuments });
  if (retrievalMode === "memories" || retrievalMode === "memories_only") {
    retrieval_plan = { mode: "manual", strategies: ["memories_fts"], reason: "Manual override: memories only." };
  } else if (retrievalMode === "documents" || retrievalMode === "documents_only") {
    retrieval_plan = allowDocuments
      ? { mode: "manual", strategies: ["pageindex_artifacts"], reason: "Manual override: documents only." }
      : heuristicRetrievalPlan(query, { allowDocuments });
  } else if (retrievalMode === "hybrid") {
    retrieval_plan = allowDocuments
      ? { mode: "manual", strategies: ["memories_fts", "pageindex_artifacts"], reason: "Manual override: hybrid retrieval." }
      : heuristicRetrievalPlan(query, { allowDocuments });
  } else if (retrievalMode === "llm" && !dryRun && c.env.ANTHROPIC_API_KEY) {
    retrieval_plan = await llmRetrievalPlan(c.env as any, query, { allowDocuments });
  }

  const { memories, assetsByMemoryId, documents } = await withDbClient(c.env, async (db) => {
    const memRows = await listMemories(db, tenantType, tenantId, {
      projectId,
      search: query,
      limit,
      mode: "retrieval",
      excludeCategoryPrefixes: ["agent_"],
    });

    const memIds = memRows.map((m: any) => String(m.id));
    const assetsByMemoryId = new Map<string, AssetSummary[]>();

    if (includeAssets && memIds.length > 0) {
      const { rows } = await db.query(
        `SELECT
           l.from_id AS memory_id,
           a.id,
           a.project_id,
           a.status,
           a.content_type,
           a.byte_size,
           a.original_name,
           a.created_at
         FROM entity_links l
         JOIN assets a
           ON a.tenant_type = l.tenant_type
          AND a.tenant_id = l.tenant_id
          AND a.id = l.to_id
         WHERE l.tenant_type = $1 AND l.tenant_id = $2
           AND l.from_type = 'memory'
           AND l.to_type = 'asset'
           AND l.from_id = ANY($3::uuid[])
         ORDER BY a.created_at DESC`,
        [tenantType, tenantId, memIds]
      );

      for (const r of rows) {
        const mid = String((r as any).memory_id);
        const arr = assetsByMemoryId.get(mid) || [];
        arr.push({
          id: String((r as any).id),
          project_id: String((r as any).project_id),
          status: String((r as any).status),
          content_type: String((r as any).content_type),
          byte_size: Number((r as any).byte_size || 0),
          original_name: (r as any).original_name ? String((r as any).original_name) : null,
          created_at: String((r as any).created_at || ""),
        });
        assetsByMemoryId.set(mid, arr);
      }
    }

    let documents: DocumentEvidence[] = [];
    if (projectId && includeDocuments && documentLimit > 0 && retrieval_plan.strategies.includes("pageindex_artifacts")) {
      documents = await retrievePageIndexEvidence(db, tenantType, tenantId, {
        projectId,
        query,
        limit: documentLimit,
      });
    }

    return { memories: memRows, assetsByMemoryId, documents };
  });

  const retrieved = memories.map(summarizeMemory);
  const assets_index: Record<string, AssetSummary[]> = {};
  for (const m of retrieved) {
    const assets = assetsByMemoryId.get(m.id) || [];
    if (assets.length) assets_index[m.id] = assets;
  }

  const retrievedDocs = documents || [];

  let answer: string | null = null;
  let provider: { kind: "none" | "anthropic"; model?: string } = { kind: "none" };
  const notes: string[] = [];
  const llmConfigured = Boolean(c.env.ANTHROPIC_API_KEY && String(c.env.ANTHROPIC_API_KEY).trim());

  if (!dryRun && llmConfigured) {
    const system = [
      "You are PajamaDot Project Memory Agent.",
      "Answer the user's question using ONLY the provided project memories and linked assets metadata as evidence.",
      "If the evidence is insufficient, say so and propose exactly what to record/upload next.",
      "Cite memories as [mem:<uuid>] and assets as [asset:<uuid>] when used.",
      "Cite documents as [doc:<artifact_uuid>#<node_id>] when used.",
      "Keep the answer concise and action-oriented.",
    ].join("\n");

    const ctxLines: string[] = [];
    ctxLines.push("MEMORIES:");
    if (retrieved.length === 0) {
      ctxLines.push("- (none)");
    } else {
      for (const m of retrieved.slice(0, 12)) {
        ctxLines.push(`- [mem:${m.id}] category=${m.category} confidence=${m.confidence.toFixed(2)} updated_at=${m.updated_at}`);
        ctxLines.push(`  title: ${m.title}`);
        ctxLines.push(`  content: ${m.content_excerpt}`);
        if (m.tags.length) ctxLines.push(`  tags: ${m.tags.join(", ")}`);

        const assets = assets_index[m.id] || [];
        if (assets.length) {
          ctxLines.push(`  assets:`);
          for (const a of assets.slice(0, 8)) {
            ctxLines.push(
              `    - [asset:${a.id}] ${a.original_name || "asset"} (${a.content_type}, ${a.byte_size} bytes, status=${a.status})`
            );
          }
        }
      }
    }

    if (retrievedDocs.length) {
      ctxLines.push("");
      ctxLines.push("DOCUMENT INDEX MATCHES:");
      for (const d of retrievedDocs.slice(0, 12)) {
        ctxLines.push(`- [doc:${d.artifact_id}#${d.node_id}] score=${Number(d.score).toFixed(0)} title=${d.title}`);
        if (d.path && d.path.length) ctxLines.push(`  path: ${d.path.slice(-5).join(" > ")}`);
        if (d.excerpt) ctxLines.push(`  excerpt: ${excerpt(String(d.excerpt || ""), 900)}`);
      }
    }

    const ctx = ctxLines.join("\n");
    try {
      const res = await anthropicMessages(c.env, {
        system,
        maxTokens: clampInt(body.max_tokens, 800, 128, 2048),
        messages: [
          {
            role: "user",
            content: `Question:\n${query}\n\nContext:\n${ctx}\n`,
          },
        ],
      });

      answer = res.text || null;
      provider = { kind: "anthropic", model: res.model };
      if (!answer) {
        notes.push(`LLM returned empty response (stop_reason=${res.stopReason ?? "unknown"}).`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`LLM synthesis failed: ${msg}`);
    }
  }

  if (!answer) {
    const fb = fallbackSynthesis({
      query,
      projectId,
      dryRun,
      llmConfigured,
      memoryCount: retrieved.length,
      docCount: retrievedDocs.length,
    });
    answer = fb.answer;
    notes.push(...fb.notes);
  }

  return c.json({
    ok: true,
    query,
    project_id: projectId,
    provider,
    retrieval_plan,
    retrieved: { memories: retrieved, assets_index, documents: retrievedDocs },
    answer,
    notes,
  });
});

function truthy(v: unknown): boolean {
  if (!v) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function safeSessionTitle(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "Agent Session";
  return s.slice(0, 140);
}

function sessionTitleFromContext(ctx: unknown): string | null {
  if (!ctx) return null;
  if (typeof ctx === "object") {
    const anyCtx = ctx as any;
    if (typeof anyCtx.title === "string" && anyCtx.title.trim()) return anyCtx.title.trim().slice(0, 140);
  }
  if (typeof ctx === "string") {
    try {
      const parsed = JSON.parse(ctx);
      if (parsed && typeof parsed === "object" && typeof (parsed as any).title === "string") {
        const t = String((parsed as any).title).trim();
        if (t) return t.slice(0, 140);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

type AgentSessionSummary = {
  id: string;
  project_id: string;
  started_at: string;
  ended_at: string | null;
  title: string;
};

// List "agent chat" sessions (moltworker/story-agent style).
agentRouter.get("/sessions", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id") || null;
  const limit = clampInt(c.req.query("limit"), 50, 1, 200);

  const sessions = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let q = "SELECT * FROM sessions WHERE tenant_type = $1 AND tenant_id = $2 AND kind = 'agent'";
    if (projectId) {
      params.push(projectId);
      q += ` AND project_id = $${params.length}`;
    }
    params.push(limit);
    q += ` ORDER BY started_at DESC LIMIT $${params.length}`;
    const { rows } = await db.query(q, params);
    return rows;
  });

  const out: AgentSessionSummary[] = sessions.map((s: any) => ({
    id: String(s.id),
    project_id: String(s.project_id),
    started_at: String(s.started_at || ""),
    ended_at: s.ended_at ? String(s.ended_at) : null,
    title: sessionTitleFromContext(s.context) || "Agent Session",
  }));

  return c.json({ sessions: out });
});

// Create an agent session (requires project_id).
agentRouter.post("/sessions", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const projectId = asString(body.project_id || body.projectId).trim();
  if (!projectId) return c.json({ ok: false, error: "project_id is required" }, 400);

  const title = safeSessionTitle(body.title);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await withDbClient(c.env, async (db) => {
    const projRes = await db.query("SELECT id FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      projectId,
      tenantType,
      tenantId,
    ]);
    if (projRes.rowCount === 0) {
      throw new Error("Project not found (or not in tenant scope).");
    }

    await db.query(
      `INSERT INTO sessions (id, tenant_type, tenant_id, project_id, kind, started_at, ended_at, context, summary, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'agent', $5, NULL, $6::jsonb, '', $7, $8)`,
      [id, tenantType, tenantId, projectId, now, JSON.stringify({ title }), actorId, actorId]
    );
  });

  return c.json({ ok: true, id, project_id: projectId, title, started_at: now }, 201);
});

// Get one agent session (plus message count).
agentRouter.get("/sessions/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const { session, messageCount } = await withDbClient(c.env, async (db) => {
    const sRes = await db.query(
      "SELECT * FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND kind = 'agent'",
      [id, tenantType, tenantId]
    );
    const session = sRes.rows[0] ?? null;
    if (!session) return { session: null, messageCount: 0 };

    const cRes = await db.query(
      `SELECT COUNT(*)::int AS cnt
       FROM memories
       WHERE tenant_type = $1 AND tenant_id = $2 AND session_id = $3
         AND category IN ('agent_user', 'agent_assistant')`,
      [tenantType, tenantId, id]
    );
    const messageCount = cRes.rows[0]?.cnt ? Number(cRes.rows[0].cnt) : 0;

    return { session, messageCount };
  });

  if (!session) return c.json({ error: "Session not found" }, 404);

  return c.json({
    id: String(session.id),
    project_id: String(session.project_id),
    started_at: String(session.started_at || ""),
    ended_at: session.ended_at ? String(session.ended_at) : null,
    title: sessionTitleFromContext(session.context) || "Agent Session",
    message_count: messageCount,
  });
});

// List chat messages (stored as memories) for an agent session.
agentRouter.get("/sessions/:id/messages", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const limit = clampInt(c.req.query("limit"), 200, 1, 500);

  const rows = await withDbClient(c.env, async (db) => {
    const sRes = await db.query(
      "SELECT id FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND kind = 'agent'",
      [id, tenantType, tenantId]
    );
    if (sRes.rowCount === 0) return null;

    const { rows } = await db.query(
      `SELECT id, category, title, content, context, created_at, updated_at, created_by
       FROM memories
       WHERE tenant_type = $1 AND tenant_id = $2 AND session_id = $3
         AND category IN ('agent_user', 'agent_assistant')
       ORDER BY created_at ASC
       LIMIT $4`,
      [tenantType, tenantId, id, limit]
    );
    return rows;
  });

  if (!rows) return c.json({ error: "Session not found" }, 404);
  return c.json({ session_id: id, messages: rows });
});

// Continue an agent session with a new user message.
//
// This is a pragmatic "worker-native" variant of the moltworker/story-agent pattern:
// we persist message history in Postgres (as memories) and do retrieval + optional synthesis.
agentRouter.post("/sessions/:id/continue", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const sessionId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const message = asString(body.content || body.message || body.query || body.q).trim();
  if (!message) return c.json({ ok: false, error: "content is required" }, 400);

  const includeAssets = truthy(body.include_assets ?? true);
  const includeDocuments = truthy(body.include_documents ?? body.include_docs ?? true);
  const dryRun = truthy(body.dry_run ?? false);
  const historyLimit = clampInt(body.history_limit, 20, 0, 200);
  const evidenceLimit = clampInt(body.evidence_limit ?? body.limit, 12, 1, 50);
  const documentLimit = clampInt(body.document_limit, 8, 0, 50);
  const retrievalMode = asString(body.retrieval_mode || body.retrievalMode || body.mode).trim().toLowerCase() || "auto";

  const now = new Date().toISOString();
  const userMessageId = crypto.randomUUID();

  const allowDocuments = Boolean(includeDocuments && documentLimit > 0);

  let retrieval_plan: RetrievalPlan = heuristicRetrievalPlan(message, { allowDocuments });
  if (retrievalMode === "memories" || retrievalMode === "memories_only") {
    retrieval_plan = { mode: "manual", strategies: ["memories_fts"], reason: "Manual override: memories only." };
  } else if (retrievalMode === "documents" || retrievalMode === "documents_only") {
    retrieval_plan = allowDocuments
      ? { mode: "manual", strategies: ["pageindex_artifacts"], reason: "Manual override: documents only." }
      : heuristicRetrievalPlan(message, { allowDocuments });
  } else if (retrievalMode === "hybrid") {
    retrieval_plan = allowDocuments
      ? { mode: "manual", strategies: ["memories_fts", "pageindex_artifacts"], reason: "Manual override: hybrid retrieval." }
      : heuristicRetrievalPlan(message, { allowDocuments });
  } else if (retrievalMode === "llm" && !dryRun && c.env.ANTHROPIC_API_KEY) {
    retrieval_plan = await llmRetrievalPlan(c.env as any, message, { allowDocuments });
  }

  const { projectId, history, retrieved, assets_index, documents } = await withDbClient(c.env, async (db) => {
    const sRes = await db.query(
      "SELECT id, project_id FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND kind = 'agent'",
      [sessionId, tenantType, tenantId]
    );
    const session = sRes.rows[0] ?? null;
    if (!session) throw new Error("Session not found (or not in tenant scope).");

    const projectId = String(session.project_id);

    // Persist user message.
    await createMemory(db, {
      tenantType,
      tenantId,
      actorId,
      id: userMessageId,
      projectId,
      sessionId,
      category: "agent_user",
      sourceType: "agent",
      title: `User: ${excerpt(message, 80)}`,
      content: message,
      tags: ["agent", "chat"],
      context: { role: "user", session_id: sessionId },
      confidence: 1.0,
      nowIso: now,
    });

    // Pull recent history (including the message we just wrote).
    const historyRows =
      historyLimit > 0
        ? (
            await db.query(
              `SELECT category, content, created_at
               FROM memories
               WHERE tenant_type = $1 AND tenant_id = $2 AND session_id = $3
                 AND category IN ('agent_user', 'agent_assistant')
               ORDER BY created_at DESC
               LIMIT $4`,
              [tenantType, tenantId, sessionId, historyLimit]
            )
          ).rows
        : [];

    const history = historyRows
      .slice()
      .reverse()
      .map((r: any) => ({
        role: String(r.category) === "agent_assistant" ? ("assistant" as const) : ("user" as const),
        content: String(r.content || ""),
      }));

    // Evidence retrieval: search project memory using the new message.
    const memRows = await listMemories(db, tenantType, tenantId, {
      projectId,
      search: message,
      limit: 50,
      mode: "retrieval",
      excludeCategoryPrefixes: ["agent_"],
    });
    const evidence = memRows.slice(0, evidenceLimit);

    const evidenceSummaries = evidence.map(summarizeMemory);

    const memIds = evidenceSummaries.map((m) => m.id);
    const assetsByMemoryId = new Map<string, AssetSummary[]>();

    if (includeAssets && memIds.length > 0) {
      const { rows } = await db.query(
        `SELECT
           l.from_id AS memory_id,
           a.id,
           a.project_id,
           a.status,
           a.content_type,
           a.byte_size,
           a.original_name,
           a.created_at
         FROM entity_links l
         JOIN assets a
           ON a.tenant_type = l.tenant_type
          AND a.tenant_id = l.tenant_id
          AND a.id = l.to_id
         WHERE l.tenant_type = $1 AND l.tenant_id = $2
           AND l.from_type = 'memory'
           AND l.to_type = 'asset'
           AND l.from_id = ANY($3::uuid[])
         ORDER BY a.created_at DESC`,
        [tenantType, tenantId, memIds]
      );

      for (const r of rows) {
        const mid = String((r as any).memory_id);
        const arr = assetsByMemoryId.get(mid) || [];
        arr.push({
          id: String((r as any).id),
          project_id: String((r as any).project_id),
          status: String((r as any).status),
          content_type: String((r as any).content_type),
          byte_size: Number((r as any).byte_size || 0),
          original_name: (r as any).original_name ? String((r as any).original_name) : null,
          created_at: String((r as any).created_at || ""),
        });
        assetsByMemoryId.set(mid, arr);
      }
    }

    const assets_index: Record<string, AssetSummary[]> = {};
    for (const m of evidenceSummaries) {
      const assets = assetsByMemoryId.get(m.id) || [];
      if (assets.length) assets_index[m.id] = assets;
    }

    let documents: DocumentEvidence[] = [];
    if (includeDocuments && documentLimit > 0 && retrieval_plan.strategies.includes("pageindex_artifacts")) {
      documents = await retrievePageIndexEvidence(db, tenantType, tenantId, {
        projectId,
        query: message,
        limit: documentLimit,
      });
    }

    return { projectId, history, retrieved: evidenceSummaries, assets_index, documents };
  });

  let answer: string | null = null;
  let provider: { kind: "none" | "anthropic"; model?: string } = { kind: "none" };

  if (!dryRun && c.env.ANTHROPIC_API_KEY) {
    const system = [
      "You are PajamaDot Project Memory Agent.",
      "You are chatting with a user about a game-dev project.",
      "Use ONLY the provided project memories and linked assets metadata as evidence.",
      "If the evidence is insufficient, say so and propose exactly what to record/upload next.",
      "Cite memories as [mem:<uuid>] and assets as [asset:<uuid>] when used.",
      "Cite documents as [doc:<artifact_uuid>#<node_id>] when used.",
      "Keep the answer concise and action-oriented.",
    ].join("\n");

    const ctxLines: string[] = [];
    ctxLines.push("EVIDENCE MEMORIES:");
    for (const m of retrieved.slice(0, 12)) {
      ctxLines.push(`- [mem:${m.id}] category=${m.category} confidence=${m.confidence.toFixed(2)} updated_at=${m.updated_at}`);
      ctxLines.push(`  title: ${m.title}`);
      ctxLines.push(`  content: ${m.content_excerpt}`);
      if (m.tags.length) ctxLines.push(`  tags: ${m.tags.join(", ")}`);

      const assets = assets_index[m.id] || [];
      if (assets.length) {
        ctxLines.push(`  assets:`);
        for (const a of assets.slice(0, 8)) {
          ctxLines.push(
            `    - [asset:${a.id}] ${a.original_name || "asset"} (${a.content_type}, ${a.byte_size} bytes, status=${a.status})`
          );
        }
      }
    }
    if (retrieved.length === 0) {
      ctxLines.push("- (none matched)");
    }

    if (documents && documents.length) {
      ctxLines.push("");
      ctxLines.push("DOCUMENT INDEX MATCHES:");
      for (const d of documents.slice(0, 12)) {
        ctxLines.push(`- [doc:${d.artifact_id}#${d.node_id}] score=${Number(d.score).toFixed(0)} title=${d.title}`);
        if (d.path && d.path.length) ctxLines.push(`  path: ${d.path.slice(-5).join(" > ")}`);
        if (d.excerpt) ctxLines.push(`  excerpt: ${excerpt(String(d.excerpt || ""), 900)}`);
      }
    }

    const ctx = ctxLines.join("\n");

    // Keep conversation history, but replace the last user message with an evidence-augmented prompt.
    const older = history.slice(0, Math.max(0, history.length - 1));
    const messages = [
      ...older.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: `Question:\n${message}\n\nEvidence:\n${ctx}\n` },
    ];

    const res = await anthropicMessages(c.env, {
      system,
      maxTokens: clampInt(body.max_tokens, 800, 128, 2048),
      messages,
    });

    answer = res.text || null;
    provider = { kind: "anthropic", model: res.model };
  }

  let assistantMessageId: string | null = null;
  if (answer) {
    const evidence_memory_ids = retrieved.map((m) => m.id);
    const evidence_asset_ids: string[] = [];
    for (const assets of Object.values(assets_index || {})) {
      for (const a of assets || []) {
        const id = String((a as any).id || "");
        if (!id) continue;
        if (evidence_asset_ids.includes(id)) continue;
        evidence_asset_ids.push(id);
        if (evidence_asset_ids.length >= 200) break;
      }
      if (evidence_asset_ids.length >= 200) break;
    }

    const evidence_documents = (documents || []).slice(0, 100).map((d) => ({ artifact_id: d.artifact_id, node_id: d.node_id }));

    assistantMessageId = crypto.randomUUID();
    await withDbClient(c.env, async (db) => {
      await createMemory(db, {
        tenantType,
        tenantId,
        actorId,
        id: assistantMessageId!,
        projectId,
        sessionId,
        category: "agent_assistant",
        sourceType: "agent",
        title: "Assistant",
        content: answer!,
        tags: ["agent", "chat"],
        context: {
          role: "assistant",
          provider,
          session_id: sessionId,
          evidence: { memory_ids: evidence_memory_ids, asset_ids: evidence_asset_ids, documents: evidence_documents },
        },
        confidence: 0.6,
        nowIso: new Date().toISOString(),
      });
    });
  }

  return c.json({
    ok: true,
    session_id: sessionId,
    project_id: projectId,
    provider,
    retrieval_plan,
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
    retrieved: { memories: retrieved, assets_index, documents: documents || [] },
    answer,
    notes:
      provider.kind === "none"
        ? ["LLM is not configured (or dry_run=true). Returning retrieval results only."]
        : [],
  });
});


