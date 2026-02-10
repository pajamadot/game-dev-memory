import { test, expect } from "@playwright/test";

test.describe("Public UX smoke", () => {
  test("home page (logged out) renders marketing copy", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /Shared project memory for teams/i })
    ).toBeVisible();

    await expect(page.getByText(/Auto sync your memory everywhere/i)).toBeVisible();

    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Create account/i })).toBeVisible();
  });

  test("research pages render", async ({ page }) => {
    await page.goto("/research");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    await page.goto("/research/agent-memory");
    await expect(
      page.getByRole("heading", { name: "Agent Memory", exact: true })
    ).toBeVisible();

    await page.goto("/research/unreal-agents");
    await expect(
      page.getByRole("heading", { name: "Unreal Agents", exact: true })
    ).toBeVisible();
  });

  test("agent page (logged out) renders", async ({ page }) => {
    await page.goto("/agent");
    await expect(page.getByRole("heading", { name: /Project Memory Agent/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
  });

  test("agent sessions (logged out) renders", async ({ page }) => {
    await page.goto("/agent/sessions");
    await expect(page.getByRole("heading", { name: /Sign in required/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
  });

  test("agent pro pages (logged out) render", async ({ page }) => {
    await page.goto("/agent/pro");
    await expect(page.getByRole("heading", { name: /Game Dev Agent/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();

    await page.goto("/agent/pro/sessions");
    await expect(page.getByRole("heading", { name: /Sign in required/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
  });

  test("assets browser (logged out) renders", async ({ page }) => {
    await page.goto("/assets");
    await expect(page.getByRole("heading", { name: /Sign in required/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
  });

  test("memory + asset viewers (logged out) render", async ({ page }) => {
    const fake = "00000000-0000-0000-0000-000000000000";

    await page.goto(`/memories/${fake}`);
    await expect(page.getByRole("heading", { name: /Sign in required/i })).toBeVisible();

    await page.goto(`/assets/${fake}`);
    await expect(page.getByRole("heading", { name: /Sign in required/i })).toBeVisible();
  });

  test("oauth authorize page (logged out) renders", async ({ page }) => {
    const params = new URLSearchParams({
      client_id: "pajama_e2e_test",
      redirect_uri: "http://127.0.0.1:9999/callback",
      scope: "projects:read memories:read",
      state: "state_e2e",
      code_challenge:
        "E2E_CHALLENGE_REPLACE_ME_E2E_CHALLENGE_REPLACE_ME_E2E_CHALLENGE_REPLACE_ME",
      code_challenge_method: "S256",
    });

    await page.goto(`/oauth/mcp/authorize?${params.toString()}`);

    await expect(page.getByRole("heading", { name: /Authorize Client/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
  });

  test("settings/tokens (logged out) renders", async ({ page }) => {
    await page.goto("/settings/tokens");
    await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
  });
});
