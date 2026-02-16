import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import {
  createMemory,
  deleteMemory,
  getMemory,
  listMemories,
  setMemoryLifecycle,
  updateMemory,
  type MemoryQuality,
  type MemorySearchMode,
  type MemoryState,
} from "../core/memories";
import { batchGetMemories, listMemorySearchProviders, listMemoryTimeline, searchMemoryIndex } from "../core/memoryRetrieval";
import { deriveMemoryPlan } from "../core/memoryDerivation";

export const memoriesRouter = new Hono<AppEnv>();

function truthy(v: unknown): boolean {
  if (!v) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function isMemoryState(v: unknown): v is MemoryState {
  return v === "active" || v === "superseded" || v === "quarantined";
}

function isMemoryQuality(v: unknown): v is MemoryQuality {
  return v === "unknown" || v === "good" || v === "bad";
}

function normalizeMemoryMode(v: unknown): MemorySearchMode {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "fast" || s === "deep") return s;
  return "balanced";
}

function parseStates(opts: { includeInactive: boolean; stateParam: string | null }): MemoryState[] | null | undefined {
  if (opts.includeInactive) return null;
  if (!opts.stateParam) return undefined;
  return isMemoryState(opts.stateParam) ? [opts.stateParam] : ["active"];
}

function safeRelation(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "related";
  // Keep relation strings small + predictable for future analytics.
  return s.slice(0, 64).replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function parseJsonObject(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeTags(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === "string").slice(0, 64);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === "string").slice(0, 64);
    } catch {
      return [];
    }
  }
  return [];
}

function uniqTags(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function shortText(v: unknown, max = 120): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}...`;
}

function parseIsoMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// List memories with optional filters
memoriesRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id") || null;
  const category = c.req.query("category") || null;
  const search = c.req.query("q") || c.req.query("query") || null;
  const memoryMode = normalizeMemoryMode(c.req.query("memory_mode") || c.req.query("search_mode"));
  const tag = c.req.query("tag") || null;
  const sessionId = c.req.query("session_id") || null;
  const includeInactive = truthy(c.req.query("include_inactive") || c.req.query("all_states"));
  const includeContentParam = c.req.query("include_content");
  const includeContent = includeContentParam === undefined || includeContentParam === null ? true : truthy(includeContentParam);
  const stateParam = c.req.query("state") || null;
  const limit = parseInt(c.req.query("limit") || "50");

  const states = parseStates({ includeInactive, stateParam });

  const memories = await withDbClient(c.env, async (db) =>
    await listMemories(db, tenantType, tenantId, {
      projectId,
      category,
      search,
      tag,
      sessionId,
      states,
      memoryMode,
      limit,
      mode: includeContent ? "full" : "preview",
    })
  );

  return c.json({ memories, meta: { total: memories.length, memory_mode: memoryMode } });
});

// List search providers available for progressive-disclosure retrieval.
memoriesRouter.get("/providers", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  void tenantType;
  void tenantId;
  return c.json({ providers: listMemorySearchProviders() });
});

// Progressive-disclosure index search:
// returns compact ranked hits first (id/title/excerpt/tokens), then clients can batch fetch full records.
memoriesRouter.get("/search-index", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id") || null;
  const category = c.req.query("category") || null;
  const sessionId = c.req.query("session_id") || null;
  const tag = c.req.query("tag") || null;
  const search = c.req.query("q") || c.req.query("query") || "";
  const provider = c.req.query("provider") || c.req.query("strategy") || null;
  const memoryMode = normalizeMemoryMode(c.req.query("memory_mode") || c.req.query("search_mode"));
  const includeInactive = truthy(c.req.query("include_inactive") || c.req.query("all_states"));
  const stateParam = c.req.query("state") || null;
  const limit = parseInt(c.req.query("limit") || "20");
  const states = parseStates({ includeInactive, stateParam });

  const result = await withDbClient(c.env, async (db) =>
    await searchMemoryIndex(db, {
      tenantType,
      tenantId,
      projectId,
      category,
      sessionId,
      tag,
      query: search,
      provider,
      memoryMode,
      states,
      limit,
    })
  );

  return c.json({
    ...result,
    meta: {
      total: result.hits.length,
      next: "POST /api/memories/batch-get",
      token_estimate_total: result.token_estimate_total,
    },
  });
});

// Time-ordered compact feed for session/project memory browsing.
memoriesRouter.get("/timeline", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id") || null;
  const category = c.req.query("category") || null;
  const sessionId = c.req.query("session_id") || null;
  const includeInactive = truthy(c.req.query("include_inactive") || c.req.query("all_states"));
  const stateParam = c.req.query("state") || null;
  const before = c.req.query("before") || null;
  const after = c.req.query("after") || null;
  const limit = parseInt(c.req.query("limit") || "100");
  const states = parseStates({ includeInactive, stateParam });

  const result = await withDbClient(c.env, async (db) =>
    await listMemoryTimeline(db, {
      tenantType,
      tenantId,
      projectId,
      category,
      sessionId,
      states,
      before,
      after,
      limit,
    })
  );

  return c.json(result);
});

// Fetch multiple memories by id in one call (ordered by requested id list).
memoriesRouter.post("/batch-get", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === "string")
    : [];
  const includeContent = body.include_content !== false;

  const result = await withDbClient(c.env, async (db) =>
    await batchGetMemories(db, {
      tenantType,
      tenantId,
      ids,
      includeContent,
    })
  );

  return c.json(result);
});

// List active foresight memories (EverMemOS-inspired time-aware memory lane).
memoriesRouter.get("/foresight/active", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id") || null;
  const search = (c.req.query("q") || c.req.query("query") || "").trim().toLowerCase();
  const includeInactive = truthy(c.req.query("include_inactive") || c.req.query("all_states"));
  const includePast = truthy(c.req.query("include_past"));
  const stateParam = c.req.query("state") || null;
  const withinDays = Math.min(Math.max(parseInt(c.req.query("within_days") || "60"), 1), 3650);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50"), 1), 300);
  const states = parseStates({ includeInactive, stateParam });

  const rows = await withDbClient(c.env, async (db) =>
    await listMemories(db, tenantType, tenantId, {
      projectId,
      category: "foresight",
      states,
      limit: Math.min(Math.max(limit * 4, limit), 500),
      mode: "preview",
      memoryMode: "fast",
    })
  );

  const nowMs = Date.now();
  const horizonMs = nowMs + withinDays * 24 * 60 * 60 * 1000;

  const filtered = (rows || [])
    .map((row: any) => {
      const context = parseJsonObject(row?.context);
      const dueRaw = context["end_time"] ?? context["due_at"] ?? context["deadline"];
      const dueMs = parseIsoMs(dueRaw);
      const dueIso = dueMs ? new Date(dueMs).toISOString() : null;
      const dueInDays = dueMs ? Math.round((dueMs - nowMs) / (24 * 60 * 60 * 1000)) : null;
      return {
        ...row,
        due_time: dueIso,
        due_in_days: dueInDays,
      };
    })
    .filter((row: any) => {
      const hay = `${String(row?.title || "")}\n${String(row?.content || "")}`.toLowerCase();
      if (search && !hay.includes(search)) return false;

      const dueMs = row?.due_time ? Date.parse(String(row.due_time)) : NaN;
      if (!Number.isFinite(dueMs)) return true;

      if (!includePast && dueMs < nowMs) return false;
      if (dueMs > horizonMs) return false;
      return true;
    })
    .sort((a: any, b: any) => {
      const aDue = a?.due_time ? Date.parse(String(a.due_time)) : Number.POSITIVE_INFINITY;
      const bDue = b?.due_time ? Date.parse(String(b.due_time)) : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return Date.parse(String(b?.updated_at || "")) - Date.parse(String(a?.updated_at || ""));
    })
    .slice(0, limit);

  return c.json({
    foresight: filtered,
    meta: {
      total: filtered.length,
      within_days: withinDays,
      include_past: includePast,
    },
  });
});

// Derive event_log + foresight memories from one source memory.
memoriesRouter.post("/:id/derive", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const dryRun = truthy(body.dry_run);
  const createEventLogs = body.create_event_logs === false || body.no_event_logs === true ? false : true;
  const createForesight = body.create_foresight === false || body.no_foresight === true ? false : true;
  const maxEventLogs = Math.min(Math.max(parseInt(body.max_event_logs ?? "12"), 0), 50);
  const maxForesight = Math.min(Math.max(parseInt(body.max_foresight ?? "6"), 0), 20);

  const out = await withDbClient(c.env, async (db) => {
    const parentRes = await db.query(
      `SELECT id, project_id, session_id, category, source_type, title, content, tags, confidence
       FROM memories
       WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3`,
      [id, tenantType, tenantId]
    );
    const parent = parentRes.rows[0] ?? null;
    if (!parent) return { error: "not_found" as const };

    const parentCategory = String(parent.category || "").toLowerCase();
    if (parentCategory === "event_log" || parentCategory === "foresight") {
      return { error: "unsupported_source" as const, category: parentCategory };
    }

    const nowIso = new Date().toISOString();
    const plan = deriveMemoryPlan({
      title: String(parent.title || ""),
      content: String(parent.content || ""),
      nowIso,
      maxEventLogs,
      maxForesight,
    });

    if (dryRun) {
      return {
        ok: true,
        dry_run: true,
        parent_memory_id: id,
        created: { event_log: 0, foresight: 0 },
        ids: { event_log: [] as string[], foresight: [] as string[] },
        plan,
      };
    }

    const baseTags = normalizeTags(parent.tags);
    const eventLogIds: string[] = [];
    const foresightIds: string[] = [];

    const createDerivedLink = async (fromId: string, toId: string, metadata: Record<string, unknown>) => {
      await db.query(
        `INSERT INTO entity_links (
           id, tenant_type, tenant_id,
           from_type, from_id, to_type, to_id,
           relation, metadata, created_at, created_by
         )
         VALUES ($1, $2, $3, 'memory', $4::uuid, 'memory', $5::uuid, 'derived_from', $6::jsonb, $7, $8)`,
        [crypto.randomUUID(), tenantType, tenantId, fromId, toId, JSON.stringify(metadata), nowIso, actorId]
      );
    };

    if (createEventLogs) {
      for (const item of plan.event_logs) {
        const childId = crypto.randomUUID();
        await createMemory(db, {
          tenantType,
          tenantId,
          actorId,
          id: childId,
          projectId: String(parent.project_id),
          sessionId: parent.session_id ? String(parent.session_id) : null,
          category: "event_log",
          sourceType: "derived",
          title: `Event: ${shortText(item.text, 90)}`,
          content: item.text,
          tags: uniqTags([...baseTags, "derived", "event_log", "evermemos"]),
          context: {
            derived: {
              framework: "evermemos-inspired",
              type: "event_log",
              parent_memory_id: id,
              parent_category: parentCategory,
              parent_source_type: String(parent.source_type || "manual"),
            },
            evidence: item.evidence,
            confidence_hint: item.confidence,
          },
          confidence: item.confidence,
          nowIso,
        });
        await createDerivedLink(childId, id, { type: "event_log", framework: "evermemos-inspired" });
        eventLogIds.push(childId);
      }
    }

    if (createForesight) {
      for (const item of plan.foresight) {
        const childId = crypto.randomUUID();
        await createMemory(db, {
          tenantType,
          tenantId,
          actorId,
          id: childId,
          projectId: String(parent.project_id),
          sessionId: parent.session_id ? String(parent.session_id) : null,
          category: "foresight",
          sourceType: "derived",
          title: `Foresight: ${shortText(item.text, 90)}`,
          content: item.text,
          tags: uniqTags([...baseTags, "derived", "foresight", "evermemos"]),
          context: {
            derived: {
              framework: "evermemos-inspired",
              type: "foresight",
              parent_memory_id: id,
              parent_category: parentCategory,
              parent_source_type: String(parent.source_type || "manual"),
            },
            evidence: item.evidence,
            start_time: item.start_time,
            end_time: item.end_time,
            due_kind: item.due_kind,
            confidence_hint: item.confidence,
          },
          confidence: item.confidence,
          nowIso,
        });
        await createDerivedLink(childId, id, { type: "foresight", framework: "evermemos-inspired" });
        foresightIds.push(childId);
      }
    }

    return {
      ok: true,
      dry_run: false,
      parent_memory_id: id,
      created: { event_log: eventLogIds.length, foresight: foresightIds.length },
      ids: { event_log: eventLogIds, foresight: foresightIds },
      plan,
    };
  });

  if ((out as any)?.error === "not_found") return c.json({ ok: false, error: "Memory not found" }, 404);
  if ((out as any)?.error === "unsupported_source") {
    return c.json(
      {
        ok: false,
        error: "Cannot derive from already-derived memory category",
        category: (out as any)?.category,
      },
      400
    );
  }

  return c.json(out);
});

// Get single memory
memoriesRouter.get("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const memory = await withDbClient(c.env, async (db) => await getMemory(db, tenantType, tenantId, id));

  if (!memory) return c.json({ error: "Memory not found" }, 404);
  return c.json(memory);
});

// Create memory
memoriesRouter.post("/", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await createMemory(db, {
      tenantType,
      tenantId,
      actorId,
      id,
      projectId: body.project_id,
      sessionId: body.session_id ?? null,
      category: body.category,
      sourceType: body.source_type ?? "manual",
      title: body.title,
      content: body.content,
      tags: body.tags || [],
      context: body.context || {},
      confidence: body.confidence ?? 0.5,
      nowIso: now,
    });
  });

  return c.json({ id, created_at: now }, 201);
});

// Update memory
memoriesRouter.put("/:id", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    await updateMemory(db, {
      tenantType,
      tenantId,
      actorId,
      id,
      title: body.title,
      content: body.content,
      tags: body.tags || [],
      context: body.context || {},
      confidence: body.confidence ?? 0.5,
      category: body.category,
      sourceType: body.source_type ?? "manual",
      nowIso: now,
    });
  });

  return c.json({ id, updated_at: now });
});

// Delete memory
memoriesRouter.delete("/:id", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const now = new Date().toISOString();
  await withDbClient(c.env, async (db) => {
    await deleteMemory(db, { tenantType, tenantId, actorId, id, nowIso: now });
  });
  return c.json({ deleted: true });
});

// Update memory lifecycle fields (state/quality).
memoriesRouter.post("/:id/lifecycle", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const now = new Date().toISOString();

  const state = body.state;
  const quality = body.quality;

  const nextState = state === undefined || state === null ? null : isMemoryState(state) ? (state as MemoryState) : null;
  const nextQuality =
    quality === undefined || quality === null ? null : isMemoryQuality(quality) ? (quality as MemoryQuality) : null;

  if (state !== undefined && state !== null && !nextState) {
    return c.json({ ok: false, error: "Invalid state (expected active|superseded|quarantined)" }, 400);
  }
  if (quality !== undefined && quality !== null && !nextQuality) {
    return c.json({ ok: false, error: "Invalid quality (expected unknown|good|bad)" }, 400);
  }

  // Safety: quality=bad should not remain active by default; it tends to poison retrieval.
  let finalState = nextState;
  let finalQuality = nextQuality;
  if (!finalState && finalQuality === "bad") finalState = "quarantined";
  if (finalState === "active" && finalQuality === "bad") {
    return c.json({ ok: false, error: "quality=bad requires state=quarantined (or omit state and it will auto-quarantine)" }, 400);
  }

  const updated = await withDbClient(c.env, async (db) => {
    return await setMemoryLifecycle(db, { tenantType, tenantId, actorId, id, state: finalState, quality: finalQuality, nowIso: now });
  });

  if (!updated) return c.json({ ok: false, error: "Memory not found (or no changes applied)" }, 404);
  return c.json({ ok: true, ...updated });
});

// Link memory -> memory (entity_links). Useful for "supersedes", "contradicts", "supports", etc.
memoriesRouter.post("/:id/link", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const fromId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const toId = typeof body.to_memory_id === "string" && body.to_memory_id.trim() ? body.to_memory_id.trim() : null;
  if (!toId) return c.json({ ok: false, error: "to_memory_id is required" }, 400);
  if (toId === fromId) return c.json({ ok: false, error: "Cannot link a memory to itself" }, 400);

  const relation = safeRelation(body.relation);
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    const m1Res = await db.query("SELECT id, project_id FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      fromId,
      tenantType,
      tenantId,
    ]);
    const m1 = m1Res.rows[0] ?? null;
    if (!m1) throw new Error("Memory not found (from_id).");

    const m2Res = await db.query("SELECT id, project_id FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      toId,
      tenantType,
      tenantId,
    ]);
    const m2 = m2Res.rows[0] ?? null;
    if (!m2) throw new Error("Memory not found (to_memory_id).");

    if (String(m1.project_id) !== String(m2.project_id)) throw new Error("Memories must be in the same project.");

    const linkId = crypto.randomUUID();
    await db.query(
      `INSERT INTO entity_links (
         id, tenant_type, tenant_id,
         from_type, from_id, to_type, to_id,
         relation, metadata, created_at, created_by
       )
       VALUES ($1, $2, $3, 'memory', $4::uuid, 'memory', $5::uuid, $6, $7::jsonb, $8, $9)`,
      [linkId, tenantType, tenantId, fromId, toId, relation, JSON.stringify(metadata), now, actorId]
    );

    // Record link creation on the source memory.
    await db.query(
      `INSERT INTO memory_events (
         id, tenant_type, tenant_id, project_id, memory_id,
         event_type, event_data, created_at, created_by
       )
       VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::jsonb, $8, $9)`,
      [
        crypto.randomUUID(),
        tenantType,
        tenantId,
        String(m1.project_id),
        fromId,
        "link_create",
        JSON.stringify({ link_id: linkId, to_memory_id: toId, relation, metadata }),
        now,
        actorId,
      ]
    );

    // If this is a "supersedes" relationship, mark the target memory as superseded (soft lifecycle).
    if (relation === "supersedes") {
      await setMemoryLifecycle(db, { tenantType, tenantId, actorId, id: toId, state: "superseded", nowIso: now });
      await db.query(
        `INSERT INTO memory_events (
           id, tenant_type, tenant_id, project_id, memory_id,
           event_type, event_data, created_at, created_by
         )
         VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::jsonb, $8, $9)`,
        [
          crypto.randomUUID(),
          tenantType,
          tenantId,
          String(m2.project_id),
          toId,
          "superseded_by",
          JSON.stringify({ link_id: linkId, from_memory_id: fromId }),
          now,
          actorId,
        ]
      );
    }
  });

  return c.json({ ok: true, from_memory_id: fromId, to_memory_id: toId, relation, created_at: now });
});

// Link memory -> asset (entity_links). Useful for attaching logs, screenshots, builds, etc.
memoriesRouter.post("/:id/attach-asset", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const memoryId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const assetId = typeof body.asset_id === "string" && body.asset_id.trim() ? body.asset_id.trim() : null;
  if (!assetId) return c.json({ ok: false, error: "asset_id is required" }, 400);

  const relation = safeRelation(body.relation || "attachment");
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const now = new Date().toISOString();

  const out = await withDbClient(c.env, async (db) => {
    const mRes = await db.query("SELECT id, project_id FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      memoryId,
      tenantType,
      tenantId,
    ]);
    const mem = mRes.rows[0] ?? null;
    if (!mem) throw new Error("Memory not found.");
    const projectId = String(mem.project_id);

    const aRes = await db.query("SELECT id, project_id FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      assetId,
      tenantType,
      tenantId,
    ]);
    const asset = aRes.rows[0] ?? null;
    if (!asset) throw new Error("Asset not found.");
    if (String(asset.project_id) !== projectId) throw new Error("Asset must be in the same project as the memory.");

    const existing = await db.query(
      `SELECT id
       FROM entity_links
       WHERE tenant_type = $1 AND tenant_id = $2
         AND from_type = 'memory' AND from_id = $3::uuid
         AND to_type = 'asset' AND to_id = $4::uuid
         AND relation = $5
       LIMIT 1`,
      [tenantType, tenantId, memoryId, assetId, relation]
    );

    const linkId = existing.rows[0]?.id ? String(existing.rows[0].id) : crypto.randomUUID();

    if (existing.rowCount === 0) {
      await db.query(
        `INSERT INTO entity_links (
           id, tenant_type, tenant_id,
           from_type, from_id, to_type, to_id,
           relation, metadata, created_at, created_by
         )
         VALUES ($1, $2, $3, 'memory', $4::uuid, 'asset', $5::uuid, $6, $7::jsonb, $8, $9)`,
        [linkId, tenantType, tenantId, memoryId, assetId, relation, JSON.stringify(metadata), now, actorId]
      );

      await db.query(
        `INSERT INTO memory_events (
           id, tenant_type, tenant_id, project_id, memory_id,
           event_type, event_data, created_at, created_by
         )
         VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7::jsonb, $8, $9)`,
        [
          crypto.randomUUID(),
          tenantType,
          tenantId,
          projectId,
          memoryId,
          "asset_attach",
          JSON.stringify({ link_id: linkId, asset_id: assetId, relation, metadata }),
          now,
          actorId,
        ]
      );
    }

    return { linkId, projectId };
  });

  return c.json({ ok: true, memory_id: memoryId, asset_id: assetId, relation, link_id: out.linkId, created_at: now });
});

// List inbound/outbound memory links for UI/debugging.
memoriesRouter.get("/:id/links", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const { inbound, outbound } = await withDbClient(c.env, async (db) => {
    const [outRes, inRes] = await Promise.all([
      db.query(
        `SELECT id, from_type, from_id, to_type, to_id, relation, metadata, created_at, created_by
         FROM entity_links
         WHERE tenant_type = $1 AND tenant_id = $2 AND from_type = 'memory' AND from_id = $3::uuid
         ORDER BY created_at DESC`,
        [tenantType, tenantId, id]
      ),
      db.query(
        `SELECT id, from_type, from_id, to_type, to_id, relation, metadata, created_at, created_by
         FROM entity_links
         WHERE tenant_type = $1 AND tenant_id = $2 AND to_type = 'memory' AND to_id = $3::uuid
         ORDER BY created_at DESC`,
        [tenantType, tenantId, id]
      ),
    ]);
    return { outbound: outRes.rows, inbound: inRes.rows };
  });

  return c.json({ inbound, outbound });
});

// List memory event history (audit trail).
memoriesRouter.get("/:id/events", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50"), 1), 200);

  const events = await withDbClient(c.env, async (db) => {
    const mRes = await db.query("SELECT id FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [id, tenantType, tenantId]);
    if (mRes.rowCount === 0) return null;

    const { rows } = await db.query(
      `SELECT id, project_id, memory_id, event_type, event_data, created_at, created_by
       FROM memory_events
       WHERE tenant_type = $1 AND tenant_id = $2 AND memory_id = $3::uuid
       ORDER BY created_at DESC
       LIMIT $4`,
      [tenantType, tenantId, id, limit]
    );

    return rows;
  });

  if (!events) return c.json({ error: "Memory not found" }, 404);
  return c.json({ events });
});


