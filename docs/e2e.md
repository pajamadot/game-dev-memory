# E2E UX Testing (Playwright + Optional Cloud Runner)

We want end-to-end UX regressions to show up quickly, without adding heavy CI.

This repo supports two complementary approaches:

1. Local Playwright tests (developer + agent sessions).
2. Optional cloud smoke runner (Cloudflare Browser Rendering via Puppeteer) for scheduled checks + screenshots.

## 1) Local Playwright (Recommended First Step)

Tests live in:

- `e2e/`

Config:

- `playwright.config.ts`

Install Chromium:

```powershell
npm run e2e:install
```

Run against local dev server (auto-starts `web` on `http://localhost:3000`):

```powershell
npm run e2e
```

Run against production deployment (no local server):

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://game-dev-memory.vercel.app"
$env:E2E_START_SERVER = "false"
npm run e2e
```

Artifacts:

- HTML report: `playwright-report/`
- Failure artifacts: `test-results/` (screenshots/videos/traces retained on failure)

## 2) Cloud Smoke Runner (Optional): Cloudflare + Puppeteer

If you want scheduled UX checks without GitHub Actions, use Cloudflare Browser Rendering:

- A Worker can launch a headless browser via a `browser` binding.
- The Worker can visit `WEBSITE_URL`, run a handful of assertions, and store screenshots in R2 (as `assets`).
- The Worker can write an `evolution_event` or `memory` describing failures (so the system "self-evolves").

High-level design:

- Add a dedicated Worker (recommended) e.g. `qa-runner/`
- Bind:
  - `BROWSER` (Cloudflare Browser Rendering)
  - `MEMORY_BUCKET` (R2)
  - `HYPERDRIVE` (Neon) or call Memory API using an API key
- Endpoints:
  - `POST /run` triggers a smoke run (manual)
  - `scheduled()` runs daily/weekly

We intentionally keep this as a second step:

- It requires enabling Browser Rendering in the Cloudflare account.
- It adds operational cost and new failure modes.

