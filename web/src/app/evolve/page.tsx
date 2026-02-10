import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";

export const dynamic = "force-dynamic";

type SignalsResponse = {
  memory_distribution: { category: string; count: number; avg_confidence: number }[];
  recent_evolution: { type: string; result: string; count: number }[];
  stale_memories: number;
  sessions: { open_sessions: number; recent_sessions: number; closed_sessions_without_summary: number };
  timestamp: string;
};

type EvolutionEventRow = {
  id: string;
  type: string;
  description: string;
  result: string;
  created_at: string;
  project_id: string | null;
  session_id: string | null;
  created_by: string | null;
  changes: unknown;
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function pct(v: number): string {
  return `${Math.round(clamp01(v) * 100)}%`;
}

function prettyJson(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return v;
    }
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default async function EvolvePage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">EVOLUTION</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">System Signals</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Sign in to view evolution signals and event history for your scope.</p>
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

  let signals: SignalsResponse | null = null;
  let events: EvolutionEventRow[] = [];
  let error: string | null = null;

  try {
    signals = await apiJson<SignalsResponse>("/api/evolve/signals");
    const ev = await apiJson<{ events: EvolutionEventRow[] }>("/api/evolve/events?limit=50");
    events = ev.events || [];
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">EVOLUTION</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Signals and Events</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Evolution is automatic on session close and can also be driven by agents (see the memory-evolver skill).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back to console
            </Link>
            <Link
              href="/docs/cli"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              CLI Docs
            </Link>
          </div>
        </header>

        {error ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">API error</p>
            <p className="mt-1 break-words font-mono text-xs leading-5">{error}</p>
          </div>
        ) : null}

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur lg:col-span-5">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Signals</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-600">A health snapshot for your current scope.</p>

            {!signals ? (
              <p className="mt-4 text-sm text-zinc-600">Loading...</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <p className="text-xs font-semibold text-zinc-900">Stale memories</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-950">{signals.stale_memories}</p>
                    <p className="mt-1 text-[11px] leading-5 text-zinc-600">Updated &gt;30d ago, access_count=0.</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <p className="text-xs font-semibold text-zinc-900">Open sessions</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-950">{signals.sessions.open_sessions}</p>
                    <p className="mt-1 text-[11px] leading-5 text-zinc-600">Ended_at is NULL.</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <p className="text-xs font-semibold text-zinc-900">Summary gaps</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-950">{signals.sessions.closed_sessions_without_summary}</p>
                    <p className="mt-1 text-[11px] leading-5 text-zinc-600">Closed sessions missing a `summary` memory.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold text-zinc-900">Memory distribution</p>
                  {signals.memory_distribution.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-600">No memories yet.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="text-left text-zinc-500">
                            <th className="py-2 pr-4">Category</th>
                            <th className="py-2 pr-4">Count</th>
                            <th className="py-2 pr-4">Avg confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {signals.memory_distribution
                            .slice()
                            .sort((a, b) => b.count - a.count)
                            .map((d) => (
                              <tr key={d.category} className="border-t border-zinc-100">
                                <td className="py-2 pr-4 font-medium text-zinc-900">{d.category}</td>
                                <td className="py-2 pr-4 text-zinc-700">{d.count}</td>
                                <td className="py-2 pr-4 text-zinc-700">{pct(d.avg_confidence)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-zinc-500">Updated {fmt(signals.timestamp)}</p>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur lg:col-span-7">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Recent Evolution Events</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-600">Audit log of automatic and agent-driven mutations.</p>

            {events.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-600">No events yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-zinc-950">{e.description}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                          <span>Type {e.type}</span>
                          <span>Result {e.result}</span>
                          <span>At {fmt(e.created_at)}</span>
                          {e.project_id ? <span className="font-mono">project {e.project_id}</span> : null}
                          {e.session_id ? <span className="font-mono">session {e.session_id}</span> : null}
                        </div>
                      </div>
                    </div>
                    {e.changes ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-zinc-900">Changes</summary>
                        <pre className="mt-2 overflow-auto rounded-2xl border border-zinc-200 bg-zinc-950 p-4 text-[11px] leading-5 text-zinc-100">
{prettyJson(e.changes)}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

