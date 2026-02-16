import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const dynamic = "force-static";

async function loadMarkdown(): Promise<string> {
  const mdPath = path.join(process.cwd(), "src", "content", "research", "evermemos.md");
  return await readFile(mdPath, "utf8");
}

export default async function EverMemOSResearchPage() {
  const markdown = await loadMarkdown();

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">RESEARCH</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">EverMemOS Adaptation</h1>
            <p className="mt-1 text-sm text-zinc-600">How we are adapting EverMemOS ideas into the game-dev memory platform.</p>
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

        <main className="mt-8">
          <article className="rounded-3xl border border-zinc-200/70 bg-white/70 p-7 shadow-sm backdrop-blur">
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
        </main>
      </div>
    </div>
  );
}
