import type { Client } from "pg";
import type { TenantType } from "../tenant";
import { listMemories, type MemorySearchMode } from "../core/memories";
import { retrievePageIndexEvidence } from "../agent/pageindex";

type SessionKind = "agent" | "agent_pro";

type ArenaArm = {
  arm_id: string;
  memory_mode: MemorySearchMode;
  retrieval_mode: "memories" | "hybrid";
  use_memories: boolean;
  use_documents: boolean;
};

type SessionRow = { id: string; project_id: string; kind: SessionKind };

type MessageRow = {
  session_id: string;
  project_id: string;
  category: string;
  content: string;
  context: unknown;
  created_at: string;
};

type Episode = {
  session_id: string;
  project_id: string;
  query: string;
  target_memory_ids: string[];
  target_document_keys: string[];
};

type ArmMetrics = {
  arm_id: string;
  memory_mode: MemorySearchMode;
  retrieval_mode: "memories" | "hybrid";
  episodes_evaluated: number;
  labeled_episodes: number;
  avg_score: number;
  avg_latency_ms: number;
  avg_memory_recall: number;
  avg_memory_precision: number;
  avg_document_recall: number;
  avg_memories_returned: number;
  avg_documents_returned: number;
  avg_category_diversity: number;
};

type BanditArmState = {
  arm_id: string;
  pulls: number;
  mean_reward: number;
  ucb_score: number;
};

type ArenaRunInput = {
  tenantType: TenantType;
  tenantId: string;
  actorId: string | null;
  projectId?: string | null;
  sessionKinds?: SessionKind[] | null;
  includeOpenSessions?: boolean;
  limitSessions?: number;
  limitEpisodes?: number;
  memoryLimit?: number;
  documentLimit?: number;
};

type ArenaRunResult = {
  version: string;
  project_id: string | null;
  session_kinds: SessionKind[];
  dataset: {
    sessions_considered: number;
    episodes_total: number;
    episodes_labeled: number;
  };
  arm_results: ArmMetrics[];
  winner_current: string | null;
  winner_bandit: string | null;
  selected_next: string | null;
  bandit: {
    total_pulls: number;
    arms: BanditArmState[];
  };
};

type ArenaBatchRunInput = ArenaRunInput & {
  iterations: number;
  timeBudgetMs?: number;
  stopWhenNoEpisodes?: boolean;
};

type ArenaBatchRunResult = {
  requested_iterations: number;
  completed_iterations: number;
  elapsed_ms: number;
  stopped_reason: "completed" | "time_budget" | "no_episodes";
  winner_tally: { arm_id: string; wins: number }[];
  average_scores: { arm_id: string; avg_score: number }[];
  last_run: ArenaRunResult | null;
};

const DEFAULT_ARMS: ArenaArm[] = [
  { arm_id: "fast_memories", memory_mode: "fast", retrieval_mode: "memories", use_memories: true, use_documents: false },
  { arm_id: "balanced_memories", memory_mode: "balanced", retrieval_mode: "memories", use_memories: true, use_documents: false },
  { arm_id: "deep_memories", memory_mode: "deep", retrieval_mode: "memories", use_memories: true, use_documents: false },
  { arm_id: "balanced_hybrid", memory_mode: "balanced", retrieval_mode: "hybrid", use_memories: true, use_documents: true },
  { arm_id: "deep_hybrid", memory_mode: "deep", retrieval_mode: "hybrid", use_memories: true, use_documents: true },
];

function policyFromArmId(armId: string | null | undefined): { arm_id: string; memory_mode: MemorySearchMode; retrieval_mode: "memories" | "hybrid" } | null {
  const key = safeString(armId);
  if (!key) return null;
  const arm = DEFAULT_ARMS.find((a) => a.arm_id === key);
  if (!arm) return null;
  return { arm_id: arm.arm_id, memory_mode: arm.memory_mode, retrieval_mode: arm.retrieval_mode };
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function safeString(v: unknown): string {
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

function mean(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function overlapCount(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const s = new Set(a);
  let out = 0;
  for (const x of b) if (s.has(x)) out++;
  return out;
}

function extractEvidenceFromAssistantContext(ctxRaw: unknown): { memoryIds: string[]; docKeys: string[] } {
  const ctx = parseJsonMaybe(ctxRaw) || {};
  const evidence = parseJsonMaybe((ctx as any).evidence) || (ctx as any).evidence || {};

  const memoryIds = Array.isArray(evidence?.memory_ids)
    ? evidence.memory_ids.map((v: unknown) => safeString(v)).filter(Boolean).slice(0, 300)
    : [];

  const docKeys = Array.isArray(evidence?.documents)
    ? evidence.documents
        .map((d: any) => `${safeString(d?.artifact_id)}#${safeString(d?.node_id)}`)
        .filter((k: string) => !k.startsWith("#") && !k.endsWith("#"))
        .slice(0, 300)
    : [];

  return { memoryIds, docKeys };
}

function buildEpisodes(rows: MessageRow[], limitEpisodes: number): Episode[] {
  const bySession = new Map<string, MessageRow[]>();
  for (const r of rows) {
    const sid = safeString(r.session_id);
    if (!sid) continue;
    const arr = bySession.get(sid) || [];
    arr.push(r);
    bySession.set(sid, arr);
  }

  const episodes: Episode[] = [];

  for (const sessionRows of bySession.values()) {
    const items = sessionRows.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      if (m.category !== "agent_user") continue;
      const query = safeString(m.content);
      if (query.length < 2) continue;

      let nextAssistant: MessageRow | null = null;
      for (let j = i + 1; j < items.length; j++) {
        if (items[j].category === "agent_assistant") {
          nextAssistant = items[j];
          break;
        }
      }
      if (!nextAssistant) continue;

      const ev = extractEvidenceFromAssistantContext(nextAssistant.context);
      episodes.push({
        session_id: safeString(m.session_id),
        project_id: safeString(m.project_id),
        query,
        target_memory_ids: ev.memoryIds,
        target_document_keys: ev.docKeys,
      });

      if (episodes.length >= limitEpisodes) return episodes;
    }
  }

  return episodes;
}

async function loadDataset(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    projectId: string | null;
    sessionKinds: SessionKind[];
    includeOpenSessions: boolean;
    limitSessions: number;
    limitEpisodes: number;
  }
): Promise<{ sessions: SessionRow[]; episodes: Episode[] }> {
  const sessionsParams: unknown[] = [input.tenantType, input.tenantId, input.sessionKinds, input.limitSessions];
  let sessionsSql = `SELECT id, project_id, kind
    FROM sessions
    WHERE tenant_type = $1 AND tenant_id = $2
      AND kind = ANY($3::text[])`;

  if (!input.includeOpenSessions) {
    sessionsSql += " AND ended_at IS NOT NULL";
  }

  if (input.projectId) {
    sessionsParams.push(input.projectId);
    sessionsSql += ` AND project_id = $${sessionsParams.length}`;
  }

  sessionsSql += ` ORDER BY started_at DESC LIMIT $4`;

  const sessionsRows = (await db.query(sessionsSql, sessionsParams)).rows as any[];
  const sessions: SessionRow[] = sessionsRows.map((r) => ({
    id: safeString(r.id),
    project_id: safeString(r.project_id),
    kind: safeString(r.kind) === "agent_pro" ? "agent_pro" : "agent",
  }));

  const sessionIds = sessions.map((s) => s.id).filter(Boolean);
  if (sessionIds.length === 0) return { sessions, episodes: [] };

  const { rows } = await db.query(
    `SELECT session_id, project_id, category, content, context, created_at
     FROM memories
     WHERE tenant_type = $1 AND tenant_id = $2
       AND session_id = ANY($3::uuid[])
       AND category IN ('agent_user', 'agent_assistant')
     ORDER BY session_id ASC, created_at ASC`,
    [input.tenantType, input.tenantId, sessionIds]
  );

  const episodes = buildEpisodes(
    rows.map((r: any) => ({
      session_id: safeString(r.session_id),
      project_id: safeString(r.project_id),
      category: safeString(r.category),
      content: safeString(r.content),
      context: r.context,
      created_at: safeString(r.created_at),
    })),
    input.limitEpisodes
  );

  return { sessions, episodes };
}

async function evaluateArm(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    arm: ArenaArm;
    episodes: Episode[];
    memoryLimit: number;
    documentLimit: number;
  }
): Promise<ArmMetrics> {
  const scoreList: number[] = [];
  const latencyList: number[] = [];
  const memRecallList: number[] = [];
  const memPrecisionList: number[] = [];
  const docRecallList: number[] = [];
  const memCountList: number[] = [];
  const docCountList: number[] = [];
  const diversityList: number[] = [];

  let labeledEpisodes = 0;

  for (const ep of input.episodes) {
    const t0 = Date.now();

    const memRows = input.arm.use_memories
      ? await listMemories(db, input.tenantType, input.tenantId, {
          projectId: ep.project_id,
          search: ep.query,
          limit: input.memoryLimit,
          mode: "retrieval",
          memoryMode: input.arm.memory_mode,
          excludeCategoryPrefixes: ["agent_"],
        })
      : [];

    const docs = input.arm.use_documents
      ? await retrievePageIndexEvidence(db, input.tenantType, input.tenantId, {
          projectId: ep.project_id,
          query: ep.query,
          limit: input.documentLimit,
        })
      : [];

    const latencyMs = Date.now() - t0;
    latencyList.push(latencyMs);

    const memoryIds = memRows.map((m: any) => safeString(m.id)).filter(Boolean);
    const docKeys = docs.map((d) => `${safeString((d as any).artifact_id)}#${safeString((d as any).node_id)}`).filter(Boolean);

    const memOverlap = overlapCount(memoryIds, ep.target_memory_ids);
    const docOverlap = overlapCount(docKeys, ep.target_document_keys);

    const memRecall = ep.target_memory_ids.length > 0 ? memOverlap / ep.target_memory_ids.length : 0;
    const memPrecision = memoryIds.length > 0 ? memOverlap / memoryIds.length : 0;
    const docRecall = ep.target_document_keys.length > 0 ? docOverlap / ep.target_document_keys.length : 0;

    memRecallList.push(memRecall);
    memPrecisionList.push(memPrecision);
    docRecallList.push(docRecall);

    const uniqueCategories = new Set(memRows.map((m: any) => safeString(m.category)).filter(Boolean)).size;
    const diversity = memoryIds.length > 0 ? uniqueCategories / memoryIds.length : 0;
    diversityList.push(diversity);
    memCountList.push(memoryIds.length);
    docCountList.push(docKeys.length);

    const latencyScore = 1 / (1 + latencyMs / 350);
    const hasLabels = ep.target_memory_ids.length > 0 || ep.target_document_keys.length > 0;
    if (hasLabels) labeledEpisodes++;

    const score = hasLabels
      ? Math.max(0, Math.min(1, memRecall * 0.55 + memPrecision * 0.15 + docRecall * 0.2 + latencyScore * 0.07 + diversity * 0.03))
      : Math.max(
          0,
          Math.min(
            1,
            (Math.min(1, memoryIds.length / Math.max(3, input.memoryLimit * 0.5)) * 0.45) +
              diversity * 0.35 +
              latencyScore * 0.2
          )
        );

    scoreList.push(score);
  }

  return {
    arm_id: input.arm.arm_id,
    memory_mode: input.arm.memory_mode,
    retrieval_mode: input.arm.retrieval_mode,
    episodes_evaluated: input.episodes.length,
    labeled_episodes: labeledEpisodes,
    avg_score: mean(scoreList),
    avg_latency_ms: mean(latencyList),
    avg_memory_recall: mean(memRecallList),
    avg_memory_precision: mean(memPrecisionList),
    avg_document_recall: mean(docRecallList),
    avg_memories_returned: mean(memCountList),
    avg_documents_returned: mean(docCountList),
    avg_category_diversity: mean(diversityList),
  };
}

function loadHistoricalBandit(rows: any[]): Map<string, { pulls: number; rewardSum: number }> {
  const out = new Map<string, { pulls: number; rewardSum: number }>();
  for (const r of rows) {
    const changes = parseJsonMaybe(r?.changes) || {};
    const arena = parseJsonMaybe((changes as any).arena) || (changes as any).arena || {};
    const armResults = Array.isArray(arena?.arm_results) ? arena.arm_results : [];
    for (const a of armResults) {
      const armId = safeString(a?.arm_id);
      if (!armId) continue;
      const pulls = clampInt(a?.episodes_evaluated, 1, 1, 1000000);
      const avgScore = typeof a?.avg_score === "number" && Number.isFinite(a.avg_score) ? a.avg_score : 0;
      const cur = out.get(armId) || { pulls: 0, rewardSum: 0 };
      cur.pulls += pulls;
      cur.rewardSum += avgScore * pulls;
      out.set(armId, cur);
    }
  }
  return out;
}

function buildBanditState(current: ArmMetrics[], history: Map<string, { pulls: number; rewardSum: number }>): {
  totalPulls: number;
  arms: BanditArmState[];
  winnerBandit: string | null;
  selectedNext: string | null;
} {
  const merged = new Map<string, { pulls: number; rewardSum: number }>();
  for (const [k, v] of history) merged.set(k, { pulls: v.pulls, rewardSum: v.rewardSum });
  for (const c of current) {
    const prev = merged.get(c.arm_id) || { pulls: 0, rewardSum: 0 };
    prev.pulls += Math.max(1, c.episodes_evaluated);
    prev.rewardSum += c.avg_score * Math.max(1, c.episodes_evaluated);
    merged.set(c.arm_id, prev);
  }

  const totalPulls = [...merged.values()].reduce((a, b) => a + b.pulls, 0);
  const c = 0.35;
  const arms: BanditArmState[] = [...merged.entries()].map(([arm_id, s]) => {
    const pulls = Math.max(1, s.pulls);
    const mean_reward = s.rewardSum / pulls;
    const ucb_score = mean_reward + c * Math.sqrt(Math.log(totalPulls + 1) / pulls);
    return { arm_id, pulls, mean_reward, ucb_score };
  });

  arms.sort((a, b) => b.ucb_score - a.ucb_score);
  const winnerBandit = arms[0]?.arm_id || null;
  const selectedNext = winnerBandit;
  return { totalPulls, arms, winnerBandit, selectedNext };
}

async function recordArenaEvolutionEvent(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    actorId: string | null;
    projectId: string | null;
    changes: Record<string, unknown>;
  }
) {
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO evolution_events (
       id, tenant_type, tenant_id, project_id, session_id,
       type, parent_id, description, changes, result, created_at, created_by
     )
     VALUES ($1, $2, $3, $4, NULL, 'optimize', NULL, $5, $6::jsonb, 'success', $7, $8)`,
    [
      crypto.randomUUID(),
      input.tenantType,
      input.tenantId,
      input.projectId,
      "memory_arena_run",
      JSON.stringify(input.changes || {}),
      now,
      input.actorId,
    ]
  );
}

async function upsertProjectRetrievalPolicy(
  db: Client,
  input: {
    tenantType: TenantType;
    tenantId: string;
    actorId: string | null;
    projectId: string | null;
    selectedArmId: string | null;
    avgScore: number;
  }
): Promise<void> {
  if (!input.projectId) return;
  const policy = policyFromArmId(input.selectedArmId);
  if (!policy) return;

  const confidence = Math.max(0, Math.min(1, Number.isFinite(input.avgScore) ? input.avgScore : 0.5));
  await db.query(
    `INSERT INTO project_retrieval_policies (
       tenant_type, tenant_id, project_id, arm_id, memory_mode, retrieval_mode,
       source, confidence, updated_at, updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'arena', $7, now(), $8)
     ON CONFLICT (tenant_type, tenant_id, project_id)
     DO UPDATE SET
       arm_id = EXCLUDED.arm_id,
       memory_mode = EXCLUDED.memory_mode,
       retrieval_mode = EXCLUDED.retrieval_mode,
       source = EXCLUDED.source,
       confidence = EXCLUDED.confidence,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    [
      input.tenantType,
      input.tenantId,
      input.projectId,
      policy.arm_id,
      policy.memory_mode,
      policy.retrieval_mode,
      confidence,
      input.actorId,
    ]
  );
}

export async function runMemoryArena(db: Client, input: ArenaRunInput): Promise<ArenaRunResult> {
  const projectId = input.projectId || null;
  const sessionKinds = (Array.isArray(input.sessionKinds) && input.sessionKinds.length
    ? input.sessionKinds.filter((k): k is SessionKind => k === "agent" || k === "agent_pro")
    : ["agent", "agent_pro"]) as SessionKind[];
  const includeOpenSessions = input.includeOpenSessions !== false;

  const limitSessions = clampInt(input.limitSessions, 30, 1, 200);
  const limitEpisodes = clampInt(input.limitEpisodes, 80, 1, 400);
  const memoryLimit = clampInt(input.memoryLimit, 16, 1, 80);
  const documentLimit = clampInt(input.documentLimit, 8, 0, 50);

  const { sessions, episodes } = await loadDataset(db, {
    tenantType: input.tenantType,
    tenantId: input.tenantId,
    projectId,
    sessionKinds,
    includeOpenSessions,
    limitSessions,
    limitEpisodes,
  });

  const armResults: ArmMetrics[] = [];
  for (const arm of DEFAULT_ARMS) {
    const metrics = await evaluateArm(db, {
      tenantType: input.tenantType,
      tenantId: input.tenantId,
      arm,
      episodes,
      memoryLimit,
      documentLimit,
    });
    armResults.push(metrics);
  }

  armResults.sort((a, b) => b.avg_score - a.avg_score);
  const winnerCurrent = armResults[0]?.arm_id || null;

  const histParams: unknown[] = [input.tenantType, input.tenantId];
  let histSql = `SELECT changes
    FROM evolution_events
    WHERE tenant_type = $1 AND tenant_id = $2
      AND type = 'optimize'
      AND description = 'memory_arena_run'`;
  if (projectId) {
    histParams.push(projectId);
    histSql += ` AND project_id = $${histParams.length}`;
  }
  histParams.push(200);
  histSql += ` ORDER BY created_at DESC LIMIT $${histParams.length}`;

  const historyRows = (await db.query(histSql, histParams)).rows;
  const history = loadHistoricalBandit(historyRows);
  const bandit = buildBanditState(armResults, history);

  const output: ArenaRunResult = {
    version: "memory-arena-v1",
    project_id: projectId,
    session_kinds: sessionKinds,
    dataset: {
      sessions_considered: sessions.length,
      episodes_total: episodes.length,
      episodes_labeled: episodes.filter((e) => e.target_memory_ids.length > 0 || e.target_document_keys.length > 0).length,
    },
    arm_results: armResults,
    winner_current: winnerCurrent,
    winner_bandit: bandit.winnerBandit,
    selected_next: bandit.selectedNext,
    bandit: {
      total_pulls: bandit.totalPulls,
      arms: bandit.arms,
    },
  };

  await recordArenaEvolutionEvent(db, {
    tenantType: input.tenantType,
    tenantId: input.tenantId,
    actorId: input.actorId,
    projectId,
    changes: {
      arena: output,
      config: {
        limit_sessions: limitSessions,
        limit_episodes: limitEpisodes,
        memory_limit: memoryLimit,
        document_limit: documentLimit,
      },
    },
  });

  const selectedArmMetrics = armResults.find((a) => a.arm_id === output.selected_next) || null;
  await upsertProjectRetrievalPolicy(db, {
    tenantType: input.tenantType,
    tenantId: input.tenantId,
    actorId: input.actorId,
    projectId,
    selectedArmId: output.selected_next || output.winner_bandit || output.winner_current,
    avgScore: selectedArmMetrics?.avg_score ?? armResults[0]?.avg_score ?? 0.5,
  });

  return output;
}

export async function runMemoryArenaIterations(db: Client, input: ArenaBatchRunInput): Promise<ArenaBatchRunResult> {
  const requestedIterations = clampInt(input.iterations, 1, 1, 1000);
  const timeBudgetMs = clampInt(input.timeBudgetMs, 60_000, 1_000, 1_800_000);
  const stopWhenNoEpisodes = input.stopWhenNoEpisodes !== false;

  const startedAt = Date.now();
  const winnerCount = new Map<string, number>();
  const scoreSums = new Map<string, { sum: number; n: number }>();

  let completed = 0;
  let stoppedReason: "completed" | "time_budget" | "no_episodes" = "completed";
  let lastRun: ArenaRunResult | null = null;

  for (let i = 0; i < requestedIterations; i++) {
    if (Date.now() - startedAt >= timeBudgetMs) {
      stoppedReason = "time_budget";
      break;
    }

    const run = await runMemoryArena(db, {
      tenantType: input.tenantType,
      tenantId: input.tenantId,
      actorId: input.actorId,
      projectId: input.projectId,
      sessionKinds: input.sessionKinds,
      includeOpenSessions: input.includeOpenSessions,
      limitSessions: input.limitSessions,
      limitEpisodes: input.limitEpisodes,
      memoryLimit: input.memoryLimit,
      documentLimit: input.documentLimit,
    });

    completed++;
    lastRun = run;

    if (run.winner_current) {
      winnerCount.set(run.winner_current, (winnerCount.get(run.winner_current) || 0) + 1);
    }
    for (const arm of run.arm_results) {
      const cur = scoreSums.get(arm.arm_id) || { sum: 0, n: 0 };
      cur.sum += arm.avg_score;
      cur.n += 1;
      scoreSums.set(arm.arm_id, cur);
    }

    if (stopWhenNoEpisodes && run.dataset.episodes_total === 0) {
      stoppedReason = "no_episodes";
      break;
    }
  }

  const winner_tally = [...winnerCount.entries()]
    .map(([arm_id, wins]) => ({ arm_id, wins }))
    .sort((a, b) => b.wins - a.wins);

  const average_scores = [...scoreSums.entries()]
    .map(([arm_id, v]) => ({ arm_id, avg_score: v.n > 0 ? v.sum / v.n : 0 }))
    .sort((a, b) => b.avg_score - a.avg_score);

  return {
    requested_iterations: requestedIterations,
    completed_iterations: completed,
    elapsed_ms: Date.now() - startedAt,
    stopped_reason: stoppedReason,
    winner_tally,
    average_scores,
    last_run: lastRun,
  };
}
