"use server";

import { redirect } from "next/navigation";
import { apiJson } from "@/lib/memory-api";

export async function createProAgentSession(formData: FormData): Promise<void> {
  const project_id = String(formData.get("project_id") || "").trim();
  const title = String(formData.get("title") || "").trim();

  if (!project_id) {
    throw new Error("project_id is required");
  }

  const res = await apiJson<{ ok: true; id: string } | { ok: false; error: string }>("/api/agent-pro/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id, title }),
  });

  if ((res as any).ok !== true) {
    throw new Error((res as any).error || "Failed to create session");
  }

  redirect(`/agent/pro/sessions/${(res as any).id}`);
}

