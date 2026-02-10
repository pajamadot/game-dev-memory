"use server";

import { apiJson } from "@/lib/memory-api";

type AgentMemorySummary = {
  id: string;
  project_id: string;
  category: string;
  title: string;
  content_excerpt: string;
  tags: string[];
  confidence: number;
  updated_at: string;
};

type AgentAssetSummary = {
  id: string;
  project_id: string;
  status: string;
  content_type: string;
  byte_size: number;
  original_name: string | null;
  created_at: string;
};

type AskAgentOk = {
  ok: true;
  query: string;
  project_id: string | null;
  provider: { kind: "none" | "anthropic"; model?: string };
  retrieved: { memories: AgentMemorySummary[]; assets_index: Record<string, AgentAssetSummary[]> };
  answer: string | null;
  notes?: string[];
};

export type AskAgentState =
  | { ok: false; error: string }
  | AskAgentOk;

export async function askProjectMemoryAgent(_prev: AskAgentState | null, formData: FormData): Promise<AskAgentState> {
  const query = String(formData.get("query") || "").trim();
  const project_id_raw = String(formData.get("project_id") || "").trim();
  const project_id = project_id_raw ? project_id_raw : null;
  const include_assets = Boolean(formData.get("include_assets"));
  const dry_run = Boolean(formData.get("dry_run"));

  if (!query) return { ok: false, error: "query is required" };

  try {
    const res = await apiJson<AskAgentOk>("/api/agent/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        project_id,
        include_assets,
        dry_run,
        limit: 12,
      }),
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

