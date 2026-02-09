import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";

export const memoriesRouter = new Hono<{ Bindings: Env }>();

// List memories with optional filters
memoriesRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id");
  const category = c.req.query("category");
  const search = c.req.query("q");
  const tag = c.req.query("tag");
  const sessionId = c.req.query("session_id");
  const limit = parseInt(c.req.query("limit") || "50");

  let query = "SELECT * FROM memories WHERE tenant_type = $1 AND tenant_id = $2";
  const params: unknown[] = [];
  params.push(tenantType, tenantId);

  if (projectId) {
    params.push(projectId);
    query += ` AND project_id = $${params.length}`;
  }
  if (category) {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }
  if (sessionId) {
    params.push(sessionId);
    query += ` AND session_id = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`, `%${search}%`);
    query += ` AND (title ILIKE $${params.length - 1} OR content ILIKE $${params.length})`;
  }
  if (tag) {
    params.push(tag);
    query += ` AND tags ? $${params.length}`;
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
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const memory = await withDbClient(c.env, async (db) => {
    await db.query(
      "UPDATE memories SET access_count = access_count + 1 WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [id, tenantType, tenantId]
    );
    const { rows } = await db.query("SELECT * FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!memory) return c.json({ error: "Memory not found" }, 404);
  return c.json(memory);
});

// Create memory
memoriesRouter.post("/", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const projectId = body.project_id;
  const sessionId = body.session_id ?? null;

  await withDbClient(c.env, async (db) => {
    // Enforce that the project exists and belongs to the tenant.
    const projRes = await db.query(
      "SELECT id FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [projectId, tenantType, tenantId]
    );
    if (projRes.rowCount === 0) {
      throw new Error("Project not found (or not in tenant scope).");
    }

    if (sessionId) {
      const sessRes = await db.query(
        "SELECT id FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND project_id = $4",
        [sessionId, tenantType, tenantId, projectId]
      );
      if (sessRes.rowCount === 0) {
        throw new Error("Session not found (or not in tenant/project scope).");
      }
    }

    await db.query(
      `INSERT INTO memories (
         id, tenant_type, tenant_id, project_id, session_id,
         category, source_type, title, content, tags, context,
         confidence, access_count, created_at, updated_at, created_by, updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, 0, $13, $14, $15, $16)`,
      [
        id,
        tenantType,
        tenantId,
        projectId,
        sessionId,
        body.category,
        body.source_type ?? "manual",
        body.title,
        body.content,
        JSON.stringify(body.tags || []),
        JSON.stringify(body.context || {}),
        body.confidence ?? 0.5,
        now,
        now,
        actorId,
        actorId,
      ]
    );
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
    await db.query(
      `UPDATE memories
       SET title = $1, content = $2, tags = $3::jsonb, context = $4::jsonb, confidence = $5, category = $6, source_type = $7, updated_at = $8, updated_by = $9
       WHERE id = $10 AND tenant_type = $11 AND tenant_id = $12`,
      [
        body.title,
        body.content,
        JSON.stringify(body.tags || []),
        JSON.stringify(body.context || {}),
        body.confidence ?? 0.5,
        body.category,
        body.source_type ?? "manual",
        now,
        actorId,
        id,
        tenantType,
        tenantId,
      ]
    );
  });

  return c.json({ id, updated_at: now });
});

// Delete memory
memoriesRouter.delete("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  await withDbClient(c.env, async (db) => {
    await db.query("DELETE FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [id, tenantType, tenantId]);
  });
  return c.json({ deleted: true });
});
