import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";

export const sessionsRouter = new Hono<{ Bindings: Env }>();

function normalizeTags(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((t) => typeof t === "string");
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === "string");
    } catch {
      // ignore
    }
  }
  return [];
}

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
    const sessRes = await db.query(
      "SELECT id, project_id, kind, started_at, ended_at FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [id, tenantType, tenantId]
    );
    const session = sessRes.rows[0] ?? null;
    if (!session) {
      throw new Error("Session not found (or not in tenant scope).");
    }

    // Mark closed (idempotent).
    await db.query(
      "UPDATE sessions SET ended_at = COALESCE(ended_at, $1), updated_by = $2 WHERE id = $3 AND tenant_type = $4 AND tenant_id = $5",
      [now, actorId, id, tenantType, tenantId]
    );

    // Auto-evolve: create a session summary memory if missing.
    const summaryExists = await db.query(
      "SELECT id FROM memories WHERE tenant_type = $1 AND tenant_id = $2 AND session_id = $3 AND category = 'summary' LIMIT 1",
      [tenantType, tenantId, id]
    );

    let createdSummary = false;
    let summaryMemoryId: string | null = null;

    if (summaryExists.rowCount === 0) {
      const projRes = await db.query(
        "SELECT id, name, engine FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
        [session.project_id, tenantType, tenantId]
      );
      const project = projRes.rows[0] ?? { id: session.project_id, name: "Unknown Project", engine: "custom" };

      const memRes = await db.query(
        "SELECT category, title, tags, updated_at FROM memories WHERE tenant_type = $1 AND tenant_id = $2 AND session_id = $3 ORDER BY updated_at DESC LIMIT 200",
        [tenantType, tenantId, id]
      );

      const memRows: { category: string; title: string; tags: unknown; updated_at: string }[] = memRes.rows;

      const categoryCounts = new Map<string, number>();
      const tagCounts = new Map<string, number>();
      for (const m of memRows) {
        categoryCounts.set(m.category, (categoryCounts.get(m.category) || 0) + 1);
        for (const t of normalizeTags(m.tags)) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }

      const topCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const topTags = [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([t]) => t);

      const title = `Session Summary: ${project.name}`;
      const lines: string[] = [];
      lines.push(`Project: ${project.name} (${project.engine})`);
      lines.push(`Session: ${id}`);
      lines.push(`Kind: ${session.kind}`);
      lines.push(`Started: ${session.started_at}`);
      lines.push(`Ended: ${session.ended_at || now}`);
      lines.push(`Memories: ${memRows.length}`);

      if (topCategories.length) {
        lines.push("");
        lines.push("By category:");
        for (const [cat, count] of topCategories) lines.push(`- ${cat}: ${count}`);
      }

      if (memRows.length) {
        lines.push("");
        lines.push("Top items:");
        for (const m of memRows.slice(0, 25)) {
          lines.push(`- [${m.category}] ${m.title}`);
        }
      }

      const content = lines.join("\n");
      const tags = ["session-summary", "auto", ...topTags].slice(0, 32);
      const context = {
        kind: session.kind,
        session_id: id,
        project_id: String(project.id),
        memory_count: memRows.length,
        top_categories: topCategories.map(([cat, count]) => ({ category: cat, count })),
        top_tags: topTags,
      };

      summaryMemoryId = crypto.randomUUID();
      await db.query(
        `INSERT INTO memories (
           id, tenant_type, tenant_id, project_id, session_id,
           category, source_type, title, content, tags, context,
           confidence, access_count, created_at, updated_at, created_by, updated_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, 0, $13, $14, $15, $16)`,
        [
          summaryMemoryId,
          tenantType,
          tenantId,
          String(project.id),
          id,
          "summary",
          "evolver",
          title,
          content,
          JSON.stringify(tags),
          JSON.stringify(context),
          0.7,
          now,
          now,
          actorId,
          actorId,
        ]
      );

      createdSummary = true;
    }

    // Record evolution event (even if summary existed; idempotent history is useful).
    const eventId = crypto.randomUUID();
    const changes = {
      trigger: "session_closed",
      created_summary: createdSummary,
      summary_memory_id: summaryMemoryId,
    };

    await db.query(
      `INSERT INTO evolution_events (
         id, tenant_type, tenant_id, project_id, session_id,
         type, parent_id, description, changes, result, created_at, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8::jsonb, $9, $10, $11)`,
      [
        eventId,
        tenantType,
        tenantId,
        session.project_id,
        id,
        "innovate",
        "Auto evolve on session close",
        JSON.stringify(changes),
        "success",
        now,
        actorId,
      ]
    );
  });

  return c.json({ id, ended_at: now });
});
