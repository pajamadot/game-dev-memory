import type { Client } from "pg";
import { randomBase64Url, sha256Hex } from "./crypto";
import type { TenantType } from "../tenant";

export const API_TOKEN_PREFIX = "gdm_";

export interface ApiTokenCreateInput {
  tenantType: TenantType;
  tenantId: string;
  actorId: string | null;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  metadata?: Record<string, unknown>;
}

export interface ApiTokenPublicRow {
  id: string;
  tenant_type: TenantType;
  tenant_id: string;
  name: string;
  token_prefix: string;
  scopes: unknown;
  created_at: string;
  created_by: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  metadata: unknown;
}

export interface ApiTokenValidated {
  id: string;
  tenant_type: TenantType;
  tenant_id: string;
  created_by: string | null;
  name: string;
  scopes: string[];
}

export function looksLikeApiToken(token: string): boolean {
  return typeof token === "string" && token.startsWith(API_TOKEN_PREFIX);
}

export async function issueApiToken(db: Client, input: ApiTokenCreateInput): Promise<{ id: string; token: string; created_at: string }> {
  const rand = randomBase64Url(32);
  const token = `${API_TOKEN_PREFIX}${rand}`;
  const tokenPrefix = `${API_TOKEN_PREFIX}${rand.slice(0, 8)}`;
  const tokenHash = await sha256Hex(token);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = input.expiresAt;

  await db.query(
    `INSERT INTO api_tokens (
       id, tenant_type, tenant_id, name,
       token_prefix, token_hash, scopes,
       created_at, created_by, last_used_at, revoked_at, expires_at, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, NULL, NULL, $10, $11::jsonb)`,
    [
      id,
      input.tenantType,
      input.tenantId,
      input.name || "",
      tokenPrefix,
      tokenHash,
      JSON.stringify(input.scopes || []),
      now,
      input.actorId,
      expiresAt,
      JSON.stringify(input.metadata || {}),
    ]
  );

  return { id, token, created_at: now };
}

export async function validateApiToken(db: Client, token: string): Promise<ApiTokenValidated | null> {
  const tokenHash = await sha256Hex(token);

  // Validate in a single query and update last_used_at (best-effort audit).
  const { rows } = await db.query(
    `UPDATE api_tokens
     SET last_used_at = now()
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING id, tenant_type, tenant_id, created_by, name, scopes`,
    [tokenHash]
  );

  const row = rows[0] as
    | {
        id: string;
        tenant_type: TenantType;
        tenant_id: string;
        created_by: string | null;
        name: string;
        scopes: unknown;
      }
    | undefined;

  if (!row) return null;

  const scopes = Array.isArray(row.scopes) ? row.scopes.filter((s) => typeof s === "string") : [];

  return {
    id: row.id,
    tenant_type: row.tenant_type,
    tenant_id: row.tenant_id,
    created_by: row.created_by,
    name: row.name,
    scopes,
  };
}

