import type { Env } from "../types";
import { sha256Base64Url, randomBase64Url } from "../auth/crypto";
import { withDbClient } from "../db";
import { issueApiToken } from "../auth/apiTokens";
import type { TenantType } from "../tenant";

export function oauthIssuerFromRequest(request: Request): string {
  const url = new URL(request.url);
  return url.origin;
}

export function websiteUrl(env: Env): string {
  return (env.WEBSITE_URL && env.WEBSITE_URL.trim()) || "https://game-dev-memory.pajamadot.com";
}

export function getOAuthMetadata(request: Request, _env: Env): Record<string, unknown> {
  const issuer = oauthIssuerFromRequest(request);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [
      "projects:read",
      "projects:write",
      "memories:read",
      "memories:write",
      "artifacts:read",
      "artifacts:write",
      "assets:read",
      "assets:write",
    ],
    service_documentation: `${websiteUrl(_env)}/research/agent-memory`,
  };
}

export function getProtectedResourceMetadata(request: Request): Record<string, unknown> {
  const url = new URL(request.url);
  const path = url.pathname;
  const base = "/.well-known/oauth-protected-resource";
  const suffix = path.startsWith(base) ? path.slice(base.length) : "";
  const resource = suffix ? `${url.origin}${suffix}` : url.origin;
  return {
    resource,
    authorization_servers: [url.origin],
    scopes_supported: [
      "projects:read",
      "projects:write",
      "memories:read",
      "memories:write",
      "artifacts:read",
      "artifacts:write",
      "assets:read",
      "assets:write",
    ],
    bearer_methods_supported: ["header"],
  };
}

export function handleAuthorize(request: Request, env: Env): Response {
  const url = new URL(request.url);

  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const scope = url.searchParams.get("scope") || "";
  const state = url.searchParams.get("state") || "";
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");

  if (!clientId) return oauthError({ error: "invalid_request", error_description: "client_id is required" });
  if (!redirectUri) return oauthError({ error: "invalid_request", error_description: "redirect_uri is required" });
  if (responseType !== "code") return oauthError({ error: "unsupported_response_type", error_description: "Only response_type=code is supported" });
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return oauthError({ error: "invalid_request", error_description: "PKCE with S256 is required" });
  }

  const web = new URL(`${websiteUrl(env)}/oauth/mcp/authorize`);
  web.searchParams.set("client_id", clientId);
  web.searchParams.set("redirect_uri", redirectUri);
  web.searchParams.set("scope", scope);
  web.searchParams.set("state", state);
  web.searchParams.set("code_challenge", codeChallenge);
  web.searchParams.set("code_challenge_method", "S256");

  return Response.redirect(web.toString(), 302);
}

function redirectUriMatches(requestedRedirectUri: string, storedRedirectUri: string): boolean {
  if (requestedRedirectUri === storedRedirectUri) return true;

  const requested = safeParseUrl(requestedRedirectUri);
  const stored = safeParseUrl(storedRedirectUri);
  if (!requested || !stored) return false;

  const reqNorm = normalizeRedirectUri(requested);
  const storedNorm = normalizeRedirectUri(stored);
  return reqNorm === storedNorm;
}

function safeParseUrl(v: string): URL | null {
  try {
    return new URL(v);
  } catch {
    return null;
  }
}

function normalizeRedirectUri(url: URL): string {
  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const hostKey = isLoopback ? "loopback" : hostname;
  const port = url.port || (protocol === "http:" ? "80" : protocol === "https:" ? "443" : "");
  let pathname = url.pathname;
  if (isLoopback && pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

  let search = url.search;
  if (isLoopback && search) {
    const p = new URLSearchParams(search);
    p.delete("code");
    p.delete("state");
    const s = p.toString();
    search = s ? `?${s}` : "";
  }

  return `${protocol}//${hostKey}:${port}${pathname}${search}`;
}

function parseScopes(raw: string): string[] {
  return raw
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 64);
}

async function createTokenFromCodeRow(
  db: import("pg").Client,
  row: {
    tenant_type: TenantType;
    tenant_id: string;
    actor_id: string | null;
    client_id: string;
    scope: string;
  }
): Promise<{ id: string; token: string; created_at: string }> {
  const scopes = parseScopes(row.scope || "");
  const name = `mcp:${row.client_id}`;
  return await issueApiToken(db, {
    tenantType: row.tenant_type,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    name,
    scopes,
    expiresAt: null,
    metadata: { source: "mcp_oauth", client_id: row.client_id },
  });
}

export async function handleToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return oauthError({ error: "invalid_request", error_description: "POST method required" }, 405);
  }

  const contentType = request.headers.get("content-type") || "";
  let body = new URLSearchParams();

  if (contentType.includes("application/x-www-form-urlencoded")) {
    body = new URLSearchParams(await request.text());
  } else if (contentType.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as Record<string, string>;
    for (const [k, v] of Object.entries(json)) body.set(k, v);
  } else {
    return oauthError({ error: "invalid_request", error_description: "Unsupported content type" }, 400);
  }

  const grantType = body.get("grant_type");
  if (grantType !== "authorization_code") {
    return oauthError({ error: "unsupported_grant_type", error_description: "Only authorization_code is supported" }, 400);
  }

  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const codeVerifier = body.get("code_verifier");
  if (!code || !codeVerifier) {
    return oauthError({ error: "invalid_request", error_description: "code and code_verifier are required" }, 400);
  }

  const tokenRes = await withDbClient(env, async (db) => {
    await db.query("BEGIN");
    try {
      const { rows } = await db.query(
        `SELECT *
         FROM oauth_authorization_codes
         WHERE code = $1
           AND consumed_at IS NULL
           AND expires_at > now()
         FOR UPDATE`,
        [code]
      );

      const row = (rows[0] as any) || null;
      if (!row) {
        await db.query("ROLLBACK");
        return { ok: false as const, error: oauthError({ error: "invalid_grant", error_description: "Invalid or expired authorization code" }, 400) };
      }

      if (redirectUri && !redirectUriMatches(redirectUri, String(row.redirect_uri))) {
        await db.query("ROLLBACK");
        return { ok: false as const, error: oauthError({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400) };
      }

      if (String(row.code_challenge_method) !== "S256") {
        await db.query("ROLLBACK");
        return { ok: false as const, error: oauthError({ error: "invalid_grant", error_description: "Unsupported code_challenge_method" }, 400) };
      }

      const expectedChallenge = await sha256Base64Url(codeVerifier);
      if (expectedChallenge !== String(row.code_challenge)) {
        await db.query("ROLLBACK");
        return { ok: false as const, error: oauthError({ error: "invalid_grant", error_description: "Invalid code_verifier" }, 400) };
      }

      await db.query("UPDATE oauth_authorization_codes SET consumed_at = now() WHERE id = $1", [row.id]);

      const issued = await createTokenFromCodeRow(db, {
        tenant_type: row.tenant_type,
        tenant_id: row.tenant_id,
        actor_id: row.actor_id,
        client_id: row.client_id,
        scope: row.scope,
      });

      await db.query("COMMIT");
      return { ok: true as const, issued };
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  });

  if (!tokenRes.ok) return tokenRes.error;

  // Standard OAuth response shape.
  return new Response(
    JSON.stringify({
      access_token: tokenRes.issued.token,
      token_type: "Bearer",
      expires_in: 86400 * 90,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    }
  );
}

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return oauthError({ error: "invalid_request", error_description: "POST method required" }, 405);
  }

  const body = (await request.json().catch(() => ({}))) as {
    client_name?: string;
    redirect_uris?: string[];
  };

  const clientId = `mcp_client_${randomBase64Url(18)}`;
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === "string").slice(0, 20) : [];
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : "MCP Client";
  const now = new Date().toISOString();

  await withDbClient(env, async (db) => {
    await db.query(
      `INSERT INTO oauth_clients (id, client_id, name, redirect_uris, created_at, metadata)
       VALUES ($1, $2, $3, $4::jsonb, $5, '{}'::jsonb)`,
      [crypto.randomUUID(), clientId, name, JSON.stringify(redirectUris), now]
    );
  });

  return new Response(
    JSON.stringify({
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    { status: 201, headers: { "content-type": "application/json" } }
  );
}

function oauthError(error: { error: string; error_description?: string }, status = 400): Response {
  return new Response(JSON.stringify(error), { status, headers: { "content-type": "application/json" } });
}
