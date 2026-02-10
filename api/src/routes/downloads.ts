import { Hono } from "hono";
import type { AppEnv } from "../appEnv";

function requireBucket(env: AppEnv["Bindings"]): R2Bucket {
  if (!env.MEMORY_BUCKET) {
    throw new Error("R2 bucket binding missing. Configure MEMORY_BUCKET in wrangler.jsonc.");
  }
  return env.MEMORY_BUCKET;
}

function isSafePathSegment(s: string): boolean {
  // Keep this strict: avoids path traversal and makes Content-Disposition safe.
  return /^[a-zA-Z0-9._-]+$/.test(s);
}

const PAJAMA_RELEASES_PREFIX = "releases/pajama";

async function handlePajamaDownload(c: any) {
  const version = String(c.req.param("version") || "").trim();
  const file = String(c.req.param("file") || "").trim();

  if (!isSafePathSegment(version) || !isSafePathSegment(file)) {
    return c.json({ error: "Invalid path" }, 400);
  }

  const key = `${PAJAMA_RELEASES_PREFIX}/${version}/${file}`;
  const bucket = requireBucket(c.env);

  const obj = await bucket.get(key);
  if (!obj) return c.json({ error: "Not found" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("content-disposition", `attachment; filename="${file.replace(/["\\\\]/g, "_")}"`);
  if (!headers.get("content-type")) headers.set("content-type", "application/octet-stream");

  // Hono doesn't automatically special-case HEAD for us here; make it explicit so
  // npm installers can probe without downloading.
  if (c.req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(obj.body, { status: 200, headers });
}

export const downloadsRouter = new Hono<AppEnv>();

// Public binary distribution for the `pajama` CLI (used by the npm installer).
downloadsRouter.get("/pajama", (c) => {
  return c.json({
    ok: true,
    name: "pajama",
    description: "Prebuilt `pajama` CLI binaries (download prefix).",
    pattern: "/downloads/pajama/v{version}/{file}",
    examples: [
      "/downloads/pajama/v0.1.1/pajama-win32-x64.exe",
      "/downloads/pajama/v0.1.1/pajama-win32-x64.exe.sha256",
    ],
    notes: [
      "This endpoint is a prefix; download URLs include a version and filename.",
      "Recommended install: `npm i -g @pajamadot/pajama` (downloads the binary automatically).",
    ],
  });
});
downloadsRouter.on("HEAD", "/pajama", (c) => new Response(null, { status: 200 }));
downloadsRouter.get("/pajama/:version/:file", handlePajamaDownload);
downloadsRouter.on("HEAD", "/pajama/:version/:file", handlePajamaDownload);
