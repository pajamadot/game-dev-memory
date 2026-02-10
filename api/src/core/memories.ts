import type { Client } from "pg";
import type { TenantType } from "../tenant";

export type MemoryState = "active" | "superseded" | "quarantined";
export type MemoryQuality = "unknown" | "good" | "bad";

export interface ListMemoriesQuery {
  projectId?: string | null;
  category?: string | null;
  search?: string | null;
  tag?: string | null;
  sessionId?: string | null;
  states?: MemoryState[] | null;
  limit?: number | null;
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
  const limit = Math.min(Math.max(q.limit || 50, 1), 200);

  let query = "SELECT * FROM memories WHERE tenant_type = $1 AND tenant_id = $2";
  const params: unknown[] = [tenantType, tenantId];

  if (projectId) {
    params.push(projectId);
    query += ` AND project_id = $${params.length}`;
  }

  // Default to active memories only unless caller explicitly requests otherwise.
  // This prevents quarantined/superseded items from poisoning retrieval by accident.
  const effectiveStates =
    states === null ? null : Array.isArray(states) && states.length > 0 ? states : (["active"] as MemoryState[]);
  if (effectiveStates) {
    params.push(effectiveStates);
    query += ` AND state = ANY($${params.length}::text[])`;
  }

  if (category) {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }
  if (sessionId) {
    params.push(sessionId);
    query += ` AND session_id = $${params.length}`;
  }
  if (tag) {
    params.push(tag);
    query += ` AND tags ? $${params.length}`;
  }
  if (search) {
    // Hybrid retrieval:
    // - FTS (GIN) for relevance
    // - ILIKE fallback for odd tokens (paths, ids) that FTS may miss
    const tsq = search;
    const ilike = `%${search}%`;
    params.push(tsq);
    const tsIdx = params.length;
    params.push(ilike);
    const likeIdx = params.length;

    const vecExpr = "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))";
    const tsqExpr = `websearch_to_tsquery('simple', $${tsIdx})`;

    query += ` AND (${vecExpr} @@ ${tsqExpr} OR title ILIKE $${likeIdx} OR content ILIKE $${likeIdx})`;

    // Rank primarily by FTS relevance; add small recency+confidence tiebreakers.
    // NOTE: Keep formula stable; avoid huge weights that cause surprising ordering.
    const scoreExpr = `(
      ts_rank_cd(${vecExpr}, ${tsqExpr}) * 10.0
      + (1.0 / (1.0 + (EXTRACT(EPOCH FROM (now() - updated_at)) / 86400.0)))
      + (confidence * 0.25)
      + CASE quality WHEN 'good' THEN 0.2 WHEN 'bad' THEN -0.5 ELSE 0.0 END
    )`;

    params.push(limit);
    query += ` ORDER BY ${scoreExpr} DESC, updated_at DESC LIMIT $${params.length}`;

    const { rows } = await db.query(query, params);
    return rows;
  }

  params.push(limit);
  query += ` ORDER BY updated_at DESC LIMIT $${params.length}`;

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
}

export async function deleteMemory(db: Client, tenantType: TenantType, tenantId: string, id: string) {
  await db.query("DELETE FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [id, tenantType, tenantId]);
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
  return { id: String(row.id), state: String(row.state), quality: String(row.quality), updated_at: String(row.updated_at) };
}
