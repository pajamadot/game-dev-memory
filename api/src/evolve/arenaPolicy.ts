import type { Client } from "pg";
import type { MemorySearchMode } from "../core/memories";
import type { TenantType } from "../tenant";

export type ArenaRetrievalMode = "memories" | "hybrid";

export type ArenaRecommendation = {
  arm_id: string;
  memory_mode: MemorySearchMode;
  retrieval_mode: ArenaRetrievalMode;
  selected_at: string | null;
  source?: string | null;
  confidence?: number | null;
};

const ARM_TO_POLICY: Record<string, { memory_mode: MemorySearchMode; retrieval_mode: ArenaRetrievalMode }> = {
  fast_memories: { memory_mode: "fast", retrieval_mode: "memories" },
  balanced_memories: { memory_mode: "balanced", retrieval_mode: "memories" },
  deep_memories: { memory_mode: "deep", retrieval_mode: "memories" },
  balanced_hybrid: { memory_mode: "balanced", retrieval_mode: "hybrid" },
  deep_hybrid: { memory_mode: "deep", retrieval_mode: "hybrid" },
};

function asString(v: unknown): string {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString();
  return typeof v === "string" ? v.trim() : "";
}

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

export function policyFromArmId(armId: string | null | undefined): ArenaRecommendation | null {
  const key = asString(armId);
  if (!key) return null;
  const p = ARM_TO_POLICY[key];
  if (!p) return null;
  return { arm_id: key, memory_mode: p.memory_mode, retrieval_mode: p.retrieval_mode, selected_at: null };
}

export async function getLatestArenaRecommendation(
  db: Client,
  input: { tenantType: TenantType; tenantId: string; projectId?: string | null }
): Promise<ArenaRecommendation | null> {
  const projectId = asString(input.projectId);

  if (projectId) {
    const policyRow = (
      await db.query(
        `SELECT arm_id, memory_mode, retrieval_mode, updated_at, source, confidence
         FROM project_retrieval_policies
         WHERE tenant_type = $1 AND tenant_id = $2 AND project_id = $3
         LIMIT 1`,
        [input.tenantType, input.tenantId, projectId]
      )
    ).rows[0];

    if (policyRow) {
      const armId = asString((policyRow as any).arm_id);
      const base = policyFromArmId(armId);
      if (base) {
        return {
          ...base,
          selected_at: asString((policyRow as any).updated_at) || null,
          source: asString((policyRow as any).source) || "arena",
          confidence:
            typeof (policyRow as any).confidence === "number" && Number.isFinite((policyRow as any).confidence)
              ? (policyRow as any).confidence
              : null,
        };
      }
    }
  }

  const fetchLatest = async (forProjectId: string | null): Promise<any | null> => {
    const params: unknown[] = [input.tenantType, input.tenantId];
    let sql = `SELECT created_at, changes
      FROM evolution_events
      WHERE tenant_type = $1 AND tenant_id = $2
        AND type = 'optimize'
        AND description = 'memory_arena_run'`;

    if (forProjectId) {
      params.push(forProjectId);
      sql += ` AND project_id = $${params.length}`;
    }

    sql += " ORDER BY created_at DESC LIMIT 1";
    const { rows } = await db.query(sql, params);
    return rows[0] || null;
  };

  // Prefer project-specific recommendation; fallback to tenant-wide latest.
  const row = (projectId ? await fetchLatest(projectId) : null) || (await fetchLatest(null));
  if (!row) return null;

  const changes = parseJsonMaybe((row as any).changes) || {};
  const arena = parseJsonMaybe((changes as any).arena) || (changes as any).arena || {};
  const armId =
    asString((arena as any).selected_next) ||
    asString((arena as any).winner_bandit) ||
    asString((arena as any).winner_current);

  const base = policyFromArmId(armId);
  if (!base) return null;
  return {
    ...base,
    selected_at: asString((row as any).created_at) || null,
    source: "evolution_events",
    confidence: null,
  };
}
