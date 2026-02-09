#!/usr/bin/env node
/**
 * Memory Evolver - Self-evolving memory system for game dev AI agents
 *
 * Usage:
 *   node index.js                    # Single evolution cycle (auto mode)
 *   node index.js --review           # Human-in-the-loop review
 *   node index.js --loop             # Continuous evolution daemon
 *   node index.js --loop --cycles=100 # Stop after N cycles (process recycling still applies)
 *   node index.js --project=<id>     # Target specific project
 *   node index.js solidify           # Persist evolved capabilities
 *   node index.js solidify --dry-run # Preview without persisting
 */

const { resolve } = require("path");
const { evolve } = require("./src/evolve");
const { solidify } = require("./src/solidify");

const DEFAULTS = {
  MIN_SLEEP_MS: parseInt(process.env.EVOLVER_MIN_SLEEP_MS || "30000"),
  MAX_SLEEP_MS: parseInt(process.env.EVOLVER_MAX_SLEEP_MS || "300000"),
  MAX_RSS_MB: parseInt(process.env.EVOLVER_MAX_RSS_MB || "256"),
  MAX_CYCLES: parseInt(process.env.EVOLVER_MAX_CYCLES_PER_PROCESS || "50"),
  API_URL: process.env.MEMORY_API_URL || "http://localhost:8787",
};

async function main() {
  const args = process.argv.slice(2);
  const flags = parseFlags(args);

  if (args[0] === "solidify") {
    return solidify({
      dryRun: flags["dry-run"] || false,
      noRollback: flags["no-rollback"] || false,
      intent: flags.intent || "optimize",
      summary: flags.summary || "",
      apiUrl: DEFAULTS.API_URL,
    });
  }

  if (flags.loop) {
    return runLoop(flags);
  }

  // Single evolution cycle
  return evolve({
    review: flags.review || false,
    projectId: flags.project || null,
    drift: flags.drift || false,
    apiUrl: DEFAULTS.API_URL,
  });
}

async function runLoop(flags) {
  let cycles = 0;
  let sleepMs = DEFAULTS.MIN_SLEEP_MS;
  const maxCycles = parseInt(flags.cycles || flags["max-cycles"] || DEFAULTS.MAX_CYCLES);

  console.log("[memory-evolver] Starting continuous evolution loop");

  while (true) {
    cycles++;

    // Memory leak protection
    const rss = process.memoryUsage().rss / 1024 / 1024;
    if (rss > DEFAULTS.MAX_RSS_MB || (Number.isFinite(maxCycles) && maxCycles > 0 && cycles > maxCycles)) {
      console.log(`[memory-evolver] Recycling process (rss=${rss.toFixed(1)}MB, cycles=${cycles})`);
      process.exit(0);
    }

    const start = Date.now();
    try {
      await evolve({
        review: false,
        projectId: flags.project || null,
        drift: flags.drift || false,
        apiUrl: DEFAULTS.API_URL,
      });
      sleepMs = DEFAULTS.MIN_SLEEP_MS; // Reset on success
    } catch (err) {
      console.error(`[memory-evolver] Evolution cycle failed:`, err.message);
      sleepMs = Math.min(sleepMs * 2, DEFAULTS.MAX_SLEEP_MS); // Exponential backoff
    }

    const elapsed = Date.now() - start;
    if (elapsed < 5000) {
      sleepMs = Math.min(sleepMs * 1.5, DEFAULTS.MAX_SLEEP_MS);
    }

    console.log(`[memory-evolver] Sleeping ${(sleepMs / 1000).toFixed(0)}s before next cycle`);
    await sleep(sleepMs);
  }
}

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      flags[key] = val || true;
    }
  }
  return flags;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[memory-evolver] Fatal error:", err);
  process.exit(1);
});
