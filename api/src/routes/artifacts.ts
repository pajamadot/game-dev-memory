import { Hono } from "hono";
import type { Env } from "../types";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";

function requireBucket(env: Env): R2Bucket {
  if (!env.MEMORY_BUCKET) {
    throw new Error("R2 bucket binding missing. Configure MEMORY_BUCKET in wrangler.jsonc.");
  }
  return env.MEMORY_BUCKET;
}

function buildArtifactPrefix(opts: { tenantType: string; tenantId: string; projectId: string; artifactId: string }) {
  const t = encodeURIComponent(opts.tenantType);
  const tid = encodeURIComponent(opts.tenantId);
  const pid = encodeURIComponent(opts.projectId);
  const aid = encodeURIComponent(opts.artifactId);
  return `tenants/${t}/${tid}/projects/${pid}/artifacts/${aid}/`;
}

export const artifactsRouter = new Hono<{ Bindings: Env }>();

// List artifacts with optional filters
artifactsRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id");
  const sessionId = c.req.query("session_id");
  const type = c.req.query("type");
  const limit = parseInt(c.req.query("limit") || "50");

  const artifacts = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let q = "SELECT * FROM artifacts WHERE tenant_type = $1 AND tenant_id = $2";

    if (projectId) {
      params.push(projectId);
      q += ` AND project_id = $${params.length}`;
    }
    if (sessionId) {
      params.push(sessionId);
      q += ` AND session_id = $${params.length}`;
    }
    if (type) {
      params.push(type);
      q += ` AND type = $${params.length}`;
    }

    params.push(limit);
    q += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const { rows } = await db.query(q, params);
    return rows;
  });

  return c.json({ artifacts });
});

// Get artifact metadata
artifactsRouter.get("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const artifact = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!artifact) return c.json({ error: "Artifact not found" }, 404);
  return c.json(artifact);
});

// Create an artifact record (upload happens separately)
artifactsRouter.post("/", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const projectId = body.project_id;
  const sessionId = body.session_id ?? null;
  const type = body.type;
  const storageMode = body.storage_mode === "chunked" ? "chunked" : "single";
  const contentType = body.content_type || "application/octet-stream";
  const prefix = buildArtifactPrefix({ tenantType, tenantId, projectId, artifactId: id });
  const objectKey = `${prefix}object`;

  await withDbClient(c.env, async (db) => {
    // Enforce that the project exists and belongs to the tenant.
    const projRes = await db.query(
      "SELECT id FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [projectId, tenantType, tenantId]
    );
    if (projRes.rowCount === 0) {
      throw new Error("Project not found (or not in tenant scope).");
    }

    if (sessionId) {
      const sessRes = await db.query(
        "SELECT id FROM sessions WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3 AND project_id = $4",
        [sessionId, tenantType, tenantId, projectId]
      );
      if (sessRes.rowCount === 0) {
        throw new Error("Session not found (or not in tenant/project scope).");
      }
    }

    await db.query(
      `INSERT INTO artifacts (
         id, tenant_type, tenant_id, project_id, session_id,
         type, storage_mode, r2_bucket, r2_key, r2_prefix,
         content_type, byte_size, sha256, metadata, created_at, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, NULL, $12::jsonb, $13, $14)`,
      [
        id,
        tenantType,
        tenantId,
        projectId,
        sessionId,
        type,
        storageMode,
        "memory",
        storageMode === "single" ? objectKey : null,
        prefix,
        contentType,
        JSON.stringify(body.metadata || {}),
        now,
        actorId,
      ]
    );
  });

  return c.json(
    {
      id,
      storage_mode: storageMode,
      r2_prefix: prefix,
      r2_key: storageMode === "single" ? objectKey : null,
      created_at: now,
    },
    201
  );
});

// Upload the whole artifact as a single object (best for smaller files)
artifactsRouter.put("/:id/object", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const bucket = requireBucket(c.env);

  const { artifact, objectKey } = await withDbClient(c.env, async (db) => {
    const res = await db.query(
      "SELECT * FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [id, tenantType, tenantId]
    );
    const row = res.rows[0] ?? null;
    if (!row) return { artifact: null, objectKey: null as string | null };
    const key = row.r2_key || `${row.r2_prefix}object`;
    return { artifact: row, objectKey: key };
  });

  if (!artifact || !objectKey) return c.json({ error: "Artifact not found" }, 404);

  const req = c.req.raw;
  if (!req.body) return c.json({ error: "Missing request body" }, 400);

  const contentType = c.req.header("content-type") || artifact.content_type || "application/octet-stream";
  const contentLength = c.req.header("content-length");
  const byteSize = contentLength ? parseInt(contentLength) : null;

  await bucket.put(objectKey, req.body, { httpMetadata: { contentType } });

  const now = new Date().toISOString();
  await withDbClient(c.env, async (db) => {
    await db.query(
      "UPDATE artifacts SET storage_mode = 'single', r2_key = $1, content_type = $2, byte_size = COALESCE($3, byte_size), created_at = created_at WHERE id = $4",
      [objectKey, contentType, byteSize, id]
    );
  });

  return c.json({ ok: true, id, r2_key: objectKey, byte_size: byteSize ?? artifact.byte_size, content_type: contentType, updated_at: now });
});

// Upload a binary chunk for large artifacts
artifactsRouter.put("/:id/chunks/:chunkIndex", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const chunkIndex = parseInt(c.req.param("chunkIndex"));
  const bucket = requireBucket(c.env);

  const byteStart = parseInt(c.req.query("byte_start") || "");
  const byteEnd = parseInt(c.req.query("byte_end") || "");
  if (!Number.isFinite(chunkIndex) || chunkIndex < 0) return c.json({ error: "Invalid chunkIndex" }, 400);
  if (!Number.isFinite(byteStart) || !Number.isFinite(byteEnd) || byteStart < 0 || byteEnd < byteStart) {
    return c.json({ error: "Invalid byte_start/byte_end" }, 400);
  }

  const { artifact, chunkKey } = await withDbClient(c.env, async (db) => {
    const res = await db.query(
      "SELECT * FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [id, tenantType, tenantId]
    );
    const row = res.rows[0] ?? null;
    if (!row) return { artifact: null, chunkKey: null as string | null };
    const key = `${row.r2_prefix}chunks/${chunkIndex}.bin`;
    return { artifact: row, chunkKey: key };
  });

  if (!artifact || !chunkKey) return c.json({ error: "Artifact not found" }, 404);

  const req = c.req.raw;
  if (!req.body) return c.json({ error: "Missing request body" }, 400);

  await bucket.put(chunkKey, req.body, { httpMetadata: { contentType: "application/octet-stream" } });

  const now = new Date().toISOString();
  await withDbClient(c.env, async (db) => {
    await db.query(
      "UPDATE artifacts SET storage_mode = 'chunked', r2_key = NULL, content_type = $1, byte_size = GREATEST(byte_size, $2) WHERE id = $3",
      [artifact.content_type || "application/octet-stream", byteEnd + 1, id]
    );
    await db.query(
      `INSERT INTO artifact_chunks (id, artifact_id, chunk_index, byte_start, byte_end, r2_key, text, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, '{}'::jsonb, $7)
       ON CONFLICT (artifact_id, chunk_index) DO UPDATE SET byte_start = EXCLUDED.byte_start, byte_end = EXCLUDED.byte_end, r2_key = EXCLUDED.r2_key`,
      [crypto.randomUUID(), id, chunkIndex, byteStart, byteEnd, chunkKey, now]
    );
  });

  return c.json({ ok: true, id, chunk_index: chunkIndex, r2_key: chunkKey, byte_start: byteStart, byte_end: byteEnd, created_at: now });
});

// Add / update text chunks for retrieval (e.g., parsed logs)
artifactsRouter.post("/:id/text-chunks", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const body = await c.req.json();

  const chunks = Array.isArray(body.chunks) ? body.chunks : [];
  if (chunks.length === 0) return c.json({ error: "No chunks provided" }, 400);

  const now = new Date().toISOString();
  const upserted = await withDbClient(c.env, async (db) => {
    // Verify artifact belongs to tenant
    const artRes = await db.query("SELECT id FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    if (artRes.rowCount === 0) throw new Error("Artifact not found (or not in tenant scope).");

    let count = 0;
    for (const ch of chunks) {
      const chunkIndex = Number.isFinite(ch.chunk_index) ? ch.chunk_index : null;
      if (chunkIndex === null) continue;
      const byteStart = Number.isFinite(ch.byte_start) ? ch.byte_start : 0;
      const byteEnd = Number.isFinite(ch.byte_end) ? ch.byte_end : 0;
      const text = typeof ch.text === "string" ? ch.text : "";
      const metadata = ch.metadata && typeof ch.metadata === "object" ? ch.metadata : {};

      await db.query(
        `INSERT INTO artifact_chunks (id, artifact_id, chunk_index, byte_start, byte_end, r2_key, text, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7::jsonb, $8)
         ON CONFLICT (artifact_id, chunk_index) DO UPDATE
           SET byte_start = EXCLUDED.byte_start,
               byte_end = EXCLUDED.byte_end,
               text = EXCLUDED.text,
               metadata = EXCLUDED.metadata`,
        [crypto.randomUUID(), id, chunkIndex, byteStart, byteEnd, text, JSON.stringify(metadata), now]
      );
      count++;
    }
    return count;
  });

  return c.json({ ok: true, artifact_id: id, upserted });
});

// List chunk metadata
artifactsRouter.get("/:id/chunks", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const chunks = await withDbClient(c.env, async (db) => {
    const artRes = await db.query("SELECT id FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    if (artRes.rowCount === 0) throw new Error("Artifact not found (or not in tenant scope).");

    const { rows } = await db.query(
      "SELECT artifact_id, chunk_index, byte_start, byte_end, r2_key, metadata, created_at FROM artifact_chunks WHERE artifact_id = $1 ORDER BY chunk_index ASC",
      [id]
    );
    return rows;
  });

  return c.json({ chunks });
});

// Fetch a chunk (binary if r2_key exists; otherwise JSON)
artifactsRouter.get("/:id/chunks/:chunkIndex", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const chunkIndex = parseInt(c.req.param("chunkIndex"));
  const bucket = requireBucket(c.env);

  const format = c.req.query("format");

  const chunk = await withDbClient(c.env, async (db) => {
    const artRes = await db.query("SELECT id FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    if (artRes.rowCount === 0) return null;

    const { rows } = await db.query("SELECT * FROM artifact_chunks WHERE artifact_id = $1 AND chunk_index = $2", [
      id,
      chunkIndex,
    ]);
    return rows[0] ?? null;
  });

  if (!chunk) return c.json({ error: "Chunk not found" }, 404);

  const wantsJson =
    format === "json" ||
    format === "text" ||
    (c.req.header("accept") || "").includes("application/json");

  if (wantsJson) {
    return c.json(chunk);
  }

  if (!chunk.r2_key) {
    return c.json({ error: "Chunk has no binary payload (r2_key is null)" }, 404);
  }

  const obj = await bucket.get(chunk.r2_key);
  if (!obj) return c.json({ error: "R2 object not found for chunk" }, 404);

  return new Response(obj.body, {
    headers: {
      "content-type": "application/octet-stream",
    },
  });
});

// Fetch the full object (optionally ranged) for single-object artifacts
artifactsRouter.get("/:id/object", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const bucket = requireBucket(c.env);

  const artifact = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!artifact) return c.json({ error: "Artifact not found" }, 404);
  const key = artifact.r2_key;
  if (!key) return c.json({ error: "Artifact is not stored as a single object (r2_key is null)" }, 400);

  const byteStartRaw = c.req.query("byte_start");
  const byteEndRaw = c.req.query("byte_end");
  let obj = null as Awaited<ReturnType<R2Bucket["get"]>> | null;

  if (byteStartRaw !== undefined || byteEndRaw !== undefined) {
    const byteStart = byteStartRaw !== undefined ? parseInt(byteStartRaw) : 0;
    const byteEnd = byteEndRaw !== undefined ? parseInt(byteEndRaw) : NaN;
    if (!Number.isFinite(byteStart) || byteStart < 0) return c.json({ error: "Invalid byte_start" }, 400);
    if (Number.isFinite(byteEnd)) {
      if (byteEnd < byteStart) return c.json({ error: "Invalid byte_end" }, 400);
      obj = await bucket.get(key, { range: { offset: byteStart, length: byteEnd - byteStart + 1 } });
    } else {
      obj = await bucket.get(key, { range: { offset: byteStart } });
    }
  } else {
    obj = await bucket.get(key);
  }

  if (!obj) return c.json({ error: "R2 object not found" }, 404);

  return new Response(obj.body, {
    headers: {
      "content-type": artifact.content_type || "application/octet-stream",
    },
  });
});

