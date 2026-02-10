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

function parseTags(raw: string): string[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const t of parts) {
    if (out.includes(t)) continue;
    out.push(t);
    if (out.length >= 32) break;
  }
  return out;
}

type SaveAgentOk = {
  ok: true;
  memory_id: string;
  created_at: string;
};

export type SaveAgentState =
  | { ok: false; error: string }
  | SaveAgentOk;

export async function saveAgentAnswerAsMemory(_prev: SaveAgentState | null, formData: FormData): Promise<SaveAgentState> {
  const project_id_raw = String(formData.get("project_id") || "").trim();
  const project_id = project_id_raw ? project_id_raw : null;
  const category = String(formData.get("category") || "summary").trim() || "summary";
  const title = String(formData.get("title") || "").trim();
  const tags = parseTags(String(formData.get("tags") || "agent").trim() || "agent");

  const query = String(formData.get("query") || "").trim();
  const answer = String(formData.get("answer") || "").trim();
  const retrieved_memories_json = String(formData.get("retrieved_memories_json") || "").trim();
  const retrieved_assets_json = String(formData.get("retrieved_assets_json") || "").trim();

  if (!project_id) return { ok: false, error: "project_id is required to save a memory" };
  if (!title) return { ok: false, error: "title is required" };
  if (!query) return { ok: false, error: "query is required" };
  if (!answer) return { ok: false, error: "answer is required" };

  let retrieved_memory_ids: string[] = [];
  let retrieved_asset_ids: string[] = [];

  try {
    if (retrieved_memories_json) {
      const parsed = JSON.parse(retrieved_memories_json);
      if (Array.isArray(parsed)) retrieved_memory_ids = parsed.filter((x) => typeof x === "string").slice(0, 200);
    }
  } catch {
    // ignore
  }

  try {
    if (retrieved_assets_json) {
      const parsed = JSON.parse(retrieved_assets_json);
      if (Array.isArray(parsed)) retrieved_asset_ids = parsed.filter((x) => typeof x === "string").slice(0, 200);
    }
  } catch {
    // ignore
  }

  const content = [
    "Question:",
    query,
    "",
    "Answer:",
    answer,
    "",
    retrieved_memory_ids.length ? `Evidence memories: ${retrieved_memory_ids.map((id) => `[mem:${id}]`).join(" ")}` : "",
    retrieved_asset_ids.length ? `Evidence assets: ${retrieved_asset_ids.map((id) => `[asset:${id}]`).join(" ")}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  try {
    const res = await apiJson<{ id: string; created_at: string }>("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id,
        session_id: null,
        category,
        source_type: "agent",
        title,
        content,
        tags,
        context: {
          source: "agent_ui",
          agent: {
            query,
            retrieved_memory_ids,
            retrieved_asset_ids,
          },
        },
        confidence: 0.7,
      }),
    });

    return { ok: true, memory_id: res.id, created_at: res.created_at };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
