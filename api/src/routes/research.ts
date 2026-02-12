import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import { runUnrealAgentsDailyDigestForTenant } from "../research/unrealAgents";
import { runAgentMemoryDailyDigestForTenant } from "../research/agentMemory";
import { runNewProjectsDailyDigestForTenant } from "../research/newProjects";

export const researchRouter = new Hono<AppEnv>();

// List digests for the current tenant (across projects).
researchRouter.get("/unreal-agents/digests", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const limit = parseInt(c.req.query("limit") || "14");

  const digests = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query(
      `SELECT *
       FROM memories
       WHERE tenant_type = $1 AND tenant_id = $2
         AND category = 'research'
         AND tags ? 'unreal-agents'
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantType, tenantId, limit]
    );
    return rows;
  });

  return c.json({ digests });
});

// Trigger a digest run for this tenant (useful for manual refresh / testing).
researchRouter.post("/unreal-agents/run", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const dateRaw = typeof body?.date === "string" ? body.date : null;
  const date = dateRaw ? new Date(dateRaw) : new Date();

  const res = await runUnrealAgentsDailyDigestForTenant(
    c.env,
    { tenant_type: tenantType, tenant_id: tenantId },
    actorId || "manual",
    date
  );

  return c.json({ ok: true, ...res });
});

// List Agent Memory digests for the current tenant.
researchRouter.get("/agent-memory/digests", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const limit = parseInt(c.req.query("limit") || "14");

  const digests = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query(
      `SELECT *
       FROM memories
       WHERE tenant_type = $1 AND tenant_id = $2
         AND category = 'research'
         AND tags ? 'agent-memory'
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantType, tenantId, limit]
    );
    return rows;
  });

  return c.json({ digests });
});

// Trigger a digest run for this tenant (manual refresh/testing).
researchRouter.post("/agent-memory/run", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const dateRaw = typeof body?.date === "string" ? body.date : null;
  const date = dateRaw ? new Date(dateRaw) : new Date();

  const res = await runAgentMemoryDailyDigestForTenant(
    c.env,
    { tenant_type: tenantType, tenant_id: tenantId },
    actorId || "manual",
    date
  );

  return c.json({ ok: true, ...res });
});

// List New Projects digests for the current tenant.
researchRouter.get("/new-projects/digests", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const limit = parseInt(c.req.query("limit") || "14");

  const digests = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query(
      `SELECT *
       FROM memories
       WHERE tenant_type = $1 AND tenant_id = $2
         AND category = 'research'
         AND tags ? 'new-projects'
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantType, tenantId, limit]
    );
    return rows;
  });

  return c.json({ digests });
});

// Trigger New Projects digest run for this tenant.
researchRouter.post("/new-projects/run", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const dateRaw = typeof body?.date === "string" ? body.date : null;
  const date = dateRaw ? new Date(dateRaw) : new Date();

  const res = await runNewProjectsDailyDigestForTenant(
    c.env,
    { tenant_type: tenantType, tenant_id: tenantId },
    actorId || "manual",
    date
  );

  return c.json({ ok: true, ...res });
});
