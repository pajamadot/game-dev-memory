import type { TenantType } from "../tenant";

export type AuthKind = "api_token" | "clerk_jwt" | "legacy_headers";

export interface AuthContext {
  kind: AuthKind;
  tenantType: TenantType;
  tenantId: string;
  actorId: string | null;

  // Clerk org info (best-effort; only present for Clerk-authenticated requests).
  orgId?: string | null;
  orgRole?: string | null;
  orgSlug?: string | null;

  // API token info (only present for api_token auth).
  tokenId?: string;
  tokenName?: string;
  scopes?: string[];
}

