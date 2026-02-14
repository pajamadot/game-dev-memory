import { test, expect } from "@playwright/test";

function envBool(name: string, fallback = false): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function safeOrigin(v: string | undefined, fallback: string): string {
  const s = (v || "").trim();
  if (!s) return fallback;
  // Normalize to origin-only to avoid accidental path joins.
  try {
    return new URL(s).origin;
  } catch {
    return fallback;
  }
}

const isLive = envBool("E2E_LIVE", false);

const apiOrigin = safeOrigin(process.env.E2E_API_ORIGIN, "https://api-game-dev-memory.pajamadot.com");
const mcpOrigin = safeOrigin(process.env.E2E_MCP_ORIGIN, "https://mcp-game-dev-memory.pajamadot.com");
const agentOrigin = safeOrigin(process.env.E2E_AGENT_ORIGIN, "https://game-dev-agent.pajamadot.com");

const apiToken = (process.env.E2E_API_TOKEN || "").trim();

test.describe("Live API/MCP smoke", () => {
  test.skip(!isLive, "Set E2E_LIVE=true to run deployed smoke tests.");

  test("API root and health are reachable", async ({ request }) => {
    const root = await request.get(`${apiOrigin}/`, {
      headers: { accept: "application/json" },
    });
    expect(root.status()).toBe(200);
    const rootJson = await root.json();
    expect(rootJson).toMatchObject({ status: "ok" });

    const health = await request.get(`${apiOrigin}/health`, {
      headers: { accept: "application/json" },
    });
    expect(health.status()).toBe(200);
    const healthJson = await health.json();
    expect(healthJson).toMatchObject({ status: "ok" });
  });

  test("Downloads metadata + binary head request work", async ({ request }) => {
    const metaRes = await request.get(`${apiOrigin}/downloads/pajama`, {
      headers: { accept: "application/json" },
    });
    expect(metaRes.status()).toBe(200);
    const meta = await metaRes.json();
    expect(meta).toMatchObject({ ok: true, name: "pajama" });
    expect(Array.isArray(meta.examples)).toBeTruthy();

    const exePath = (meta.examples as string[]).find((p) =>
      typeof p === "string" && p.includes("/downloads/pajama/") && p.endsWith(".exe")
    );
    expect(exePath).toBeTruthy();

    const binUrl = `${apiOrigin}${exePath}`;
    const head = await request.head(binUrl);
    expect(head.status()).toBe(200);
  });

  test("MCP OAuth discovery is reachable and issuer matches host", async ({ request }) => {
    const res = await request.get(`${mcpOrigin}/.well-known/oauth-authorization-server`, {
      headers: { accept: "application/json" },
    });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.issuer).toBe(mcpOrigin);
    expect(typeof j.authorization_endpoint).toBe("string");
    expect(typeof j.token_endpoint).toBe("string");
  });

  test("Agent host returns structured metadata for non-HTML clients", async ({ request }) => {
    const res = await request.get(`${agentOrigin}/`, {
      headers: { accept: "application/json" },
    });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ name: "game-dev-agent", status: "ok" });
    expect(j.endpoints).toBeTruthy();
  });

  test("Agent host redirects browsers to the web UI", async ({ request }) => {
    const res = await request.get(`${agentOrigin}/`, {
      maxRedirects: 0,
      headers: { accept: "text/html" },
    });
    expect(res.status()).toBe(302);
    const loc = res.headers()["location"];
    expect(typeof loc).toBe("string");
    expect(loc).toContain("/agent/streaming/sessions");
  });

  test("Unauthed API endpoints are protected", async ({ request }) => {
    const res = await request.get(`${apiOrigin}/api/memories/providers`, {
      headers: { accept: "application/json" },
    });
    // Auth is required; exact status can vary (401/403) depending on middleware/version.
    expect([401, 403]).toContain(res.status());
    const j = await res.json().catch(() => null);
    expect(j).toBeTruthy();
  });

  test("Authed memory provider list works (if token present)", async ({ request }) => {
    test.skip(!apiToken, "Set E2E_API_TOKEN to run authenticated live tests.");

    const res = await request.get(`${apiOrigin}/api/memories/providers`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiToken}`,
      },
    });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.providers)).toBeTruthy();
    expect(j.providers.map((p: any) => p.id)).toContain("memories_fts");
  });

  test("MCP tools/list works (if token present)", async ({ request }) => {
    test.skip(!apiToken, "Set E2E_API_TOKEN to run authenticated live tests.");

    const res = await request.post(`${mcpOrigin}/mcp`, {
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiToken}`,
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      },
    });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.result?.tools?.length).toBeGreaterThan(0);
    const toolNames = (j.result?.tools || []).map((t: any) => t.name);
    expect(toolNames).toContain("memories.search_index");
    expect(toolNames).toContain("memories.batch_get");
    expect(toolNames).toContain("memories.timeline");
  });
});

