import { Hono } from "hono";
import type { Env } from "../types";

export const evolveRouter = new Hono<{ Bindings: Env }>();

// Get evolution history
evolveRouter.get("/events", async (c) => {
  const limit = parseInt(c.req.query("limit") || "50");
  const result = await c.env.DB.prepare(
    "SELECT * FROM evolution_events ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json({ events: result.results });
});

// Record an evolution event
evolveRouter.post("/events", async (c) => {
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO evolution_events (id, type, parent_id, description, changes, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, body.type, body.parent_id || null, body.description, JSON.stringify(body.changes || {}), body.result, now)
    .run();

  return c.json({ id, created_at: now }, 201);
});

// Get system health signals (for the evolver skill to consume)
evolveRouter.get("/signals", async (c) => {
  const [memoryStats, recentEvents, staleMemories] = await Promise.all([
    c.env.DB.prepare(
      "SELECT category, COUNT(*) as count, AVG(confidence) as avg_confidence FROM memories GROUP BY category"
    ).all(),
    c.env.DB.prepare(
      "SELECT type, result, COUNT(*) as count FROM evolution_events WHERE created_at > datetime('now', '-7 days') GROUP BY type, result"
    ).all(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM memories WHERE updated_at < datetime('now', '-30 days') AND access_count = 0"
    ).first(),
  ]);

  return c.json({
    memory_distribution: memoryStats.results,
    recent_evolution: recentEvents.results,
    stale_memories: staleMemories?.count ?? 0,
    timestamp: new Date().toISOString(),
  });
});
