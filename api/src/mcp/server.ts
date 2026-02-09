import type { Env } from "../types";
import type { AuthContext } from "../auth/types";
import { withDbClient } from "../db";
import { listProjects, createProject } from "../core/projects";
import { listMemories, createMemory, getMemory } from "../core/memories";
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

