import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";

const MB = 1024 * 1024;
const MIN_PART_SIZE = 5 * MB; // S3/R2 multipart minimum (except last part)
// Cloudflare Workers request body limits vary by plan; stay under 100MB for safety.
const MAX_PART_SIZE = 95 * MB;

function requireBucket(env: AppEnv["Bindings"]): R2Bucket {
  if (!env.MEMORY_BUCKET) {
    throw new Error("R2 bucket binding missing. Configure MEMORY_BUCKET in wrangler.jsonc.");
  }
  return env.MEMORY_BUCKET;
}

function buildAssetPrefix(opts: { tenantType: string; tenantId: string; projectId: string; assetId: string }) {
  const t = encodeURIComponent(opts.tenantType);
  const tid = encodeURIComponent(opts.tenantId);
  const pid = encodeURIComponent(opts.projectId);
  const aid = encodeURIComponent(opts.assetId);
  return `tenants/${t}/${tid}/projects/${pid}/assets/${aid}/`;
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function roundUp(n: number, multiple: number): number {
  return Math.ceil(n / multiple) * multiple;
}

function recommendedPartSize(byteSize: number | null): number {
  if (!byteSize || !Number.isFinite(byteSize) || byteSize <= 0) {
    return 16 * MB;
  }

  // Ensure <= 10k parts (S3 limit). Prefer fewer parts for large files.
  const minRequired = Math.ceil(byteSize / 10_000);
  let part = Math.max(MIN_PART_SIZE, minRequired);

  // Heuristic: bump to larger sizes for big files to keep part count reasonable.
  if (byteSize >= 8 * 1024 * MB) part = Math.max(part, 64 * MB); // >= 8GB
  else if (byteSize >= 512 * MB) part = Math.max(part, 32 * MB);
  else if (byteSize >= 64 * MB) part = Math.max(part, 16 * MB);

  // Round to 8MB for nicer boundaries.
  part = roundUp(part, 8 * MB);
  return Math.min(part, MAX_PART_SIZE);
}

function safeAsciiFilename(name: string | null | undefined): string {
  const raw = (name || "asset.bin").replace(/[\/\\]/g, "_");
  const ascii = raw.replace(/[^\x20-\x7E]/g, "_").trim();
  if (!ascii) return "asset.bin";
  return ascii.slice(0, 200);
}

function contentDispositionAttachment(filename: string): string {
  const safe = filename.replace(/["\\]/g, "_");
  return `attachment; filename="${safe}"`;
}

function truthyQuery(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export const assetsRouter = new Hono<AppEnv>();

// List assets with optional filters
assetsRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id");
  const memoryId = c.req.query("memory_id");
  const status = c.req.query("status");
  const searchRaw = c.req.query("q") || c.req.query("search") || "";
  const searchQ = searchRaw ? searchRaw.trim() : "";
  const limit = clampInt(c.req.query("limit"), 50, 1, 200);
  const includeMemoryLinks = truthyQuery(c.req.query("include_memory_links") || c.req.query("include_links"));

  const assets = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    let sql = "SELECT a.* FROM assets a WHERE a.tenant_type = $1 AND a.tenant_id = $2";

    if (projectId) {
      params.push(projectId);
      sql += ` AND a.project_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      sql += ` AND a.status = $${params.length}`;
    }

    if (searchQ) {
      // Search by original filename or storage key suffix.
      // Keep this simple and deterministic (no embeddings here).
      const like = `%${searchQ.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
      params.push(like);
      sql += ` AND (
        (a.original_name IS NOT NULL AND a.original_name ILIKE $${params.length} ESCAPE '\\\\')
        OR a.r2_key ILIKE $${params.length} ESCAPE '\\\\'
      )`;
    }

    if (memoryId) {
      params.push(memoryId);
      sql += ` AND EXISTS (
        SELECT 1 FROM entity_links l
        WHERE l.tenant_type = $1 AND l.tenant_id = $2
          AND l.from_type = 'memory'
          AND l.from_id = $${params.length}::uuid
          AND l.to_type = 'asset'
          AND l.to_id = a.id
      )`;
    }

    params.push(limit);
    sql += ` ORDER BY a.created_at DESC LIMIT $${params.length}`;

    if (!includeMemoryLinks) {
      const { rows } = await db.query(sql, params);
      return rows;
    }

    // Return asset metadata plus linked memory summaries (evidence graph).
    //
    // We keep the base selection + paging deterministic, then join link aggregates.
    const full = `
      WITH base AS (
        ${sql}
      )
      SELECT
        base.*,
        COALESCE(links.linked_memory_count, 0) AS linked_memory_count,
        COALESCE(links.linked_memories, '[]'::jsonb) AS linked_memories
      FROM base
      LEFT JOIN (
        SELECT
          l.to_id AS asset_id,
          COUNT(DISTINCT m.id) AS linked_memory_count,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', m.id,
                'project_id', m.project_id,
                'category', m.category,
                'title', m.title,
                'updated_at', m.updated_at
              )
              ORDER BY m.updated_at DESC
            ),
            '[]'::jsonb
          ) AS linked_memories
        FROM entity_links l
        JOIN memories m
          ON m.tenant_type = l.tenant_type
         AND m.tenant_id = l.tenant_id
         AND m.id = l.from_id
        WHERE l.tenant_type = $1 AND l.tenant_id = $2
          AND l.from_type = 'memory'
          AND l.to_type = 'asset'
        GROUP BY l.to_id
      ) links
        ON links.asset_id = base.id
      ORDER BY base.created_at DESC
    `;

    const { rows } = await db.query(full, params);
    return rows;
  });

  return c.json({ assets });
});

// Get asset metadata
assetsRouter.get("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const asset = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    const row = rows[0] ?? null;
    if (!row) return null;

    const countRes = await db.query(
      `SELECT COUNT(DISTINCT l.from_id) AS cnt
       FROM entity_links l
       WHERE l.tenant_type = $1 AND l.tenant_id = $2
         AND l.to_type = 'asset' AND l.to_id = $3::uuid
         AND l.from_type = 'memory'`,
      [tenantType, tenantId, id]
    );
    const linkedCount = countRes.rows[0]?.cnt ? Number(countRes.rows[0].cnt) : 0;

    const linkedRes = await db.query(
      `SELECT m.id, m.project_id, m.category, m.title, m.updated_at
       FROM entity_links l
       JOIN memories m
         ON m.tenant_type = l.tenant_type
        AND m.tenant_id = l.tenant_id
        AND m.id = l.from_id
       WHERE l.tenant_type = $1 AND l.tenant_id = $2
         AND l.to_type = 'asset' AND l.to_id = $3::uuid
         AND l.from_type = 'memory'
       ORDER BY m.updated_at DESC
       LIMIT 100`,
      [tenantType, tenantId, id]
    );

    return { ...row, linked_memory_count: linkedCount, linked_memories: linkedRes.rows || [] };
  });

  if (!asset) return c.json({ error: "Asset not found" }, 404);
  return c.json(asset);
});

// Create an asset + initiate multipart upload
assetsRouter.post("/", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const bucket = requireBucket(c.env);
  const body = await c.req.json();

  const projectId = String(body.project_id || "").trim();
  if (!projectId) return c.json({ error: "project_id is required" }, 400);

  const byteSizeRaw = body.byte_size;
  const byteSize = typeof byteSizeRaw === "number" && Number.isFinite(byteSizeRaw) && byteSizeRaw >= 0 ? Math.trunc(byteSizeRaw) : 0;
  const contentType = typeof body.content_type === "string" && body.content_type.trim() ? body.content_type.trim() : "application/octet-stream";
  const originalName = typeof body.original_name === "string" && body.original_name.trim() ? body.original_name.trim() : null;
  const sha256 = typeof body.sha256 === "string" && body.sha256.trim() ? body.sha256.trim() : null;
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const memoryId = typeof body.memory_id === "string" && body.memory_id.trim() ? body.memory_id.trim() : null;
  const relation = typeof body.relation === "string" && body.relation.trim() ? body.relation.trim() : "attachment";

  const requestedPartSize = body.part_size;
  let partSize =
    typeof requestedPartSize === "number" && Number.isFinite(requestedPartSize)
      ? Math.trunc(requestedPartSize)
      : typeof requestedPartSize === "string"
        ? parseInt(requestedPartSize)
        : NaN;

  if (!Number.isFinite(partSize)) {
    partSize = recommendedPartSize(byteSize > 0 ? byteSize : null);
  }

  if (partSize < MIN_PART_SIZE) partSize = MIN_PART_SIZE;
  if (partSize > MAX_PART_SIZE) partSize = MAX_PART_SIZE;

  if (byteSize > 0) {
    const expectedParts = Math.ceil(byteSize / partSize);
    if (expectedParts > 10_000) {
      return c.json(
        {
          error: "File too large for this upload mode (would exceed 10,000 multipart parts).",
          details: { byte_size: byteSize, part_size: partSize, expected_parts: expectedParts },
        },
        400
      );
    }
  }

  // Validate project (and optional memory) scope first.
  const memProjectId = await withDbClient(c.env, async (db) => {
    const projRes = await db.query("SELECT id FROM projects WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      projectId,
      tenantType,
      tenantId,
    ]);
    if (projRes.rowCount === 0) throw new Error("Project not found (or not in tenant scope).");

    if (!memoryId) return null;

    const memRes = await db.query(
      "SELECT id, project_id FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [memoryId, tenantType, tenantId]
    );
    const row = memRes.rows[0] ?? null;
    if (!row) throw new Error("Memory not found (or not in tenant scope).");
    if (String(row.project_id) !== projectId) throw new Error("Memory is not in the specified project.");
    return String(row.project_id);
  });
  void memProjectId;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const prefix = buildAssetPrefix({ tenantType, tenantId, projectId, assetId: id });
  const objectKey = `${prefix}object`;

  const upload = await bucket.createMultipartUpload(objectKey, { httpMetadata: { contentType } });

  try {
    await withDbClient(c.env, async (db) => {
      await db.query(
        `INSERT INTO assets (
           id, tenant_type, tenant_id, project_id,
           status, r2_bucket, r2_key,
           content_type, byte_size, sha256, original_name, metadata,
           upload_id, upload_part_size,
           created_at, updated_at, created_by, updated_by
         )
         VALUES (
           $1, $2, $3, $4,
           'uploading', $5, $6,
           $7, $8, $9, $10, $11::jsonb,
           $12, $13,
           $14, $15, $16, $17
         )`,
        [
          id,
          tenantType,
          tenantId,
          projectId,
          "memory",
          objectKey,
          contentType,
          byteSize,
          sha256,
          originalName,
          JSON.stringify(metadata),
          upload.uploadId,
          partSize,
          now,
          now,
          actorId,
          actorId,
        ]
      );

      if (memoryId) {
        await db.query(
          `INSERT INTO entity_links (
             id, tenant_type, tenant_id,
             from_type, from_id, to_type, to_id,
             relation, metadata, created_at, created_by
           )
           VALUES ($1, $2, $3, 'memory', $4::uuid, 'asset', $5::uuid, $6, $7::jsonb, $8, $9)`,
          [crypto.randomUUID(), tenantType, tenantId, memoryId, id, relation, JSON.stringify({}), now, actorId]
        );
      }
    });
  } catch (err) {
    // Best-effort cleanup; avoid leaving abandoned multipart uploads behind.
    await upload.abort().catch(() => undefined);
    throw err;
  }

  return c.json(
    {
      id,
      project_id: projectId,
      status: "uploading",
      r2_key: objectKey,
      upload_id: upload.uploadId,
      upload_part_size: partSize,
      byte_size: byteSize,
      content_type: contentType,
      original_name: originalName,
      created_at: now,
    },
    201
  );
});

// Upload status + parts list
assetsRouter.get("/:id/upload", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const result = await withDbClient(c.env, async (db) => {
    const aRes = await db.query("SELECT * FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    const asset = aRes.rows[0] ?? null;
    if (!asset) return { asset: null, parts: [] as any[] };

    const pRes = await db.query(
      "SELECT part_number, etag, byte_size, created_at FROM asset_upload_parts WHERE asset_id = $1 ORDER BY part_number ASC",
      [id]
    );
    return { asset, parts: pRes.rows };
  });

  if (!result.asset) return c.json({ error: "Asset not found" }, 404);
  return c.json({
    asset_id: id,
    status: result.asset.status,
    upload_id: result.asset.upload_id,
    upload_part_size: result.asset.upload_part_size,
    parts: result.parts,
  });
});

// Upload a multipart part
assetsRouter.put("/:id/parts/:partNumber", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const partNumber = clampInt(c.req.param("partNumber"), -1, 1, 10_000);
  if (partNumber < 1) return c.json({ error: "Invalid partNumber (must be 1..10000)" }, 400);

  const bucket = requireBucket(c.env);

  const asset = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (asset.status !== "uploading") return c.json({ error: "Asset is not in uploading state" }, 400);
  if (!asset.upload_id) return c.json({ error: "Asset has no active upload_id" }, 400);

  const req = c.req.raw;
  if (!req.body) return c.json({ error: "Missing request body" }, 400);

  const contentLength = c.req.header("content-length");
  const partByteSize = contentLength ? parseInt(contentLength) : null;
  if (partByteSize !== null && Number.isFinite(partByteSize) && partByteSize > MAX_PART_SIZE) {
    return c.json({ error: "Part too large for this endpoint", details: { max_part_size: MAX_PART_SIZE } }, 413);
  }

  const upload = bucket.resumeMultipartUpload(asset.r2_key, asset.upload_id);
  const uploaded = await upload.uploadPart(partNumber, req.body as any);

  const now = new Date().toISOString();
  await withDbClient(c.env, async (db) => {
    await db.query(
      `INSERT INTO asset_upload_parts (id, asset_id, part_number, etag, byte_size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (asset_id, part_number) DO UPDATE
         SET etag = EXCLUDED.etag,
             byte_size = EXCLUDED.byte_size,
             created_at = EXCLUDED.created_at`,
      [crypto.randomUUID(), id, partNumber, uploaded.etag, partByteSize, now]
    );
  });

  return c.json({ ok: true, asset_id: id, part_number: partNumber, etag: uploaded.etag });
});

// Complete multipart upload (uses stored parts unless provided explicitly)
assetsRouter.post("/:id/complete", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const bucket = requireBucket(c.env);
  const body = await c.req.json().catch(() => ({}));

  const { asset, parts } = await withDbClient(c.env, async (db) => {
    const aRes = await db.query("SELECT * FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    const assetRow = aRes.rows[0] ?? null;
    if (!assetRow) return { asset: null, parts: [] as any[] };

    const provided = Array.isArray(body.parts) ? body.parts : null;
    if (provided) {
      const normalized = provided
        .map((p: any) => ({
          partNumber: clampInt(p?.part_number ?? p?.partNumber, -1, 1, 10_000),
          etag: typeof p?.etag === "string" ? p.etag : null,
        }))
        .filter((p: any) => p.partNumber >= 1 && typeof p.etag === "string" && p.etag.length > 0);
      return { asset: assetRow, parts: normalized };
    }

    const pRes = await db.query(
      "SELECT part_number, etag FROM asset_upload_parts WHERE asset_id = $1 ORDER BY part_number ASC",
      [id]
    );
    const normalized = pRes.rows.map((r) => ({ partNumber: r.part_number, etag: r.etag }));
    return { asset: assetRow, parts: normalized };
  });

  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (asset.status !== "uploading") return c.json({ error: "Asset is not in uploading state" }, 400);
  if (!asset.upload_id) return c.json({ error: "Asset has no active upload_id" }, 400);
  if (!parts || parts.length === 0) return c.json({ error: "No uploaded parts found" }, 400);

  if (asset.byte_size && asset.upload_part_size) {
    const expected = Math.ceil(Number(asset.byte_size) / Number(asset.upload_part_size));
    if (expected > 0 && parts.length !== expected) {
      const seen = new Set(parts.map((p: any) => p.partNumber));
      const missing: number[] = [];
      for (let i = 1; i <= expected && missing.length < 50; i++) {
        if (!seen.has(i)) missing.push(i);
      }
      return c.json(
        {
          error: "Missing parts for completion",
          details: { expected_parts: expected, received_parts: parts.length, missing_part_numbers: missing },
        },
        400
      );
    }
  }

  const upload = bucket.resumeMultipartUpload(asset.r2_key, asset.upload_id);
  const completed = await upload.complete(parts);

  const now = new Date().toISOString();
  await withDbClient(c.env, async (db) => {
    await db.query(
      "UPDATE assets SET status = 'ready', upload_id = NULL, updated_at = $1, updated_by = $2, byte_size = $3 WHERE id = $4 AND tenant_type = $5 AND tenant_id = $6",
      [now, actorId, completed.size, id, tenantType, tenantId]
    );
    await db.query("DELETE FROM asset_upload_parts WHERE asset_id = $1", [id]);
  });

  return c.json({ ok: true, asset_id: id, status: "ready", r2_key: asset.r2_key, byte_size: completed.size, updated_at: now });
});

// Abort multipart upload
assetsRouter.post("/:id/abort", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const bucket = requireBucket(c.env);

  const asset = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (!asset.upload_id) return c.json({ ok: true, asset_id: id, status: asset.status });

  const upload = bucket.resumeMultipartUpload(asset.r2_key, asset.upload_id);
  await upload.abort();

  const now = new Date().toISOString();
  await withDbClient(c.env, async (db) => {
    await db.query(
      "UPDATE assets SET status = 'failed', upload_id = NULL, updated_at = $1, updated_by = $2 WHERE id = $3 AND tenant_type = $4 AND tenant_id = $5",
      [now, actorId, id, tenantType, tenantId]
    );
    await db.query("DELETE FROM asset_upload_parts WHERE asset_id = $1", [id]);
  });

  return c.json({ ok: true, asset_id: id, status: "failed", aborted_at: now });
});

// Link an asset to a memory (entity_links)
assetsRouter.post("/:id/link", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const assetId = c.req.param("id");
  const body = await c.req.json();

  const memoryId = typeof body.memory_id === "string" && body.memory_id.trim() ? body.memory_id.trim() : null;
  if (!memoryId) return c.json({ error: "memory_id is required" }, 400);

  const relation = typeof body.relation === "string" && body.relation.trim() ? body.relation.trim() : "attachment";
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const now = new Date().toISOString();

  await withDbClient(c.env, async (db) => {
    const aRes = await db.query("SELECT id, project_id FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      assetId,
      tenantType,
      tenantId,
    ]);
    const asset = aRes.rows[0] ?? null;
    if (!asset) throw new Error("Asset not found (or not in tenant scope).");

    const mRes = await db.query("SELECT id, project_id FROM memories WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      memoryId,
      tenantType,
      tenantId,
    ]);
    const mem = mRes.rows[0] ?? null;
    if (!mem) throw new Error("Memory not found (or not in tenant scope).");
    if (String(mem.project_id) !== String(asset.project_id)) throw new Error("Asset and memory must be in the same project.");

    await db.query(
      `INSERT INTO entity_links (
         id, tenant_type, tenant_id,
         from_type, from_id, to_type, to_id,
         relation, metadata, created_at, created_by
       )
       VALUES ($1, $2, $3, 'memory', $4::uuid, 'asset', $5::uuid, $6, $7::jsonb, $8, $9)`,
      [crypto.randomUUID(), tenantType, tenantId, memoryId, assetId, relation, JSON.stringify(metadata), now, actorId]
    );
  });

  return c.json({ ok: true, asset_id: assetId, memory_id: memoryId, relation, created_at: now });
});

// Download the asset object (supports range via byte_start/byte_end query)
assetsRouter.get("/:id/object", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const bucket = requireBucket(c.env);

  const asset = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!asset) return c.json({ error: "Asset not found" }, 404);
  if (asset.status !== "ready") return c.json({ error: "Asset is not ready" }, 400);

  const byteStartRaw = c.req.query("byte_start");
  const byteEndRaw = c.req.query("byte_end");
  let obj: Awaited<ReturnType<R2Bucket["get"]>> | null = null;

  if (byteStartRaw !== undefined || byteEndRaw !== undefined) {
    const byteStart = byteStartRaw !== undefined ? parseInt(byteStartRaw) : 0;
    const byteEnd = byteEndRaw !== undefined ? parseInt(byteEndRaw) : NaN;
    if (!Number.isFinite(byteStart) || byteStart < 0) return c.json({ error: "Invalid byte_start" }, 400);
    if (Number.isFinite(byteEnd)) {
      if (byteEnd < byteStart) return c.json({ error: "Invalid byte_end" }, 400);
      obj = await bucket.get(asset.r2_key, { range: { offset: byteStart, length: byteEnd - byteStart + 1 } });
    } else {
      obj = await bucket.get(asset.r2_key, { range: { offset: byteStart } });
    }
  } else {
    obj = await bucket.get(asset.r2_key);
  }

  if (!obj) return c.json({ error: "R2 object not found" }, 404);

  const filename = safeAsciiFilename(asset.original_name);
  const headers: Record<string, string> = {
    "content-type": asset.content_type || "application/octet-stream",
    "content-disposition": contentDispositionAttachment(filename),
  };

  return new Response(obj.body, { headers });
});

// Delete asset (DB row + R2 object + links)
assetsRouter.delete("/:id", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const bucket = requireBucket(c.env);

  const asset = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });
  if (!asset) return c.json({ error: "Asset not found" }, 404);

  // Best-effort cleanup of any in-progress upload session.
  if (asset.upload_id) {
    const upload = bucket.resumeMultipartUpload(asset.r2_key, asset.upload_id);
    await upload.abort().catch(() => undefined);
  }

  await bucket.delete(asset.r2_key).catch(() => undefined);

  await withDbClient(c.env, async (db) => {
    await db.query("DELETE FROM asset_upload_parts WHERE asset_id = $1", [id]);
    await db.query(
      "DELETE FROM entity_links WHERE tenant_type = $1 AND tenant_id = $2 AND ((from_type = 'asset' AND from_id = $3::uuid) OR (to_type = 'asset' AND to_id = $3::uuid))",
      [tenantType, tenantId, id]
    );
    await db.query("DELETE FROM assets WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [id, tenantType, tenantId]);
  });

  return c.json({ ok: true, deleted: true, asset_id: id });
});
