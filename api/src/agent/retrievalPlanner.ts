import type { Env } from "../types";
import { anthropicMessages } from "./anthropic";

export type RetrievalStrategyId = "memories_fts" | "pageindex_artifacts";

export type RetrievalPlan = {
  mode: "manual" | "heuristic" | "llm";
  strategies: RetrievalStrategyId[];
  reason: string;
};

function safeLower(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase() : "";
}

export function heuristicRetrievalPlan(query: string, opts: { allowDocuments: boolean }): RetrievalPlan {
  const q = safeLower(query);
  const strategies: RetrievalStrategyId[] = ["memories_fts"];

  const docHints = [
    "pdf",
    "doc",
    "docs",
    "documentation",
    "manual",
    "spec",
    "specification",
    "design",
    "proposal",
    "report",
    "paper",
    "readme",
    "tutorial",
    "changelog",
    "section",
    "chapter",
    "where in",
    "find in",
  ];

  const wantsDocs = opts.allowDocuments && docHints.some((h) => q.includes(h));
  if (wantsDocs) strategies.push("pageindex_artifacts");

  return {
    mode: "heuristic",
    strategies,
    reason: wantsDocs
      ? "Query looks document-oriented (keywords suggest section-level retrieval)."
      : "Default: retrieve from project memories.",
  };
}

function parsePlanJson(text: string): { strategies?: unknown; reason?: unknown } | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as any;
  } catch {
    return null;
  }
}

export async function llmRetrievalPlan(env: Env, query: string, opts: { allowDocuments: boolean }): Promise<RetrievalPlan> {
  // Keep the plan space intentionally tiny for reliability.
  const available: RetrievalStrategyId[] = ["memories_fts"];
  if (opts.allowDocuments) available.push("pageindex_artifacts");

  const system = [
    "You are a retrieval planner for an agent memory system.",
    "Select which retrieval strategies to use given the user's query.",
    "Return STRICT JSON ONLY with keys: strategies (array of strings), reason (string).",
    "Allowed strategy ids:",
    available.map((s) => `- ${s}`).join("\n"),
    "Rules:",
    "- Always include memories_fts unless the query is purely about long-form docs and time is tight.",
    "- Prefer pageindex_artifacts when the query asks to find a section in a document/manual/spec or references PDFs/chapters/sections.",
    "- Keep the strategy set small (1-2 strategies).",
  ].join("\n");

  const res = await anthropicMessages(env, {
    system,
    maxTokens: 256,
    messages: [{ role: "user", content: `Query:\n${query}\n` }],
  });

  const parsed = parsePlanJson(res.text);
  const out: RetrievalStrategyId[] = [];
  const requested = Array.isArray(parsed?.strategies) ? parsed!.strategies : [];
  for (const s of requested) {
    if (s === "memories_fts" || s === "pageindex_artifacts") {
      if (!available.includes(s)) continue;
      if (!out.includes(s)) out.push(s);
    }
  }

  if (out.length === 0) {
    return heuristicRetrievalPlan(query, opts);
  }

  return {
    mode: "llm",
    strategies: out.slice(0, 2),
    reason: typeof parsed?.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "LLM-planned retrieval.",
  };
}

