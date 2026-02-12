import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import { createMemory } from "../core/memories";
import { getSandbox, parseSSEStream, type ExecEvent } from "@cloudflare/sandbox";

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function truthy(v: unknown): boolean {
  if (!v) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function excerpt(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}...`;
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

function sseJson(writer: WritableStreamDefaultWriter<Uint8Array>, data: unknown): Promise<boolean> {
  const enc = new TextEncoder();
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  return writer
    .write(enc.encode(payload))
    .then(() => true)
    .catch(() => false);
}

function sseComment(writer: WritableStreamDefaultWriter<Uint8Array>, text: string): Promise<boolean> {
  const enc = new TextEncoder();
  const payload = `: ${text.replace(/\r?\n/g, " ")}\n\n`;
  return writer
    .write(enc.encode(payload))
    .then(() => true)
    .catch(() => false);
}

type ProAgentSessionSummary = {
  id: string;
  project_id: string;
  started_at: string;
  ended_at: string | null;
  title: string;
};

export const agentProRouter = new Hono<AppEnv>();

agentProRouter.get("/status", async (c) => {
  const hasSandbox = Boolean((c.env as any).Sandbox);
  const hasAnthropic = Boolean(c.env.ANTHROPIC_API_KEY && String(c.env.ANTHROPIC_API_KEY).trim());
  return c.json({
    ok: true,
    service: "project-memory-pro-agent",
    timestamp: new Date().toISOString(),
    sandbox: { configured: hasSandbox },
    llm: {
      anthropic_configured: hasAnthropic,
      model: c.env.ANTHROPIC_MODEL || null,
      version: c.env.ANTHROPIC_VERSION || null,
    },
  });
});

// List pro agent sessions (container-backed).
agentProRouter.get("/sessions", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id") || null;
  const limit = clampInt(c.req.query("limit"), 50, 1, 200);

  const sessions = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let q = "SELECT * FROM sessions WHERE tenant_type = $1 AND tenant_id = $2 AND kind = 'agent_pro'";
    if (projectId) {
      params.push(projectId);
      q += ` AND project_id = $${params.length}`;
    }
    params.push(limit);
    q += ` ORDER BY started_at DESC LIMIT $${params.length}`;
    const { rows } = await db.query(q, params);
    return rows;
  });

  const out: ProAgentSessionSummary[] = sessions.map((s: any) => ({
    id: String(s.id),
    project_id: String(s.project_id),
    started_at: String(s.started_at || ""),
    ended_at: s.ended_at ? String(s.ended_at) : null,
    title: sessionTitleFromContext(s.context) || "Agent Session",
  }));

  return c.json({ sessions: out });
});

// Create a pro agent session (requires project_id).
agentProRouter.post("/sessions", async (c) => {
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
       VALUES ($1, $2, $3, $4, 'agent_pro', $5, NULL, $6::jsonb, '', $7, $8)`,
      [id, tenantType, tenantId, projectId, now, JSON.stringify({ title, mode: "pro" }), actorId, actorId]
    );
  });

  return c.json({ ok: true, id, project_id: projectId, title, started_at: now }, 201);
});

// Get one pro agent session (plus message count).
agentProRouter.get("/sessions/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const { session, messageCount } = await withDbClient(c.env, async (db) => {
    const sRes = await db.query(
      "SELECT * FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND kind = 'agent_pro'",
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

// List chat messages (stored as memories) for a pro agent session.
agentProRouter.get("/sessions/:id/messages", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const limit = clampInt(c.req.query("limit"), 200, 1, 500);

  const rows = await withDbClient(c.env, async (db) => {
    const sRes = await db.query(
      "SELECT id FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND kind = 'agent_pro'",
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

// Continue a pro agent session using Cloudflare Sandbox Containers.
//
// Response: SSE stream of structured progress events; final "done" includes answer + evidence.
agentProRouter.post("/sessions/:id/continue", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const sessionId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const corsOrigin = c.req.raw.headers.get("Origin") || "*";
  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  } as const;

  if (!c.env.Sandbox) {
    return c.json({ ok: false, error: "Sandbox is not configured for this worker (missing DO binding)." }, 501);
  }

  const message = asString(body.content || body.message || body.query || body.q).trim();
  if (!message) return c.json({ ok: false, error: "content is required" }, 400);

  const dryRun = truthy(body.dry_run ?? false);
  const includeAssets = truthy(body.include_assets ?? true);
  const historyLimit = clampInt(body.history_limit, 20, 0, 200);
  const evidenceLimit = clampInt(body.evidence_limit ?? body.limit, 12, 1, 50);
  const maxTokens = clampInt(body.max_tokens, 900, 128, 2048);
  const memoryModeRaw = asString(body.memory_mode || body.memoryMode || body.search_mode || body.searchMode).trim().toLowerCase();
  const memoryMode = memoryModeRaw === "fast" || memoryModeRaw === "deep" ? memoryModeRaw : "balanced";

  const now = new Date().toISOString();
  const userMessageId = crypto.randomUUID();

  const { projectId, history } = await withDbClient(c.env, async (db) => {
    const sRes = await db.query(
      "SELECT id, project_id FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND kind = 'agent_pro'",
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
      sourceType: "agent_pro",
      title: `User: ${excerpt(message, 80)}`,
      content: message,
      tags: ["agent", "chat", "pro"],
      context: { role: "user", session_id: sessionId, mode: "pro" },
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

    return { projectId, history };
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const apiOrigin = new URL(c.req.raw.url).origin;
  const authorization = c.req.raw.headers.get("Authorization") || c.req.raw.headers.get("authorization") || "";

  const sandbox = getSandbox(c.env.Sandbox, sessionId, { keepAlive: true });
  let execStream: ReadableStream<Uint8Array>;
  try {
    execStream = await sandbox.execStream("npx tsx /workspace/agent-runner.ts", {
      env: {
        PROMPT: message,
        SESSION_ID: sessionId,
        PROJECT_ID: projectId,
        HISTORY_JSON: JSON.stringify(history || []),
        API_BASE_URL: apiOrigin,
        AUTHORIZATION: authorization,
        DRY_RUN: dryRun ? "true" : "false",
        INCLUDE_ASSETS: includeAssets ? "true" : "false",
        MEMORY_MODE: memoryMode,
        EVIDENCE_LIMIT: String(evidenceLimit),
        MAX_TOKENS: String(maxTokens),
        ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || "",
        ANTHROPIC_MODEL: c.env.ANTHROPIC_MODEL || "",
        ANTHROPIC_VERSION: c.env.ANTHROPIC_VERSION || "",
        CI: "true",
        TERM: "dumb",
        NO_COLOR: "1",
      },
      timeout: 960_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sseJson(writer, { type: "error", sessionId, error: msg });
    await writer.close().catch(() => undefined);
    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Background: stream sandbox events + persist assistant message at the end.
  c.executionCtx.waitUntil(
    (async () => {
      const STDOUT_MAX = 500_000;
      const STDERR_MAX = 500_000;
      const HEARTBEAT_MS = 15_000;

      let stdout = "";
      let stderr = "";
      let traceBuffer = "";
      let exitCode = 0;
      let lastEventTime = Date.now();
      let streamActive = true;

      const safeSend = async (data: any) => {
        if (!streamActive) return;
        const ok = await sseJson(writer, data);
        if (!ok) streamActive = false;
      };

      const heartbeat = setInterval(async () => {
        if (!streamActive) return;
        const idleMs = Date.now() - lastEventTime;
        if (idleMs >= HEARTBEAT_MS) {
          const ok = await sseComment(writer, `heartbeat ${new Date().toISOString()}`);
          if (!ok) streamActive = false;
        }
      }, HEARTBEAT_MS);

      try {
        await safeSend({ type: "session", sessionId, projectId, user_message_id: userMessageId });
        await safeSend({ type: "status", sessionId, message: "pro agent started" });

        for await (const event of parseSSEStream<ExecEvent>(execStream)) {
          lastEventTime = Date.now();

          if (event.type === "stdout") {
            const chunk = event.data || "";
            stdout = (stdout + chunk).slice(-STDOUT_MAX);
          } else if (event.type === "stderr") {
            const chunk = event.data || "";
            stderr = (stderr + chunk).slice(-STDERR_MAX);
            traceBuffer += chunk;

            const lines = traceBuffer.split(/\r?\n/);
            traceBuffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("[trace]")) continue;
              const payload = line.replace("[trace]", "").trim();
              if (!payload) continue;
              try {
                const parsed = JSON.parse(payload);
                await safeSend({ ...parsed, sessionId });
              } catch {
                // ignore trace parse errors
              }
            }
          } else if (event.type === "complete") {
            exitCode = event.exitCode ?? 0;
          }
        }

        // Try to parse final JSON output (last parseable line).
        let output: any = null;
        const stdoutLines = stdout.trim().split(/\r?\n/).filter(Boolean);
        for (let i = stdoutLines.length - 1; i >= 0; i -= 1) {
          try {
            output = JSON.parse(stdoutLines[i]);
            break;
          } catch {
            // keep searching
          }
        }

        const success = Boolean(output && output.success !== false && exitCode === 0);
        const answer = output?.answer ? String(output.answer) : null;
        const provider = output?.provider || { kind: "none" };
        const retrieved = output?.retrieved || { memories: [], assets_index: {}, documents: [] };
        const errorMessage = output?.error ? String(output.error) : !success ? "Sandbox run failed" : null;

        let assistantMessageId: string | null = null;
        if (answer) {
          const evidence_memory_ids = Array.isArray(retrieved?.memories) ? retrieved.memories.map((m: any) => String(m.id)) : [];
          const evidence_asset_ids: string[] = [];
          const idx = (retrieved?.assets_index || {}) as Record<string, any[]>;
          for (const assets of Object.values(idx)) {
            for (const a of assets || []) {
              const id = String((a as any).id || "");
              if (!id) continue;
              if (evidence_asset_ids.includes(id)) continue;
              evidence_asset_ids.push(id);
              if (evidence_asset_ids.length >= 200) break;
            }
            if (evidence_asset_ids.length >= 200) break;
          }

          const evidence_documents = Array.isArray((retrieved as any)?.documents)
            ? ((retrieved as any).documents as any[])
                .filter((d) => d && d.artifact_id && d.node_id)
                .slice(0, 100)
                .map((d) => ({ artifact_id: String(d.artifact_id), node_id: String(d.node_id) }))
            : [];

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
              sourceType: "agent_pro",
              title: "Assistant",
              content: answer!,
              tags: ["agent", "chat", "pro"],
              context: {
                role: "assistant",
                mode: "pro",
                provider,
                session_id: sessionId,
                evidence: { memory_ids: evidence_memory_ids, asset_ids: evidence_asset_ids, documents: evidence_documents },
              },
              confidence: 0.6,
              nowIso: new Date().toISOString(),
            });

            // Keep a lightweight session summary for dashboards.
            await db.query(
              "UPDATE sessions SET summary = $1, updated_by = $2 WHERE id = $3 AND tenant_type = $4 AND tenant_id = $5",
              [excerpt(answer!, 280), actorId, sessionId, tenantType, tenantId]
            );
          });
        }

        await safeSend({
          type: "done",
          sessionId,
          success,
          provider,
          answer,
          retrieved,
          assistant_message_id: assistantMessageId,
          error: errorMessage,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await safeSend({ type: "error", sessionId, error: msg });
      } finally {
        clearInterval(heartbeat);
        streamActive = false;
        await writer.close().catch(() => undefined);
      }
    })()
  );

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
