import { auth } from "@clerk/nextjs/server";

function baseUrl(): string {
  return (
    process.env.MEMORY_API_URL ||
    process.env.NEXT_PUBLIC_MEMORY_API_URL ||
    "https://game-dev-memory-api.radiantclay.workers.dev"
  );
}

export type TenantHeaders = Record<string, string>;

export async function clerkTenantHeaders(): Promise<TenantHeaders> {
  const { userId, orgId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const tenantType = orgId ? "org" : "user";
  const tenantId = orgId ?? userId;

  return {
    "X-Tenant-Type": tenantType,
    "X-Tenant-Id": tenantId,
    "X-Actor-Id": userId,
  };
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await clerkTenantHeaders();
  const url = `${baseUrl()}${path}`;

  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${init?.method || "GET"} ${path} failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}

