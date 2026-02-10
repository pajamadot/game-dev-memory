#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function binaryName() {
  return process.platform === "win32" ? "pajama.exe" : "pajama";
}

function binaryPath() {
  return path.join(__dirname, binaryName());
}

const bin = binaryPath();
if (!fs.existsSync(bin)) {
  console.error("[pajama] CLI binary not found.");
  console.error("[pajama] Try reinstalling: npm i -g @pajamadot/pajama");
  console.error("[pajama] Or build from source: cargo install --path pajama --force");
  process.exit(1);
}

const child = spawn(bin, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code == null ? 1 : code);
});

