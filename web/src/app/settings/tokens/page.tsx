import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";
import { TokensClient } from "./TokensClient";

export const dynamic = "force-dynamic";

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  created_by: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
};

function scopeLabel(orgId: string | null): { label: string; hint: string } {
  if (orgId) {
    return {
      label: "Organization (shared)",
      hint: "Keys grant access to shared project memory for your org.",
    };
  }
  return {
    label: "Personal (private)",
    hint: "Keys grant access to your private personal memory only.",
  };
}

export default async function TokensPage() {
  const { userId, orgId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">SETTINGS</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">API Keys</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Sign in to manage API keys for agents and MCP clients.</p>
            <div className="mt-6">
              <SignInButton mode="modal">
                <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                  Sign in
                </button>
              </SignInButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const scope = scopeLabel(orgId ?? null);

  let tokens: TokenRow[] = [];
  let error: string | null = null;

  try {
    const res = await apiJson<{ tokens: TokenRow[] }>("/api/tokens?limit=100");
    tokens = res.tokens || [];
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">SETTINGS</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">API Keys</h1>
            <p className="mt-1 text-sm text-zinc-600">Dispatch API keys from the Clerk web app, then use keys everywhere else.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back to console
            </Link>
          </div>
        </header>

        {error ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">API error</p>
            <p className="mt-1 break-words font-mono text-xs leading-5">{error}</p>
          </div>
        ) : null}

        <main className="mt-8">
          <TokensClient scopeLabel={scope.label} scopeHint={scope.hint} tokens={tokens} />
        </main>
      </div>
    </div>
  );
}

