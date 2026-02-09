import type { Client } from "pg";
import type { TenantType } from "../tenant";

export interface ListMemoriesQuery {
  projectId?: string | null;
  category?: string | null;
  search?: string | null;
  tag?: string | null;
  sessionId?: string | null;
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
  const limit = Math.min(Math.max(q.limit || 50, 1), 200);

  let query = "SELECT * FROM memories WHERE tenant_type = $1 AND tenant_id = $2";
  const params: unknown[] = [tenantType, tenantId];

  if (projectId) {
    params.push(projectId);
    query += ` AND project_id = $${params.length}`;
  }
  if (category) {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }
  if (sessionId) {
    params.push(sessionId);
    query += ` AND session_id = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`, `%${search}%`);
    query += ` AND (title ILIKE $${params.length - 1} OR content ILIKE $${params.length})`;
  }
  if (tag) {
    params.push(tag);
    query += ` AND tags ? $${params.length}`;
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

