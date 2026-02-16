import type { Env } from "../types";
import type { AuthContext } from "../auth/types";
import { withDbClient } from "../db";
import { listProjects, createProject } from "../core/projects";
import { listMemories, createMemory, getMemory, type MemoryState } from "../core/memories";
import { deriveMemoryPlan } from "../core/memoryDerivation";
import { batchGetMemories, listMemorySearchProviders, listMemoryTimeline, searchMemoryIndex } from "../core/memoryRetrieval";
import type { TenantType } from "../tenant";

export const MCP_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"] as const;

export const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
} as const;

export type McpId = string | number | null;

export interface McpRequest {
  jsonrpc: "2.0";
  id?: McpId;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: McpId;
  result?: Record<string, unknown>;
  error?: McpError;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function errorResponse(id: McpId, code: number, message: string, data?: Record<string, unknown>): McpResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function okResponse(id: McpId, result: Record<string, unknown>): McpResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonContent(data: unknown): Record<string, unknown> {
  return {
    content: [
      {
        type: "resource",
        resource: {
          uri: "data:application/json",
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      },
    ],
  };
}

function normalizeTags(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((t) => typeof t === "string");
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 32);
  }
  return [];
}

function normalizeTenant(auth: AuthContext): { tenantType: TenantType; tenantId: string; actorId: string | null } {
  return { tenantType: auth.tenantType, tenantId: auth.tenantId, actorId: auth.actorId };
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

function parseIsoMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function normalizeDbTags(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === "string").slice(0, 64);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) {
        return parsed.filter((t): t is string => typeof t === "string").slice(0, 64);
      }
    } catch {
      const split = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 64);
      return split;
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

const tools: McpTool[] = [
  {
    name: "projects.list",
    description: "List projects in the current tenant scope (personal or org).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "projects.create",
    description: "Create a project in the current tenant scope.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        engine: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "memories.list",
    description: "List memories with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        category: { type: "string" },
        q: { type: "string" },
        tag: { type: "string" },
        session_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memories.search_index",
    description: "Progressive-disclosure memory search: compact ranked hits for low-token agent routing.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        category: { type: "string" },
        session_id: { type: "string" },
        q: { type: "string" },
        tag: { type: "string" },
        provider: { type: "string", enum: ["memories_fts", "recent_activity"] },
        memory_mode: { type: "string", enum: ["fast", "balanced", "deep"] },
        state: { type: "string", enum: ["active", "superseded", "quarantined"] },
        include_inactive: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memories.batch_get",
    description: "Fetch multiple memories by id in one call.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200 },
        include_content: { type: "boolean" },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "memories.timeline",
    description: "Get a compact time-ordered memory feed for a project/session.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        category: { type: "string" },
        session_id: { type: "string" },
        state: { type: "string", enum: ["active", "superseded", "quarantined"] },
        include_inactive: { type: "boolean" },
        before: { type: "string" },
        after: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memories.foresight_active",
    description: "List active foresight memories ordered by nearest due date.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        q: { type: "string" },
        state: { type: "string", enum: ["active", "superseded", "quarantined"] },
        include_inactive: { type: "boolean" },
        include_past: { type: "boolean" },
        within_days: { type: "integer", minimum: 1, maximum: 3650 },
        limit: { type: "integer", minimum: 1, maximum: 300 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memories.derive",
    description: "Derive event-log and foresight memories from an existing memory.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        dry_run: { type: "boolean" },
        create_event_logs: { type: "boolean" },
        create_foresight: { type: "boolean" },
        no_event_logs: { type: "boolean" },
        no_foresight: { type: "boolean" },
        max_event_logs: { type: "integer", minimum: 0, maximum: 50 },
        max_foresight: { type: "integer", minimum: 0, maximum: 20 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memories.providers",
    description: "List available memory retrieval providers/strategies.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "memories.get",
    description: "Fetch a single memory by id (increments access_count).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "memories.create",
    description: "Create a new memory in a project.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        session_id: { type: ["string", "null"] },
        category: { type: "string" },
        source_type: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        tags: { type: ["array", "string"], items: { type: "string" } },
        context: { type: "object" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["project_id", "category", "title", "content"],
      additionalProperties: false,
    },
  },
];

function resolveProtocolVersion(requested: unknown): string {
  if (typeof requested === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return MCP_PROTOCOL_VERSIONS[0];
}

function parseMemoryState(v: unknown): MemoryState | null {
  return v === "active" || v === "superseded" || v === "quarantined" ? v : null;
}

export async function handleMcpJsonRpc(env: Env, auth: AuthContext, request: McpRequest): Promise<McpResponse> {
  const id: McpId = request.id === undefined ? null : request.id;
  const method = request.method;
  const params = request.params || {};

  if (!method || typeof method !== "string") {
    return errorResponse(id, MCP_ERROR_CODES.INVALID_REQUEST, "Method must be a string");
  }

  switch (method) {
    case "initialize": {
      const protocolVersion = resolveProtocolVersion(params["protocolVersion"]);
      return okResponse(id, {
        protocolVersion,
        serverInfo: { name: "game-dev-memory-mcp", version: "0.1.0" },
        capabilities: { tools: { listChanged: false } },
      });
    }

    case "initialized":
    case "notifications/initialized":
      return okResponse(id, {});

    case "ping":
      return okResponse(id, {});

    case "tools/list":
      return okResponse(id, { tools });

    case "tools/call": {
      const toolName = params["name"];
      const toolArgs = (params["arguments"] as Record<string, unknown> | undefined) || {};
      if (typeof toolName !== "string") {
        return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "Tool name is required");
      }

      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        return errorResponse(id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Unknown tool: ${toolName}`, {
          available_tools: tools.map((t) => t.name),
        });
      }

      const { tenantType, tenantId, actorId } = normalizeTenant(auth);

      try {
        if (toolName === "projects.list") {
          const limit = Math.min(Number(toolArgs["limit"] || 50), 200);
          const projects = await withDbClient(env, async (db) => {
            const rows = await listProjects(db, tenantType, tenantId);
            return rows.slice(0, limit);
          });
          return okResponse(id, jsonContent({ projects }));
        }

        if (toolName === "projects.create") {
          const name = String(toolArgs["name"] || "").trim();
          if (!name) return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "name is required");
          const engine = String(toolArgs["engine"] || "custom").trim();
          const description = String(toolArgs["description"] || "").trim();
          const projectId = crypto.randomUUID();
          const now = new Date().toISOString();
          await withDbClient(env, async (db) => {
            await createProject(db, {
              tenantType,
              tenantId,
              actorId,
              id: projectId,
              name,
              engine,
              description,
              nowIso: now,
            });
          });
          return okResponse(id, jsonContent({ id: projectId, created_at: now }));
        }

        if (toolName === "memories.list") {
          const limit = Math.min(Number(toolArgs["limit"] || 50), 200);
          const projectId = typeof toolArgs["project_id"] === "string" ? toolArgs["project_id"] : null;
          const category = typeof toolArgs["category"] === "string" ? toolArgs["category"] : null;
          const search = typeof toolArgs["q"] === "string" ? toolArgs["q"] : null;
          const tag = typeof toolArgs["tag"] === "string" ? toolArgs["tag"] : null;
          const sessionId = typeof toolArgs["session_id"] === "string" ? toolArgs["session_id"] : null;

          const memories = await withDbClient(env, async (db) =>
            await listMemories(db, tenantType, tenantId, { projectId, category, search, tag, sessionId, limit })
          );

          return okResponse(id, jsonContent({ memories, meta: { total: memories.length } }));
        }

        if (toolName === "memories.providers") {
          const providers = listMemorySearchProviders();
          return okResponse(id, jsonContent({ providers }));
        }

        if (toolName === "memories.search_index") {
          const limit = Math.min(Number(toolArgs["limit"] || 20), 100);
          const projectId = typeof toolArgs["project_id"] === "string" ? toolArgs["project_id"] : null;
          const category = typeof toolArgs["category"] === "string" ? toolArgs["category"] : null;
          const sessionId = typeof toolArgs["session_id"] === "string" ? toolArgs["session_id"] : null;
          const search = typeof toolArgs["q"] === "string" ? toolArgs["q"] : "";
          const tag = typeof toolArgs["tag"] === "string" ? toolArgs["tag"] : null;
          const provider = typeof toolArgs["provider"] === "string" ? toolArgs["provider"] : null;
          const memoryModeRaw = typeof toolArgs["memory_mode"] === "string" ? toolArgs["memory_mode"] : null;
          const memoryMode = memoryModeRaw === "fast" || memoryModeRaw === "deep" ? memoryModeRaw : "balanced";
          const includeInactive = toolArgs["include_inactive"] === true;
          const state = parseMemoryState(toolArgs["state"]);
          const states: MemoryState[] | null | undefined = includeInactive ? null : state ? [state] : undefined;

          const result = await withDbClient(env, async (db) =>
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
          return okResponse(id, jsonContent(result as unknown as Record<string, unknown>));
        }

        if (toolName === "memories.batch_get") {
          const ids = Array.isArray(toolArgs["ids"])
            ? (toolArgs["ids"] as unknown[]).filter((v): v is string => typeof v === "string")
            : [];
          if (ids.length === 0) return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "ids is required");
          const includeContent = toolArgs["include_content"] !== false;

          const result = await withDbClient(env, async (db) =>
            await batchGetMemories(db, {
              tenantType,
              tenantId,
              ids,
              includeContent,
            })
          );
          return okResponse(id, jsonContent(result as unknown as Record<string, unknown>));
        }

        if (toolName === "memories.timeline") {
          const projectId = typeof toolArgs["project_id"] === "string" ? toolArgs["project_id"] : null;
          const category = typeof toolArgs["category"] === "string" ? toolArgs["category"] : null;
          const sessionId = typeof toolArgs["session_id"] === "string" ? toolArgs["session_id"] : null;
          const includeInactive = toolArgs["include_inactive"] === true;
          const state = parseMemoryState(toolArgs["state"]);
          const states: MemoryState[] | null | undefined = includeInactive ? null : state ? [state] : undefined;
          const before = typeof toolArgs["before"] === "string" ? toolArgs["before"] : null;
          const after = typeof toolArgs["after"] === "string" ? toolArgs["after"] : null;
          const limit = Math.min(Number(toolArgs["limit"] || 100), 500);

          const result = await withDbClient(env, async (db) =>
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
          return okResponse(id, jsonContent(result as unknown as Record<string, unknown>));
        }

        if (toolName === "memories.foresight_active") {
          const projectId = typeof toolArgs["project_id"] === "string" ? toolArgs["project_id"] : null;
          const search =
            typeof toolArgs["q"] === "string"
              ? toolArgs["q"].trim().toLowerCase()
              : typeof toolArgs["query"] === "string"
                ? toolArgs["query"].trim().toLowerCase()
                : "";
          const includeInactive = toolArgs["include_inactive"] === true;
          const includePast = toolArgs["include_past"] === true;
          const state = parseMemoryState(toolArgs["state"]);
          const states: MemoryState[] | null | undefined = includeInactive ? null : state ? [state] : undefined;
          const withinDaysRaw = Number(toolArgs["within_days"] || 60);
          const limitRaw = Number(toolArgs["limit"] || 50);
          const withinDays = Math.min(Math.max(Math.trunc(withinDaysRaw), 1), 3650);
          const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), 300);

          const rows = await withDbClient(env, async (db) =>
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

          return okResponse(
            id,
            jsonContent({
              foresight: filtered,
              meta: {
                total: filtered.length,
                within_days: withinDays,
                include_past: includePast,
              },
            })
          );
        }

        if (toolName === "memories.derive") {
          const memId = String(toolArgs["id"] || "").trim();
          if (!memId) return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "id is required");

          const dryRun = toolArgs["dry_run"] === true;
          const createEventLogs = toolArgs["create_event_logs"] === false || toolArgs["no_event_logs"] === true ? false : true;
          const createForesight = toolArgs["create_foresight"] === false || toolArgs["no_foresight"] === true ? false : true;
          const maxEventLogs = Math.min(Math.max(Math.trunc(Number(toolArgs["max_event_logs"] || 12)), 0), 50);
          const maxForesight = Math.min(Math.max(Math.trunc(Number(toolArgs["max_foresight"] || 6)), 0), 20);

          const out = await withDbClient(env, async (db) => {
            const parentRes = await db.query(
              `SELECT id, project_id, session_id, category, source_type, title, content, tags, confidence
               FROM memories
               WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3`,
              [memId, tenantType, tenantId]
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
                parent_memory_id: memId,
                created: { event_log: 0, foresight: 0 },
                ids: { event_log: [] as string[], foresight: [] as string[] },
                plan,
              };
            }

            const baseTags = normalizeDbTags(parent.tags);
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
                      parent_memory_id: memId,
                      parent_category: parentCategory,
                      parent_source_type: String(parent.source_type || "manual"),
                    },
                    evidence: item.evidence,
                    confidence_hint: item.confidence,
                  },
                  confidence: item.confidence,
                  nowIso,
                });
                await createDerivedLink(childId, memId, { type: "event_log", framework: "evermemos-inspired" });
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
                      parent_memory_id: memId,
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
                await createDerivedLink(childId, memId, { type: "foresight", framework: "evermemos-inspired" });
                foresightIds.push(childId);
              }
            }

            return {
              ok: true,
              dry_run: false,
              parent_memory_id: memId,
              created: { event_log: eventLogIds.length, foresight: foresightIds.length },
              ids: { event_log: eventLogIds, foresight: foresightIds },
              plan,
            };
          });

          if ((out as any)?.error === "not_found") return errorResponse(id, 404, "Memory not found");
          if ((out as any)?.error === "unsupported_source") {
            return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "Cannot derive from already-derived memory category", {
              category: (out as any)?.category,
            });
          }

          return okResponse(id, jsonContent(out as unknown as Record<string, unknown>));
        }

        if (toolName === "memories.get") {
          const memId = String(toolArgs["id"] || "").trim();
          if (!memId) return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "id is required");
          const memory = await withDbClient(env, async (db) => await getMemory(db, tenantType, tenantId, memId));
          if (!memory) return errorResponse(id, 404, "Memory not found");
          return okResponse(id, jsonContent(memory));
        }

        if (toolName === "memories.create") {
          const projectId = String(toolArgs["project_id"] || "").trim();
          const category = String(toolArgs["category"] || "").trim();
          const title = String(toolArgs["title"] || "").trim();
          const content = String(toolArgs["content"] || "").trim();
          if (!projectId) return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "project_id is required");
          if (!category) return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "category is required");
          if (!title) return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "title is required");
          if (!content) return errorResponse(id, MCP_ERROR_CODES.INVALID_PARAMS, "content is required");

          const memId = crypto.randomUUID();
          const now = new Date().toISOString();
          const sessionIdRaw = toolArgs["session_id"];
          const sessionId = sessionIdRaw === null ? null : typeof sessionIdRaw === "string" ? sessionIdRaw : null;
          const sourceType = String(toolArgs["source_type"] || "manual").trim();
          const tags = normalizeTags(toolArgs["tags"]);
          const ctx = toolArgs["context"] && typeof toolArgs["context"] === "object" ? (toolArgs["context"] as Record<string, unknown>) : {};
          const confidenceRaw = toolArgs["confidence"];
          const confidence = typeof confidenceRaw === "number" ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;

          await withDbClient(env, async (db) => {
            await createMemory(db, {
              tenantType,
              tenantId,
              actorId,
              id: memId,
              projectId,
              sessionId,
              category,
              sourceType,
              title,
              content,
              tags,
              context: ctx,
              confidence,
              nowIso: now,
            });
          });

          return okResponse(id, jsonContent({ id: memId, created_at: now }));
        }

        return errorResponse(id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Unhandled tool: ${toolName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResponse(id, MCP_ERROR_CODES.INTERNAL_ERROR, msg);
      }
    }

    default:
      return errorResponse(id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

