import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";

export const sessionsRouter = new Hono<{ Bindings: Env }>();

// List sessions (optionally filtered by project/kind)
sessionsRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id");
  const kind = c.req.query("kind");
  const limit = parseInt(c.req.query("limit") || "50");

  const sessions = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let q = "SELECT * FROM sessions WHERE tenant_type = $1 AND tenant_id = $2";

    if (projectId) {
      params.push(projectId);
      q += ` AND project_id = $${params.length}`;
    }
    if (kind) {
      params.push(kind);
      q += ` AND kind = $${params.length}`;
    }

    params.push(limit);
    q += ` ORDER BY started_at DESC LIMIT $${params.length}`;

    const { rows } = await db.query(q, params);
    return rows;
  });

  return c.json({ sessions });
});

// Get a single session
sessionsRouter.get("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const session = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(session);
});

// Create a session
sessionsRouter.post("/", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const projectId = body.project_id;
  const kind = body.kind || "coding";

  await withDbClient(c.env, async (db) => {
    const projRes = await db.query(
      "SELECT id FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [projectId, tenantType, tenantId]
    );
    if (projRes.rowCount === 0) {
      throw new Error("Project not found (or not in tenant scope).");
    }

    await db.query(
      `INSERT INTO sessions (id, tenant_type, tenant_id, project_id, kind, started_at, ended_at, context, summary, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7::jsonb, $8, $9, $10)`,
      [
        id,
        tenantType,
        tenantId,
        projectId,
        kind,
        body.started_at || now,
        JSON.stringify(body.context || {}),
        body.summary || "",
        actorId,
        actorId,
      ]
    );
  });

  return c.json({ id, started_at: body.started_at || now }, 201);
});

// Close a session (marks ended_at)
sessionsRouter.post("/:id/close", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    const res = await db.query(
      "UPDATE sessions SET ended_at = $1, updated_by = $2 WHERE id = $3 AND tenant_type = $4 AND tenant_id = $5",
      [now, actorId, id, tenantType, tenantId]
    );
    if (res.rowCount === 0) {
      throw new Error("Session not found (or not in tenant scope).");
    }
  });

  return c.json({ id, ended_at: now });
});

