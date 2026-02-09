"use server";

import { revalidatePath } from "next/cache";
import { apiJson } from "@/lib/memory-api";

type CreateTokenState =
  | { ok: false; error: string }
  | { ok: true; id: string; token: string; created_at: string };

export async function createApiToken(_prev: CreateTokenState | null, formData: FormData): Promise<CreateTokenState> {
  const name = String(formData.get("name") || "").trim();
  const expiresInDaysRaw = String(formData.get("expires_in_days") || "").trim();

  let expires_in_days: number | null = null;
  if (expiresInDaysRaw) {
    const n = Number(expiresInDaysRaw);
    if (Number.isFinite(n) && n > 0) expires_in_days = Math.floor(Math.min(n, 365));
  }

  try {
    const res = await apiJson<{ id: string; token: string; created_at: string }>("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || "API Token",
        scopes: [],
        expires_in_days,
      }),
    });

    revalidatePath("/settings/tokens");
    return { ok: true, ...res };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function revokeApiToken(formData: FormData): Promise<void> {
  const id = String(formData.get("token_id") || "").trim();
  if (!id) throw new Error("token_id is required");

  await apiJson(`/api/tokens/${encodeURIComponent(id)}/revoke`, { method: "POST" });
  revalidatePath("/settings/tokens");
}

