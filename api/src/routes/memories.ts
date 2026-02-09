import { Hono } from "hono";
import type { Env } from "../types";

export const memoriesRouter = new Hono<{ Bindings: Env }>();

// List memories with optional filters
memoriesRouter.get("/", async (c) => {
  const projectId = c.req.query("project_id");
  const category = c.req.query("category");
  const search = c.req.query("q");
  const limit = parseInt(c.req.query("limit") || "50");

  let query = "SELECT * FROM memories WHERE 1=1";
  const params: unknown[] = [];

  if (projectId) {
    query += " AND project_id = ?";
    params.push(projectId);
  }
  if (category) {
    query += " AND category = ?";
    params.push(category);
  }
  if (search) {
    query += " AND (title LIKE ? OR content LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  query += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all();

  return c.json({ memories: result.results, meta: { total: result.results.length } });
});

// Get single memory
memoriesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  // Increment access count
  await c.env.DB.prepare("UPDATE memories SET access_count = access_count + 1 WHERE id = ?")
    .bind(id)
    .run();

  const result = await c.env.DB.prepare("SELECT * FROM memories WHERE id = ?")
    .bind(id)
    .first();

  if (!result) return c.json({ error: "Memory not found" }, 404);
  return c.json(result);
});

// Create memory
memoriesRouter.post("/", async (c) => {
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO memories (id, project_id, category, title, content, tags, context, confidence, access_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      id,
      body.project_id,
      body.category,
      body.title,
      body.content,
      JSON.stringify(body.tags || []),
      JSON.stringify(body.context || {}),
      body.confidence ?? 0.5,
      now,
      now
    )
    .run();

  // Also cache in KV for fast retrieval
  await c.env.MEMORY_KV.put(`memory:${id}`, JSON.stringify({ ...body, id, created_at: now, updated_at: now }));

  return c.json({ id, created_at: now }, 201);
});

// Update memory
memoriesRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE memories SET title = ?, content = ?, tags = ?, context = ?, confidence = ?, category = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.title,
      body.content,
      JSON.stringify(body.tags || []),
      JSON.stringify(body.context || {}),
      body.confidence ?? 0.5,
      body.category,
      now,
      id
    )
    .run();

  return c.json({ id, updated_at: now });
});

// Delete memory
memoriesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(id).run();
  await c.env.MEMORY_KV.delete(`memory:${id}`);
  return c.json({ deleted: true });
});
