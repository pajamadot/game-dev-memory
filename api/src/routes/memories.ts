import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import { createMemory, deleteMemory, getMemory, listMemories, updateMemory } from "../core/memories";

export const memoriesRouter = new Hono<AppEnv>();

// List memories with optional filters
memoriesRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id") || null;
  const category = c.req.query("category") || null;
  const search = c.req.query("q") || null;
  const tag = c.req.query("tag") || null;
  const sessionId = c.req.query("session_id") || null;
  const limit = parseInt(c.req.query("limit") || "50");

  const memories = await withDbClient(c.env, async (db) =>
    await listMemories(db, tenantType, tenantId, { projectId, category, search, tag, sessionId, limit })
  );

  return c.json({ memories, meta: { total: memories.length } });
});

// Get single memory
memoriesRouter.get("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const memory = await withDbClient(c.env, async (db) => await getMemory(db, tenantType, tenantId, id));

  if (!memory) return c.json({ error: "Memory not found" }, 404);
  return c.json(memory);
});

// Create memory
memoriesRouter.post("/", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await createMemory(db, {
      tenantType,
      tenantId,
      actorId,
      id,
      projectId: body.project_id,
      sessionId: body.session_id ?? null,
      category: body.category,
      sourceType: body.source_type ?? "manual",
      title: body.title,
      content: body.content,
      tags: body.tags || [],
      context: body.context || {},
      confidence: body.confidence ?? 0.5,
      nowIso: now,
    });
  });

  return c.json({ id, created_at: now }, 201);
});

// Update memory
memoriesRouter.put("/:id", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await updateMemory(db, {
      tenantType,
      tenantId,
      actorId,
      id,
      title: body.title,
      content: body.content,
      tags: body.tags || [],
      context: body.context || {},
      confidence: body.confidence ?? 0.5,
      category: body.category,
      sourceType: body.source_type ?? "manual",
      nowIso: now,
    });
  });

  return c.json({ id, updated_at: now });
});

// Delete memory
memoriesRouter.delete("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  await withDbClient(c.env, async (db) => {
    await deleteMemory(db, tenantType, tenantId, id);
  });
  return c.json({ deleted: true });
});
