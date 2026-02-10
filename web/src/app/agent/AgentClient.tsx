"use client";

import Link from "next/link";
import { useActionState } from "react";
import { askProjectMemoryAgent, saveAgentAnswerAsMemory, type AskAgentState, type SaveAgentState } from "./actions";

type ProjectRow = {
  id: string;
  name: string;
  engine: string;
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

export function AgentClient(props: { projects: ProjectRow[] }) {
  const [state, formAction] = useActionState<AskAgentState | null, FormData>(askProjectMemoryAgent, null);
  const [saveState, saveAction] = useActionState<SaveAgentState | null, FormData>(saveAgentAnswerAsMemory, null);

  const ok = state && (state as any).ok === true;
  const err = state && (state as any).ok === false ? (state as any).error : null;

  const hasAnswer = Boolean(ok && (state as any).answer);
  const retrievedMemoryIds: string[] = ok ? ((state as any).retrieved.memories || []).map((m: any) => String(m.id)) : [];
  const retrievedAssetIds: string[] = (() => {
    if (!ok) return [];
    const idx = ((state as any).retrieved.assets_index || {}) as Record<string, any[]>;
    const out: string[] = [];
    for (const assets of Object.values(idx)) {
      for (const a of assets || []) {
        const id = String((a as any).id || "");
        if (!id) continue;
        if (out.includes(id)) continue;
        out.push(id);
        if (out.length >= 200) return out;
      }
    }
    return out;
  })();
  const retrievedDocRefs: string[] = (() => {
    if (!ok) return [];
    const docs = ((state as any).retrieved.documents || []) as any[];
    const out: string[] = [];
    for (const d of docs) {
      const aid = String((d as any).artifact_id || "");
      const nid = String((d as any).node_id || "");
      if (!aid || !nid) continue;
      const ref = `${aid}#${nid}`;
      if (out.includes(ref)) continue;
      out.push(ref);
      if (out.length >= 200) return out;
    }
    return out;
  })();

  const saveOk = saveState && (saveState as any).ok === true;
  const saveErr = saveState && (saveState as any).ok === false ? (saveState as any).error : null;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Ask</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-600">
          Retrieval-first assistant that searches your tenant memory (personal or org). If an LLM is configured on the API, it will also
          synthesize an answer with citations.
        </p>

        <form action={formAction} className="mt-5 grid grid-cols-1 gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <div className="sm:col-span-3">
              <label className="text-xs font-medium text-zinc-700" htmlFor="agent-project">
                Project scope (optional)
              </label>
              <select
                id="agent-project"
                name="project_id"
                className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                defaultValue=""
              >
                <option value="">All projects</option>
                {props.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.engine})
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <p className="text-xs font-medium text-zinc-700">Options</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-700">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" name="include_assets" defaultChecked className="h-4 w-4 rounded border-zinc-300" />
                  Include assets
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" name="include_documents" defaultChecked className="h-4 w-4 rounded border-zinc-300" />
                  Include documents
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" name="dry_run" className="h-4 w-4 rounded border-zinc-300" />
                  Retrieval only
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-700" htmlFor="agent-query">
              Question
            </label>
            <textarea
              id="agent-query"
              name="query"
              rows={4}
              placeholder="e.g. Why are we seeing shader compile stalls in UE5 editor, and what did we try last time?"
              className="mt-1 w-full resize-y rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-900/10 focus:ring-4"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <button className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800">
              Ask agent
            </button>
            {ok ? (
              <p className="text-[11px] text-zinc-500">
                Provider: {(state as any).provider.kind}
                {(state as any).provider.model ? ` (${(state as any).provider.model})` : ""}
              </p>
            ) : null}
          </div>
        </form>

        {err ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Agent error</p>
            <p className="mt-1 break-words font-mono text-xs leading-5">{err}</p>
          </div>
        ) : null}
      </section>

      {ok ? (
        <>
          {(state as any).answer ? (
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Answer</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{(state as any).answer}</p>
              {(state as any).notes && (state as any).notes.length ? (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-zinc-600">
                  {(state as any).notes.map((n: string) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : (
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Answer</h2>
              <p className="mt-2 text-sm text-zinc-600">
                No synthesis answer returned. This usually means LLM is not configured on the API (or you checked Retrieval only).
              </p>
            </section>
          )}

          {hasAnswer ? (
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Save As Memory</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-600">
                Turn this answer into durable project memory so it can be retrieved later (and shared with your org).
              </p>

              <form action={saveAction} className="mt-5 grid grid-cols-1 gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                  <div className="sm:col-span-3">
                    <label className="text-xs font-medium text-zinc-700" htmlFor="save-project">
                      Project (required)
                    </label>
                    <select
                      id="save-project"
                      name="project_id"
                      required
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                      defaultValue={(state as any).project_id || ""}
                    >
                      <option value="">Select a project</option>
                      {props.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.engine})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-zinc-700" htmlFor="save-category">
                      Category
                    </label>
                    <select
                      id="save-category"
                      name="category"
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                      defaultValue="summary"
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
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                  <div className="sm:col-span-3">
                    <label className="text-xs font-medium text-zinc-700" htmlFor="save-title">
                      Title
                    </label>
                    <input
                      id="save-title"
                      name="title"
                      required
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                      defaultValue={`Agent: ${String((state as any).query || "").slice(0, 120)}`}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-zinc-700" htmlFor="save-tags">
                      Tags
                    </label>
                    <input
                      id="save-tags"
                      name="tags"
                      className="mt-1 h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                      defaultValue="agent"
                    />
                  </div>
                </div>

                <input type="hidden" name="query" value={String((state as any).query || "")} />
                <input type="hidden" name="answer" value={String((state as any).answer || "")} />
                <input type="hidden" name="retrieved_memories_json" value={JSON.stringify(retrievedMemoryIds)} />
                <input type="hidden" name="retrieved_assets_json" value={JSON.stringify(retrievedAssetIds)} />
                <input type="hidden" name="retrieved_docs_json" value={JSON.stringify(retrievedDocRefs)} />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800">
                    Save memory
                  </button>
                  {saveOk ? (
                    <Link
                      href={`/memories/${(saveState as any).memory_id}`}
                      className="text-xs font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                    >
                      Saved: view memory
                    </Link>
                  ) : null}
                </div>

                {saveErr ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">Save error</p>
                    <p className="mt-1 break-words font-mono text-xs leading-5">{saveErr}</p>
                  </div>
                ) : null}
              </form>
            </section>
          ) : null}

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Retrieved Evidence</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-600">Memories (and linked assets) the agent used as context.</p>

            {(state as any).retrieved.memories.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-600">No memories matched. Consider recording a memory and attaching logs as assets.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {(state as any).retrieved.memories.map((m: any) => {
                  const assets = ((state as any).retrieved.assets_index || {})[m.id] || [];
                  return (
                    <li key={m.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <Link
                            href={`/memories/${m.id}`}
                            className="text-sm font-semibold text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                          >
                            {m.title}
                          </Link>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                            <span className="font-mono">{m.id}</span>
                            <span>{m.category}</span>
                            <span>Conf {Math.round(Number(m.confidence) * 100)}%</span>
                            <span>Updated {fmt(m.updated_at)}</span>
                          </div>
                        </div>
                      </div>
                      {m.content_excerpt ? <p className="mt-3 text-xs leading-5 text-zinc-700">{m.content_excerpt}</p> : null}
                      {m.tags && m.tags.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {m.tags.slice(0, 12).map((t: string) => (
                            <span key={t} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {assets.length ? (
                        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                          <p className="text-[11px] font-semibold text-zinc-900">Linked assets</p>
                          <ul className="mt-2 space-y-1 text-[11px] text-zinc-700">
                            {assets.slice(0, 8).map((a: any) => (
                              <li key={a.id} className="font-mono">
                                <Link
                                  href={`/assets/${a.id}`}
                                  className="underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                                >
                                  {a.original_name || "asset"}
                                </Link>{" "}
                                ({a.content_type}, {bytes(a.byte_size)}) [{a.status}] id={a.id}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {ok && ((state as any).retrieved.documents || []).length ? (
              <div className="mt-6 rounded-3xl border border-zinc-200 bg-white p-5">
                <p className="text-sm font-semibold text-zinc-950">Documents</p>
                <p className="mt-1 text-xs text-zinc-600">PageIndex-based matches from indexed artifacts.</p>
                <ul className="mt-3 space-y-2">
                  {((state as any).retrieved.documents || []).slice(0, 12).map((d: any) => (
                    <li key={`${d.artifact_id}#${d.node_id}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                        <p className="text-sm font-semibold text-zinc-950">{String(d.title || "Document section")}</p>
                        <p className="text-[11px] text-zinc-500">score={Number(d.score || 0).toFixed(0)}</p>
                      </div>
                      <p className="mt-2 break-words font-mono text-xs text-zinc-700">
                        doc={String(d.artifact_id || "")}#{String(d.node_id || "")}
                      </p>
                      {d.path && Array.isArray(d.path) && d.path.length ? (
                        <p className="mt-1 text-xs text-zinc-700">path: {d.path.slice(-5).join(" > ")}</p>
                      ) : null}
                      {d.excerpt ? <p className="mt-3 text-xs leading-5 text-zinc-700">{String(d.excerpt).slice(0, 900)}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
