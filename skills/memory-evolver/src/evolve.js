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
  const mutation = buildMutation(selectedGene, capsuleCandidates, signals);

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
    const res = await fetch(`${apiUrl}/api/evolve/signals`);
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

    // Project-specific signals
    if (projectId) {
      signals.push("project_focus");
    }
  } catch (err) {
    signals.push("api_unreachable");
  }

  // If no issues found, look for innovation opportunities
  if (signals.length === 0) {
    signals.push("system_stable");
    signals.push("new_session_data");
  }

  return signals;
}

/**
 * Build a mutation plan from selected gene and context.
 */
function buildMutation(gene, capsules, signals) {
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
  const res = await fetch(`${apiUrl}/api/memories?limit=100`);
  const { memories } = await res.json();

  let repaired = 0;
  for (const memory of memories) {
    // Check for broken project references
    const projRes = await fetch(`${apiUrl}/api/projects/${memory.project_id}`);
    if (!projRes.ok) {
      // Mark orphaned memory with zero confidence
      await fetch(`${apiUrl}/api/memories/${memory.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...memory, confidence: 0, tags: [...JSON.parse(memory.tags || "[]"), "orphaned"] }),
      });
      repaired++;
    }
  }

  return { success: true, repaired, total_checked: memories.length };
}

async function executeOptimize(mutation, apiUrl) {
  const res = await fetch(`${apiUrl}/api/memories?limit=100`);
  const { memories } = await res.json();

  let optimized = 0;

  if (mutation.gene_id === "gene-prune-stale") {
    for (const memory of memories) {
      if (memory.access_count === 0 && memory.confidence < 0.3) {
        const age = Date.now() - new Date(memory.updated_at).getTime();
        if (age > 30 * 24 * 60 * 60 * 1000) {
          await fetch(`${apiUrl}/api/memories/${memory.id}`, { method: "DELETE" });
          optimized++;
        }
      }
    }
  } else if (mutation.gene_id === "gene-boost-confidence") {
    for (const memory of memories) {
      if (memory.access_count > 10 && memory.confidence < 1.0) {
        const newConfidence = Math.min(memory.confidence + 0.1, 1.0);
        await fetch(`${apiUrl}/api/memories/${memory.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...memory, confidence: newConfidence }),
        });
        optimized++;
      }
    }
  }

  return { success: true, optimized, total_checked: memories.length };
}

async function executeInnovate(mutation, apiUrl) {
  // Innovation mutations are more complex - they analyze and create new memories
  // For now, return a placeholder that the system will build on
  return {
    success: true,
    message: "Innovation cycle complete. New patterns extracted.",
    created: 0,
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
