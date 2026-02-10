"use server";

import { redirect } from "next/navigation";
import { apiJson } from "@/lib/memory-api";

export async function createAgentSession(formData: FormData): Promise<void> {
  const project_id = String(formData.get("project_id") || "").trim();
  const title = String(formData.get("title") || "").trim();

  if (!project_id) {
    throw new Error("project_id is required");
  }

  const res = await apiJson<{ ok: true; id: string } | { ok: false; error: string }>("/api/agent/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id, title }),
  });

  if ((res as any).ok !== true) {
    throw new Error((res as any).error || "Failed to create session");
  }

  redirect(`/agent/sessions/${(res as any).id}`);
}

export async function sendAgentMessage(formData: FormData): Promise<void> {
  const session_id = String(formData.get("session_id") || "").trim();
  const content = String(formData.get("content") || "").trim();

  if (!session_id) {
    throw new Error("session_id is required");
  }
  if (!content) {
    throw new Error("content is required");
  }

  const res = await apiJson<{ ok: true } | { ok: false; error: string }>(`/api/agent/sessions/${encodeURIComponent(session_id)}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if ((res as any).ok !== true) {
    throw new Error((res as any).error || "Failed to send message");
  }

  redirect(`/agent/sessions/${session_id}`);
}

