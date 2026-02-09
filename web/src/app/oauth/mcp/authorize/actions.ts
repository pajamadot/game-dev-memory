"use server";

import { apiJson } from "@/lib/memory-api";
import { redirect } from "next/navigation";

function requireUrl(v: string): URL {
  try {
    return new URL(v);
  } catch {
    throw new Error("Invalid redirect_uri");
  }
}

export async function approveMcpOauth(formData: FormData): Promise<void> {
  const client_id = String(formData.get("client_id") || "").trim();
  const redirect_uri = String(formData.get("redirect_uri") || "").trim();
  const scope = String(formData.get("scope") || "").trim();
  const state = String(formData.get("state") || "").trim();
  const code_challenge = String(formData.get("code_challenge") || "").trim();
  const code_challenge_method = String(formData.get("code_challenge_method") || "").trim() || "S256";

  if (!client_id) throw new Error("client_id is required");
  if (!redirect_uri) throw new Error("redirect_uri is required");
  if (!code_challenge || code_challenge_method !== "S256") throw new Error("PKCE S256 is required");

  const res = await apiJson<{ code: string; expires_at: string }>("/api/oauth/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id,
      redirect_uri,
      scope,
      code_challenge,
      code_challenge_method,
    }),
  });

  const u = requireUrl(redirect_uri);
  u.searchParams.set("code", res.code);
  if (state) u.searchParams.set("state", state);
  redirect(u.toString());
}

export async function denyMcpOauth(formData: FormData): Promise<void> {
  const redirect_uri = String(formData.get("redirect_uri") || "").trim();
  const state = String(formData.get("state") || "").trim();

  const u = requireUrl(redirect_uri);
  u.searchParams.set("error", "access_denied");
  if (state) u.searchParams.set("state", state);
  redirect(u.toString());
}

