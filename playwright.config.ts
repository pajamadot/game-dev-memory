import { defineConfig, devices } from "@playwright/test";

// Default to a non-standard port to avoid accidentally reusing an unrelated dev server
// that might already be running on :3000.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3040";
const isLocal =
  baseURL.includes("localhost") ||
  baseURL.includes("127.0.0.1") ||
  baseURL.includes("0.0.0.0");

const startServer = isLocal && process.env.E2E_START_SERVER !== "false";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: startServer
    ? {
        command: "npm --prefix web run dev -- --port 3040",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
