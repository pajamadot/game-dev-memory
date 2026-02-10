---
name: ux-e2e
description: Run Playwright end-to-end UX smoke tests against the web console (local or production), capture artifacts (screenshots/videos/traces), and turn failures into actionable memories/evolution events. Use when changing frontend UX, OAuth consent, or auth flows.
tags: [playwright, e2e, ux, qa, oauth]
---

# UX E2E Skill (Playwright)

This skill validates the web UX end-to-end using Playwright.

## Run (Production Smoke)

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://game-dev-memory.pajamadot.com"
$env:E2E_START_SERVER = "false"
npm run e2e
```

## Run (Local Dev)

This will auto-start the Next dev server via `playwright.config.ts`:

```powershell
npm run e2e
```

## Install Browser

```powershell
npm run e2e:install
```

## Outputs

- HTML report: `playwright-report/`
- Failure artifacts: `test-results/` (screenshots/videos/traces)

## How This Evolves The System

When tests fail, treat them as memory signals:

- Create a `bug` memory describing the UX regression.
- Attach the trace zip or screenshot as an `asset` and link it via `entity_links`.
- Record an `evolution_event` with `type=repair` when the issue is fixed.

See:

- `docs/e2e.md`
