import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson, clerkTenantHeaders } from "@/lib/memory-api";
import { CopyTextButton } from "@/app/_components/CopyTextButton";

export const dynamic = "force-dynamic";

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
  r2_bucket: string;
  r2_key: string;
  content_type: string;
  byte_size: number;
  sha256: string | null;
  original_name: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  linked_memory_count?: number;
  linked_memories?: LinkedMemorySummary[];
};

function apiBaseUrl(): string {
  return (
    process.env.MEMORY_API_URL ||
    process.env.NEXT_PUBLIC_MEMORY_API_URL ||
    "https://api-game-dev-memory.pajamadot.com"
  );
}

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

function isTextLikeContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  if (ct.startsWith("text/")) return true;
  if (ct.includes("json")) return true;
  if (ct.includes("xml")) return true;
  if (ct.includes("yaml") || ct.includes("yml")) return true;
  if (ct.includes("toml")) return true;
  if (ct.includes("javascript")) return true;
  if (ct.includes("typescript")) return true;
  if (ct.includes("csv")) return true;
  return false;
}

export default async function AssetPage(props: { params: Promise<{ id: string }> | { id: string } }) {
  const { userId } = await auth();
  const params = "then" in (props.params as any) ? await (props.params as Promise<{ id: string }>) : (props.params as { id: string });
  const id = String(params.id || "").trim();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">ASSET</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Assets are tenant-scoped. Sign in to view this asset.</p>
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

  let asset: AssetRow | null = null;
  let error: string | null = null;

  try {
    asset = await apiJson<AssetRow>(`/api/assets/${encodeURIComponent(id)}`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (!asset) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-8 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">ASSET</p>
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

  const name = asset.original_name || "asset";
  const linked = Array.isArray(asset.linked_memories) ? asset.linked_memories : [];
  const linkedCount = Number.isFinite(asset.linked_memory_count as any) ? Number(asset.linked_memory_count) : linked.length;

  const previewEligible = asset.status === "ready" && isTextLikeContentType(asset.content_type) && Number(asset.byte_size || 0) > 0;
  const previewMaxBytes = 64 * 1024;

  let previewText: string | null = null;
  let previewTruncated = false;
  let previewError: string | null = null;

  if (previewEligible) {
    try {
      const headers = await clerkTenantHeaders();
      const byteSize = Math.max(0, Math.trunc(Number(asset.byte_size || 0)));
      const end = Math.max(0, Math.min(byteSize, previewMaxBytes) - 1);
      const url = `${apiBaseUrl()}/api/assets/${encodeURIComponent(id)}/object?byte_start=0&byte_end=${end}`;
      const res = await fetch(url, { cache: "no-store", headers });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Preview fetch failed (${res.status}): ${text || res.statusText}`);
      }
      previewText = await res.text();
      previewTruncated = byteSize > previewMaxBytes;
    } catch (e) {
      previewError = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">ASSET</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{name}</h1>
            <p className="mt-1 text-xs text-zinc-600">
              {asset.content_type} | {bytes(Number(asset.byte_size || 0))} | status {asset.status}
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

        <main className="mt-8 space-y-6">
          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Details</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-[11px] font-semibold text-zinc-900">IDs</p>
                <p className="mt-2 break-words font-mono text-xs text-zinc-700">asset_id={asset.id}</p>
                <p className="mt-1 break-words font-mono text-xs text-zinc-700">project_id={asset.project_id}</p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-[11px] font-semibold text-zinc-900">Storage</p>
                <p className="mt-2 text-xs text-zinc-700">bucket={asset.r2_bucket}</p>
                <p className="mt-1 break-words font-mono text-xs text-zinc-700">r2_key={asset.r2_key}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
              <p className="text-[11px] font-semibold text-zinc-900">Meta</p>
              <p className="mt-2 text-xs text-zinc-700">created_at={fmt(asset.created_at)}</p>
              <p className="mt-1 text-xs text-zinc-700">updated_at={fmt(asset.updated_at)}</p>
              {asset.sha256 ? <p className="mt-1 break-words font-mono text-xs text-zinc-700">sha256={asset.sha256}</p> : null}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Attached Memories</h2>
            <p className="mt-1 text-xs text-zinc-600">Memories this file is linked to (evidence graph).</p>

            {linkedCount === 0 ? (
              <p className="mt-4 text-sm text-zinc-600">No linked memories.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {linked.slice(0, 50).map((m) => (
                  <li key={m.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                      <Link
                        href={`/memories/${m.id}`}
                        className="text-sm font-semibold text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                      >
                        {m.title}
                      </Link>
                      <p className="text-[11px] text-zinc-500">
                        {m.category} | updated {fmt(m.updated_at)}
                      </p>
                    </div>
                    <p className="mt-2 break-words font-mono text-xs text-zinc-700">{m.id}</p>
                  </li>
                ))}
              </ul>
            )}

            {linkedCount > linked.length ? (
              <p className="mt-3 text-xs text-zinc-500">Showing {linked.length} of {linkedCount} linked memories.</p>
            ) : null}
          </section>

          {previewEligible ? (
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Preview</h2>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">
                    First {bytes(previewMaxBytes)} (text-like assets only). {previewTruncated ? "Truncated." : ""}
                  </p>
                </div>
                {previewText ? <CopyTextButton text={previewText} label="Copy preview" /> : null}
              </div>

              {previewError ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  <p className="font-semibold">Preview failed</p>
                  <p className="mt-1 break-words font-mono">{previewError}</p>
                </div>
              ) : null}

              {previewText ? (
                <pre className="mt-4 max-h-[520px] overflow-auto rounded-2xl border border-zinc-200 bg-zinc-950 p-4 text-xs leading-5 text-zinc-100">
                  {previewText}
                </pre>
              ) : previewError ? null : (
                <p className="mt-4 text-sm text-zinc-600">No preview available.</p>
              )}
            </section>
          ) : null}

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Download</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Downloads require auth. Use the CLI or an API token to fetch <span className="font-mono">/api/assets/&lt;id&gt;/object</span>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
