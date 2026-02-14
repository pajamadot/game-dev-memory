#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const pkg = require("../package.json");

function binaryName() {
  return process.platform === "win32" ? "pajama.exe" : "pajama";
}

function binaryPath() {
  return path.join(__dirname, binaryName());
}

function versionStampPath() {
  return path.join(__dirname, ".pajama-version");
}

function needsInstall() {
  const bin = binaryPath();
  const stamp = versionStampPath();
  if (!fs.existsSync(bin)) return true;
  if (!fs.existsSync(stamp)) return true;
  const installedVersion = fs.readFileSync(stamp, "utf8").trim();
  return installedVersion !== pkg.version;
}

function ensureBinaryInstalled() {
  const bin = binaryPath();
  if (!needsInstall()) return bin;

  // Fallback: if install scripts were disabled or postinstall failed, try to fetch
  // the binary on first run (or refresh on version mismatch).
  const installer = path.join(__dirname, "..", "scripts", "postinstall.js");
  try {
    console.error("[pajama] Installing CLI binary...");
    const res = spawnSync(process.execPath, [installer], { stdio: "inherit" });
    if (res.status !== 0) {
      throw new Error(`installer exited with code ${res.status}`);
    }
  } catch (err) {
    console.error("[pajama] On-demand install failed.");
    console.error("[pajama] Try reinstalling: npm i -g @pajamadot/pajama");
    console.error("[pajama] Or build from source: cargo install --path pajama --force");
    process.exit(1);
  }

  if (!fs.existsSync(bin)) {
    console.error("[pajama] Install finished but binary is still missing.");
    process.exit(1);
  }
  return bin;
}

const bin = ensureBinaryInstalled();
const child = spawn(bin, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code == null ? 1 : code);
});
