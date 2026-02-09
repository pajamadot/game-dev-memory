import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { issueApiToken } from "../auth/apiTokens";
import type { AuthContext } from "../auth/types";
import { TenantError, requireTenant } from "../tenant";

export const tokensRouter = new Hono<AppEnv>();

function requireClerkUser(auth: AuthContext): { clerkUserId: string } {
  if (auth.kind !== "clerk_jwt" || !auth.actorId) {
    throw new TenantError("Token management requires Clerk web auth");
  }
  return { clerkUserId: auth.actorId };
}

function normalizeScopes(v: unknown): string[] {
  if (!v) return [];
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 64);
}

async function ensureIdentity(db: import("pg").Client, auth: AuthContext): Promise<void> {
  if (auth.kind !== "clerk_jwt" || !auth.actorId) return;

  const now = new Date().toISOString();
  const clerkUserId = auth.actorId;

  // Upsert user (best-effort; Clerk remains the source of truth).
  const userRes = await db.query("SELECT id FROM app_users WHERE clerk_user_id = $1 LIMIT 1", [clerkUserId]);
  let userId: string;
  if (userRes.rowCount === 0) {
    userId = crypto.randomUUID();
    await db.query(
      `INSERT INTO app_users (id, clerk_user_id, primary_email, display_name, image_url, metadata, created_at, updated_at)
       VALUES ($1, $2, NULL, '', '', '{}'::jsonb, $3, $4)`,
      [userId, clerkUserId, now, now]
    );
  } else {
    userId = userRes.rows[0].id as string;
    await db.query("UPDATE app_users SET updated_at = $1 WHERE id = $2", [now, userId]);
  }

  // If the session has an active org, upsert org + membership.
  if (auth.orgId) {
    const orgRes = await db.query("SELECT id FROM app_orgs WHERE clerk_org_id = $1 LIMIT 1", [auth.orgId]);
    let orgId: string;
    if (orgRes.rowCount === 0) {
      orgId = crypto.randomUUID();
      await db.query(
        `INSERT INTO app_orgs (id, clerk_org_id, name, slug, image_url, metadata, created_at, updated_at)
         VALUES ($1, $2, '', '', '', '{}'::jsonb, $3, $4)`,
        [orgId, auth.orgId, now, now]
      );
    } else {
      orgId = orgRes.rows[0].id as string;
      await db.query("UPDATE app_orgs SET updated_at = $1 WHERE id = $2", [now, orgId]);
    }

    const role = auth.orgRole || "member";
    await db.query(
      `INSERT INTO app_org_memberships (id, org_id, user_id, clerk_membership_id, role, permissions, created_at, updated_at)
       VALUES ($1, $2, $3, NULL, $4, '[]'::jsonb, $5, $6)
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = EXCLUDED.updated_at`,
      [crypto.randomUUID(), orgId, userId, role, now, now]
    );
  }
}

// List tokens for the current tenant.
tokensRouter.get("/", async (c) => {
  const auth = c.get("auth");
  requireClerkUser(auth);

  const { tenantType, tenantId } = requireTenant(c);
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);

  const tokens = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query(
      `SELECT id, tenant_type, tenant_id, name, token_prefix, scopes, created_at, created_by, last_used_at, revoked_at, expires_at, metadata
       FROM api_tokens
       WHERE tenant_type = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantType, tenantId, limit]
    );
    return rows;
  });

  return c.json({ tokens });
});

// Create a new API token (returns plaintext once).
tokensRouter.post("/", async (c) => {
  const auth = c.get("auth");
  requireClerkUser(auth);

  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "API Token";
  const scopes = normalizeScopes(body?.scopes);

  const expiresInDaysRaw = body?.expires_in_days;
  const expiresInDays = Number.isFinite(expiresInDaysRaw) ? Number(expiresInDaysRaw) : null;
  let expiresAt: string | null = null;
  if (expiresInDays && expiresInDays > 0) {
    const dt = new Date();
    dt.setDate(dt.getDate() + Math.min(expiresInDays, 365));
    expiresAt = dt.toISOString();
  }

  const res = await withDbClient(c.env, async (db) => {
    await ensureIdentity(db, auth);
    return await issueApiToken(db, {
      tenantType,
      tenantId,
      actorId,
      name,
      scopes,
      expiresAt,
      metadata: { source: "web" },
    });
  });

  return c.json(res, 201);
});

// Revoke a token (does not delete rows).
tokensRouter.post("/:id/revoke", async (c) => {
  const auth = c.get("auth");
  requireClerkUser(auth);

  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const now = new Date().toISOString();

  const updated = await withDbClient(c.env, async (db) => {
    const { rowCount } = await db.query(
      `UPDATE api_tokens
       SET revoked_at = COALESCE(revoked_at, $1)
       WHERE id = $2 AND tenant_type = $3 AND tenant_id = $4`,
      [now, id, tenantType, tenantId]
    );
    return rowCount;
  });

  if (updated === 0) return c.json({ error: "Token not found" }, 404);
  return c.json({ ok: true, id, revoked_at: now });
});

