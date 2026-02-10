import type { Client } from "pg";
import type { TenantType } from "../tenant";
import { searchPageIndex, type PageIndexNode } from "../../../packages/pageindex-ts/src/index";

export type PageIndexEvidence = {
  kind: "pageindex";
  artifact_id: string;
  project_id: string;
  node_id: string;
  title: string;
  path: string[];
  excerpt: string;
  score: number;
};

function parseJsonMaybe(v: unknown): any {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
}

export async function retrievePageIndexEvidence(
  db: Client,
  tenantType: TenantType,
  tenantId: string,
  input: { projectId: string; query: string; limit: number; artifactLimit?: number }
): Promise<PageIndexEvidence[]> {
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit || 8)));
  const artifactLimit = Math.max(1, Math.min(50, Math.trunc(input.artifactLimit ?? 20)));

  const { rows } = await db.query(
    `SELECT id, project_id, metadata
     FROM artifacts
     WHERE tenant_type = $1 AND tenant_id = $2
       AND project_id = $3
       AND metadata ? 'pageindex'
     ORDER BY created_at DESC
     LIMIT $4`,
    [tenantType, tenantId, input.projectId, artifactLimit]
  );

  const all: PageIndexEvidence[] = [];

  for (const r of rows as any[]) {
    const artifactId = String(r.id);
    const projectId = String(r.project_id);
    const meta = parseJsonMaybe(r.metadata) || {};
    const pi = meta.pageindex || null;
    if (!pi) continue;
    const roots = (parseJsonMaybe(pi.roots) || pi.roots) as PageIndexNode[] | null;
    if (!Array.isArray(roots) || roots.length === 0) continue;

    const matches = searchPageIndex(roots, input.query, { limit: Math.min(12, limit * 2) });
    for (const m of matches) {
      all.push({
        kind: "pageindex",
        artifact_id: artifactId,
        project_id: projectId,
        node_id: m.node_id,
        title: m.title,
        path: m.path || [],
        excerpt: m.excerpt || "",
        score: m.score,
      });
    }
  }

  all.sort((a, b) => b.score - a.score);

  const out: PageIndexEvidence[] = [];
  const seen = new Set<string>();
  for (const e of all) {
    const key = `${e.artifact_id}#${e.node_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }

  return out;
}

