import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";

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
    params.push(projectId);
    query += ` AND project_id = $${params.length}`;
  }
  if (category) {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`, `%${search}%`);
    query += ` AND (title ILIKE $${params.length - 1} OR content ILIKE $${params.length})`;
  }

  params.push(limit);
  query += ` ORDER BY updated_at DESC LIMIT $${params.length}`;

  const memories = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query(query, params);
    return rows;
  });

  return c.json({ memories, meta: { total: memories.length } });
});

// Get single memory
memoriesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  const memory = await withDbClient(c.env, async (db) => {
    await db.query("UPDATE memories SET access_count = access_count + 1 WHERE id = $1", [id]);
    const { rows } = await db.query("SELECT * FROM memories WHERE id = $1", [id]);
    return rows[0] ?? null;
  });

  if (!memory) return c.json({ error: "Memory not found" }, 404);
  return c.json(memory);
});

// Create memory
memoriesRouter.post("/", async (c) => {
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await db.query(
      `INSERT INTO memories (id, project_id, category, title, content, tags, context, confidence, access_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 0, $9, $10)`,
      [
        id,
        body.project_id,
        body.category,
        body.title,
        body.content,
        JSON.stringify(body.tags || []),
        JSON.stringify(body.context || {}),
        body.confidence ?? 0.5,
        now,
        now,
      ]
    );
  });

  return c.json({ id, created_at: now }, 201);
});

// Update memory
memoriesRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await db.query(
      `UPDATE memories
       SET title = $1, content = $2, tags = $3::jsonb, context = $4::jsonb, confidence = $5, category = $6, updated_at = $7
       WHERE id = $8`,
      [
        body.title,
        body.content,
        JSON.stringify(body.tags || []),
        JSON.stringify(body.context || {}),
        body.confidence ?? 0.5,
        body.category,
        now,
        id,
      ]
    );
  });

  return c.json({ id, updated_at: now });
});

// Delete memory
memoriesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await withDbClient(c.env, async (db) => {
    await db.query("DELETE FROM memories WHERE id = $1", [id]);
  });
  return c.json({ deleted: true });
});
