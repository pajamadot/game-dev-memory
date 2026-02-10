import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "..");

const nextConfig: NextConfig = {
  // This is a monorepo and there can be multiple lockfiles. Explicitly set the
  // monorepo root so Next doesn't guess and warn, and keep it aligned with
  // output file tracing on Vercel.
  turbopack: {
    root: repoRoot,
  },
  outputFileTracingRoot: repoRoot,
  experimental: {
    // Next's memory-based worker count can spawn a very high number of workers
    // on large machines (e.g. 60+), which has been unstable in local Windows builds.
    // Cap the worker count to keep builds predictable.
    memoryBasedWorkersCount: false,
    cpus: 8,
  },
};

export default nextConfig;
