import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import {
  createProject,
  deleteProject,
  getProjectWithStats,
  listProjects,
  updateProject,
} from "../core/projects";

export const projectsRouter = new Hono<AppEnv>();

projectsRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projects = await withDbClient(c.env, async (db) => await listProjects(db, tenantType, tenantId));

  return c.json({ projects });
});

projectsRouter.get("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const { project, memoryStats } = await withDbClient(c.env, async (db) => await getProjectWithStats(db, tenantType, tenantId, id));

  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json({ ...project, memory_stats: memoryStats });
});

projectsRouter.post("/", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await createProject(db, {
      tenantType,
      tenantId,
      actorId,
      id,
      name: body.name,
      engine: body.engine || "custom",
      description: body.description || "",
      nowIso: now,
    });
  });

  return c.json({ id, created_at: now }, 201);
});

projectsRouter.put("/:id", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await updateProject(db, {
      tenantType,
      tenantId,
      actorId,
      id,
      name: body.name,
      engine: body.engine,
      description: body.description,
      nowIso: now,
    });
  });

  return c.json({ id, updated_at: now });
});

projectsRouter.delete("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  await withDbClient(c.env, async (db) => {
    await deleteProject(db, tenantType, tenantId, id);
  });
  return c.json({ deleted: true });
});
