import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { memoriesRouter } from "./routes/memories";
import { projectsRouter } from "./routes/projects";
import { evolveRouter } from "./routes/evolve";

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

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

export default app;
