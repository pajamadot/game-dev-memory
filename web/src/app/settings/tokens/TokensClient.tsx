"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createApiToken, revokeApiToken } from "./actions";

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

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function TokensClient(props: { scopeLabel: string; scopeHint: string; tokens: TokenRow[] }) {
  const [state, formAction] = useActionState(createApiToken, null);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-900">CLI Quickstart</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-600">
          Install once, then login via the browser (OAuth PKCE) or set <span className="font-mono">PAJAMA_TOKEN</span> to use an API
          key from this page.
        </p>
        <pre className="mt-3 overflow-auto rounded-2xl border border-zinc-200 bg-zinc-950 px-4 py-3 font-mono text-[12px] leading-5 text-zinc-50">
npm i -g @pajamadot/pajama
pajama login
pajama projects list
        </pre>
        <p className="mt-3 text-xs text-zinc-600">
          <Link className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800" href="/docs/cli">
            Full CLI docs
          </Link>
        </p>
        <p className="mt-3 text-xs text-zinc-600">
          Default API base: <span className="font-mono">https://api-game-dev-memory.pajamadot.com</span> (override with{" "}
          <span className="font-mono">PAJAMA_API_URL</span>).
        </p>
      </section>

      <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">API Keys</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              Scope: <span className="font-medium text-zinc-900">{props.scopeLabel}</span>. {props.scopeHint}
            </p>
          </div>
        </div>

        {state && !state.ok ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Create failed</p>
            <p className="mt-1 break-words font-mono text-xs leading-5">{state.error}</p>
          </div>
        ) : null}

        {state && state.ok ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">New API key (shown once)</p>
            <p className="mt-1 text-xs text-emerald-900/80">
              Copy it now and store it safely. Anyone with this key can access the selected scope.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={state.token}
                className="h-10 w-full rounded-xl border border-emerald-200 bg-white px-3 font-mono text-xs text-zinc-900"
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(state.token)}
                className="h-10 rounded-xl bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-600"
              >
                Copy
              </button>
            </div>
          </div>
        ) : null}

        <form action={formAction} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-6">
          <div className="sm:col-span-4">
            <label className="text-xs font-medium text-zinc-700" htmlFor="token-name">
              Name
            </label>
            <input
              id="token-name"
              name="name"
              placeholder="My UE5 Agent"
              className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="text-xs font-medium text-zinc-700" htmlFor="token-exp">
              Exp (days)
            </label>
            <input
              id="token-exp"
              name="expires_in_days"
              inputMode="numeric"
              placeholder="90"
              className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
            />
          </div>
          <div className="sm:col-span-1">
            <span className="block text-xs font-medium text-transparent">Create</span>
            <button className="mt-1 inline-flex h-10 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800">
              Create
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Existing Keys</h2>
        {props.tokens.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">No API keys yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {props.tokens.map((t) => {
              const revoked = Boolean(t.revoked_at);
              return (
                <li key={t.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">{t.name || "API Token"}</p>
                      <p className="mt-1 font-mono text-xs text-zinc-600">{t.token_prefix}...</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                        <span>Created {fmt(t.created_at)}</span>
                        {t.last_used_at ? <span>Last used {fmt(t.last_used_at)}</span> : <span>Never used</span>}
                        {t.expires_at ? <span>Expires {fmt(t.expires_at)}</span> : <span>No expiry</span>}
                      </div>
                      {revoked ? <p className="mt-2 text-[11px] font-semibold text-amber-700">Revoked</p> : null}
                    </div>

                    {!revoked ? (
                      <form action={revokeApiToken}>
                        <input type="hidden" name="token_id" value={t.id} />
                        <button className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
                          Revoke
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
