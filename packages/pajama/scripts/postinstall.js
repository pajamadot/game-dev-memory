#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const pkg = require("../package.json");

function platformAssetName() {
  const p = process.platform;
  const a = process.arch;

  if (p === "win32" && a === "x64") return "pajama-win32-x64.exe";
  if (p === "win32" && a === "arm64") return "pajama-win32-arm64.exe";
  if (p === "darwin" && a === "x64") return "pajama-darwin-x64";
  if (p === "darwin" && a === "arm64") return "pajama-darwin-arm64";
  if (p === "linux" && a === "x64") return "pajama-linux-x64";
  if (p === "linux" && a === "arm64") return "pajama-linux-arm64";

  return null;
}

function binaryName() {
  return process.platform === "win32" ? "pajama.exe" : "pajama";
}

function versionStampPath() {
  return path.join(__dirname, "..", "bin", ".pajama-version");
}

function baseUrl() {
  const fromEnv = (process.env.PAJAMA_DOWNLOAD_BASE_URL || "").trim();
  return fromEnv || "https://api-game-dev-memory.pajamadot.com/downloads/pajama";
}

async function fetchOrNull(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} downloading ${url}: ${text}`);
  }
  return res;
}

async function downloadToFile(url, dstPath) {
  const res = await fetchOrNull(url);
  if (!res) throw new Error(`Not found: ${url}`);

  const buf = Buffer.from(await res.arrayBuffer());

  fs.mkdirSync(path.dirname(dstPath), { recursive: true });

  // Atomic write: write to tmp, then rename.
  const tmp = `${dstPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dstPath);
}

async function maybeVerifySha256(url, filePath) {
  const res = await fetchOrNull(url);
  if (!res) return; // optional sidecar

  const text = (await res.text()).trim();
  const expected = text.split(/\s+/)[0]?.toLowerCase();
  if (!expected || expected.length < 32) return;

  const data = fs.readFileSync(filePath);
  const actual = crypto.createHash("sha256").update(data).digest("hex").toLowerCase();
  if (actual !== expected) {
    throw new Error(`SHA256 mismatch for ${path.basename(filePath)} (expected ${expected}, got ${actual})`);
  }
}

async function main() {
  const asset = platformAssetName();
  if (!asset) {
    console.error(`[pajama] No prebuilt binary for ${process.platform}/${process.arch}.`);
    console.error("[pajama] Build from source: cargo install --path pajama --force");
    return;
  }

  const tag = `v${pkg.version}`;
  const url = `${baseUrl()}/${tag}/${asset}`;
  const shaUrl = `${url}.sha256`;
  const dst = path.join(__dirname, "..", "bin", binaryName());
  const stamp = versionStampPath();

  // Skip only when both binary and version stamp match.
  if (fs.existsSync(dst) && fs.existsSync(stamp)) {
    const installedVersion = fs.readFileSync(stamp, "utf8").trim();
    if (installedVersion === pkg.version) return;
  }

  console.error(`[pajama] Downloading ${url}`);
  await downloadToFile(url, dst);
  await maybeVerifySha256(shaUrl, dst);

  fs.writeFileSync(stamp, `${pkg.version}\n`, "utf8");

  if (process.platform !== "win32") {
    fs.chmodSync(dst, 0o755);
  }
}

main().catch((err) => {
  console.error("[pajama] Install failed:", err && err.message ? err.message : String(err));
  process.exit(1);
});
