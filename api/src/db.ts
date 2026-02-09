import { Client } from "pg";
import type { Env } from "./types";

function resolveConnectionString(env: Env): string {
  const fromHyperdrive = env.HYPERDRIVE?.connectionString?.trim();
  if (fromHyperdrive) return fromHyperdrive;

  const fromEnv = env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    "Database connection not configured. Bind a Hyperdrive instance as HYPERDRIVE (recommended) or set DATABASE_URL."
  );
}

export async function withDbClient<T>(env: Env, fn: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = resolveConnectionString(env);
  const client = new Client({ connectionString });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    // Ensure sockets are cleaned up between requests.
    await client.end().catch(() => undefined);
  }
}

