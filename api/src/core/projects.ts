import type { Client } from "pg";
import type { TenantType } from "../tenant";

export async function listProjects(db: Client, tenantType: TenantType, tenantId: string) {
  const { rows } = await db.query(
    "SELECT * FROM projects WHERE tenant_type = $1 AND tenant_id = $2 ORDER BY updated_at DESC",
    [tenantType, tenantId]
  );
  return rows;
}

export async function getProjectWithStats(db: Client, tenantType: TenantType, tenantId: string, projectId: string) {
  const projRes = await db.query("SELECT * FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
    projectId,
    tenantType,
    tenantId,
  ]);
  const projectRow = projRes.rows[0] ?? null;
  if (!projectRow) return { project: null, memoryStats: [] as unknown[] };

  const statsRes = await db.query(
    "SELECT category, COUNT(*)::int AS count FROM memories WHERE tenant_type = $1 AND tenant_id = $2 AND project_id = $3 GROUP BY category",
    [tenantType, tenantId, projectId]
  );

  return { project: projectRow, memoryStats: statsRes.rows };
}

export async function createProject(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    actorId: string | null;
    id: string;
    name: string;
    engine: string;
    description: string;
    nowIso: string;
  }
) {
  await db.query(
    "INSERT INTO projects (id, tenant_type, tenant_id, name, engine, description, created_at, updated_at, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [
      input.id,
      input.tenantType,
      input.tenantId,
      input.name,
      input.engine || "custom",
      input.description || "",
      input.nowIso,
      input.nowIso,
      input.actorId,
      input.actorId,
    ]
  );
}

export async function updateProject(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    actorId: string | null;
    id: string;
    name: string;
    engine: string;
    description: string;
    nowIso: string;
  }
) {
  await db.query(
    "UPDATE projects SET name = $1, engine = $2, description = $3, updated_at = $4, updated_by = $5 WHERE id = $6 AND tenant_type = $7 AND tenant_id = $8",
    [input.name, input.engine, input.description, input.nowIso, input.actorId, input.id, input.tenantType, input.tenantId]
  );
}

export async function deleteProject(db: Client, tenantType: TenantType, tenantId: string, id: string) {
  await db.query("DELETE FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [id, tenantType, tenantId]);
}

