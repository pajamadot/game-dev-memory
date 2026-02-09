import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";

export const evolveRouter = new Hono<{ Bindings: Env }>();

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
  const { memoryDistribution, recentEvolution, staleMemories } = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let memWhere = "tenant_type = $1 AND tenant_id = $2";
    let eventsWhere = "tenant_type = $1 AND tenant_id = $2";
    if (projectId) {
      params.push(projectId);
      memWhere += ` AND project_id = $${params.length}`;
      eventsWhere += ` AND project_id = $${params.length}`;
    }

    const [memStatsRes, recentRes, staleRes] = await Promise.all([
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
    ]);

    return {
      memoryDistribution: memStatsRes.rows,
      recentEvolution: recentRes.rows,
      staleMemories: staleRes.rows[0]?.count ?? 0,
    };
  });

  return c.json({
    memory_distribution: memoryDistribution,
    recent_evolution: recentEvolution,
    stale_memories: staleMemories ?? 0,
    timestamp: new Date().toISOString(),
  });
});
