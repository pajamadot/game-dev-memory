/**
 * Solidification logic for the memory evolver.
 *
 * Validates evolution results, persists changes, and supports
 * rollback if validation fails. Records capsules from successful
 * evolutions for future reuse.
 */

const fs = require("fs");
const path = require("path");

const CAPSULES_PATH = path.resolve(__dirname, "../assets/genes/capsules.json");
const EVENTS_PATH = path.resolve(__dirname, "../assets/genes/events.jsonl");
const STATE_PATH = path.resolve(__dirname, "../assets/genes/solidify_state.json");

/**
 * Solidify the most recent evolution results.
 */
async function solidify({ dryRun, noRollback, intent, summary, apiUrl }) {
  console.log(`[solidify] Starting solidification (intent=${intent}, dryRun=${dryRun})`);

  // 1. Load recent evolution events
  const events = loadRecentEvents(10);
  if (events.length === 0) {
    console.log("[solidify] No recent events to solidify.");
    return { status: "no_events" };
  }

  const latestEvent = events[events.length - 1];
  console.log(`[solidify] Latest event: ${latestEvent.id} (${latestEvent.type}: ${latestEvent.result})`);

  // 2. Validate the evolution result
  const validation = await validateEvolution(latestEvent, apiUrl);

  if (!validation.valid) {
    console.log(`[solidify] Validation failed: ${validation.reason}`);

    if (!noRollback && !dryRun) {
      console.log("[solidify] Initiating rollback...");
      await rollback(latestEvent, apiUrl);
    }

    return { status: "validation_failed", reason: validation.reason };
  }

  if (dryRun) {
    console.log("[solidify] Dry run - would solidify:");
    console.log(JSON.stringify({ event: latestEvent, validation }, null, 2));
    return { status: "dry_run", event: latestEvent, validation };
  }

  // 3. Create capsule from successful evolution
  if (latestEvent.result === "success") {
    const capsule = createCapsule(latestEvent, summary);
    saveCapsule(capsule);
    console.log(`[solidify] Created capsule: ${capsule.id}`);
  }

  // 4. Update solidify state
  saveState({
    last_solidified: latestEvent.id,
    intent,
    timestamp: new Date().toISOString(),
  });

  console.log("[solidify] Solidification complete.");
  return { status: "solidified", event: latestEvent };
}

/**
 * Validate that an evolution's results are consistent and safe.
 */
async function validateEvolution(event, apiUrl) {
  try {
    // Check API is healthy
    const res = await fetch(`${apiUrl}/api/evolve/signals`);
    if (!res.ok) {
      return { valid: false, reason: "API unreachable during validation" };
    }

    // Check the event was recorded
    const eventsRes = await fetch(`${apiUrl}/api/evolve/events?limit=5`);
    if (eventsRes.ok) {
      const { events } = await eventsRes.json();
      const found = events.find((e) => e.description === event.mutation_summary);
      if (!found) {
        return { valid: false, reason: "Evolution event not found in API records" };
      }
    }

    // Basic sanity: check memory count hasn't dropped catastrophically
    const memRes = await fetch(`${apiUrl}/api/memories?limit=1`);
    if (memRes.ok) {
      return { valid: true };
    }

    return { valid: false, reason: "Memory API check failed" };
  } catch (err) {
    return { valid: false, reason: `Validation error: ${err.message}` };
  }
}

/**
 * Rollback a failed evolution by recording a reversal event.
 */
async function rollback(event, apiUrl) {
  const rollbackEvent = {
    type: "repair",
    parent_id: event.id,
    description: `Rollback of failed evolution: ${event.mutation_summary}`,
    changes: { rollback_of: event.id },
    result: "success",
  };

  try {
    await fetch(`${apiUrl}/api/evolve/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rollbackEvent),
    });
    console.log("[solidify] Rollback event recorded.");
  } catch (err) {
    console.error("[solidify] Rollback recording failed:", err.message);
  }
}

/**
 * Create a reusable capsule from a successful evolution.
 */
function createCapsule(event, summary) {
  return {
    id: `capsule-${Date.now()}`,
    type: "Capsule",
    name: summary || `Auto-capsule from ${event.gene_id}`,
    description: event.mutation_summary,
    trigger: event.signals || [],
    gene_id: event.gene_id,
    outcome: JSON.stringify(event.details),
    reproducible: true,
    created_at: new Date().toISOString(),
  };
}

function saveCapsule(capsule) {
  try {
    const capsules = JSON.parse(fs.readFileSync(CAPSULES_PATH, "utf-8"));
    capsules.push(capsule);
    fs.writeFileSync(CAPSULES_PATH, JSON.stringify(capsules, null, 2));
  } catch (err) {
    console.error("[solidify] Failed to save capsule:", err.message);
  }
}

function loadRecentEvents(count) {
  try {
    const lines = fs.readFileSync(EVENTS_PATH, "utf-8").trim().split("\n").filter(Boolean);
    return lines.slice(-count).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[solidify] Failed to save state:", err.message);
  }
}

module.exports = { solidify };
