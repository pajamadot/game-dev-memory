#!/usr/bin/env node
/**
 * Minimal Postgres migration runner for Neon.
 *
 * Usage:
 *   npm run db:migrate
 *
 * Connection string resolution:
 * - DATABASE_URL env var
 * - ../../secrets/neondb.env (raw connection string, single line)
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function resolveConnectionString() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const secretsPath = path.resolve(__dirname, "../../secrets/neondb.env");
  if (fs.existsSync(secretsPath)) {
    const raw = fs.readFileSync(secretsPath, "utf8").trim();
    if (raw) return raw;
  }

  throw new Error(
    "Missing DATABASE_URL and secrets/neondb.env not found. Set DATABASE_URL to your Neon connection string."
  );
}

function listMigrationFiles() {
  const migrationsDir = path.resolve(__dirname, "../migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort();

  return files.map((f) => ({
    version: f.split("_", 1)[0],
    name: f,
    fullPath: path.join(migrationsDir, f),
  }));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedVersions(client) {
  const { rows } = await client.query("SELECT version FROM schema_migrations");
  return new Set(rows.map((r) => String(r.version)));
}

async function applyMigration(client, mig) {
  const sql = fs.readFileSync(mig.fullPath, "utf8");
  if (!sql.trim()) return;

  console.log(`[migrate] Applying ${mig.name}`);

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [
      mig.version,
      mig.name,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  const connectionString = resolveConnectionString();
  const client = new Client({ connectionString });

  await client.connect();
  try {
    await ensureMigrationsTable(client);

    const migrations = listMigrationFiles();
    const applied = await getAppliedVersions(client);

    const pending = migrations.filter((m) => !applied.has(m.version));
    if (pending.length === 0) {
      console.log("[migrate] No pending migrations.");
      return;
    }

    for (const mig of pending) {
      await applyMigration(client, mig);
    }

    console.log(`[migrate] Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] Failed:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});

