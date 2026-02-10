import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default async function ProAgentLandingPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT PRO</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Project Memory Pro Agent</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Container-backed agent sessions (Cloudflare Sandbox) with streaming progress and evidence.
            </p>
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

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT PRO</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Project Memory Pro Agent</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Professional, streaming agent sessions built on the Memory API. Org scope is shared; personal scope stays private.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/agent/pro/sessions"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Pro sessions
            </Link>
            <Link
              href="/agent"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Standard agent
            </Link>
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Console
            </Link>
          </div>
        </header>

        <main className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="lg:col-span-7">
            <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-8 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">What this is</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-700">
                A container-backed agent runtime (Cloudflare Sandbox Containers) that can stream progress while it retrieves evidence
                from your project memory and generates a cited answer.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs text-zinc-700">
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">Streaming SSE</span>
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">Evidence pointers</span>
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">Session persistence</span>
                <span className="rounded-full border border-zinc-200 bg-white px-3 py-1">Org shared + personal private</span>
              </div>
              <div className="mt-6">
                <Link
                  href="/agent/pro/sessions"
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Open pro sessions
                </Link>
              </div>
            </div>
          </section>

          <section className="lg:col-span-5">
            <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-8 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">When to use Pro</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-700">
                <li>Longer investigations (multi-turn sessions).</li>
                <li>When you want streaming progress instead of request/refresh.</li>
                <li>When you want a production-ready path to “tools” in a sandboxed runtime.</li>
              </ul>
              <div className="mt-6 text-xs text-zinc-600">
                Note: this is intentionally built on top of the Memory API (core), not a separate data store.
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

