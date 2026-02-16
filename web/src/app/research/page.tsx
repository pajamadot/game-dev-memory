import Link from "next/link";

export const dynamic = "force-static";

export default function ResearchIndexPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">RESEARCH</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Library</h1>
            <p className="mt-1 text-sm text-zinc-600">Project memory research notes and living docs.</p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Back to console
          </Link>
        </header>

        <main className="mt-8 grid grid-cols-1 gap-4">
          <Link
            href="/research/agent-memory"
            className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur hover:bg-white"
          >
            <p className="text-sm font-semibold text-zinc-950">Agent Memory</p>
            <p className="mt-1 text-sm text-zinc-600">Taxonomy, ingestion, retrieval, and evolution loops for agents.</p>
          </Link>

          <Link
            href="/research/unreal-agents"
            className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur hover:bg-white"
          >
            <p className="text-sm font-semibold text-zinc-950">Unreal Agents</p>
            <p className="mt-1 text-sm text-zinc-600">
              Unreal Engine + AI agent workflows, plus daily cron-generated digests.
            </p>
          </Link>

          <Link
            href="/research/pageindex"
            className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur hover:bg-white"
          >
            <p className="text-sm font-semibold text-zinc-950">PageIndex</p>
            <p className="mt-1 text-sm text-zinc-600">Document indexing for long specs/manuals (TOC-like tree + section retrieval).</p>
          </Link>

          <Link
            href="/research/evermemos"
            className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur hover:bg-white"
          >
            <p className="text-sm font-semibold text-zinc-950">EverMemOS Adaptation</p>
            <p className="mt-1 text-sm text-zinc-600">Structured event-log + foresight derivation for long-term agent memory.</p>
          </Link>

          <Link
            href="/research/new-projects"
            className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur hover:bg-white"
          >
            <p className="text-sm font-semibold text-zinc-950">New Projects Radar</p>
            <p className="mt-1 text-sm text-zinc-600">
              Daily discovery loop for new tools/projects, automatically converted into org/person memory.
            </p>
          </Link>
        </main>
      </div>
    </div>
  );
}
