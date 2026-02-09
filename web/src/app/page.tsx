import { OrganizationSwitcher, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { apiJson } from "@/lib/memory-api";
import { closeSession, createMemory, createProject, startSession } from "./actions";

type Project = {
  id: string;
  name: string;
  engine: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type Session = {
  id: string;
  project_id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  summary?: string | null;
};

type Memory = {
  id: string;
  project_id: string;
  session_id: string | null;
  category: string;
  source_type: string;
  title: string;
  content: string;
  tags: unknown;
  confidence: number;
  access_count: number;
  created_at: string;
  updated_at: string;
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function normalizeTags(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((t) => typeof t === "string");
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((t) => typeof t === "string");
    } catch {
      // ignore
    }
  }
  return [];
}

function Card(props: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-2xl border border-zinc-200/70 bg-white/70 p-5 shadow-[0_1px_0_0_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-900">{props.title}</h2>
        {props.hint ? <p className="text-xs text-zinc-500">{props.hint}</p> : null}
      </div>
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

function Pill(props: { children: React.ReactNode; tone?: "zinc" | "amber" | "emerald" | "sky" }) {
  const tone = props.tone || "zinc";
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : tone === "sky"
          ? "border-sky-200 bg-sky-50 text-sky-900"
          : "border-zinc-200 bg-zinc-50 text-zinc-900";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{props.children}</span>;
}

function categoryTone(category: string): "zinc" | "amber" | "emerald" | "sky" {
  const c = category.toLowerCase();
  if (c.includes("bug") || c.includes("error")) return "amber";
  if (c.includes("pattern") || c.includes("architecture")) return "sky";
  if (c.includes("lesson") || c.includes("decision") || c.includes("summary")) return "emerald";
  return "zinc";
}

export default async function Home() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_15%_-10%,#cffafe_0%,transparent_55%),radial-gradient(900px_circle_at_85%_0%,#fde68a_0%,transparent_50%),linear-gradient(180deg,#fafafa_0%,#ffffff_55%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">GAME DEV MEMORY</p>
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
                  A tenant-scoped memory graph for your agents.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-zinc-600">
                  Capture session logs, build errors, playtest notes, and large artifacts. Retrieve fast by project,
                  tags, and time, then evolve the system every session.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <SignInButton mode="modal">
                  <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
                    Create account
                  </button>
                </SignUpButton>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold text-zinc-900">Sources</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">Agent logs, diffs, traces, errors, playtests, assets.</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold text-zinc-900">Retrieval</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">Project scoped now; semantic search later.</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold text-zinc-900">Storage</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">Neon Postgres via Hyperdrive + R2 chunking.</p>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-8 text-center text-xs text-zinc-500">Sign in to select personal or org scope.</p>
        </div>
      </div>
    );
  }

  let projects: Project[] = [];
  let sessions: Session[] = [];
  let memories: Memory[] = [];
  let error: string | null = null;

  try {
    const projRes = await apiJson<{ projects: Project[] }>("/api/projects");
    projects = projRes.projects || [];

    const sessRes = await apiJson<{ sessions: Session[] }>("/api/sessions?limit=25");
    sessions = sessRes.sessions || [];

    const memRes = await apiJson<{ memories: Memory[] }>("/api/memories?limit=50");
    memories = memRes.memories || [];
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const openSessions = sessions.filter((s) => !s.ended_at);

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">GAME DEV MEMORY</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Memory Console</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Personal or org scoped. Neon (Hyperdrive) + R2. Agents evolve per session.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/research"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Research
            </Link>
            <OrganizationSwitcher
              appearance={{
                elements: {
                  rootBox: "rounded-full border border-zinc-300 bg-white px-2 py-1",
                },
              }}
            />
            <div className="rounded-full border border-zinc-300 bg-white px-2 py-1">
              <UserButton />
            </div>
          </div>
        </header>

        {error ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">API error</p>
            <p className="mt-1 break-words font-mono text-xs leading-5">{error}</p>
          </div>
        ) : null}

        <main className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-4">
            <Card title="Projects" hint={`${projects.length} total`}>
              {projects.length === 0 ? (
                <p className="text-sm text-zinc-600">Create your first project to start tracking memories.</p>
              ) : (
                <ul className="space-y-3">
                  {projects.map((p) => (
                    <li key={p.id} className="rounded-xl border border-zinc-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-950">{p.name}</p>
                          <p className="mt-1 text-xs text-zinc-600">{p.description || "No description"}</p>
                        </div>
                        <Pill tone="sky">{p.engine}</Pill>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-[11px] text-zinc-500">Updated {fmt(p.updated_at)}</p>
                        <form action={startSession}>
                          <input type="hidden" name="project_id" value={p.id} />
                          <input type="hidden" name="kind" value="coding" />
                          <button className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-50">
                            Start session
                          </button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="New project" hint="Tenant scoped">
              <form action={createProject} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700" htmlFor="project-name">
                    Name
                  </label>
                  <input
                    id="project-name"
                    name="name"
                    placeholder="UE5 Shooter Prototype"
                    className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-700" htmlFor="project-engine">
                      Engine
                    </label>
                    <select
                      id="project-engine"
                      name="engine"
                      className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                      defaultValue="unreal"
                    >
                      <option value="unreal">unreal</option>
                      <option value="unity">unity</option>
                      <option value="godot">godot</option>
                      <option value="custom">custom</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-700" htmlFor="project-desc">
                      Description
                    </label>
                    <input
                      id="project-desc"
                      name="description"
                      placeholder="Goals, constraints, pipeline notes"
                      className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                    />
                  </div>
                </div>
                <button className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800">
                  Create project
                </button>
              </form>
            </Card>

            <Card title="Sessions" hint={`${openSessions.length} active`}>
              {sessions.length === 0 ? (
                <p className="text-sm text-zinc-600">No sessions yet. Start one from a project card.</p>
              ) : (
                <ul className="space-y-2">
                  {sessions.slice(0, 12).map((s) => {
                    const proj = projectById.get(s.project_id);
                    const isOpen = !s.ended_at;
                    return (
                      <li key={s.id} className="rounded-xl border border-zinc-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-zinc-950">
                              {proj ? proj.name : s.project_id} <span className="font-normal text-zinc-500">({s.kind})</span>
                            </p>
                            <p className="mt-1 text-[11px] text-zinc-500">Started {fmt(s.started_at)}</p>
                            {s.ended_at ? <p className="text-[11px] text-zinc-500">Ended {fmt(s.ended_at)}</p> : null}
                          </div>
                          {isOpen ? (
                            <form action={closeSession}>
                              <input type="hidden" name="session_id" value={s.id} />
                              <button className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-50">
                                Close
                              </button>
                            </form>
                          ) : (
                            <Pill tone="emerald">closed</Pill>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6 lg:col-span-8">
            <Card title="New memory" hint="Write notes, bugs, decisions, patterns">
              {projects.length === 0 ? (
                <p className="text-sm text-zinc-600">Create a project first.</p>
              ) : (
                <form action={createMemory} className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700" htmlFor="mem-project">
                        Project
                      </label>
                      <select
                        id="mem-project"
                        name="project_id"
                        className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700" htmlFor="mem-session">
                        Session (optional)
                      </label>
                      <select
                        id="mem-session"
                        name="session_id"
                        className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                        defaultValue=""
                      >
                        <option value="">None</option>
                        {openSessions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {projectById.get(s.project_id)?.name || s.project_id} ({s.kind})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700" htmlFor="mem-category">
                        Category
                      </label>
                      <select
                        id="mem-category"
                        name="category"
                        className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                        defaultValue="note"
                      >
                        <option value="note">note</option>
                        <option value="bug">bug</option>
                        <option value="decision">decision</option>
                        <option value="pattern">pattern</option>
                        <option value="architecture">architecture</option>
                        <option value="asset">asset</option>
                        <option value="lesson">lesson</option>
                        <option value="summary">summary</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700" htmlFor="mem-tags">
                        Tags
                      </label>
                      <input
                        id="mem-tags"
                        name="tags"
                        placeholder="comma, separated, tags"
                        className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-700" htmlFor="mem-title">
                      Title
                    </label>
                    <input
                      id="mem-title"
                      name="title"
                      placeholder="Fixed shader compile crash on DX12"
                      className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-700" htmlFor="mem-content">
                      Content
                    </label>
                    <textarea
                      id="mem-content"
                      name="content"
                      placeholder="What happened, why it happened, and the fix..."
                      className="min-h-28 w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                    />
                  </div>

                  <button className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800">
                    Add memory
                  </button>
                </form>
              )}
            </Card>

            <Card title="Recent memories" hint={`${memories.length} loaded`}>
              {memories.length === 0 ? (
                <p className="text-sm text-zinc-600">No memories yet.</p>
              ) : (
                <ul className="space-y-3">
                  {memories.slice(0, 30).map((m) => {
                    const proj = projectById.get(m.project_id);
                    const tags = normalizeTags(m.tags);
                    return (
                      <li key={m.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill tone={categoryTone(m.category)}>{m.category}</Pill>
                          {proj ? <Pill tone="sky">{proj.name}</Pill> : null}
                          <span className="text-[11px] text-zinc-500">Updated {fmt(m.updated_at)}</span>
                          <span className="text-[11px] text-zinc-500">Access {m.access_count}</span>
                          <span className="text-[11px] text-zinc-500">Conf {Math.round(m.confidence * 100)}%</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-zinc-950">{m.title}</p>
                        <p className="mt-1 line-clamp-4 text-sm leading-6 text-zinc-700">{m.content}</p>
                        {tags.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {tags.slice(0, 10).map((t) => (
                              <Pill key={t}>{t}</Pill>
                            ))}
                          </div>
                        ) : null}
                        {m.session_id ? <p className="mt-2 text-[11px] text-zinc-500">Session {m.session_id}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
