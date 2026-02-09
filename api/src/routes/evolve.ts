import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";

export const evolveRouter = new Hono<{ Bindings: Env }>();

// Get evolution history
evolveRouter.get("/events", async (c) => {
  const limit = parseInt(c.req.query("limit") || "50");
  const events = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM evolution_events ORDER BY created_at DESC LIMIT $1", [limit]);
    return rows;
  });

  return c.json({ events });
});

// Record an evolution event
evolveRouter.post("/events", async (c) => {
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await db.query(
      `INSERT INTO evolution_events (id, type, parent_id, description, changes, result, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [id, body.type, body.parent_id || null, body.description, JSON.stringify(body.changes || {}), body.result, now]
    );
  });

  return c.json({ id, created_at: now }, 201);
});

// Get system health signals (for the evolver skill to consume)
evolveRouter.get("/signals", async (c) => {
  const { memoryDistribution, recentEvolution, staleMemories } = await withDbClient(c.env, async (db) => {
    const [memStatsRes, recentRes, staleRes] = await Promise.all([
      db.query(
        "SELECT category, COUNT(*)::int AS count, AVG(confidence)::float AS avg_confidence FROM memories GROUP BY category"
      ),
      db.query(
        "SELECT type, result, COUNT(*)::int AS count FROM evolution_events WHERE created_at > now() - interval '7 days' GROUP BY type, result"
      ),
      db.query("SELECT COUNT(*)::int AS count FROM memories WHERE updated_at < now() - interval '30 days' AND access_count = 0"),
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
