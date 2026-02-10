import Link from "next/link";

export const dynamic = "force-dynamic";

export default function DocsIndexPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">DOCS</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Game Dev Memory</h1>
            <p className="mt-1 text-sm text-zinc-600">Install once. Auto sync your memory everywhere.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back to console
            </Link>
          </div>
        </header>

        <main className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-7 shadow-sm backdrop-blur lg:col-span-8">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Get started</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-700">
              The CLI is the fastest way to connect agents and developers to shared project memory (org scope) while keeping personal
              memory private.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Link
                href="/docs/cli"
                className="group rounded-2xl border border-zinc-200 bg-white p-5 hover:border-zinc-300"
              >
                <p className="text-xs font-semibold tracking-[0.2em] text-zinc-500">DOC</p>
                <p className="mt-2 text-base font-semibold text-zinc-950">CLI</p>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Install `pajama`, log in with OAuth, and use API keys for headless agents.
                </p>
                <p className="mt-3 text-xs font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 group-hover:decoration-zinc-800">
                  Open CLI docs
                </p>
              </Link>

              <Link
                href="/docs/skills"
                className="group rounded-2xl border border-zinc-200 bg-white p-5 hover:border-zinc-300"
              >
                <p className="text-xs font-semibold tracking-[0.2em] text-zinc-500">DOC</p>
                <p className="mt-2 text-base font-semibold text-zinc-950">Skills</p>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Install public skills from this repo so agents can write and retrieve memory consistently.
                </p>
                <p className="mt-3 text-xs font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 group-hover:decoration-zinc-800">
                  Open skills docs
                </p>
              </Link>
            </div>
          </section>

          <aside className="space-y-6 lg:col-span-4">
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">What this is</h2>
              <p className="mt-2 text-xs leading-5 text-zinc-600">
                A memory API + MCP layer + agent UX for game development. Org scope is shared across project members; personal scope stays
                private.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-zinc-700">
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">Neon Postgres</span>
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">Hyperdrive</span>
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">R2 assets</span>
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">OAuth + API keys</span>
              </div>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}

