/* eslint-disable no-console */
// Minimal sanity check to keep the published research route wired correctly.

const fs = require("fs");
const path = require("path");

function mustExist(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing: ${p}`);
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, "../../..");
  const md = path.join(repoRoot, "web", "src", "content", "research", "unreal-agents.md");
  const page = path.join(repoRoot, "web", "src", "app", "research", "unreal-agents", "page.tsx");

  mustExist(md);
  mustExist(page);

  const mdText = fs.readFileSync(md, "utf8");
  if (!mdText.trim().startsWith("#")) {
    throw new Error("unreal-agents.md should start with a markdown heading (# ...)");
  }

  console.log("[ok] Unreal Agents report files exist and look sane.");
}

main();

