import type { Context } from "hono";
import type { Env } from "./types";

export type TenantType = "user" | "org";

export interface TenantContext {
  tenantType: TenantType;
  tenantId: string;
  actorId: string | null;
}

export class TenantError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "TenantError";
  }
}

function normalizeTenantType(v: string): TenantType | null {
  const s = v.trim().toLowerCase();
  if (s === "user" || s === "org") return s;
  return null;
}

/**
 * Temporary tenancy plumbing until Clerk auth is wired end-to-end.
 *
 * Required headers:
 * - X-Tenant-Type: user|org
 * - X-Tenant-Id: <clerk_user_id|clerk_org_id>
 *
 * Optional:
 * - X-Actor-Id: <clerk_user_id> (stored as created_by/updated_by)
 */
export function requireTenant(c: Context<{ Bindings: Env }>): TenantContext {
  const tenantTypeRaw = c.req.header("x-tenant-type") ?? c.req.header("X-Tenant-Type");
  const tenantId = c.req.header("x-tenant-id") ?? c.req.header("X-Tenant-Id");
  const actorId = c.req.header("x-actor-id") ?? c.req.header("X-Actor-Id") ?? null;

  const missing: string[] = [];
  if (!tenantTypeRaw) missing.push("X-Tenant-Type");
  if (!tenantId) missing.push("X-Tenant-Id");

  if (missing.length > 0) {
    // Hono: throw to be caught by outer error handling; callers typically turn into a 401.
    throw new TenantError(`Missing tenant headers: ${missing.join(", ")}`);
  }

  const tenantType = normalizeTenantType(String(tenantTypeRaw));
  if (!tenantType) {
    throw new TenantError(`Invalid X-Tenant-Type: ${String(tenantTypeRaw)} (expected user|org)`);
  }

  return {
    tenantType,
    tenantId: String(tenantId),
    actorId,
  };
}
