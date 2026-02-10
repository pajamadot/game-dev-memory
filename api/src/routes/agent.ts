import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import { listMemories } from "../core/memories";
import { anthropicMessages } from "../agent/anthropic";

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeTags(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((t) => typeof t === "string");
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === "string");
    } catch {
      // ignore
    }
  }
  return [];
}

function excerpt(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}...`;
}

type MemorySummary = {
  id: string;
  project_id: string;
  category: string;
  title: string;
  content_excerpt: string;
  tags: string[];
  confidence: number;
  updated_at: string;
};

type AssetSummary = {
  id: string;
  project_id: string;
  status: string;
  content_type: string;
  byte_size: number;
  original_name: string | null;
  created_at: string;
};

function summarizeMemory(m: any): MemorySummary {
  return {
    id: String(m.id),
    project_id: String(m.project_id),
    category: String(m.category || ""),
    title: String(m.title || ""),
    content_excerpt: excerpt(String(m.content || ""), 900),
    tags: normalizeTags(m.tags),
    confidence: typeof m.confidence === "number" ? m.confidence : 0.5,
    updated_at: String(m.updated_at || ""),
  };
}

export const agentRouter = new Hono<AppEnv>();

// Project Memory Agent: retrieval-first "ask" endpoint.
//
// This is intentionally deterministic unless an LLM provider is configured.
agentRouter.post("/ask", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));

  const query = asString(body.query || body.q).trim();
  if (!query) return c.json({ ok: false, error: "query is required" }, 400);

  const projectId = asString(body.project_id || body.projectId).trim() || null;
  const limit = clampInt(body.limit, 12, 1, 50);
  const includeAssets = Boolean(body.include_assets ?? true);

  const dryRun = Boolean(body.dry_run ?? false);

  const { memories, assetsByMemoryId } = await withDbClient(c.env, async (db) => {
    const memRows = await listMemories(db, tenantType, tenantId, {
      projectId,
      search: query,
      limit,
    });

    const memIds = memRows.map((m: any) => String(m.id));
    const assetsByMemoryId = new Map<string, AssetSummary[]>();

    if (includeAssets && memIds.length > 0) {
      const { rows } = await db.query(
        `SELECT
           l.from_id AS memory_id,
           a.id,
           a.project_id,
           a.status,
           a.content_type,
           a.byte_size,
           a.original_name,
           a.created_at
         FROM entity_links l
         JOIN assets a
           ON a.tenant_type = l.tenant_type
          AND a.tenant_id = l.tenant_id
          AND a.id = l.to_id
         WHERE l.tenant_type = $1 AND l.tenant_id = $2
           AND l.from_type = 'memory'
           AND l.to_type = 'asset'
           AND l.from_id = ANY($3::uuid[])
         ORDER BY a.created_at DESC`,
        [tenantType, tenantId, memIds]
      );

      for (const r of rows) {
        const mid = String((r as any).memory_id);
        const arr = assetsByMemoryId.get(mid) || [];
        arr.push({
          id: String((r as any).id),
          project_id: String((r as any).project_id),
          status: String((r as any).status),
          content_type: String((r as any).content_type),
          byte_size: Number((r as any).byte_size || 0),
          original_name: (r as any).original_name ? String((r as any).original_name) : null,
          created_at: String((r as any).created_at || ""),
        });
        assetsByMemoryId.set(mid, arr);
      }
    }

    return { memories: memRows, assetsByMemoryId };
  });

  const retrieved = memories.map(summarizeMemory);
  const assets_index: Record<string, AssetSummary[]> = {};
  for (const m of retrieved) {
    const assets = assetsByMemoryId.get(m.id) || [];
    if (assets.length) assets_index[m.id] = assets;
  }

  let answer: string | null = null;
  let provider: { kind: "none" | "anthropic"; model?: string } = { kind: "none" };

  if (!dryRun && c.env.ANTHROPIC_API_KEY && retrieved.length > 0) {
    const system = [
      "You are PajamaDot Project Memory Agent.",
      "Answer the user's question using ONLY the provided project memories and linked assets metadata as evidence.",
      "If the evidence is insufficient, say so and propose exactly what to record/upload next.",
      "Cite memories as [mem:<uuid>] and assets as [asset:<uuid>] when used.",
      "Keep the answer concise and action-oriented.",
    ].join("\n");

    const ctxLines: string[] = [];
    ctxLines.push("MEMORIES:");
    for (const m of retrieved.slice(0, 12)) {
      ctxLines.push(`- [mem:${m.id}] category=${m.category} confidence=${m.confidence.toFixed(2)} updated_at=${m.updated_at}`);
      ctxLines.push(`  title: ${m.title}`);
      ctxLines.push(`  content: ${m.content_excerpt}`);
      if (m.tags.length) ctxLines.push(`  tags: ${m.tags.join(", ")}`);

      const assets = assets_index[m.id] || [];
      if (assets.length) {
        ctxLines.push(`  assets:`);
        for (const a of assets.slice(0, 8)) {
          ctxLines.push(
            `    - [asset:${a.id}] ${a.original_name || "asset"} (${a.content_type}, ${a.byte_size} bytes, status=${a.status})`
          );
        }
      }
    }

    const ctx = ctxLines.join("\n");
    const res = await anthropicMessages(c.env, {
      system,
      maxTokens: clampInt(body.max_tokens, 800, 128, 2048),
      messages: [
        {
          role: "user",
          content: `Question:\n${query}\n\nContext:\n${ctx}\n`,
        },
      ],
    });

    answer = res.text || null;
    provider = { kind: "anthropic", model: res.model };
  }

  return c.json({
    ok: true,
    query,
    project_id: projectId,
    provider,
    retrieved: { memories: retrieved, assets_index },
    answer,
    notes:
      provider.kind === "none"
        ? ["LLM is not configured (or dry_run=true). Returning retrieval results only."]
        : [],
  });
});


