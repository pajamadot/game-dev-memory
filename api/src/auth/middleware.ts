import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../appEnv";
import { authenticateRequest } from "./authenticate";

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Allow CORS preflight through without auth.
  if (c.req.method === "OPTIONS") {
    return next();
  }

  const auth = await authenticateRequest(c.env, c.req.raw);
  c.set("auth", auth);
  await next();
};
