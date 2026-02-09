import { Hono } from "hono";
import type { Env } from "../types";

export const projectsRouter = new Hono<{ Bindings: Env }>();

projectsRouter.get("/", async (c) => {
  const result = await c.env.DB.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
  return c.json({ projects: result.results });
});

projectsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const memoryCount = await c.env.DB.prepare(
    "SELECT category, COUNT(*) as count FROM memories WHERE project_id = ? GROUP BY category"
  )
    .bind(id)
    .all();

  return c.json({ ...project, memory_stats: memoryCount.results });
});

projectsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    "INSERT INTO projects (id, name, engine, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, body.name, body.engine || "custom", body.description || "", now, now)
    .run();

  return c.json({ id, created_at: now }, 201);
});

projectsRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await c.env.DB.prepare("UPDATE projects SET name = ?, engine = ?, description = ?, updated_at = ? WHERE id = ?")
    .bind(body.name, body.engine, body.description, now, id)
    .run();

  return c.json({ id, updated_at: now });
});

projectsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  return c.json({ deleted: true });
});
