import type { Env } from "../types";
import { base64UrlToBytes } from "./crypto";

interface JWK extends JsonWebKey {
  kid?: string;
}

let jwksCache: { keys: JWK[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface ClerkJwtPayload {
  sub: string;
  exp: number;
  iat: number;
  nbf?: number;

  // Active org context (best-effort; key names vary by Clerk token type/template).
  org_id?: string;
  orgId?: string;
  org_slug?: string;
  orgSlug?: string;
  org_role?: string;
  orgRole?: string;
}

export interface VerifiedClerkSession {
  userId: string;
  orgId: string | null;
  orgSlug: string | null;
  orgRole: string | null;
}

function resolveJwksUrl(env: Env): string {
  return (env.CLERK_JWKS_URL && env.CLERK_JWKS_URL.trim()) || "https://clerk.pajamadot.com/.well-known/jwks.json";
}

async function getJwksKeys(env: Env): Promise<JWK[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  const url = resolveJwksUrl(env);
  const res = await fetch(url);
  if (!res.ok) {
    if (jwksCache) return jwksCache.keys;
    throw new Error(`Failed to fetch Clerk JWKS (${res.status})`);
  }

  const data = (await res.json()) as { keys: JWK[] };
  jwksCache = { keys: data.keys || [], fetchedAt: now };
  return jwksCache.keys;
}

async function importJwkForVerify(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"]
  );
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && token.length > 32;
}

async function verifyJwt(env: Env, token: string): Promise<ClerkJwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  const headerRaw = new TextDecoder().decode(base64UrlToBytes(headerB64));
  const header = safeJsonParse<{ alg?: string; kid?: string }>(headerRaw);
  if (!header?.kid) return null;
  if (header.alg !== "RS256") return null;

  const keys = await getJwksKeys(env);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const cryptoKey = await importJwkForVerify(jwk);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(sigB64);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
  if (!ok) return null;

  const payloadRaw = new TextDecoder().decode(base64UrlToBytes(payloadB64));
  const payload = safeJsonParse<ClerkJwtPayload>(payloadRaw);
  if (!payload?.sub) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now) return null;

  return payload;
}

export async function verifyClerkSessionJwt(env: Env, token: string): Promise<VerifiedClerkSession | null> {
  const payload = await verifyJwt(env, token);
  if (!payload) return null;

  const orgId = payload.org_id || payload.orgId || null;
  const orgSlug = payload.org_slug || payload.orgSlug || null;
  const orgRole = payload.org_role || payload.orgRole || null;

  return {
    userId: payload.sub,
    orgId,
    orgSlug,
    orgRole,
  };
}

