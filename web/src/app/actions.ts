"use server";

import { revalidatePath } from "next/cache";
import { apiJson } from "@/lib/memory-api";

function splitTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 32);
}

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const engine = String(formData.get("engine") || "custom").trim();
  const description = String(formData.get("description") || "").trim();

  if (!name) throw new Error("Project name is required");

  await apiJson("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, engine, description }),
  });

  revalidatePath("/");
}

export async function startSession(formData: FormData) {
  const project_id = String(formData.get("project_id") || "").trim();
  const kind = String(formData.get("kind") || "coding").trim();

  if (!project_id) throw new Error("project_id is required");

  await apiJson("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id, kind }),
  });

  revalidatePath("/");
}

export async function closeSession(formData: FormData) {
  const session_id = String(formData.get("session_id") || "").trim();
  if (!session_id) throw new Error("session_id is required");

  await apiJson(`/api/sessions/${encodeURIComponent(session_id)}/close`, {
    method: "POST",
  });

  revalidatePath("/");
}

export async function createMemory(formData: FormData) {
  const project_id = String(formData.get("project_id") || "").trim();
  const session_id_raw = String(formData.get("session_id") || "").trim();
  const session_id = session_id_raw ? session_id_raw : null;

  const category = String(formData.get("category") || "note").trim();
  const title = String(formData.get("title") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const tags = splitTags(String(formData.get("tags") || ""));

  if (!project_id) throw new Error("project_id is required");
  if (!title) throw new Error("title is required");
  if (!content) throw new Error("content is required");

  await apiJson("/api/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id,
      session_id,
      category,
      source_type: "manual",
      title,
      content,
      tags,
      context: {},
      confidence: 0.6,
    }),
  });

  revalidatePath("/");
}

