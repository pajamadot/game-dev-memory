import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";
import { createAgentSession } from "./actions";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  name: string;
  engine: string;
};

type AgentSessionRow = {
  id: string;
  project_id: string;
  started_at: string;
  ended_at: string | null;
  title: string;
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default async function AgentSessionsPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Sign in to create and continue agent sessions.</p>
            <div className="mt-6 flex items-center gap-3">
              <SignInButton mode="modal">
                <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                  Sign in
                </button>
              </SignInButton>
              <Link
                href="/agent"
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Back to agent
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const projRes = await apiJson<{ projects: ProjectRow[] }>("/api/projects");
  const projects = projRes.projects || [];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const sessRes = await apiJson<{ sessions: AgentSessionRow[] }>("/api/agent/sessions?limit=100");
  const sessions = sessRes.sessions || [];

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Agent Sessions</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Persistent chat threads (moltworker/story-agent style) backed by sessions + memories.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/agent"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Ask
            </Link>
            <Link
              href="/assets"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Files
            </Link>
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Console
            </Link>
          </div>
        </header>

        <main className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="lg:col-span-4">
            <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">New session</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-600">
                Sessions are project-scoped. Use org scope for shared sessions; personal scope stays private.
              </p>

              <form action={createAgentSession} className="mt-4 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700" htmlFor="agent-session-project">
                    Project
                  </label>
                  <select
                    id="agent-session-project"
                    name="project_id"
                    required
                    className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Select a project
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.engine})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700" htmlFor="agent-session-title">
                    Title (optional)
                  </label>
                  <input
                    id="agent-session-title"
                    name="title"
                    placeholder="Shader compile stalls investigation"
                    className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                  />
                </div>

                <button className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800">
                  Create session
                </button>
              </form>
            </div>
          </section>

          <section className="lg:col-span-8">
            <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Recent sessions</h2>
              <p className="mt-1 text-xs text-zinc-600">{sessions.length} loaded</p>

              {sessions.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-600">No agent sessions yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {sessions.slice(0, 50).map((s) => {
                    const proj = projectById.get(s.project_id);
                    return (
                      <li key={s.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <Link
                              href={`/agent/sessions/${s.id}`}
                              className="text-sm font-semibold text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                            >
                              {s.title || "Agent Session"}
                            </Link>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                              <span className="font-mono">{s.id}</span>
                              {proj ? (
                                <span>
                                  {proj.name} ({proj.engine})
                                </span>
                              ) : (
                                <span className="font-mono">{s.project_id}</span>
                              )}
                              <span>Started {fmt(s.started_at)}</span>
                              {s.ended_at ? <span>Ended {fmt(s.ended_at)}</span> : <span className="text-emerald-700">active</span>}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

