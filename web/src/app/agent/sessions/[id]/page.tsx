import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { apiJson } from "@/lib/memory-api";
import { sendAgentMessage } from "../actions";

export const dynamic = "force-dynamic";

type AgentSession = {
  id: string;
  project_id: string;
  started_at: string;
  ended_at: string | null;
  title: string;
  message_count: number;
};

type EvidenceContext = {
  evidence?: { memory_ids?: string[]; asset_ids?: string[] };
  provider?: unknown;
  role?: string;
};

type AgentMessage = {
  id: string;
  category: string;
  title: string;
  content: string;
  context?: EvidenceContext | string | null;
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

function normalizeEvidence(ctx: unknown): { memory_ids: string[]; asset_ids: string[] } {
  let obj: any = null;
  if (!ctx) return { memory_ids: [], asset_ids: [] };
  if (typeof ctx === "string") {
    try {
      obj = JSON.parse(ctx);
    } catch {
      obj = null;
    }
  } else if (typeof ctx === "object") {
    obj = ctx as any;
  }

  const ev = obj?.evidence || obj?.context?.evidence || null;
  const mem = Array.isArray(ev?.memory_ids) ? ev.memory_ids.filter((x: any) => typeof x === "string") : [];
  const assets = Array.isArray(ev?.asset_ids) ? ev.asset_ids.filter((x: any) => typeof x === "string") : [];
  return { memory_ids: mem.slice(0, 50), asset_ids: assets.slice(0, 50) };
}

export default async function AgentSessionPage(props: { params: Promise<{ id: string }> | { id: string } }) {
  const { userId } = await auth();
  const params = "then" in (props.params as any) ? await (props.params as Promise<{ id: string }>) : (props.params as { id: string });
  const id = String(params.id || "").trim();

  if (!userId) {
    return (
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-10 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Sign in required</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">Sign in to view and continue this session.</p>
            <div className="mt-6 flex items-center gap-3">
              <SignInButton mode="modal">
                <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800">
                  Sign in
                </button>
              </SignInButton>
              <Link
                href="/agent/sessions"
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

  const session = await apiJson<AgentSession>(`/api/agent/sessions/${encodeURIComponent(id)}`);
  const msgRes = await apiJson<{ messages: AgentMessage[] }>(`/api/agent/sessions/${encodeURIComponent(id)}/messages?limit=500`);
  const messages = msgRes.messages || [];

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT SESSION</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{session.title || "Agent Session"}</h1>
            <p className="mt-1 text-xs text-zinc-600">
              messages {session.message_count} | started {fmt(session.started_at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/agent/sessions"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Sessions
            </Link>
            <Link
              href="/agent/ask"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              One-shot ask
            </Link>
            <Link
              href="/assets"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Files
            </Link>
          </div>
        </header>

        <main className="mt-8 space-y-6">
          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Conversation</h2>
            {messages.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">No messages yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {messages.map((m) => {
                  const isAssistant = String(m.category) === "agent_assistant";
                  const ev = isAssistant ? normalizeEvidence(m.context) : { memory_ids: [], asset_ids: [] };
                  return (
                    <li key={m.id} className={isAssistant ? "flex justify-start" : "flex justify-end"}>
                      <div
                        className={
                          isAssistant
                            ? "w-full max-w-[44rem] rounded-2xl border border-zinc-200 bg-white p-4"
                            : "w-full max-w-[44rem] rounded-2xl border border-zinc-200 bg-zinc-950 p-4 text-zinc-50"
                        }
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                          <p className={isAssistant ? "text-xs font-semibold text-zinc-900" : "text-xs font-semibold text-zinc-100"}>
                            {isAssistant ? "Assistant" : "You"}
                          </p>
                          <p className={isAssistant ? "text-[11px] text-zinc-500" : "text-[11px] text-zinc-300"}>{fmt(m.created_at)}</p>
                        </div>
                        <p className={isAssistant ? "mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800" : "mt-2 whitespace-pre-wrap text-sm leading-6"}>
                          {m.content}
                        </p>

                        {isAssistant && (ev.memory_ids.length || ev.asset_ids.length) ? (
                          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                            <p className="text-[11px] font-semibold text-zinc-900">Evidence</p>
                            {ev.memory_ids.length ? (
                              <p className="mt-2 text-[11px] text-zinc-700">
                                Memories:{" "}
                                {ev.memory_ids.slice(0, 5).map((id) => (
                                  <span key={id} className="mr-2">
                                    <Link
                                      href={`/memories/${id}`}
                                      className="font-mono underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                                    >
                                      {id.slice(0, 8)}
                                    </Link>
                                  </span>
                                ))}
                                {ev.memory_ids.length > 5 ? <span className="text-zinc-500">+{ev.memory_ids.length - 5} more</span> : null}
                              </p>
                            ) : null}
                            {ev.asset_ids.length ? (
                              <p className="mt-2 text-[11px] text-zinc-700">
                                Assets:{" "}
                                {ev.asset_ids.slice(0, 5).map((id) => (
                                  <span key={id} className="mr-2">
                                    <Link
                                      href={`/assets/${id}`}
                                      className="font-mono underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                                    >
                                      {id.slice(0, 8)}
                                    </Link>
                                  </span>
                                ))}
                                {ev.asset_ids.length > 5 ? <span className="text-zinc-500">+{ev.asset_ids.length - 5} more</span> : null}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Send message</h2>
            <form action={sendAgentMessage} className="mt-4 space-y-3">
              <input type="hidden" name="session_id" value={id} />
              <textarea
                name="content"
                rows={4}
                placeholder="Ask the agent..."
                className="w-full resize-y rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-900/10 focus:ring-4"
              />
              <button className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800">
                Send
              </button>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
