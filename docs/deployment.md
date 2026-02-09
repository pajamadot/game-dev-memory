# Deployment + Repo Connections

This repo is a monorepo with two deploy targets:

- `web/` -> Vercel project
- `api/` -> Cloudflare Workers project (wrangler + Hyperdrive)

We deploy from GitHub Actions so each deploy is tied to the repo history.

## Web (Vercel)

Workflow: `.github/workflows/deploy-web-vercel.yml`

Root directory: `web/`

### Required GitHub Secrets

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

You can find the org + project ids from a local Vercel link:

- `web/.vercel/project.json`
  - `orgId`: `team_WJowfW1mXL9rNj9GgCwhpmy8`
  - `projectId`: `prj_JGWSOBoo7zAfpEx5gl7hJopknLxp`

The token must be created in Vercel (Account Settings -> Tokens).

### Environment Variables (Vercel)

Set these in the Vercel project settings:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

## API (Cloudflare Workers)

Workflow: `.github/workflows/deploy-api-worker.yml`

Root directory: `api/`

### Required GitHub Secrets

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token must have permission to deploy Workers and manage Hyperdrive bindings as needed.

### Hyperdrive Binding

`api/wrangler.jsonc` binds:

- `HYPERDRIVE` -> `bf4313a26dc64a7080f23b9932a4c8a0` (name: `game-dev-memory-neon-db`)

## Local Notes

Wrangler emulates Hyperdrive with a local Postgres connection string:

- `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`

This should point at a local Postgres instance, not Neon.

