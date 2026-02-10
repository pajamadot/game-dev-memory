import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";
import { CopyTextButton } from "@/app/_components/CopyTextButton";

export const dynamic = "force-dynamic";

type ArtifactRow = {
  id: string;
  project_id: string;
  session_id: string | null;
  type: string;
  storage_mode: string;
  content_type: string;
  byte_size: number;
  r2_key: string | null;
  r2_prefix: string | null;
  metadata?: unknown;
  created_at: string;
  created_by: string | null;
};

type PageIndexNodePath = { node_id: string; title: string };

type PageIndexNodeResponse = {
  ok: true;
  artifact_id: string;
  project_id: string;
  node_id: string;
  path: PageIndexNodePath[];
  node: Record<string, any>;
  children: Array<{ node_id: string; title: string }>;
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

function safeNodeTitle(node: Record<string, any> | null | undefined): string {
  if (!node) return "Document node";
  const t = typeof node.title === "string" ? node.title.trim() : "";
  if (t) return t;
  const id = typeof node.node_id === "string" ? node.node_id.trim() : "";
  return id ? `Node ${id}` : "Document node";
}

function nodeCopyText(data: PageIndexNodeResponse): string {
  const lines: string[] = [];
  lines.push(`doc:${data.artifact_id}#${data.node_id}`);
  if (data.path && data.path.length) lines.push(`path: ${data.path.map((p) => p.title || p.node_id).filter(Boolean).join(" > ")}`);
  lines.push("");

  const node = data.node || {};
  const fields = ["summary", "prefix_summary", "text", "excerpt", "line_num", "start_index", "end_index"];
  for (const f of fields) {
    const v = (node as any)[f];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    lines.push(`${f}:`);
    lines.push(typeof v === "string" ? v : JSON.stringify(v, null, 2));
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export default async function ArtifactNodePage(props: {
  params: Promise<{ id: string }> | { id: string };
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const { userId } = await auth();
  const params = "then" in (props.params as any) ? await (props.params as Promise<{ id: string }>) : (props.params as { id: string });
  const id = String(params.id || "").trim();

  const sp =
    props.searchParams && "then" in (props.searchParams as any)
      ? await (props.searchParams as Promise<Record<string, string | string[] | undefined>>)
      : (props.searchParams as Record<string, string | string[] | undefined> | undefined);

  const node = normalizeStr(Array.isArray(sp?.node) ? sp?.node[0] : sp?.node) || normalizeStr(Array.isArray(sp?.node_id) ? sp?.node_id[0] : sp?.node_id);

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">DOC</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Documents are tenant-scoped. Sign in to view this document node.</p>
            <div className="mt-6 flex items-center gap-3">
              <SignInButton mode="modal">
                <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                  Sign in
                </button>
              </SignInButton>
              <Link
                href="/agent/streaming/sessions"
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Agent sessions
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  let artifact: ArtifactRow | null = null;
  let artifactError: string | null = null;
  try {
    // Avoid downloading large pageindex metadata when rendering a single node view.
    artifact = await apiJson<ArtifactRow>(`/api/artifacts/${encodeURIComponent(id)}?include_metadata=0`);
  } catch (e) {
    artifactError = e instanceof Error ? e.message : String(e);
  }

  let nodeData: PageIndexNodeResponse | null = null;
  let nodeError: string | null = null;

  if (artifact && node) {
    try {
      nodeData = await apiJson<PageIndexNodeResponse>(`/api/artifacts/${encodeURIComponent(id)}/pageindex/node/${encodeURIComponent(node)}`);
    } catch (e) {
      nodeError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!artifact) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-8 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">DOC</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Not found</h1>
            {artifactError ? <p className="mt-2 break-words font-mono text-xs text-zinc-600">{artifactError}</p> : null}
            <div className="mt-6 flex items-center gap-3">
              <Link
                href="/agent/streaming/sessions"
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Agent sessions
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

  const title = nodeData ? safeNodeTitle(nodeData.node) : artifact.type || "Document";
  const copyText = nodeData ? nodeCopyText(nodeData) : `artifact_id=${artifact.id}\nproject_id=${artifact.project_id}\n`;

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">DOC</p>
            <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>
            <p className="mt-1 text-xs text-zinc-600">
              artifact {artifact.id} | {artifact.content_type} | {bytes(Number(artifact.byte_size || 0))} | created {fmt(artifact.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {nodeData ? <CopyTextButton text={copyText} label="Copy for LLM" /> : null}
            <Link
              href="/agent/streaming/sessions"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Agent
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
          {node ? (
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Node</h2>
              {nodeError ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">Error</p>
                  <p className="mt-1 break-words font-mono text-xs leading-5">{nodeError}</p>
                </div>
              ) : nodeData ? (
                <>
                  {nodeData.path && nodeData.path.length ? (
                    <p className="mt-2 text-xs text-zinc-700">
                      path: {nodeData.path.map((p) => p.title || p.node_id).filter(Boolean).join(" > ")}
                    </p>
                  ) : null}

                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-[11px] font-semibold text-zinc-900">Summary</p>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-700">
                        {typeof nodeData.node.summary === "string" && nodeData.node.summary.trim()
                          ? nodeData.node.summary
                          : "No summary."}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-[11px] font-semibold text-zinc-900">Prefix summary</p>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-700">
                        {typeof nodeData.node.prefix_summary === "string" && nodeData.node.prefix_summary.trim()
                          ? nodeData.node.prefix_summary
                          : "No prefix summary."}
                      </p>
                    </div>
                  </div>

                  {typeof nodeData.node.text === "string" && nodeData.node.text.trim() ? (
                    <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-[11px] font-semibold text-zinc-900">Text</p>
                      <pre className="mt-2 overflow-auto rounded-xl bg-zinc-950 px-4 py-3 font-mono text-[12px] leading-5 text-zinc-50">
{nodeData.node.text}
                      </pre>
                    </div>
                  ) : null}

                  {nodeData.children && nodeData.children.length ? (
                    <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-[11px] font-semibold text-zinc-900">Children</p>
                      <ul className="mt-2 space-y-1 text-xs text-zinc-700">
                        {nodeData.children.slice(0, 40).map((c) => (
                          <li key={c.node_id} className="font-mono">
                            <Link
                              href={`/artifacts/${encodeURIComponent(artifact.id)}?node=${encodeURIComponent(c.node_id)}`}
                              className="underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                            >
                              {c.node_id}
                            </Link>{" "}
                            <span className="text-zinc-500">{c.title}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-sm text-zinc-600">Loading node...</p>
              )}
            </section>
          ) : (
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Open a referenced node</h2>
              <p className="mt-2 text-sm text-zinc-700">
                This page is meant to be linked from agent evidence like <span className="font-mono">doc:&lt;artifact&gt;#&lt;node&gt;</span>.
              </p>
              <p className="mt-3 text-xs text-zinc-600">
                Tip: open from the agent evidence panel, or add <span className="font-mono">?node=0001</span> to the URL.
              </p>
            </section>
          )}

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Artifact</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-[11px] font-semibold text-zinc-900">IDs</p>
                <p className="mt-2 break-words font-mono text-xs text-zinc-700">artifact_id={artifact.id}</p>
                <p className="mt-1 break-words font-mono text-xs text-zinc-700">project_id={artifact.project_id}</p>
                {artifact.session_id ? <p className="mt-1 break-words font-mono text-xs text-zinc-700">session_id={artifact.session_id}</p> : null}
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-[11px] font-semibold text-zinc-900">Storage</p>
                <p className="mt-2 text-xs text-zinc-700">storage_mode={artifact.storage_mode}</p>
                {artifact.r2_key ? <p className="mt-1 break-words font-mono text-xs text-zinc-700">r2_key={artifact.r2_key}</p> : null}
                {artifact.r2_prefix ? <p className="mt-1 break-words font-mono text-xs text-zinc-700">r2_prefix={artifact.r2_prefix}</p> : null}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
