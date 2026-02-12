import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { auth } from "@clerk/nextjs/server";
import { apiJson } from "@/lib/memory-api";
import { runNewProjectsDigest } from "../../actions";

export const dynamic = "force-dynamic";

async function loadMarkdown(): Promise<string> {
  const mdPath = path.join(process.cwd(), "src", "content", "research", "new-projects.md");
  return await readFile(mdPath, "utf8");
}

type Digest = {
  id: string;
  title: string;
  content: string;
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

export default async function NewProjectsResearchPage() {
  const markdown = await loadMarkdown();
  const { userId } = await auth();

  let digests: Digest[] = [];
  let digestError: string | null = null;

  if (userId) {
    try {
      const res = await apiJson<{ digests: Digest[] }>("/api/research/new-projects/digests?limit=10");
      digests = res.digests || [];
    } catch (e) {
      digestError = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">RESEARCH</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">New Projects Radar</h1>
            <p className="mt-1 text-sm text-zinc-600">Track new projects, launches, and tools and convert them into durable org memory.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/research"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              All research
            </Link>
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back to console
            </Link>
          </div>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <article className="rounded-3xl border border-zinc-200/70 bg-white/70 p-7 shadow-sm backdrop-blur lg:col-span-7">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: (props) => <h2 className="text-xl font-semibold tracking-tight text-zinc-950" {...props} />,
                h2: (props) => <h3 className="mt-6 text-lg font-semibold tracking-tight text-zinc-950" {...props} />,
                h3: (props) => <h4 className="mt-5 text-base font-semibold text-zinc-950" {...props} />,
                p: (props) => <p className="mt-3 text-sm leading-6 text-zinc-700" {...props} />,
                ul: (props) => <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700" {...props} />,
                ol: (props) => <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-700" {...props} />,
                li: (props) => <li className="leading-6" {...props} />,
                blockquote: (props) => (
                  <blockquote className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700" {...props} />
                ),
                a: ({ href, ...props }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                    {...props}
                  />
                ),
                code: ({ className, children, ...props }) => {
                  const isBlock = Boolean(className);
                  if (isBlock) {
                    return (
                      <pre className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-zinc-950 p-4 text-xs text-zinc-100">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    );
                  }
                  return (
                    <code className="rounded-md border border-zinc-200 bg-zinc-50 px-1 py-0.5 font-mono text-[12px]" {...props}>
                      {children}
                    </code>
                  );
                },
                hr: (props) => <hr className="my-6 border-zinc-200" {...props} />,
              }}
            >
              {markdown}
            </ReactMarkdown>
          </article>

          <aside className="space-y-6 lg:col-span-5">
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Daily Digest</h2>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">
                    Generated by the API worker cron and stored as `research` memories tagged `new-projects`.
                  </p>
                </div>
                {userId ? (
                  <form action={runNewProjectsDigest}>
                    <button className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
                      Run now
                    </button>
                  </form>
                ) : null}
              </div>

              {!userId ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">Sign in to view digests</p>
                  <p className="mt-1 text-xs leading-5 text-amber-900/80">
                    Digests are tenant-scoped (personal or org) and require auth.
                  </p>
                </div>
              ) : digestError ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">Digest load failed</p>
                  <p className="mt-1 break-words font-mono text-xs leading-5">{digestError}</p>
                </div>
              ) : digests.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-600">No digests yet. Click Run now or wait for the daily cron.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {digests.slice(0, 10).map((d) => (
                    <details key={d.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-zinc-950">{d.title}</p>
                            <p className="mt-1 text-[11px] text-zinc-500">Created {fmt(d.created_at)}</p>
                          </div>
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
                            digest
                          </span>
                        </div>
                      </summary>
                      <div className="mt-4">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: (props) => <h3 className="text-sm font-semibold text-zinc-950" {...props} />,
                            h2: (props) => <h4 className="mt-4 text-sm font-semibold text-zinc-950" {...props} />,
                            p: (props) => <p className="mt-2 text-xs leading-5 text-zinc-700" {...props} />,
                            ul: (props) => <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-700" {...props} />,
                            li: (props) => <li className="leading-5" {...props} />,
                            a: ({ href, ...props }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                                {...props}
                              />
                            ),
                          }}
                        >
                          {d.content}
                        </ReactMarkdown>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Related</h2>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                <Link className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800" href="/research/agent-memory">
                  Agent Memory research
                </Link>
                <Link className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800" href="/research/unreal-agents">
                  Unreal Agents research
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
