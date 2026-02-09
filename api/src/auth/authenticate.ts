import type { Env } from "../types";
import type { AuthContext } from "./types";
import { verifyClerkSessionJwt, looksLikeJwt } from "./clerk";
import { looksLikeApiToken, validateApiToken } from "./apiTokens";
import { withDbClient } from "../db";
import { TenantError, type TenantType } from "../tenant";

function normalizeTenantType(v: string): TenantType | null {
  const s = v.trim().toLowerCase();
  if (s === "user" || s === "org") return s;
  return null;
}

function parseLegacyTenantHeaders(req: Request): { tenantType: TenantType; tenantId: string; actorId: string | null } {
  const tenantTypeRaw = req.headers.get("x-tenant-type") ?? req.headers.get("X-Tenant-Type");
  const tenantId = req.headers.get("x-tenant-id") ?? req.headers.get("X-Tenant-Id");
  const actorId = req.headers.get("x-actor-id") ?? req.headers.get("X-Actor-Id") ?? null;

  const missing: string[] = [];
  if (!tenantTypeRaw) missing.push("X-Tenant-Type");
  if (!tenantId) missing.push("X-Tenant-Id");
  if (missing.length > 0) {
    throw new TenantError(`Missing tenant headers: ${missing.join(", ")}`);
  }

  const tenantType = normalizeTenantType(String(tenantTypeRaw));
  if (!tenantType) {
    throw new TenantError(`Invalid X-Tenant-Type: ${String(tenantTypeRaw)} (expected user|org)`);
  }

  return { tenantType, tenantId: String(tenantId), actorId };
}

function extractBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return m[1].trim();
}

export async function authenticateRequest(env: Env, req: Request): Promise<AuthContext> {
  const token = extractBearerToken(req);

  if (!token) {
    const allowLegacy = String(env.ALLOW_INSECURE_TENANT_HEADERS || "").toLowerCase() === "true";
    if (!allowLegacy) {
      throw new TenantError("Missing Authorization: Bearer <token>");
    }

    const legacy = parseLegacyTenantHeaders(req);
    return {
      kind: "legacy_headers",
      tenantType: legacy.tenantType,
      tenantId: legacy.tenantId,
      actorId: legacy.actorId,
    };
  }

  if (looksLikeApiToken(token)) {
    const validated = await withDbClient(env, async (db) => validateApiToken(db, token));
    if (!validated) {
      throw new TenantError("Invalid API token");
    }

    return {
      kind: "api_token",
      tenantType: validated.tenant_type,
      tenantId: validated.tenant_id,
      actorId: validated.created_by ?? null,
      tokenId: validated.id,
      tokenName: validated.name,
      scopes: validated.scopes,
    };
  }

  if (looksLikeJwt(token)) {
    const clerk = await verifyClerkSessionJwt(env, token);
    if (!clerk) {
      throw new TenantError("Invalid Clerk session token");
    }

    const tenantType: TenantType = clerk.orgId ? "org" : "user";
    const tenantId = clerk.orgId ?? clerk.userId;

    return {
      kind: "clerk_jwt",
      tenantType,
      tenantId,
      actorId: clerk.userId,
      orgId: clerk.orgId,
      orgRole: clerk.orgRole,
      orgSlug: clerk.orgSlug,
    };
  }

  throw new TenantError("Unsupported Authorization token format");
}

