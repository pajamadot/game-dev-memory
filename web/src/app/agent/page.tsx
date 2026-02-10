import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { OrganizationSwitcher, SignInButton, UserButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";
import { AgentClient } from "./AgentClient";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  name: string;
  engine: string;
  description: string;
};

function ScopePill(props: { orgId: string | null }) {
  const isOrg = Boolean(props.orgId);
  const label = isOrg ? "Organization" : "Personal";
  const badge = isOrg ? "shared" : "private";
  const tone = isOrg ? "border-sky-200 bg-sky-50 text-sky-900" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {label} · {badge}
    </span>
  );
}

export default async function AgentPage() {
  const { userId, orgId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Project Memory Agent</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Sign in to ask questions against shared org memory or private personal memory.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <SignInButton mode="modal">
                <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                  Sign in
                </button>
              </SignInButton>
              <Link
                href="/"
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Back to console
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const res = await apiJson<{ projects: ProjectRow[] }>("/api/projects");
  const projects = res.projects || [];

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Project Memory Agent</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Built on the Memory API and MCP. Org scope is shared across your team; personal scope stays private.
            </p>
            {!orgId ? (
              <p className="mt-1 text-xs text-zinc-600">
                Tip: switch to an org to ask against shared project memory (use the org switcher on the right).
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ScopePill orgId={orgId ?? null} />
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back to console
            </Link>
            <Link
              href="/agent/sessions"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Sessions
            </Link>
            <Link
              href="/agent/pro/sessions"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Pro Sessions
            </Link>
            <Link
              href="/assets"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Files
            </Link>
            <Link
              href="/settings/tokens"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              API Keys
            </Link>
            <Link
              href="/docs/cli"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              CLI Docs
            </Link>
            <OrganizationSwitcher
              appearance={{
                elements: {
                  rootBox: "rounded-full border border-zinc-300 bg-white px-2 py-1",
                },
              }}
            />
            <div className="rounded-full border border-zinc-300 bg-white px-2 py-1">
              <UserButton />
            </div>
          </div>
        </header>

        <main className="mt-8">
          <AgentClient projects={projects.map((p) => ({ id: p.id, name: p.name, engine: p.engine }))} />
        </main>
      </div>
    </div>
  );
}
