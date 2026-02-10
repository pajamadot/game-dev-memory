import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";

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
  let error: string | null = null;

  try {
    memory = await apiJson<MemoryRow>(`/api/memories/${encodeURIComponent(id)}`);
    const aRes = await apiJson<{ assets: AssetRow[] }>(`/api/assets?memory_id=${encodeURIComponent(id)}&limit=100`);
    assets = aRes.assets || [];
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
        </main>
      </div>
    </div>
  );
}

