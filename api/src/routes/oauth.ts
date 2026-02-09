import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { randomBase64Url } from "../auth/crypto";
import type { AuthContext } from "../auth/types";
import { TenantError, requireTenant } from "../tenant";

export const oauthRouter = new Hono<AppEnv>();

function requireClerkUser(auth: AuthContext): { clerkUserId: string } {
  if (auth.kind !== "clerk_jwt" || !auth.actorId) {
    throw new TenantError("OAuth authorization requires Clerk web auth");
  }
  return { clerkUserId: auth.actorId };
}

// Internal helper called by the web consent page.
// Creates an authorization code stored in Postgres for /token exchange (PKCE).
oauthRouter.post("/authorize", async (c) => {
  const auth = c.get("auth");
  requireClerkUser(auth);

  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const clientId = typeof body?.client_id === "string" ? body.client_id : null;
  const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : null;
  const scope = typeof body?.scope === "string" ? body.scope : "";
  const codeChallenge = typeof body?.code_challenge === "string" ? body.code_challenge : null;
  const codeChallengeMethod = typeof body?.code_challenge_method === "string" ? body.code_challenge_method : null;

  if (!clientId) return c.json({ error: "client_id is required" }, 400);
  if (!redirectUri) return c.json({ error: "redirect_uri is required" }, 400);
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return c.json({ error: "PKCE with code_challenge_method=S256 is required" }, 400);
  }

  const code = randomBase64Url(32);
  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60 * 1000);
  const nowIso = now.toISOString();
  const expiresIso = expires.toISOString();
  const id = crypto.randomUUID();

  await withDbClient(c.env, async (db) => {
    await db.query(
      `INSERT INTO oauth_authorization_codes (
         id, code, tenant_type, tenant_id, actor_id,
         client_id, redirect_uri, scope,
         code_challenge, code_challenge_method,
         created_at, expires_at, consumed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)`,
      [
        id,
        code,
        tenantType,
        tenantId,
        actorId,
        clientId,
        redirectUri,
        scope,
        codeChallenge,
        "S256",
        nowIso,
        expiresIso,
      ]
    );
  });

  return c.json({ code, expires_at: expiresIso }, 201);
});

