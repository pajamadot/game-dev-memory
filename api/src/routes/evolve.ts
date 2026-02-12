import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import { runMemoryArena, runMemoryArenaIterations } from "../evolve/memoryArena";

export const evolveRouter = new Hono<AppEnv>();

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseJsonMaybe(v: unknown): any {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
}

function truthy(v: unknown): boolean {
  if (!v) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

// Get evolution history
evolveRouter.get("/events", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const limit = parseInt(c.req.query("limit") || "50");
  const projectId = c.req.query("project_id");
  const events = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let q = "SELECT * FROM evolution_events WHERE tenant_type = $1 AND tenant_id = $2";
    if (projectId) {
      params.push(projectId);
      q += ` AND project_id = $${params.length}`;
    }
    params.push(limit);
    q += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    const { rows } = await db.query(q, params);
    return rows;
  });

  return c.json({ events });
});

// Record an evolution event
evolveRouter.post("/events", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await db.query(
      `INSERT INTO evolution_events (
         id, tenant_type, tenant_id, project_id, session_id,
         type, parent_id, description, changes, result, created_at, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
      [
        id,
        tenantType,
        tenantId,
        body.project_id || null,
        body.session_id || null,
        body.type,
        body.parent_id || null,
        body.description,
        JSON.stringify(body.changes || {}),
        body.result,
        now,
        actorId,
      ]
    );
  });

  return c.json({ id, created_at: now }, 201);
});

// Get system health signals (for the evolver skill to consume)
evolveRouter.get("/signals", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id");
  const { memoryDistribution, recentEvolution, staleMemories, sessionStats } = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let memWhere = "tenant_type = $1 AND tenant_id = $2";
    let eventsWhere = "tenant_type = $1 AND tenant_id = $2";
    let sessionsWhere = "tenant_type = $1 AND tenant_id = $2";
    if (projectId) {
      params.push(projectId);
      memWhere += ` AND project_id = $${params.length}`;
      eventsWhere += ` AND project_id = $${params.length}`;
      sessionsWhere += ` AND project_id = $${params.length}`;
    }

    const [memStatsRes, recentRes, staleRes, sessionRes, summaryGapRes] = await Promise.all([
      db.query(
        `SELECT category, COUNT(*)::int AS count, AVG(confidence)::float AS avg_confidence
         FROM memories
         WHERE ${memWhere}
         GROUP BY category`,
        params
      ),
      db.query(
        `SELECT type, result, COUNT(*)::int AS count
         FROM evolution_events
         WHERE ${eventsWhere} AND created_at > now() - interval '7 days'
         GROUP BY type, result`,
        params
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM memories
         WHERE ${memWhere} AND updated_at < now() - interval '30 days' AND access_count = 0`,
        params
      ),
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE ended_at IS NULL)::int AS open_sessions,
           COUNT(*) FILTER (WHERE started_at > now() - interval '7 days')::int AS recent_sessions
         FROM sessions
         WHERE ${sessionsWhere}`,
        params
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM sessions s
         WHERE ${sessionsWhere} AND s.ended_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM memories m
             WHERE m.tenant_type = s.tenant_type
               AND m.tenant_id = s.tenant_id
               AND m.session_id = s.id
               AND m.category = 'summary'
           )`,
        params
      ),
    ]);

    return {
      memoryDistribution: memStatsRes.rows,
      recentEvolution: recentRes.rows,
      staleMemories: staleRes.rows[0]?.count ?? 0,
      sessionStats: {
        open_sessions: sessionRes.rows[0]?.open_sessions ?? 0,
        recent_sessions: sessionRes.rows[0]?.recent_sessions ?? 0,
        closed_sessions_without_summary: summaryGapRes.rows[0]?.count ?? 0,
      },
    };
  });

  return c.json({
    memory_distribution: memoryDistribution,
    recent_evolution: recentEvolution,
    stale_memories: staleMemories ?? 0,
    sessions: sessionStats,
    timestamp: new Date().toISOString(),
  });
});

// Run retrieval-evolution arena over past agent sessions and select a winner.
evolveRouter.post("/memory-arena/run", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const projectId = typeof body.project_id === "string" && body.project_id.trim() ? body.project_id.trim() : null;
  const sessionKinds = Array.isArray(body.session_kinds)
    ? body.session_kinds.filter((v: unknown) => v === "agent" || v === "agent_pro")
    : undefined;

  const result = await withDbClient(c.env, async (db) =>
    await runMemoryArena(db, {
      tenantType,
      tenantId,
      actorId,
      projectId,
      sessionKinds,
      includeOpenSessions: !("include_open_sessions" in body) || truthy(body.include_open_sessions),
      limitSessions: clampInt(body.limit_sessions, 30, 1, 200),
      limitEpisodes: clampInt(body.limit_episodes, 80, 1, 400),
      memoryLimit: clampInt(body.memory_limit, 16, 1, 80),
      documentLimit: clampInt(body.document_limit, 8, 0, 50),
    })
  );

  return c.json({ ok: true, arena: result });
});

// Run multiple arena iterations in one call (bounded by time budget).
evolveRouter.post("/memory-arena/iterate", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const projectId = typeof body.project_id === "string" && body.project_id.trim() ? body.project_id.trim() : null;
  const sessionKinds = Array.isArray(body.session_kinds)
    ? body.session_kinds.filter((v: unknown) => v === "agent" || v === "agent_pro")
    : undefined;

  const batch = await withDbClient(c.env, async (db) =>
    await runMemoryArenaIterations(db, {
      tenantType,
      tenantId,
      actorId,
      projectId,
      sessionKinds,
      includeOpenSessions: !("include_open_sessions" in body) || truthy(body.include_open_sessions),
      iterations: clampInt(body.iterations, 10, 1, 1000),
      timeBudgetMs: clampInt(body.time_budget_ms, 25_000, 1_000, 1_800_000),
      stopWhenNoEpisodes: !("stop_when_no_episodes" in body) || truthy(body.stop_when_no_episodes),
      limitSessions: clampInt(body.limit_sessions, 30, 1, 200),
      limitEpisodes: clampInt(body.limit_episodes, 80, 1, 400),
      memoryLimit: clampInt(body.memory_limit, 16, 1, 80),
      documentLimit: clampInt(body.document_limit, 8, 0, 50),
    })
  );

  return c.json({ ok: true, batch });
});

// Get the latest arena result from evolution events.
evolveRouter.get("/memory-arena/latest", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id") || null;

  const latest = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let q = `SELECT id, project_id, created_at, created_by, changes
      FROM evolution_events
      WHERE tenant_type = $1 AND tenant_id = $2
        AND type = 'optimize'
        AND description = 'memory_arena_run'`;
    if (projectId) {
      params.push(projectId);
      q += ` AND project_id = $${params.length}`;
    }
    q += ` ORDER BY created_at DESC LIMIT 1`;
    const { rows } = await db.query(q, params);
    return rows[0] || null;
  });

  if (!latest) return c.json({ ok: true, latest: null });
  const changes = parseJsonMaybe((latest as any).changes) || {};
  return c.json({
    ok: true,
    latest: {
      id: String((latest as any).id),
      project_id: (latest as any).project_id ? String((latest as any).project_id) : null,
      created_at: String((latest as any).created_at),
      created_by: (latest as any).created_by ? String((latest as any).created_by) : null,
      arena: changes.arena ?? null,
    },
  });
});
