import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import { runUnrealAgentsDailyDigestForTenant } from "../research/unrealAgents";

export const researchRouter = new Hono<{ Bindings: Env }>();

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

