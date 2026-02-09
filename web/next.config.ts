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
};

export default nextConfig;
