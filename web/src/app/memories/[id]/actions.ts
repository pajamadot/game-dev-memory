"use server";

import { revalidatePath } from "next/cache";
import { apiJson } from "@/lib/memory-api";

function asString(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function setMemoryLifecycleAction(formData: FormData) {
  const id = asString(formData.get("memory_id"));
  if (!id) throw new Error("memory_id is required");

  const state = asString(formData.get("state")) || null;
  const quality = asString(formData.get("quality")) || null;

  await apiJson(`/api/memories/${encodeURIComponent(id)}/lifecycle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(state ? { state } : {}),
      ...(quality ? { quality } : {}),
    }),
  });

  revalidatePath(`/memories/${id}`);
}

export async function linkMemoryAction(formData: FormData) {
  const fromId = asString(formData.get("from_memory_id"));
  const toId = asString(formData.get("to_memory_id"));
  if (!fromId) throw new Error("from_memory_id is required");
  if (!toId) throw new Error("to_memory_id is required");

  const relation = asString(formData.get("relation")) || "related";

  await apiJson(`/api/memories/${encodeURIComponent(fromId)}/link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to_memory_id: toId, relation }),
  });

  revalidatePath(`/memories/${fromId}`);
}

