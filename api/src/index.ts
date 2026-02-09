import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { memoriesRouter } from "./routes/memories";
import { projectsRouter } from "./routes/projects";
import { evolveRouter } from "./routes/evolve";
import { sessionsRouter } from "./routes/sessions";
import { artifactsRouter } from "./routes/artifacts";
import { researchRouter } from "./routes/research";
import { TenantError } from "./tenant";
import { runUnrealAgentsDailyDigestForAllTenants } from "./research/unrealAgents";

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

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

app.route("/api/memories", memoriesRouter);
app.route("/api/projects", projectsRouter);
app.route("/api/evolve", evolveRouter);
app.route("/api/sessions", sessionsRouter);
app.route("/api/artifacts", artifactsRouter);
app.route("/api/research", researchRouter);

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
          await runUnrealAgentsDailyDigestForAllTenants(env, when);
        } catch (err) {
          console.error("[cron] unreal-agents digest failed:", err);
        }
      })()
    );
  },
};
