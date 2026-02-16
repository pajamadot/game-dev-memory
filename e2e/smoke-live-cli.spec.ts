import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function envBool(name: string, fallback = false): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function safeOrigin(v: string | undefined, fallback: string): string {
  const s = (v || "").trim();
  if (!s) return fallback;
  try {
    return new URL(s).origin;
  } catch {
    return fallback;
  }
}

function cliPackageSpec(): string {
  const fromEnv = (process.env.E2E_CLI_PACKAGE || "").trim();
  if (fromEnv) return fromEnv;

  const pkgPath = path.join(process.cwd(), "packages", "pajama", "package.json");
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    if (parsed.version && parsed.version.trim()) {
      return `@pajamadot/pajama@${parsed.version.trim()}`;
    }
  } catch {
    // Fallback below.
  }
  return "@pajamadot/pajama@latest";
}

async function run(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ code: 124, stdout, stderr: `${stderr}\n(timeout after ${timeoutMs}ms)` });
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const isLive = envBool("E2E_LIVE", false);

const apiOrigin = safeOrigin(process.env.E2E_API_ORIGIN, "https://api-game-dev-memory.pajamadot.com");
const apiToken = (process.env.E2E_API_TOKEN || "").trim();
const npxPkg = cliPackageSpec();

test.describe("Live CLI smoke (npx)", () => {
  test.skip(!isLive, "Set E2E_LIVE=true to run deployed smoke tests.");

  test("npx @pajamadot/pajama --version runs", async () => {
    const res = await run("npx", ["-y", npxPkg, "--version"], { timeoutMs: 240_000 });
    expect(res.code).toBe(0);
    expect((res.stdout + res.stderr).toLowerCase()).toContain("pajama");
  });

  test("npx @pajamadot/pajama memories --help shows progressive commands", async () => {
    const res = await run("npx", ["-y", npxPkg, "memories", "--help"], { timeoutMs: 240_000 });
    expect(res.code).toBe(0);
    const out = (res.stdout + res.stderr).toLowerCase();
    expect(out).toContain("search-index");
    expect(out).toContain("batch-get");
    expect(out).toContain("timeline");
    expect(out).toContain("derive");
    expect(out).toContain("foresight-active");
  });

  test("--query alias is accepted (does not fail clap parsing)", async () => {
    // Use an invalid token to avoid requiring secrets; we only care that parsing succeeds.
    // If parsing fails, clap exits with code 2 and prints "unexpected argument '--query'".
    const res = await run(
      "npx",
      [
        "-y",
        npxPkg,
        "memories",
        "search-index",
        "--api-url",
        apiOrigin,
        "--token",
        "invalid",
        "--query",
        "smoke",
        "--limit",
        "1",
      ],
      { timeoutMs: 240_000 }
    );
    const out = (res.stdout + res.stderr).toLowerCase();
    expect(out).not.toContain("unexpected argument '--query'");
    expect(res.code).not.toBe(2);
  });

  test("Authenticated CLI can query memory (if token present)", async () => {
    test.skip(!apiToken, "Set E2E_API_TOKEN to run authenticated live tests.");
    const res = await run(
      "npx",
      [
        "-y",
        npxPkg,
        "memories",
        "search-index",
        "--api-url",
        apiOrigin,
        "--token",
        apiToken,
        "--query",
        "memory",
        "--limit",
        "1",
      ],
      { timeoutMs: 240_000 }
    );
    expect(res.code).toBe(0);
    const out = (res.stdout + res.stderr).toLowerCase();
    expect(out).toContain("provider");
    expect(out).toContain("hits");
  });
});
