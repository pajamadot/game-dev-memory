import type { Client } from "pg";
import type { TenantType } from "../tenant";
import { listMemories, type MemorySearchMode, type MemoryState } from "./memories";

export type MemorySearchProviderId = "memories_fts" | "recent_activity";

export type MemoryIndexHit = {
  id: string;
  project_id: string;
  category: string;
  title: string;
  content_excerpt: string;
  tags: string[];
  confidence: number;
  updated_at: string;
  provider: MemorySearchProviderId;
  rank: number;
  score: number;
  token_estimate: number;
};

export type MemorySearchIndexInput = {
  tenantType: TenantType;
  tenantId: string;
  projectId?: string | null;
  category?: string | null;
  sessionId?: string | null;
  tag?: string | null;
  query?: string | null;
  provider?: MemorySearchProviderId | string | null;
  memoryMode?: MemorySearchMode | null;
  states?: MemoryState[] | null;
  limit?: number;
};

export type MemorySearchIndexResult = {
  provider: MemorySearchProviderId;
  providers_available: { id: MemorySearchProviderId; description: string }[];
  query: string;
  hits: MemoryIndexHit[];
  token_estimate_total: number;
};

export type MemoryTimelineInput = {
  tenantType: TenantType;
  tenantId: string;
  projectId?: string | null;
  category?: string | null;
  sessionId?: string | null;
  states?: MemoryState[] | null;
  before?: string | null;
  after?: string | null;
  limit?: number;
};

export type MemoryTimelineEntry = {
  id: string;
  project_id: string;
  session_id: string | null;
  category: string;
  title: string;
  confidence: number;
  state: string;
  quality: string;
  source_type: string;
  updated_at: string;
};

export type MemoryTimelineResult = {
  entries: MemoryTimelineEntry[];
  next_before: string | null;
  total: number;
};

export type MemoryBatchGetInput = {
  tenantType: TenantType;
  tenantId: string;
  ids: string[];
  includeContent?: boolean;
};

export type MemoryBatchGetResult = {
  memories: Record<string, unknown>[];
  missing_ids: string[];
  requested: number;
  resolved: number;
};

type MemorySearchProvider = {
  id: MemorySearchProviderId;
  description: string;
  search(db: Client, input: MemorySearchIndexInput & { query: string; limit: number; memoryMode: MemorySearchMode }): Promise<MemoryIndexHit[]>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function toSafeString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeTags(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === "string").slice(0, 32);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === "string").slice(0, 32);
    } catch {
      return [];
    }
  }
  if (typeof v === "object") {
    try {
      const anyV = v as any;
      if (Array.isArray(anyV)) return anyV.filter((t: unknown): t is string => typeof t === "string").slice(0, 32);
    } catch {
      return [];
    }
  }
  return [];
}

function excerpt(s: string, max = 220): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}...`;
}

function estimateTokens(s: string): number {
  const bytes = Math.max(0, (s || "").length);
  return Math.max(1, Math.ceil(bytes / 4));
}

function scoreFromRank(rank: number, confidence: number): number {
  const base = 1 / Math.max(1, rank);
  const conf = Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0.5));
  return Number((base * 0.85 + conf * 0.15).toFixed(6));
}

function summarizeRow(row: any, provider: MemorySearchProviderId, rank: number): MemoryIndexHit {
  const title = toSafeString(row?.title);
  const content = toSafeString(row?.content);
  const confidence = typeof row?.confidence === "number" ? row.confidence : 0.5;
  const content_excerpt = excerpt(content, 260);
  const token_estimate = estimateTokens(`${title}\n${content_excerpt}`);
  return {
    id: String(row?.id || ""),
    project_id: String(row?.project_id || ""),
    category: String(row?.category || ""),
    title,
    content_excerpt,
    tags: normalizeTags(row?.tags),
    confidence,
    updated_at: String(row?.updated_at || ""),
    provider,
    rank,
    score: scoreFromRank(rank, confidence),
    token_estimate,
  };
}

const memoriesFtsProvider: MemorySearchProvider = {
  id: "memories_fts",
  description: "Full-text + ranked retrieval over memory records.",
  async search(db, input) {
    const rows = await listMemories(db, input.tenantType, input.tenantId, {
      projectId: input.projectId || null,
      category: input.category || null,
      sessionId: input.sessionId || null,
      tag: input.tag || null,
      search: input.query || null,
      mode: "retrieval",
      memoryMode: input.memoryMode,
      states: input.states,
      limit: input.limit,
    });
    return rows.map((r: any, i: number) => summarizeRow(r, "memories_fts", i + 1)).filter((h) => h.id);
  },
};

const recentActivityProvider: MemorySearchProvider = {
  id: "recent_activity",
  description: "Recent-memory retrieval optimized for recency browsing.",
  async search(db, input) {
    const baseRows = await listMemories(db, input.tenantType, input.tenantId, {
      projectId: input.projectId || null,
      category: input.category || null,
      sessionId: input.sessionId || null,
      tag: input.tag || null,
      search: null,
      mode: "retrieval",
      memoryMode: "fast",
      states: input.states,
      limit: Math.min(Math.max(input.limit * 3, input.limit), 200),
    });

    const q = input.query.toLowerCase();
    const filtered =
      q.length >= 2
        ? baseRows.filter((r: any) => {
            const title = String(r?.title || "").toLowerCase();
            const content = String(r?.content || "").toLowerCase();
            const category = String(r?.category || "").toLowerCase();
            return title.includes(q) || content.includes(q) || category.includes(q);
          })
        : baseRows;

    return filtered
      .slice(0, input.limit)
      .map((r: any, i: number) => summarizeRow(r, "recent_activity", i + 1))
      .filter((h) => h.id);
  },
};

const PROVIDERS: Record<MemorySearchProviderId, MemorySearchProvider> = {
  memories_fts: memoriesFtsProvider,
  recent_activity: recentActivityProvider,
};

function resolveProvider(id: string | null | undefined): MemorySearchProvider {
  const key = toSafeString(id).toLowerCase() as MemorySearchProviderId;
  return PROVIDERS[key] || PROVIDERS.memories_fts;
}

function normalizeMemoryMode(mode: unknown): MemorySearchMode {
  if (mode === "fast" || mode === "deep") return mode;
  return "balanced";
}

function isIsoDateTime(v: string): boolean {
  if (!v) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

export function listMemorySearchProviders(): { id: MemorySearchProviderId; description: string }[] {
  return (Object.values(PROVIDERS) as MemorySearchProvider[]).map((p) => ({ id: p.id, description: p.description }));
}

export async function searchMemoryIndex(db: Client, input: MemorySearchIndexInput): Promise<MemorySearchIndexResult> {
  const provider = resolveProvider(input.provider || null);
  const limit = clampInt(input.limit, 20, 1, 100);
  const query = toSafeString(input.query || "");
  const memoryMode = normalizeMemoryMode(input.memoryMode);

  const hits = await provider.search(db, { ...input, query, limit, memoryMode });
  const token_estimate_total = hits.reduce((acc, h) => acc + h.token_estimate, 0);

  return {
    provider: provider.id,
    providers_available: listMemorySearchProviders(),
    query,
    hits,
    token_estimate_total,
  };
}

export async function listMemoryTimeline(db: Client, input: MemoryTimelineInput): Promise<MemoryTimelineResult> {
  const limit = clampInt(input.limit, 100, 1, 500);
  const params: unknown[] = [input.tenantType, input.tenantId];
  let where = "FROM memories WHERE tenant_type = $1 AND tenant_id = $2";

  if (input.projectId) {
    params.push(input.projectId);
    where += ` AND project_id = $${params.length}`;
  }
  if (input.category) {
    params.push(input.category);
    where += ` AND category = $${params.length}`;
  }
  if (input.sessionId) {
    params.push(input.sessionId);
    where += ` AND session_id = $${params.length}`;
  }
  if (Array.isArray(input.states) && input.states.length > 0) {
    params.push(input.states);
    where += ` AND state = ANY($${params.length}::text[])`;
  }
  if (input.before && isIsoDateTime(input.before)) {
    params.push(input.before);
    where += ` AND updated_at < $${params.length}::timestamptz`;
  }
  if (input.after && isIsoDateTime(input.after)) {
    params.push(input.after);
    where += ` AND updated_at > $${params.length}::timestamptz`;
  }

  params.push(limit);
  const sql = `SELECT
      id, project_id, session_id, category, title, confidence, state, quality, source_type, updated_at
    ${where}
    ORDER BY updated_at DESC
    LIMIT $${params.length}`;

  const { rows } = await db.query(sql, params);
  const entries: MemoryTimelineEntry[] = (rows || []).map((r: any) => ({
    id: String(r.id),
    project_id: String(r.project_id),
    session_id: r.session_id ? String(r.session_id) : null,
    category: String(r.category || ""),
    title: String(r.title || ""),
    confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
    state: String(r.state || "active"),
    quality: String(r.quality || "unknown"),
    source_type: String(r.source_type || "manual"),
    updated_at: String(r.updated_at || ""),
  }));

  return {
    entries,
    next_before: entries.length > 0 ? entries[entries.length - 1].updated_at : null,
    total: entries.length,
  };
}

export async function batchGetMemories(db: Client, input: MemoryBatchGetInput): Promise<MemoryBatchGetResult> {
  const rawIds = Array.isArray(input.ids) ? input.ids : [];
  const requestedIds = rawIds
    .map((id) => toSafeString(id))
    .filter(Boolean)
    .slice(0, 200);
  const ids = requestedIds.filter((id) => UUID_RE.test(id));
  const includeContent = input.includeContent !== false;

  if (ids.length === 0) {
    return { memories: [], missing_ids: requestedIds, requested: requestedIds.length, resolved: 0 };
  }

  const select = includeContent
    ? "SELECT *"
    : "SELECT id, project_id, session_id, category, source_type, title, tags, context, confidence, access_count, state, quality, created_at, updated_at, created_by, updated_by";
  const { rows } = await db.query(
    `${select}
     FROM memories
     WHERE tenant_type = $1 AND tenant_id = $2
       AND id = ANY($3::uuid[])`,
    [input.tenantType, input.tenantId, ids]
  );

  const rowById = new Map<string, any>();
  for (const row of rows || []) {
    const id = String((row as any).id || "");
    if (!id) continue;
    rowById.set(id, row);
  }

  const memories: Record<string, unknown>[] = [];
  for (const id of ids) {
    const row = rowById.get(id);
    if (row) memories.push(row as Record<string, unknown>);
  }

  const missing_ids = requestedIds.filter((id) => !rowById.has(id));
  return {
    memories,
    missing_ids,
    requested: requestedIds.length,
    resolved: memories.length,
  };
}

