import type { Client } from "pg";
import type { TenantType } from "../tenant";

export type MemoryState = "active" | "superseded" | "quarantined";
export type MemoryQuality = "unknown" | "good" | "bad";
export type MemorySearchMode = "fast" | "balanced" | "deep";

async function recordMemoryEvent(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    actorId: string | null;
    projectId: string | null;
    memoryId: string;
    eventType: string;
    eventData: Record<string, unknown>;
    nowIso: string;
  }
) {
  await db.query(
    `INSERT INTO memory_events (
       id, tenant_type, tenant_id, project_id, memory_id,
       event_type, event_data, created_at, created_by
     )
     VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::jsonb, $8, $9)`,
    [
      crypto.randomUUID(),
      input.tenantType,
      input.tenantId,
      input.projectId,
      input.memoryId,
      input.eventType,
      JSON.stringify(input.eventData || {}),
      input.nowIso,
      input.actorId,
    ]
  );
}

export interface ListMemoriesQuery {
  projectId?: string | null;
  category?: string | null;
  search?: string | null;
  tag?: string | null;
  sessionId?: string | null;
  states?: MemoryState[] | null;
  excludeCategoryPrefixes?: string[] | null;
  mode?: "full" | "retrieval" | "preview" | "index";
  memoryMode?: MemorySearchMode | null;
  limit?: number | null;
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function stripScore<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => {
    const out = { ...r };
    delete (out as any)._score;
    return out;
  });
}

function dedupeById<T extends Record<string, unknown>>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const id = String((r as any).id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

export async function listMemories(
  db: Client,
  tenantType: TenantType,
  tenantId: string,
  q: ListMemoriesQuery
) {
  const projectId = q.projectId || null;
  const category = q.category || null;
  const search = q.search || null;
  const tag = q.tag || null;
  const sessionId = q.sessionId || null;
  const states = q.states;
  const excludeCategoryPrefixes = Array.isArray(q.excludeCategoryPrefixes)
    ? q.excludeCategoryPrefixes.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).slice(0, 16)
    : [];
  const mode: NonNullable<ListMemoriesQuery["mode"]> =
    q.mode === "retrieval" || q.mode === "preview" || q.mode === "index" ? q.mode : "full";
  const memoryMode: MemorySearchMode = q.memoryMode === "fast" || q.memoryMode === "deep" ? q.memoryMode : "balanced";
  const limit = Math.min(Math.max(q.limit || 50, 1), 200);
  // "index"/"preview" exist to avoid pulling huge content blobs when a caller only needs a snippet.
  // Do not change the WHERE semantics: FTS/ILIKE still search the full `memories.content` column.
  const previewChars = 8000;
  const selectClause =
    mode === "full"
      ? "SELECT *"
      : mode === "preview"
        ? `SELECT id, project_id, session_id, category, source_type, title,
             LEFT(COALESCE(content, ''), ${previewChars}) AS content,
             tags, context, confidence, access_count, state, quality, created_at, updated_at, created_by, updated_by`
        : mode === "index"
          ? `SELECT id, project_id, category, title,
               LEFT(COALESCE(content, ''), ${previewChars}) AS content,
               tags, confidence, updated_at, state, quality, source_type, session_id`
          : "SELECT id, project_id, category, title, content, tags, confidence, updated_at, state, quality, source_type, session_id";

  let where = "FROM memories WHERE tenant_type = $1 AND tenant_id = $2";
  const params: unknown[] = [tenantType, tenantId];

  if (projectId) {
    params.push(projectId);
    where += ` AND project_id = $${params.length}`;
  }

  // Default to active memories only unless caller explicitly requests otherwise.
  // This prevents quarantined/superseded items from poisoning retrieval by accident.
  const effectiveStates =
    states === null ? null : Array.isArray(states) && states.length > 0 ? states : (["active"] as MemoryState[]);
  if (effectiveStates) {
    params.push(effectiveStates);
    where += ` AND state = ANY($${params.length}::text[])`;
  }

  if (category) {
    params.push(category);
    where += ` AND category = $${params.length}`;
  }
  if (sessionId) {
    params.push(sessionId);
    where += ` AND session_id = $${params.length}`;
  }
  if (tag) {
    params.push(tag);
    where += ` AND tags ? $${params.length}`;
  }
  for (const prefix of excludeCategoryPrefixes) {
    params.push(`${prefix}%`);
    where += ` AND category NOT LIKE $${params.length}`;
  }

  if (search) {
    const tsq = search.trim();
    const vecExpr = "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))";
    const scoreExpr = (tsIdx: number) => `(
      ts_rank_cd(${vecExpr}, websearch_to_tsquery('simple', $${tsIdx})) * 10.0
      + (1.0 / (1.0 + (EXTRACT(EPOCH FROM (now() - updated_at)) / 86400.0)))
      + (confidence * 0.25)
      + CASE quality WHEN 'good' THEN 0.2 WHEN 'bad' THEN -0.5 ELSE 0.0 END
    )`;

    const runFts = async (ftsLimit: number): Promise<Record<string, unknown>[]> => {
      const ftsParams = [...params];
      ftsParams.push(tsq);
      const tsIdx = ftsParams.length;
      ftsParams.push(ftsLimit);
      const limIdx = ftsParams.length;

      const ftsSql = `${selectClause}, ${scoreExpr(tsIdx)} AS _score ${where}
        AND ${vecExpr} @@ websearch_to_tsquery('simple', $${tsIdx})
        ORDER BY _score DESC, updated_at DESC
        LIMIT $${limIdx}`;

      return (await db.query(ftsSql, ftsParams)).rows as Record<string, unknown>[];
    };

    const runLikeFallback = async (
      likeLimit: number,
      excludeIds: string[] = []
    ): Promise<Record<string, unknown>[]> => {
      if (likeLimit <= 0) return [];
      const ilike = `%${escapeLike(tsq)}%`;
      const likeParams = [...params];
      likeParams.push(ilike);
      const likeIdx = likeParams.length;

      let dedupeClause = "";
      if (excludeIds.length > 0) {
        likeParams.push(excludeIds);
        const dedupeIdx = likeParams.length;
        dedupeClause = ` AND id <> ALL($${dedupeIdx}::uuid[])`;
      }

      likeParams.push(likeLimit);
      const likeLimIdx = likeParams.length;

      const likeSql = `${selectClause} ${where}
        AND (title ILIKE $${likeIdx} OR content ILIKE $${likeIdx})
        ${dedupeClause}
        ORDER BY updated_at DESC
        LIMIT $${likeLimIdx}`;

      return (await db.query(likeSql, likeParams)).rows as Record<string, unknown>[];
    };

    try {
      if (memoryMode === "fast") {
        // Fast mode: one FTS pass only (lower latency and predictable cost).
        const ftsRows = await runFts(limit);
        return stripScore(ftsRows);
      }

      if (memoryMode === "balanced") {
        // Balanced mode: FTS first, then ILIKE fallback only if needed.
        const ftsRows = await runFts(limit);
        if (ftsRows.length >= limit) return stripScore(ftsRows);
        const likeRows = await runLikeFallback(
          limit - ftsRows.length,
          ftsRows.map((r) => String((r as any).id))
        );
        return [...stripScore(ftsRows), ...likeRows];
      }

      // Deep mode:
      // 1) widen candidate retrieval (higher recall),
      // 2) blend with contextual neighbors from same session/category,
      // 3) cap to requested limit.
      const candidateLimit = Math.min(Math.max(limit * 3, limit), 200);
      const ftsRows = await runFts(candidateLimit);

      let candidateRows = dedupeById(stripScore(ftsRows));
      if (candidateRows.length < candidateLimit) {
        const likeRows = await runLikeFallback(
          candidateLimit - candidateRows.length,
          candidateRows.map((r) => String((r as any).id))
        );
        candidateRows = dedupeById([...candidateRows, ...likeRows]);
      }

      const headCount = Math.min(limit, Math.max(1, Math.ceil(limit * 0.6)));
      const selected = candidateRows.slice(0, headCount);
      const selectedIds = new Set(selected.map((r) => String((r as any).id || "")).filter(Boolean));

      const remainderNeeded = Math.max(0, limit - selected.length);
      const canExpandContext = Boolean(projectId && remainderNeeded > 0);
      const sessionIds = [...new Set(selected.map((r) => String((r as any).session_id || "")).filter(Boolean))].slice(0, 16);
      const categories = [...new Set(selected.map((r) => String((r as any).category || "")).filter(Boolean))].slice(0, 16);

      const contextualRows: Record<string, unknown>[] = [];
      if (canExpandContext && (sessionIds.length > 0 || categories.length > 0)) {
        const neighborParams = [...params];
        neighborParams.push([...selectedIds]);
        const excludeIdx = neighborParams.length;

        const clauses: string[] = [];
        if (sessionIds.length > 0) {
          neighborParams.push(sessionIds);
          clauses.push(`session_id = ANY($${neighborParams.length}::uuid[])`);
        }
        if (categories.length > 0) {
          neighborParams.push(categories);
          clauses.push(`category = ANY($${neighborParams.length}::text[])`);
        }

        if (clauses.length > 0) {
          neighborParams.push(Math.min(Math.max(remainderNeeded * 2, remainderNeeded), 80));
          const limIdx = neighborParams.length;
          const neighborSql = `${selectClause} ${where}
            AND id <> ALL($${excludeIdx}::uuid[])
            AND (${clauses.join(" OR ")})
            ORDER BY updated_at DESC
            LIMIT $${limIdx}`;
          const { rows } = await db.query(neighborSql, neighborParams);
          contextualRows.push(...(rows as Record<string, unknown>[]));
        }
      }

      const merged = dedupeById([...selected, ...contextualRows, ...candidateRows]);
      return merged.slice(0, limit);
    } catch {
      // Fallback-only path for unusual FTS parse edge cases.
      return await runLikeFallback(limit);
    }
  }

  params.push(limit);
  const query = `${selectClause} ${where} ORDER BY updated_at DESC LIMIT $${params.length}`;

  const { rows } = await db.query(query, params);
  return rows;
}

export async function getMemory(db: Client, tenantType: TenantType, tenantId: string, id: string) {
  await db.query("UPDATE memories SET access_count = access_count + 1 WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
    id,
    tenantType,
    tenantId,
  ]);
  const { rows } = await db.query("SELECT * FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
    id,
    tenantType,
    tenantId,
  ]);
  return rows[0] ?? null;
}

export async function createMemory(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    actorId: string | null;
    id: string;
    projectId: string;
    sessionId: string | null;
    category: string;
    sourceType: string;
    title: string;
    content: string;
    tags: string[];
    context: Record<string, unknown>;
    confidence: number;
    nowIso: string;
  }
) {
  // Enforce that the project exists and belongs to the tenant.
  const projRes = await db.query("SELECT id FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
    input.projectId,
    input.tenantType,
    input.tenantId,
  ]);
  if (projRes.rowCount === 0) {
    throw new Error("Project not found (or not in tenant scope).");
  }

  if (input.sessionId) {
    const sessRes = await db.query(
      "SELECT id FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND project_id = $4",
      [input.sessionId, input.tenantType, input.tenantId, input.projectId]
    );
    if (sessRes.rowCount === 0) {
      throw new Error("Session not found (or not in tenant/project scope).");
    }
  }

  await db.query(
    `INSERT INTO memories (
       id, tenant_type, tenant_id, project_id, session_id,
       category, source_type, title, content, tags, context,
       confidence, access_count, created_at, updated_at, created_by, updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, 0, $13, $14, $15, $16)`,
    [
      input.id,
      input.tenantType,
      input.tenantId,
      input.projectId,
      input.sessionId,
      input.category,
      input.sourceType,
      input.title,
      input.content,
      JSON.stringify(input.tags || []),
      JSON.stringify(input.context || {}),
      input.confidence,
      input.nowIso,
      input.nowIso,
      input.actorId,
      input.actorId,
    ]
  );

  await recordMemoryEvent(db, {
    tenantType: input.tenantType,
    tenantId: input.tenantId,
    actorId: input.actorId,
    projectId: input.projectId,
    memoryId: input.id,
    eventType: "create",
    eventData: {
      category: input.category,
      source_type: input.sourceType,
      title: input.title,
      tags: input.tags || [],
      confidence: input.confidence,
      session_id: input.sessionId,
      content_len: input.content ? input.content.length : 0,
    },
    nowIso: input.nowIso,
  });
}

export async function updateMemory(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    actorId: string | null;
    id: string;
    title: string;
    content: string;
    tags: string[];
    context: Record<string, unknown>;
    confidence: number;
    category: string;
    sourceType: string;
    nowIso: string;
  }
) {
  const beforeRes = await db.query(
    "SELECT project_id, title, category, source_type, confidence, state, quality FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
    [input.id, input.tenantType, input.tenantId]
  );
  const before = beforeRes.rows[0] ?? null;

  await db.query(
    `UPDATE memories
     SET title = $1, content = $2, tags = $3::jsonb, context = $4::jsonb, confidence = $5, category = $6, source_type = $7, updated_at = $8, updated_by = $9
     WHERE id = $10 AND tenant_type = $11 AND tenant_id = $12`,
    [
      input.title,
      input.content,
      JSON.stringify(input.tags || []),
      JSON.stringify(input.context || {}),
      input.confidence ?? 0.5,
      input.category,
      input.sourceType ?? "manual",
      input.nowIso,
      input.actorId,
      input.id,
      input.tenantType,
      input.tenantId,
    ]
  );

  if (before) {
    await recordMemoryEvent(db, {
      tenantType: input.tenantType,
      tenantId: input.tenantId,
      actorId: input.actorId,
      projectId: before.project_id ? String(before.project_id) : null,
      memoryId: input.id,
      eventType: "update",
      eventData: {
        from: {
          title: before.title,
          category: before.category,
          source_type: before.source_type,
          confidence: before.confidence,
          state: before.state,
          quality: before.quality,
        },
        to: {
          title: input.title,
          category: input.category,
          source_type: input.sourceType,
          confidence: input.confidence ?? 0.5,
        },
        content_len: input.content ? input.content.length : 0,
      },
      nowIso: input.nowIso,
    });
  }
}

export async function deleteMemory(
  db: Client,
  input: { tenantType: TenantType; tenantId: string; actorId: string | null; id: string; nowIso: string }
) {
  const beforeRes = await db.query(
    "SELECT project_id, title, category, source_type, confidence, state, quality FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
    [input.id, input.tenantType, input.tenantId]
  );
  const before = beforeRes.rows[0] ?? null;

  if (before) {
    await recordMemoryEvent(db, {
      tenantType: input.tenantType,
      tenantId: input.tenantId,
      actorId: input.actorId,
      projectId: before.project_id ? String(before.project_id) : null,
      memoryId: input.id,
      eventType: "delete",
      eventData: {
        title: before.title,
        category: before.category,
        source_type: before.source_type,
        confidence: before.confidence,
        state: before.state,
        quality: before.quality,
      },
      nowIso: input.nowIso,
    });
  }

  await db.query("DELETE FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
    input.id,
    input.tenantType,
    input.tenantId,
  ]);
}

export async function setMemoryLifecycle(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    actorId: string | null;
    id: string;
    state?: MemoryState | null;
    quality?: MemoryQuality | null;
    nowIso: string;
  }
): Promise<{ id: string; state: string; quality: string; updated_at: string } | null> {
  const beforeRes = await db.query(
    "SELECT project_id, state, quality FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
    [input.id, input.tenantType, input.tenantId]
  );
  const before = beforeRes.rows[0] ?? null;
  if (!before) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.state) {
    params.push(input.state);
    sets.push(`state = $${params.length}`);
  }
  if (input.quality) {
    params.push(input.quality);
    sets.push(`quality = $${params.length}`);
  }

  if (sets.length === 0) return null;

  params.push(input.nowIso);
  sets.push(`updated_at = $${params.length}`);

  params.push(input.actorId);
  sets.push(`updated_by = $${params.length}`);

  params.push(input.id, input.tenantType, input.tenantId);

  const { rows } = await db.query(
    `UPDATE memories
     SET ${sets.join(", ")}
     WHERE id = $${params.length - 2} AND tenant_type = $${params.length - 1} AND tenant_id = $${params.length}
     RETURNING id, state, quality, updated_at`,
    params
  );

  const row = rows[0] as any;
  if (!row) return null;

  await recordMemoryEvent(db, {
    tenantType: input.tenantType,
    tenantId: input.tenantId,
    actorId: input.actorId,
    projectId: before.project_id ? String(before.project_id) : null,
    memoryId: input.id,
    eventType: "lifecycle_set",
    eventData: {
      from: { state: String(before.state), quality: String(before.quality) },
      to: { state: String(row.state), quality: String(row.quality) },
    },
    nowIso: input.nowIso,
  });

  return { id: String(row.id), state: String(row.state), quality: String(row.quality), updated_at: String(row.updated_at) };
}
