import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { approveMcpOauth, denyMcpOauth } from "./actions";

export const dynamic = "force-dynamic";

function splitScopes(raw: string): string[] {
  return raw
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 32);
}

function scopeLabel(orgId: string | null): { label: string; hint: string } {
  if (orgId) {
    return {
      label: "Organization scope (shared)",
      hint: "The client will access shared project memory for your org.",
    };
  }
  return {
    label: "Personal scope (private)",
    hint: "The client will access only your private personal memory.",
  };
}

export default async function McpAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const client_id = typeof sp.client_id === "string" ? sp.client_id : "";
  const redirect_uri = typeof sp.redirect_uri === "string" ? sp.redirect_uri : "";
  const scope = typeof sp.scope === "string" ? sp.scope : "";
  const state = typeof sp.state === "string" ? sp.state : "";
  const code_challenge = typeof sp.code_challenge === "string" ? sp.code_challenge : "";
  const code_challenge_method = typeof sp.code_challenge_method === "string" ? sp.code_challenge_method : "S256";

  const { userId, orgId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">OAUTH</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Authorize MCP Client</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Sign in to approve access for this MCP client.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <SignInButton mode="modal">
                <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                  Sign in
                </button>
              </SignInButton>
              <Link
                href="/"
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Back to console
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const missing = [];
  if (!client_id) missing.push("client_id");
  if (!redirect_uri) missing.push("redirect_uri");
  if (!code_challenge) missing.push("code_challenge");
  if (code_challenge_method !== "S256") missing.push("code_challenge_method");

  const scopes = splitScopes(scope);
  const scopeInfo = scopeLabel(orgId ?? null);

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <header className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">OAUTH</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Authorize MCP Client</h1>
            <p className="mt-1 text-sm text-zinc-600">Grant an MCP client an API key for your selected memory scope.</p>
          </div>
          <Link
            href="/settings/tokens"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Manage keys
          </Link>
        </header>

        {missing.length ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Invalid OAuth request</p>
            <p className="mt-1 text-xs leading-5 text-amber-900/80">Missing or invalid: {missing.join(", ")}</p>
          </div>
        ) : (
          <main className="mt-8 space-y-6">
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Request</h2>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                <p>
                  <span className="font-semibold text-zinc-900">Client</span>: <span className="font-mono text-xs">{client_id}</span>
                </p>
                <p>
                  <span className="font-semibold text-zinc-900">Redirect</span>: <span className="font-mono text-xs">{redirect_uri}</span>
                </p>
                <p>
                  <span className="font-semibold text-zinc-900">Scope</span>: {scopeInfo.label}
                </p>
                <p className="text-xs text-zinc-600">{scopeInfo.hint}</p>
              </div>

              {scopes.length ? (
                <div className="mt-4">
                  <p className="text-xs font-medium text-zinc-700">Requested scopes</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {scopes.map((s) => (
                      <span key={s} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-800">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Consent</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Approving will create an API key and return it to the MCP client via OAuth token exchange (PKCE).
              </p>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <form action={approveMcpOauth} className="flex-1">
                  <input type="hidden" name="client_id" value={client_id} />
                  <input type="hidden" name="redirect_uri" value={redirect_uri} />
                  <input type="hidden" name="scope" value={scope} />
                  <input type="hidden" name="state" value={state} />
                  <input type="hidden" name="code_challenge" value={code_challenge} />
                  <input type="hidden" name="code_challenge_method" value={code_challenge_method} />
                  <button className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800">
                    Approve
                  </button>
                </form>

                <form action={denyMcpOauth} className="flex-1">
                  <input type="hidden" name="redirect_uri" value={redirect_uri} />
                  <input type="hidden" name="state" value={state} />
                  <button className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-zinc-300 bg-white text-sm font-medium text-zinc-900 hover:bg-zinc-50">
                    Deny
                  </button>
                </form>
              </div>
            </section>
          </main>
        )}
      </div>
    </div>
  );
}

