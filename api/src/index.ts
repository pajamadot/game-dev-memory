import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import type { AppEnv } from "./appEnv";
import { authMiddleware } from "./auth/middleware";
import { authenticateRequest } from "./auth/authenticate";
import { memoriesRouter } from "./routes/memories";
import { projectsRouter } from "./routes/projects";
import { evolveRouter } from "./routes/evolve";
import { sessionsRouter } from "./routes/sessions";
import { artifactsRouter } from "./routes/artifacts";
import { assetsRouter } from "./routes/assets";
import { downloadsRouter } from "./routes/downloads";
import { researchRouter } from "./routes/research";
import { tokensRouter } from "./routes/tokens";
import { agentRouter } from "./routes/agent";
import { oauthRouter } from "./routes/oauth";
import { TenantError } from "./tenant";
import { runUnrealAgentsDailyDigestForAllTenants } from "./research/unrealAgents";
import { runAgentMemoryDailyDigestForAllTenants } from "./research/agentMemory";
import { getOAuthMetadata, getProtectedResourceMetadata, handleAuthorize, handleRegister, handleToken } from "./oauth/server";
import { handleMcpJsonRpc, MCP_ERROR_CODES, type McpRequest, type McpResponse } from "./mcp/server";

const app = new Hono<AppEnv>();

app.use("/*", cors());

// Core auth: Clerk session JWT for web, API keys for agents/services.
app.use("/api/*", authMiddleware);

app.onError((err, c) => {
  const anyErr = err as any;
  if (anyErr && (anyErr instanceof TenantError || anyErr.name === "TenantError")) {
    return c.json({ error: anyErr.message }, anyErr.status || 401);
  }

  console.error("[api] unhandled error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.get("/", (c) => {
  return c.json({
    name: "game-dev-memory-api",
    version: "0.1.0",
    status: "ok",
  });
});

// OAuth discovery endpoints for MCP clients.
app.get("/.well-known/oauth-authorization-server", (c) => c.json(getOAuthMetadata(c.req.raw, c.env)));
app.get("/.well-known/oauth-protected-resource", (c) => c.json(getProtectedResourceMetadata(c.req.raw)));
app.get("/.well-known/oauth-protected-resource/*", (c) => c.json(getProtectedResourceMetadata(c.req.raw)));

// OAuth endpoints.
app.get("/authorize", (c) => handleAuthorize(c.req.raw, c.env));
app.post("/token", async (c) => {
  const res = await handleToken(c.req.raw, c.env);
  return res;
});
app.post("/register", async (c) => {
  const res = await handleRegister(c.req.raw, c.env);
  return res;
});

// MCP endpoint: thin tool layer over the Memory API.
app.post("/mcp", async (c) => {
  const auth = await authenticateRequest(c.env, c.req.raw);

  const text = await c.req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err: McpResponse = { jsonrpc: "2.0", id: null, error: { code: MCP_ERROR_CODES.PARSE_ERROR, message: "Invalid JSON" } };
    return c.json(err, 400);
  }

  const normalize = (v: any): McpRequest => {
    return {
      jsonrpc: "2.0",
      id: v?.id === undefined ? null : v.id,
      method: v?.method,
      params: v?.params,
    } as McpRequest;
  };

  if (Array.isArray(parsed)) {
    const responses: McpResponse[] = [];
    for (const entry of parsed) {
      const req = normalize(entry);
      const res = await handleMcpJsonRpc(c.env, auth, req);
      if (req.id === null) continue; // notification
      responses.push(res);
    }
    if (responses.length === 0) return new Response(null, { status: 202 });
    return c.json(responses);
  }

  const req = normalize(parsed);
  const res = await handleMcpJsonRpc(c.env, auth, req);
  if (req.id === null) return new Response(null, { status: 202 });
  return c.json(res);
});

app.route("/api/memories", memoriesRouter);
app.route("/api/projects", projectsRouter);
app.route("/api/evolve", evolveRouter);
app.route("/api/sessions", sessionsRouter);
app.route("/api/artifacts", artifactsRouter);
app.route("/api/assets", assetsRouter);
app.route("/api/research", researchRouter);
app.route("/api/tokens", tokensRouter);
app.route("/api/agent", agentRouter);
app.route("/api/oauth", oauthRouter);
app.route("/downloads", downloadsRouter);

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    // Keep cron work bounded and deterministic: one daily digest sweep.
    //
    // NOTE: This runs for ALL tenants that have at least one project.
    // If we need opt-in controls later, add a tenant-level config table.
    const when = event.scheduledTime ? new Date(event.scheduledTime) : new Date();
    ctx.waitUntil(
      (async () => {
        try {
          await Promise.all([
            (async () => {
              try {
                await runUnrealAgentsDailyDigestForAllTenants(env, when);
              } catch (err) {
                console.error("[cron] unreal-agents digest failed:", err);
              }
            })(),
            (async () => {
              try {
                await runAgentMemoryDailyDigestForAllTenants(env, when);
              } catch (err) {
                console.error("[cron] agent-memory digest failed:", err);
              }
            })(),
          ]);
        } catch (err) {
          console.error("[cron] digest sweep failed:", err);
        }
      })()
    );
  },
};
