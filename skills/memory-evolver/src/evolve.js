/**
 * Core evolution logic for the memory evolver.
 *
 * Analyzes the current state of the memory system, selects appropriate
 * evolution genes, and executes mutations to improve the knowledge base.
 */

const fs = require("fs");
const path = require("path");
const { selectGeneAndCapsule } = require("./selector");

const GENES_PATH = path.resolve(__dirname, "../assets/genes/genes.json");
const CAPSULES_PATH = path.resolve(__dirname, "../assets/genes/capsules.json");
const EVENTS_PATH = path.resolve(__dirname, "../assets/genes/events.jsonl");

function tenantHeaders() {
  const tenantType = process.env.MEMORY_TENANT_TYPE;
  const tenantId = process.env.MEMORY_TENANT_ID;
  const actorId = process.env.MEMORY_ACTOR_ID || process.env.MEMORY_TENANT_ACTOR_ID || null;

  if (!tenantType || !tenantId) return {};

  return {
    "X-Tenant-Type": tenantType,
    "X-Tenant-Id": tenantId,
    ...(actorId ? { "X-Actor-Id": actorId } : {}),
  };
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter((t) => typeof t === "string");
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === "string");
    } catch {
      // ignore
    }
  }
  return [];
}

function normalizeContext(ctx) {
  if (!ctx) return {};
  if (typeof ctx === "string") {
    try {
      const parsed = JSON.parse(ctx);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
    return {};
  }
  if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) return ctx;
  return {};
}

/**
 * Run a single evolution cycle.
 */
async function evolve({ review, projectId, drift, apiUrl }) {
  console.log("[evolve] Starting evolution cycle");

  // 1. Gather signals from the API
  const signals = await gatherSignals(apiUrl, projectId);
  console.log(`[evolve] Gathered ${signals.length} signals: ${signals.join(", ")}`);

  if (signals.length === 0) {
    console.log("[evolve] No signals detected. System is healthy.");
    return { status: "no_action", signals: [] };
  }

  // 2. Load evolution assets
  const genes = loadJson(GENES_PATH, []);
  const capsules = loadJson(CAPSULES_PATH, []);

  // 3. Select best gene and capsule for current signals
  const { selectedGene, capsuleCandidates, selector } = selectGeneAndCapsule({
    genes,
    capsules,
    signals,
    driftEnabled: drift,
  });

  if (!selectedGene) {
    console.log("[evolve] No matching gene found. May need new gene creation.");
    return { status: "no_gene", signals, selector };
  }

  console.log(`[evolve] Selected gene: ${selectedGene.id} (${selectedGene.mutation_type})`);
  if (capsuleCandidates.length > 0) {
    console.log(`[evolve] Capsule available: ${capsuleCandidates[0].id}`);
  }

  // 4. Build mutation plan
  const mutation = buildMutation(selectedGene, capsuleCandidates, signals, projectId);

  // 5. Review gate
  if (review) {
    console.log("[evolve] Review mode - mutation plan:");
    console.log(JSON.stringify(mutation, null, 2));
    console.log("[evolve] Awaiting human approval...");
    return { status: "pending_review", mutation, selector };
  }

  // 6. Execute mutation
  const result = await executeMutation(mutation, apiUrl);

  // 7. Record evolution event
  const event = {
    id: generateId(),
    type: selectedGene.mutation_type,
    gene_id: selectedGene.id,
    signals,
    mutation_summary: mutation.description,
    result: result.success ? "success" : "failure",
    details: result,
    project_id: mutation.project_id || null,
    timestamp: new Date().toISOString(),
  };

  appendEvent(event);
  await recordEventToApi(event, apiUrl);

  console.log(`[evolve] Cycle complete: ${event.result}`);
  return { status: event.result, event, selector };
}

/**
 * Gather signals from the memory API health endpoint.
 */
async function gatherSignals(apiUrl, projectId) {
  const signals = [];

  try {
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    const res = await fetch(`${apiUrl}/api/evolve/signals${qs}`, { headers: tenantHeaders() });
    if (!res.ok) {
      signals.push("api_unreachable");
      return signals;
    }

    const data = await res.json();

    // Check for stale memories
    if (data.stale_memories > 0) {
      signals.push("stale_memories_detected");
      if (data.stale_memories > 10) signals.push("zero_access_count");
    }

    // Check memory distribution health
    if (data.memory_distribution) {
      const categories = data.memory_distribution.map((d) => d.category);
      const lowConfidence = data.memory_distribution.filter((d) => d.avg_confidence < 0.3);
      if (lowConfidence.length > 0) signals.push("low_confidence_memories");

      // Check if any category is empty (potential gap)
      const expected = ["pattern", "decision", "bug", "architecture", "asset", "lesson"];
      const missing = expected.filter((c) => !categories.includes(c));
      if (missing.length > 0) signals.push("missing_categories");
    }

    // Check recent evolution success rate
    if (data.recent_evolution) {
      const failures = data.recent_evolution.filter((e) => e.result === "failure");
      if (failures.length > 2) signals.push("recent_failures");
    }

    // Check for high-value memories to boost
    if (data.memory_distribution) {
      const highAccess = data.memory_distribution.filter((d) => d.count > 20);
      if (highAccess.length > 0) signals.push("high_access_count");
    }

  } catch (err) {
    signals.push("api_unreachable");
  }

  // If no issues found, look for innovation opportunities
  if (signals.length === 0) {
    signals.push("system_stable");
    signals.push("new_session_data");
  }

  // Add this last so "healthy" projects still get innovation signals.
  if (projectId) signals.push("project_focus");

  return signals;
}

/**
 * Build a mutation plan from selected gene and context.
 */
function buildMutation(gene, capsules, signals, projectId) {
  return {
    id: generateId(),
    type: gene.mutation_type,
    gene_id: gene.id,
    description: gene.description,
    instructions: gene.instructions,
    risk: gene.risk,
    validation: gene.validation,
    capsule_hint: capsules.length > 0 ? capsules[0].outcome : null,
    signals,
    project_id: projectId || null,
    created_at: new Date().toISOString(),
  };
}

/**
 * Execute a mutation against the memory API.
 */
async function executeMutation(mutation, apiUrl) {
  try {
    switch (mutation.type) {
      case "repair":
        return await executeRepair(mutation, apiUrl);
      case "optimize":
        return await executeOptimize(mutation, apiUrl);
      case "innovate":
        return await executeInnovate(mutation, apiUrl);
      default:
        return { success: false, error: `Unknown mutation type: ${mutation.type}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function executeRepair(mutation, apiUrl) {
  // Fetch memories that may need repair
  const res = await fetch(`${apiUrl}/api/memories?limit=100`, { headers: tenantHeaders() });
  const { memories } = await res.json();

  let repaired = 0;
  for (const memory of memories) {
    // Check for broken project references
    const projRes = await fetch(`${apiUrl}/api/projects/${memory.project_id}`, { headers: tenantHeaders() });
    if (!projRes.ok) {
      // Mark orphaned memory with zero confidence
      const tags = normalizeTags(memory.tags);
      const context = normalizeContext(memory.context);
      await fetch(`${apiUrl}/api/memories/${memory.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...tenantHeaders() },
        body: JSON.stringify({
          ...memory,
          confidence: 0,
          tags: [...new Set([...tags, "orphaned"])],
          context,
        }),
      });
      repaired++;
    }
  }

  return { success: true, repaired, total_checked: memories.length };
}

async function executeOptimize(mutation, apiUrl) {
  const res = await fetch(`${apiUrl}/api/memories?limit=100`, { headers: tenantHeaders() });
  const { memories } = await res.json();

  let optimized = 0;

  if (mutation.gene_id === "gene-prune-stale") {
    for (const memory of memories) {
      if (memory.access_count === 0 && memory.confidence < 0.3) {
        const age = Date.now() - new Date(memory.updated_at).getTime();
        if (age > 30 * 24 * 60 * 60 * 1000) {
          await fetch(`${apiUrl}/api/memories/${memory.id}`, { method: "DELETE", headers: tenantHeaders() });
          optimized++;
        }
      }
    }
  } else if (mutation.gene_id === "gene-boost-confidence") {
    for (const memory of memories) {
      if (memory.access_count > 10 && memory.confidence < 1.0) {
        const newConfidence = Math.min(memory.confidence + 0.1, 1.0);
        const tags = normalizeTags(memory.tags);
        const context = normalizeContext(memory.context);
        await fetch(`${apiUrl}/api/memories/${memory.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...tenantHeaders() },
          body: JSON.stringify({ ...memory, confidence: newConfidence, tags, context }),
        });
        optimized++;
      }
    }
  }

  return { success: true, optimized, total_checked: memories.length };
}

async function executeInnovate(mutation, apiUrl) {
  // Innovation mutations create new memories from recent session data.
  // Keep it small + safe: no schema changes and avoid duplicating existing patterns.

  if (mutation.gene_id === "gene-seed-missing-categories") {
    return await seedMissingCategories(apiUrl, mutation.project_id || null);
  }

  if (mutation.gene_id === "gene-extract-pattern") {
    return await extractPatternsFromRecentSessions(apiUrl, mutation.project_id || null);
  }

  return { success: true, message: "No innovate handler for gene_id; skipped.", created: 0 };
}

async function apiJson(apiUrl, pathnameWithQuery, init = {}) {
  const res = await fetch(`${apiUrl}${pathnameWithQuery}`, {
    ...init,
    headers: { ...(init.headers || {}), ...tenantHeaders() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${init.method || "GET"} ${pathnameWithQuery} failed (${res.status}): ${text || res.statusText}`);
  }
  return await res.json();
}

async function apiPostJson(apiUrl, pathnameWithQuery, body) {
  return await apiJson(apiUrl, pathnameWithQuery, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedMissingCategories(apiUrl, projectId) {
  const expected = ["pattern", "decision", "bug", "architecture", "asset", "lesson"];

  const { projects } = await apiJson(apiUrl, "/api/projects");
  const targetProjectId = projectId || (projects && projects[0] && projects[0].id) || null;
  if (!targetProjectId) {
    return { success: true, message: "No projects exist; cannot seed categories.", created: 0 };
  }

  const createdIds = [];

  for (const category of expected) {
    const existing = await apiJson(
      apiUrl,
      `/api/memories?project_id=${encodeURIComponent(targetProjectId)}&category=${encodeURIComponent(category)}&limit=1`
    );
    if (existing && Array.isArray(existing.memories) && existing.memories.length > 0) continue;

    const title = `Seed: ${category}`;
    const content =
      category === "pattern"
        ? "Store recurring problem-solution recipes (what worked repeatedly, when to apply it, and evidence)."
        : category === "decision"
          ? "Store architecture or pipeline decisions with rationale, alternatives, and tradeoffs."
          : category === "bug"
            ? "Store bug reports with reproduction steps, root cause, fix, and prevention notes."
            : category === "architecture"
              ? "Store system design notes: components, data flow, interfaces, invariants, and constraints."
              : category === "asset"
                ? "Store asset pipeline notes: formats, import settings, naming conventions, optimization, ownership."
                : "Store lessons learned (what to do / avoid next time), derived from session outcomes.";

    const res = await apiPostJson(apiUrl, "/api/memories", {
      project_id: targetProjectId,
      session_id: null,
      category,
      source_type: "evolver",
      title,
      content,
      tags: ["seed", "auto", category],
      context: { seed: true, category },
      confidence: 0.4,
    });
    if (res && res.id) createdIds.push(res.id);
  }

  return { success: true, message: "Seeded missing categories (if any).", created: createdIds.length, created_ids: createdIds };
}

async function extractPatternsFromRecentSessions(apiUrl, projectId) {
  const ignoreTags = new Set([
    "auto",
    "seed",
    "session-summary",
    "pattern",
    "decision",
    "bug",
    "architecture",
    "asset",
    "lesson",
    "summary",
    "note",
    "evolver",
  ]);

  const { projects } = await apiJson(apiUrl, "/api/projects");
  const targetProjectId = projectId || (projects && projects[0] && projects[0].id) || null;
  if (!targetProjectId) {
    return { success: true, message: "No projects exist; cannot extract patterns.", created: 0 };
  }

  const sessRes = await apiJson(
    apiUrl,
    `/api/sessions?project_id=${encodeURIComponent(targetProjectId)}&limit=50`
  );
  const sessions = Array.isArray(sessRes.sessions) ? sessRes.sessions : [];
  const closed = sessions.filter((s) => s && s.ended_at).slice(0, 10);
  if (closed.length === 0) {
    return { success: true, message: "No closed sessions; nothing to extract.", created: 0 };
  }

  // Count tags appearing in bug memories across recent closed sessions.
  const tagCounts = new Map(); // tag -> count
  const tagSamples = new Map(); // tag -> Set(title)
  const sessionIds = [];

  for (const s of closed) {
    sessionIds.push(s.id);
    const memRes = await apiJson(
      apiUrl,
      `/api/memories?project_id=${encodeURIComponent(targetProjectId)}&session_id=${encodeURIComponent(s.id)}&limit=200`
    );
    const mems = Array.isArray(memRes.memories) ? memRes.memories : [];

    for (const m of mems) {
      if (!m || String(m.category).toLowerCase() !== "bug") continue;
      const tags = normalizeTags(m.tags);
      for (const t of tags) {
        const tag = String(t).trim();
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (ignoreTags.has(key)) continue;

        tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
        if (!tagSamples.has(key)) tagSamples.set(key, new Set());
        const set = tagSamples.get(key);
        if (set.size < 5 && m.title) set.add(String(m.title));
      }
    }
  }

  const candidates = [...tagCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (candidates.length === 0) {
    return { success: true, message: "No repeated bug tags found; no patterns created.", created: 0 };
  }

  const createdIds = [];

  for (const [tag, count] of candidates) {
    // Skip if a pattern for this tag already exists in this project.
    const exists = await apiJson(
      apiUrl,
      `/api/memories?project_id=${encodeURIComponent(targetProjectId)}&category=pattern&tag=${encodeURIComponent(tag)}&limit=1`
    );
    if (exists && Array.isArray(exists.memories) && exists.memories.length > 0) continue;

    const samples = [...(tagSamples.get(tag) || new Set())].slice(0, 5);
    const lines = [];
    lines.push(`This tag appeared in ${count} bug memories across the last ${closed.length} closed sessions.`);
    if (samples.length) {
      lines.push("");
      lines.push("Examples:");
      for (const s of samples) lines.push(`- ${s}`);
    }
    lines.push("");
    lines.push("Suggested workflow:");
    lines.push("- Capture minimal repro + environment");
    lines.push("- Attach logs/trace artifacts and link relevant chunks");
    lines.push("- Record the fix and prevention notes as a decision/lesson");

    const res = await apiPostJson(apiUrl, "/api/memories", {
      project_id: targetProjectId,
      session_id: null,
      category: "pattern",
      source_type: "evolver",
      title: `Pattern: ${tag}`,
      content: lines.join("\n"),
      tags: ["pattern", "auto", tag],
      context: {
        derived_from: { session_ids: sessionIds, category: "bug" },
        tag,
        occurrences: count,
        sample_titles: samples,
      },
      confidence: 0.55,
    });

    if (res && res.id) createdIds.push(res.id);
  }

  return {
    success: true,
    message: "Extracted pattern candidates from recent sessions.",
    created: createdIds.length,
    created_ids: createdIds,
  };
}

/**
 * Append an evolution event to the local audit log.
 */
function appendEvent(event) {
  try {
    fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + "\n");
  } catch (err) {
    console.error("[evolve] Failed to append event:", err.message);
  }
}

/**
 * Record evolution event to the API.
 */
async function recordEventToApi(event, apiUrl) {
  try {
    await fetch(`${apiUrl}/api/evolve/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...tenantHeaders() },
      body: JSON.stringify({
        project_id: event.project_id || null,
        type: event.type,
        parent_id: null,
        description: event.mutation_summary,
        changes: event.details,
        result: event.result,
      }),
    });
  } catch (err) {
    console.error("[evolve] Failed to record event to API:", err.message);
  }
}

function loadJson(filepath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return fallback;
  }
}

function generateId() {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { evolve };
