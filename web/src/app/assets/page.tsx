import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  name: string;
  engine: string;
};

type LinkedMemorySummary = {
  id: string;
  project_id: string;
  category: string;
  title: string;
  updated_at: string;
};

type AssetRow = {
  id: string;
  project_id: string;
  status: string;
  content_type: string;
  byte_size: number;
  original_name: string | null;
  created_at: string;
  updated_at: string;
  linked_memory_count?: number;
  linked_memories?: LinkedMemorySummary[];
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const p = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(p)} ${units[i]}`;
}

function normalizeStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export default async function AssetsIndexPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const { userId } = await auth();

  const sp =
    props.searchParams && "then" in (props.searchParams as any)
      ? await (props.searchParams as Promise<Record<string, string | string[] | undefined>>)
      : (props.searchParams as Record<string, string | string[] | undefined> | undefined);

  const project_id = normalizeStr(Array.isArray(sp?.project_id) ? sp?.project_id[0] : sp?.project_id);
  const status = normalizeStr(Array.isArray(sp?.status) ? sp?.status[0] : sp?.status);
  const memory_id = normalizeStr(Array.isArray(sp?.memory_id) ? sp?.memory_id[0] : sp?.memory_id);

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">FILES</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Files are tenant-scoped (org or personal). Sign in to browse your project assets.
            </p>
            <div className="mt-6 flex items-center gap-3">
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

  const projRes = await apiJson<{ projects: ProjectRow[] }>("/api/projects");
  const projects = projRes.projects || [];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const qs = new URLSearchParams();
  qs.set("limit", "200");
  qs.set("include_memory_links", "1");
  if (project_id) qs.set("project_id", project_id);
  if (status) qs.set("status", status);
  if (memory_id) qs.set("memory_id", memory_id);

  const assetsRes = await apiJson<{ assets: AssetRow[] }>(`/api/assets?${qs.toString()}`);
  const assets = assetsRes.assets || [];

  const titleProject = project_id ? projectById.get(project_id)?.name || "Unknown project" : "All projects";

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">FILES</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Project File Browser</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Browse large files stored in R2 (assets), and see which memories they are attached to.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Console
            </Link>
            <Link
              href="/agent"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Agent
            </Link>
            <Link
              href="/docs/cli"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              CLI Docs
            </Link>
          </div>
        </header>

        <main className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="lg:col-span-4">
            <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Filters</h2>
              <form method="get" className="mt-4 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700" htmlFor="assets-project">
                    Project
                  </label>
                  <select
                    id="assets-project"
                    name="project_id"
                    defaultValue={project_id}
                    className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                  >
                    <option value="">All projects</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.engine})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700" htmlFor="assets-status">
                    Status
                  </label>
                  <select
                    id="assets-status"
                    name="status"
                    defaultValue={status}
                    className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                  >
                    <option value="">Any</option>
                    <option value="ready">ready</option>
                    <option value="uploading">uploading</option>
                    <option value="failed">failed</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700" htmlFor="assets-memory">
                    Memory id (optional)
                  </label>
                  <input
                    id="assets-memory"
                    name="memory_id"
                    defaultValue={memory_id}
                    placeholder="Filter to files attached to a memory"
                    className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                  />
                </div>

                <button className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800">
                  Apply filters
                </button>
              </form>
            </div>

            <div className="mt-6 rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Upload</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-600">
                For large files (GBs), use the CLI multipart uploader. You can optionally attach a file to a memory.
              </p>
              <pre className="mt-3 overflow-auto rounded-2xl bg-zinc-950 px-4 py-3 font-mono text-[12px] leading-5 text-zinc-50">
npm i -g @pajamadot/pajama
pajama login
pajama assets upload --project-id &lt;PROJECT_ID&gt; --path &lt;FILE&gt; --memory-id &lt;MEMORY_ID&gt;
              </pre>
              <div className="mt-3">
                <Link
                  href="/docs/cli"
                  className="text-xs font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                >
                  Full CLI docs
                </Link>
              </div>
            </div>
          </section>

          <section className="lg:col-span-8">
            <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Files</h2>
                  <p className="mt-1 text-xs text-zinc-600">
                    {assets.length} shown | scope: {titleProject}
                  </p>
                </div>
              </div>

              {assets.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-600">No assets found for these filters.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {assets.slice(0, 200).map((a) => {
                    const proj = projectById.get(a.project_id);
                    const linked = Array.isArray(a.linked_memories) ? a.linked_memories : [];
                    const linkedCount = Number.isFinite(a.linked_memory_count as any)
                      ? Number(a.linked_memory_count)
                      : linked.length;

                    return (
                      <li key={a.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <Link
                              href={`/assets/${a.id}`}
                              className="text-sm font-semibold text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                            >
                              {a.original_name || a.id}
                            </Link>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                              <span className="font-mono">{a.id}</span>
                              {proj ? (
                                <span>
                                  {proj.name} ({proj.engine})
                                </span>
                              ) : (
                                <span className="font-mono">{a.project_id}</span>
                              )}
                              <span>{a.status}</span>
                              <span>{bytes(Number(a.byte_size || 0))}</span>
                              <span>{a.content_type}</span>
                              <span>Updated {fmt(a.updated_at)}</span>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
                              {linkedCount} memories
                            </span>
                          </div>
                        </div>

                        {linked.length ? (
                          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                            <p className="text-[11px] font-semibold text-zinc-900">Attached memories</p>
                            <ul className="mt-2 space-y-1 text-[11px] text-zinc-700">
                              {linked.slice(0, 4).map((m) => (
                                <li key={m.id}>
                                  <Link
                                    href={`/memories/${m.id}`}
                                    className="font-mono underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                                  >
                                    {m.id}
                                  </Link>{" "}
                                  <span className="text-zinc-500">[{m.category}]</span> {m.title}
                                </li>
                              ))}
                            </ul>
                            {linkedCount > linked.length ? (
                              <p className="mt-2 text-[11px] text-zinc-500">Showing {linked.length} of {linkedCount}.</p>
                            ) : null}
                          </div>
                        ) : null}
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

