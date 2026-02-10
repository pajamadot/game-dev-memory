import { Hono } from "hono";
import type { AppEnv } from "../appEnv";
import { withDbClient } from "../db";
import { requireTenant } from "../tenant";
import { anthropicMessages } from "../agent/anthropic";
import {
  buildChunkPageIndex,
  buildMarkdownPageIndex,
  countNodes,
  countTokens,
  mdToTree,
  pageIndexFromPages,
  searchPageIndex,
  type PageIndexLlm,
  type PageIndexNode,
} from "../../../packages/pageindex-ts/src/index";

function requireBucket(env: AppEnv["Bindings"]): R2Bucket {
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

export const artifactsRouter = new Hono<AppEnv>();

type StoredPageIndex = {
  version: 1 | 2;
  kind: "markdown" | "chunks" | "pageindex_md" | "pageindex_pdf";
  built_at: string;
  node_count: number;
  roots: PageIndexNode[];
  doc?: any;
  source: {
    storage_mode: string;
    content_type: string;
    byte_size: number;
    r2_key: string | null;
  };
};

function findNodeWithPath(
  roots: PageIndexNode[],
  targetNodeId: string
): { node: any; path: Array<{ node_id: string; title: string }> } | null {
  const target = String(targetNodeId || "").trim();
  if (!target) return null;

  const walk = (nodes: any[], path: Array<{ node_id: string; title: string }>): any => {
    for (const n of nodes || []) {
      if (!n || typeof n !== "object") continue;
      const node_id = String((n as any).node_id || "");
      const title = String((n as any).title || "");
      const nextPath = [...path, { node_id, title }];
      if (node_id === target) return { node: n, path: nextPath };
      const kids = (n as any).nodes;
      if (Array.isArray(kids) && kids.length) {
        const r = walk(kids, nextPath);
        if (r) return r;
      }
    }
    return null;
  };

  return walk(roots as any, []);
}

function pageIndexLlmFromEnv(env: AppEnv["Bindings"]): PageIndexLlm {
  return {
    complete: async (opts) => {
      const history = Array.isArray(opts.chat_history) ? opts.chat_history : [];
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

      for (const m of history) {
        if (!m || typeof m !== "object") continue;
        const role = (m as any).role === "assistant" ? "assistant" : "user";
        const content = typeof (m as any).content === "string" ? String((m as any).content) : "";
        if (content) messages.push({ role, content });
      }

      messages.push({ role: "user", content: String(opts.prompt || "") });

      const res = await anthropicMessages(env as any, {
        system: "",
        messages,
        maxTokens: typeof opts.max_tokens === "number" ? Math.trunc(opts.max_tokens) : 4096,
      });

      const stopReason = (res as any).stopReason as string | null | undefined;
      const finish_reason = stopReason === "max_tokens" ? "max_output_reached" : "finished";

      return { text: res.text, finish_reason };
    },
  };
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseJsonMaybe(v: unknown): any {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
}

function isTextContentType(ct: unknown): boolean {
  const s = typeof ct === "string" ? ct.toLowerCase().trim() : "";
  if (!s) return false;
  return (
    s.startsWith("text/") ||
    s.includes("markdown") ||
    s.includes("json") ||
    s.includes("xml") ||
    s.includes("yaml") ||
    s.includes("yml")
  );
}

// List artifacts with optional filters
artifactsRouter.get("/", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const projectId = c.req.query("project_id");
  const sessionId = c.req.query("session_id");
  const type = c.req.query("type");
  const limit = parseInt(c.req.query("limit") || "50");
  const includeMetadata = (() => {
    const v = (c.req.query("include_metadata") || c.req.query("metadata") || "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  })();

  const artifacts = await withDbClient(c.env, async (db) => {
    const params: unknown[] = [tenantType, tenantId];
    // metadata can be very large (pageindex). Default to summary rows unless explicitly requested.
    const select = includeMetadata
      ? "SELECT *"
      : `SELECT
           id, tenant_type, tenant_id, project_id, session_id,
           type, storage_mode, r2_bucket, r2_key, r2_prefix,
           content_type, byte_size, sha256,
           COALESCE(metadata, '{}'::jsonb) ? 'pageindex' AS has_pageindex,
           created_at, created_by`;

    let q = `${select} FROM artifacts WHERE tenant_type = $1 AND tenant_id = $2`;

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

// PageIndex (TS port): store a hierarchical index in artifact.metadata.pageindex.
// This is a pragmatic bridge between "artifact text" and retrieval-first agents.

// Get stored pageindex metadata (if any)
artifactsRouter.get("/:id/pageindex", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const artifact = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT id, project_id, metadata FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!artifact) return c.json({ error: "Artifact not found" }, 404);
  const meta = parseJsonMaybe((artifact as any).metadata) || {};
  const pageindex = meta.pageindex || null;
  if (!pageindex) return c.json({ error: "No pageindex for artifact" }, 404);

  return c.json({ ok: true, artifact_id: String((artifact as any).id), project_id: String((artifact as any).project_id), pageindex });
});

// Fetch a single node (plus breadcrumbs) from the stored pageindex.
// This avoids shipping the entire tree to clients when they only need a referenced node.
artifactsRouter.get("/:id/pageindex/node/:nodeId", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");
  const nodeId = c.req.param("nodeId");

  const artifact = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query(
      "SELECT id, project_id, metadata FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3",
      [id, tenantType, tenantId]
    );
    return rows[0] ?? null;
  });

  if (!artifact) return c.json({ error: "Artifact not found" }, 404);
  const meta = parseJsonMaybe((artifact as any).metadata) || {};
  const pageindex = meta.pageindex as StoredPageIndex | undefined;
  if (!pageindex || !Array.isArray((pageindex as any).roots)) return c.json({ error: "No pageindex for artifact" }, 404);

  const found = findNodeWithPath((pageindex as any).roots || [], nodeId);
  if (!found) return c.json({ error: "Node not found in pageindex", node_id: String(nodeId) }, 404);

  const nodeAny = found.node as any;
  const node = { ...nodeAny } as any;
  const childrenAny = Array.isArray(nodeAny.nodes) ? (nodeAny.nodes as any[]) : [];
  delete node.nodes;

  const children = childrenAny.slice(0, 200).map((c) => ({
    node_id: String((c as any).node_id || ""),
    title: String((c as any).title || ""),
  }));

  return c.json({
    ok: true,
    artifact_id: String((artifact as any).id),
    project_id: String((artifact as any).project_id),
    node_id: String((nodeAny as any).node_id || nodeId),
    path: found.path,
    node,
    children,
  });
});

// Build/rebuild a pageindex for an artifact.
//
// Body:
// - kind: "auto" | "markdown" | "chunks" (default "auto")
// - markdown: optional markdown content override (string)
// - max_nodes: cap for markdown heading extraction (default 5000)
// - excerpt_chars: per-node excerpt size (default 800)
artifactsRouter.post("/:id/pageindex", async (c) => {
  const { tenantType, tenantId, actorId } = requireTenant(c);
  const id = c.req.param("id");
  const bucket = requireBucket(c.env);
  const body = await c.req.json().catch(() => ({}));

  const kindRaw = typeof body.kind === "string" ? body.kind.trim().toLowerCase() : "auto";
  const kindKey = kindRaw.replace(/-/g, "_");
  const kind: "auto" | "markdown" | "chunks" | "pageindex_md" | "pageindex_pdf" =
    kindKey === "markdown" || kindKey === "chunks" || kindKey === "pageindex_md" || kindKey === "pageindex_pdf"
      ? (kindKey as any)
      : "auto";
  const maxNodes = clampInt(body.max_nodes, 5000, 1, 50_000);
  const excerptChars = clampInt(body.excerpt_chars, 800, 80, 8000);
  const markdownOverride = typeof body.markdown === "string" && body.markdown.trim() ? String(body.markdown) : null;

  const artifact = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT * FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!artifact) return c.json({ error: "Artifact not found" }, 404);

  let markdownText: string | null = null;
  let chunkTexts: Array<{ chunk_index: number; text: string; title?: string | null }> = [];

  if (markdownOverride) {
    markdownText = markdownOverride;
  } else if ((artifact as any).r2_key && isTextContentType((artifact as any).content_type)) {
    const obj = await bucket.get(String((artifact as any).r2_key));
    if (!obj) return c.json({ error: "R2 object not found for artifact" }, 404);
    markdownText = await obj.text();
  } else {
    chunkTexts = await withDbClient(c.env, async (db) => {
      const { rows } = await db.query(
        "SELECT chunk_index, text, metadata FROM artifact_chunks WHERE artifact_id = $1 AND text IS NOT NULL ORDER BY chunk_index ASC",
        [id]
      );
      return rows.map((r: any) => {
        const meta = parseJsonMaybe(r.metadata) || {};
        const title = typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : null;
        return { chunk_index: Number(r.chunk_index), text: String(r.text || ""), title };
      });
    });
  }

  let roots: PageIndexNode[] = [];
  let doc: any = null;
  let finalKind: StoredPageIndex["kind"] = "chunks";
  let storedVersion: StoredPageIndex["version"] = 1;

  const llm = pageIndexLlmFromEnv(c.env);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : String(c.env.ANTHROPIC_MODEL || "claude");

  if (kind === "pageindex_md") {
    const src = markdownText ?? (chunkTexts.length ? chunkTexts.map((c) => c.text).join("\n\n") : "");
    if (!src.trim()) return c.json({ error: "No text available to index (provide markdown or upload text chunks)" }, 400);

    const ifAddNodeSummary = typeof body.if_add_node_summary === "string" ? body.if_add_node_summary : "yes";
    const ifAddDocDescription = typeof body.if_add_doc_description === "string" ? body.if_add_doc_description : "no";
    const ifAddNodeText = typeof body.if_add_node_text === "string" ? body.if_add_node_text : "no";
    const ifAddNodeId = typeof body.if_add_node_id === "string" ? body.if_add_node_id : "yes";
    const ifThinning = typeof body.if_thinning === "boolean" ? body.if_thinning : String(body.if_thinning || "").toLowerCase() === "yes";
    const thinningThreshold = clampInt(body.thinning_threshold, 5000, 0, 500_000);
    const summaryTokenThreshold = clampInt(body.summary_token_threshold, 200, 1, 200_000);

    doc = await mdToTree({
      markdown: src,
      doc_name: String((artifact as any).type || "Document"),
      if_thinning: ifThinning,
      min_token_threshold: thinningThreshold,
      if_add_node_summary: String(ifAddNodeSummary).toLowerCase() === "yes" ? "yes" : "no",
      summary_token_threshold: summaryTokenThreshold,
      model,
      if_add_doc_description: String(ifAddDocDescription).toLowerCase() === "yes" ? "yes" : "no",
      if_add_node_text: String(ifAddNodeText).toLowerCase() === "yes" ? "yes" : "no",
      if_add_node_id: String(ifAddNodeId).toLowerCase() === "yes" ? "yes" : "no",
      llm,
    });

    roots = Array.isArray(doc.structure) ? (doc.structure as PageIndexNode[]) : [];
    finalKind = "pageindex_md";
    storedVersion = 2;
  } else if (kind === "pageindex_pdf") {
    // We don't parse raw PDFs in the Worker. Instead we rely on extracted per-chunk/per-page text.
    const pages = chunkTexts.length
      ? chunkTexts.map((c) => [String(c.text || ""), countTokens(String(c.text || ""), model)] as [string, number])
      : markdownText
        ? [[markdownText, countTokens(markdownText, model)] as [string, number]]
        : [];

    if (pages.length === 0) return c.json({ error: "No text available to index as pages (upload extracted text chunks first)" }, 400);

    const user_opt: any = {};
    if (typeof body.toc_check_page_num !== "undefined") user_opt.toc_check_page_num = clampInt(body.toc_check_page_num, 20, 1, 200);
    if (typeof body.max_page_num_each_node !== "undefined") user_opt.max_page_num_each_node = clampInt(body.max_page_num_each_node, 10, 1, 500);
    if (typeof body.max_token_num_each_node !== "undefined") user_opt.max_token_num_each_node = clampInt(body.max_token_num_each_node, 20000, 100, 5_000_000);
    if (typeof body.if_add_node_id === "string") user_opt.if_add_node_id = String(body.if_add_node_id).toLowerCase() === "yes" ? "yes" : "no";
    if (typeof body.if_add_node_summary === "string") user_opt.if_add_node_summary = String(body.if_add_node_summary).toLowerCase() === "yes" ? "yes" : "no";
    if (typeof body.if_add_doc_description === "string") user_opt.if_add_doc_description = String(body.if_add_doc_description).toLowerCase() === "yes" ? "yes" : "no";
    if (typeof body.if_add_node_text === "string") user_opt.if_add_node_text = String(body.if_add_node_text).toLowerCase() === "yes" ? "yes" : "no";
    user_opt.model = model;

    doc = await pageIndexFromPages({
      llm,
      page_list: pages,
      doc_name: String((artifact as any).type || "Document"),
      user_opt,
    });

    roots = Array.isArray(doc.structure) ? (doc.structure as PageIndexNode[]) : [];
    finalKind = "pageindex_pdf";
    storedVersion = 2;
  } else if (kind === "markdown" || kind === "auto") {
    const src = markdownText ?? (chunkTexts.length ? chunkTexts.map((c) => c.text).join("\n\n") : "");
    if (src.trim()) {
      const mdRoots = buildMarkdownPageIndex(src, { maxNodes, excerptChars });
      if (mdRoots.length > 0) {
        roots = mdRoots;
        finalKind = "markdown";
      }
    }
  }

  if (roots.length === 0) {
    if (!chunkTexts.length) {
      if (markdownText && markdownText.trim()) {
        roots = buildChunkPageIndex([{ chunk_index: 0, text: markdownText, title: String((artifact as any).type || "Document") }], {
          excerptChars,
          rootTitle: String((artifact as any).type || "Document"),
        });
        finalKind = "chunks";
      } else {
        return c.json({ error: "No text available to index (provide markdown or upload text chunks)" }, 400);
      }
    } else {
      roots = buildChunkPageIndex(chunkTexts, { excerptChars, rootTitle: String((artifact as any).type || "Document") });
      finalKind = "chunks";
    }
  }

  const now = new Date().toISOString();
  const stored: StoredPageIndex = {
    version: storedVersion,
    kind: finalKind,
    built_at: now,
    node_count: countNodes(roots),
    roots,
    doc: doc || undefined,
    source: {
      storage_mode: String((artifact as any).storage_mode || ""),
      content_type: String((artifact as any).content_type || ""),
      byte_size: Number((artifact as any).byte_size || 0),
      r2_key: (artifact as any).r2_key ? String((artifact as any).r2_key) : null,
    },
  };

  await withDbClient(c.env, async (db) => {
    await db.query(
      `UPDATE artifacts
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{pageindex}', $1::jsonb, true)
       WHERE id = $2 AND tenant_type = $3 AND tenant_id = $4`,
      [JSON.stringify(stored), id, tenantType, tenantId]
    );

    // Record an evolution event for auditability (cheap + human-visible).
    await db.query(
      `INSERT INTO evolution_events (
         id, tenant_type, tenant_id, project_id, session_id,
         type, parent_id, description, changes, result, created_at, created_by
       )
       VALUES ($1, $2, $3, $4, NULL, 'optimize', NULL, $5, $6::jsonb, 'success', $7, $8)`,
      [
        crypto.randomUUID(),
        tenantType,
        tenantId,
        String((artifact as any).project_id),
        `Built artifact pageindex (${finalKind})`,
        JSON.stringify({ artifact_id: id, kind: finalKind, node_count: stored.node_count }),
        now,
        actorId,
      ]
    );
  });

  return c.json({ ok: true, artifact_id: id, project_id: String((artifact as any).project_id), pageindex: stored });
});

// Query stored pageindex with a cheap deterministic scorer.
artifactsRouter.get("/:id/pageindex/query", async (c) => {
  const { tenantType, tenantId } = requireTenant(c);
  const id = c.req.param("id");

  const q = (c.req.query("q") || "").trim();
  if (!q) return c.json({ error: "q is required" }, 400);

  const limit = clampInt(c.req.query("limit"), 12, 1, 200);

  const artifact = await withDbClient(c.env, async (db) => {
    const { rows } = await db.query("SELECT id, project_id, metadata FROM artifacts WHERE id = $1 AND tenant_type = $2 AND tenant_id = $3", [
      id,
      tenantType,
      tenantId,
    ]);
    return rows[0] ?? null;
  });

  if (!artifact) return c.json({ error: "Artifact not found" }, 404);
  const meta = parseJsonMaybe((artifact as any).metadata) || {};
  const pageindex = meta.pageindex as StoredPageIndex | undefined;
  if (!pageindex || !Array.isArray((pageindex as any).roots)) return c.json({ error: "No pageindex for artifact" }, 404);

  const matches = searchPageIndex(pageindex.roots || [], q, { limit });

  return c.json({
    ok: true,
    artifact_id: String((artifact as any).id),
    project_id: String((artifact as any).project_id),
    query: q,
    matches,
  });
});
