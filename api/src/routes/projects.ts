import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";

export const projectsRouter = new Hono<{ Bindings: Env }>();

projectsRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projects = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query(
      "SELECT * FROM projects WHERE tenant_type = $1 AND tenant_id = $2 ORDER BY updated_at DESC",
      [tenantType, tenantId]
    );
    return rows;
  });

  return c.json({ projects });
});

projectsRouter.get("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const { project, memoryStats } = await withDbClient(c.env, async (db) => {
    const projRes = await db.query("SELECT * FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    const projectRow = projRes.rows[0] ?? null;

    if (!projectRow) return { project: null, memoryStats: [] };

    const statsRes = await db.query(
      "SELECT category, COUNT(*)::int AS count FROM memories WHERE tenant_type = $1 AND tenant_id = $2 AND project_id = $3 GROUP BY category",
      [tenantType, tenantId, id]
    );

    return { project: projectRow, memoryStats: statsRes.rows };
  });

  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json({ ...project, memory_stats: memoryStats });
});

projectsRouter.post("/", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await db.query(
      "INSERT INTO projects (id, tenant_type, tenant_id, name, engine, description, created_at, updated_at, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        id,
        tenantType,
        tenantId,
        body.name,
        body.engine || "custom",
        body.description || "",
        now,
        now,
        actorId,
        actorId,
      ]
    );
  });

  return c.json({ id, created_at: now }, 201);
});

projectsRouter.put("/:id", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await db.query(
      "UPDATE projects SET name = $1, engine = $2, description = $3, updated_at = $4, updated_by = $5 WHERE id = $6 AND tenant_type = $7 AND tenant_id = $8",
      [body.name, body.engine, body.description, now, actorId, id, tenantType, tenantId]
    );
  });

  return c.json({ id, updated_at: now });
});

projectsRouter.delete("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  await withDbClient(c.env, async (db) => {
    await db.query("DELETE FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [id, tenantType, tenantId]);
  });
  return c.json({ deleted: true });
});
