import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";
import { linkMemoryAction, setMemoryLifecycleAction } from "./actions";

export const dynamic = "force-dynamic";

type MemoryRow = {
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
  state?: string;
  quality?: string;
  created_at: string;
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
};

type LinkRow = {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  metadata: unknown;
  created_at: string;
  created_by: string | null;
};

type LinksResponse = { inbound: LinkRow[]; outbound: LinkRow[] };

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

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default async function MemoryPage(props: { params: Promise<{ id: string }> | { id: string } }) {
  const { userId } = await auth();
  const params = "then" in (props.params as any) ? await (props.params as Promise<{ id: string }>) : (props.params as { id: string });
  const id = String(params.id || "").trim();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">MEMORY</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Memories are tenant-scoped. Sign in to view this memory.</p>
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

  let memory: MemoryRow | null = null;
  let assets: AssetRow[] = [];
  let links: LinksResponse | null = null;
  let error: string | null = null;

  try {
    memory = await apiJson<MemoryRow>(`/api/memories/${encodeURIComponent(id)}`);
    const aRes = await apiJson<{ assets: AssetRow[] }>(`/api/assets?memory_id=${encodeURIComponent(id)}&limit=100`);
    assets = aRes.assets || [];
    links = await apiJson<LinksResponse>(`/api/memories/${encodeURIComponent(id)}/links`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (!memory) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-8 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">MEMORY</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Not found</h1>
            {error ? <p className="mt-2 break-words font-mono text-xs text-zinc-600">{error}</p> : null}
            <div className="mt-6 flex items-center gap-3">
              <Link
                href="/agent"
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Back to agent
              </Link>
              <Link
                href="/"
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Console
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tags = normalizeTags(memory.tags);
  const state = String(memory.state || "active");
  const quality = String(memory.quality || "unknown");
  const stateTone =
    state === "quarantined"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : state === "superseded"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">MEMORY</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{memory.title}</h1>
            <p className="mt-1 text-xs text-zinc-600">
              {memory.category} · conf {Math.round(Number(memory.confidence || 0) * 100)}% · updated {fmt(memory.updated_at)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${stateTone}`}>
                state: {state}
              </span>
              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-700">
                quality: {quality}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/agent"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back to agent
            </Link>
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Console
            </Link>
          </div>
        </header>

        <main className="mt-8 space-y-6">
          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Memory Controls</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              Lifecycle controls help prevent outdated or harmful memories from being retrieved by the agent.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {state === "active" ? (
                <form action={setMemoryLifecycleAction}>
                  <input type="hidden" name="memory_id" value={memory.id} />
                  <input type="hidden" name="state" value="quarantined" />
                  <button className="inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-900 hover:bg-rose-100">
                    Quarantine
                  </button>
                </form>
              ) : (
                <form action={setMemoryLifecycleAction}>
                  <input type="hidden" name="memory_id" value={memory.id} />
                  <input type="hidden" name="state" value="active" />
                  <button className="inline-flex h-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-900 hover:bg-emerald-100">
                    Restore to active
                  </button>
                </form>
              )}

              <form action={setMemoryLifecycleAction}>
                <input type="hidden" name="memory_id" value={memory.id} />
                <input type="hidden" name="quality" value="good" />
                <button className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
                  Mark good
                </button>
              </form>
              <form action={setMemoryLifecycleAction}>
                <input type="hidden" name="memory_id" value={memory.id} />
                <input type="hidden" name="state" value="quarantined" />
                <input type="hidden" name="quality" value="bad" />
                <button className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
                  Mark bad
                </button>
              </form>
              <form action={setMemoryLifecycleAction}>
                <input type="hidden" name="memory_id" value={memory.id} />
                <input type="hidden" name="quality" value="unknown" />
                <button className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
                  Clear quality
                </button>
              </form>
            </div>

            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4">
              <p className="text-[11px] font-semibold text-zinc-900">Link this memory to another memory</p>
              <p className="mt-1 text-xs text-zinc-600">
                Example: create a <span className="font-mono">supersedes</span> link to mark an older memory as superseded.
              </p>
              <form action={linkMemoryAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-6">
                <input type="hidden" name="from_memory_id" value={memory.id} />
                <div className="sm:col-span-4">
                  <label className="text-xs font-medium text-zinc-700" htmlFor="to-memory-id">
                    Target memory id
                  </label>
                  <input
                    id="to-memory-id"
                    name="to_memory_id"
                    placeholder="UUID of the other memory"
                    className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm font-mono outline-none ring-zinc-900/10 focus:ring-4"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-zinc-700" htmlFor="relation">
                    Relation
                  </label>
                  <select
                    id="relation"
                    name="relation"
                    className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                    defaultValue="related"
                  >
                    <option value="related">related</option>
                    <option value="supports">supports</option>
                    <option value="contradicts">contradicts</option>
                    <option value="supersedes">supersedes</option>
                  </select>
                </div>
                <div className="sm:col-span-6">
                  <button className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800">
                    Create link
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Details</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-[11px] font-semibold text-zinc-900">IDs</p>
                <p className="mt-2 break-words font-mono text-xs text-zinc-700">memory_id={memory.id}</p>
                <p className="mt-1 break-words font-mono text-xs text-zinc-700">project_id={memory.project_id}</p>
                {memory.session_id ? <p className="mt-1 break-words font-mono text-xs text-zinc-700">session_id={memory.session_id}</p> : null}
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-[11px] font-semibold text-zinc-900">Meta</p>
                <p className="mt-2 text-xs text-zinc-700">source_type={memory.source_type}</p>
                <p className="mt-1 text-xs text-zinc-700">access_count={memory.access_count}</p>
                <p className="mt-1 text-xs text-zinc-700">created_at={fmt(memory.created_at)}</p>
              </div>
            </div>
            {tags.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {tags.slice(0, 32).map((t) => (
                  <span key={t} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Content</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{memory.content}</p>
          </section>

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Linked Assets</h2>
            <p className="mt-1 text-xs text-zinc-600">Assets linked to this memory (metadata only).</p>
            {assets.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-600">No linked assets.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {assets.slice(0, 50).map((a) => (
                  <li key={a.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                      <p className="text-sm font-semibold text-zinc-950">{a.original_name || "asset"}</p>
                      <p className="text-[11px] text-zinc-500">status={a.status}</p>
                    </div>
                    <p className="mt-2 break-words font-mono text-xs text-zinc-700">asset_id={a.id}</p>
                    <p className="mt-1 text-xs text-zinc-700">{a.content_type}</p>
                    <div className="mt-3">
                      <Link
                        href={`/assets/${a.id}`}
                        className="text-xs font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                      >
                        View asset
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Linked Memories</h2>
            <p className="mt-1 text-xs text-zinc-600">
              Memory-to-memory relationships (e.g. <span className="font-mono">supersedes</span>) to keep retrieval clean and auditable.
            </p>

            {!links ? (
              <p className="mt-4 text-sm text-zinc-600">No link data.</p>
            ) : links.outbound.length === 0 && links.inbound.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-600">No linked memories.</p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-[11px] font-semibold text-zinc-900">Outbound</p>
                  {links.outbound.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-600">None</p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-xs text-zinc-700">
                      {links.outbound.slice(0, 20).map((l) => (
                        <li key={l.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                          <p className="font-mono text-[11px] text-zinc-600">relation={l.relation}</p>
                          <Link
                            href={`/memories/${l.to_id}`}
                            className="mt-1 inline-block font-mono text-xs text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                          >
                            to: {l.to_id}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-[11px] font-semibold text-zinc-900">Inbound</p>
                  {links.inbound.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-600">None</p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-xs text-zinc-700">
                      {links.inbound.slice(0, 20).map((l) => (
                        <li key={l.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                          <p className="font-mono text-[11px] text-zinc-600">relation={l.relation}</p>
                          <Link
                            href={`/memories/${l.from_id}`}
                            className="mt-1 inline-block font-mono text-xs text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                          >
                            from: {l.from_id}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
