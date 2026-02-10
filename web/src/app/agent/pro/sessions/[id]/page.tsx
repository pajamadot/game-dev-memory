import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";
import { ProAgentChatClient } from "./ProAgentChatClient";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  project_id: string;
  started_at: string;
  ended_at: string | null;
  title: string;
  message_count?: number;
};

type MessageRow = {
  id: string;
  category: string;
  title: string;
  content: string;
  context: any;
  created_at: string;
};

type ProjectRow = {
  id: string;
  name: string;
  engine: string;
};

export default async function ProAgentSessionPage(props: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT PRO</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Sign in to continue a pro agent session.</p>
            <div className="mt-6 flex items-center gap-3">
              <SignInButton mode="modal">
                <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                  Sign in
                </button>
              </SignInButton>
              <Link
                href="/agent/pro/sessions"
                className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Back to sessions
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { id } = await props.params;

  const session = await apiJson<SessionRow>(`/api/agent-pro/sessions/${encodeURIComponent(id)}`);
  const msgRes = await apiJson<{ messages: MessageRow[] }>(`/api/agent-pro/sessions/${encodeURIComponent(id)}/messages?limit=400`);
  const messages = msgRes.messages || [];

  const projRes = await apiJson<{ projects: ProjectRow[] }>("/api/projects");
  const projects = projRes.projects || [];
  const project = projects.find((p) => p.id === session.project_id) || null;

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <ProAgentChatClient sessionId={id} title={session.title} project={project} initialMessages={messages} />
      </div>
    </div>
  );
}

