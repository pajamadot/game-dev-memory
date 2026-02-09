# Deployment + Repo Connections

This repo is a monorepo with two deploy targets:

- `web/` -> Vercel project
- `api/` -> Cloudflare Workers project (wrangler + Hyperdrive)

We deploy using the Vercel CLI and Wrangler CLI from the correct subfolder for each target.

## Web (Vercel)

Root directory: `web/`

### Link The Project (CLI)

The `web/` folder is already linked if `web/.vercel/project.json` exists.
Current link metadata:

- `web/.vercel/project.json`
  - `orgId`: `team_WJowfW1mXL9rNj9GgCwhpmy8`
  - `projectId`: `prj_JGWSOBoo7zAfpEx5gl7hJopknLxp`

To (re)link via CLI:

```bash
cd web
npx vercel link
```

To deploy:

```bash
cd web
npx vercel --prod
```

### Environment Variables (Vercel)

Set these in the Vercel project settings:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_MEMORY_API_URL` (optional; defaults to the deployed Worker URL)

## API (Cloudflare Workers)

Root directory: `api/`

### Deploy (Wrangler CLI)

```bash
cd api
npx wrangler deploy
```

### Hyperdrive Binding

`api/wrangler.jsonc` binds:

- `HYPERDRIVE` -> `bf4313a26dc64a7080f23b9932a4c8a0` (name: `game-dev-memory-neon-db`)

### R2 Bucket (Artifacts)

`api/wrangler.jsonc` binds:

- `MEMORY_BUCKET` -> `game-dev-memory`

Create it if needed:

```bash
cd api
npx wrangler r2 bucket create game-dev-memory
```

## Local Notes

Wrangler emulates Hyperdrive with a local Postgres connection string:

- `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`

This should point at a local Postgres instance, not Neon.
