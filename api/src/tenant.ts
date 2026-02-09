import type { Context } from "hono";
import type { AppEnv } from "./appEnv";

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

/**
 * Requires tenant context to be present (populated by auth middleware).
 */
export function requireTenant(c: Context<AppEnv>): TenantContext {
  const auth = c.get("auth");
  if (!auth) {
    throw new TenantError("Missing auth context (auth middleware not installed)");
  }

  return {
    tenantType: auth.tenantType,
    tenantId: auth.tenantId,
    actorId: auth.actorId,
  };
}
