import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";

export const projectsRouter = new Hono<{ Bindings: Env }>();

projectsRouter.get("/", async (c) => {
  const projects = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM projects ORDER BY updated_at DESC");
    return rows;
  });

  return c.json({ projects });
});

projectsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const { project, memoryStats } = await withDbClient(c.env, async (db) => {
    const projRes = await db.query("SELECT * FROM projects WHERE id = $1", [id]);
    const projectRow = projRes.rows[0] ?? null;

    if (!projectRow) return { project: null, memoryStats: [] };

    const statsRes = await db.query(
      "SELECT category, COUNT(*)::int AS count FROM memories WHERE project_id = $1 GROUP BY category",
      [id]
    );

    return { project: projectRow, memoryStats: statsRes.rows };
  });

  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json({ ...project, memory_stats: memoryStats });
});

projectsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await db.query(
      "INSERT INTO projects (id, name, engine, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, body.name, body.engine || "custom", body.description || "", now, now]
    );
  });

  return c.json({ id, created_at: now }, 201);
});

projectsRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await db.query("UPDATE projects SET name = $1, engine = $2, description = $3, updated_at = $4 WHERE id = $5", [
      body.name,
      body.engine,
      body.description,
      now,
      id,
    ]);
  });

  return c.json({ id, updated_at: now });
});

projectsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await withDbClient(c.env, async (db) => {
    await db.query("DELETE FROM projects WHERE id = $1", [id]);
  });
  return c.json({ deleted: true });
});
