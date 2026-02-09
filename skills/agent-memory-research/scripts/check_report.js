#!/usr/bin/env node
/**
 * Minimal sanity check for the published research report.
 *
 * Usage:
 *   node skills/agent-memory-research/scripts/check_report.js
 */

const fs = require("fs");
const path = require("path");

function fail(msg) {
  console.error(`[agent-memory-research] ${msg}`);
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const reportPath = path.join(repoRoot, "web", "src", "content", "research", "agent-memory.md");
const pagePath = path.join(repoRoot, "web", "src", "app", "research", "agent-memory", "page.tsx");

if (!fs.existsSync(reportPath)) fail(`Missing report markdown: ${reportPath}`);
if (!fs.existsSync(pagePath)) fail(`Missing report page route: ${pagePath}`);

const text = fs.readFileSync(reportPath, "utf8");
if (!text.includes("# Agent Memory")) fail(`Report missing main title (# Agent Memory ...)`);
if (!text.includes("## References")) fail(`Report missing "## References" section`);
if (!text.includes("https://") && !text.includes("http://")) {
  fail(`Report has no URLs (expected references to include links)`);
}

console.log("[agent-memory-research] OK");
