"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo, useState } from "react";

type MessageRow = {
  id: string;
  category: string;
  title: string;
  content: string;
  context: any;
  created_at: string;
};

type ProjectInfo = {
  id: string;
  name: string;
  engine: string;
};

function apiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_MEMORY_API_URL ||
    process.env.MEMORY_API_URL ||
    "https://api-game-dev-memory.pajamadot.com"
  );
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function roleFromCategory(category: string): "user" | "assistant" {
  return category === "agent_assistant" ? "assistant" : "user";
}

function extractEvidence(ctx: any): { memoryIds: string[]; assetIds: string[] } {
  const mem = ctx?.evidence?.memory_ids;
  const assets = ctx?.evidence?.asset_ids;
  const memoryIds = Array.isArray(mem) ? mem.filter((x) => typeof x === "string").slice(0, 50) : [];
  const assetIds = Array.isArray(assets) ? assets.filter((x) => typeof x === "string").slice(0, 50) : [];
  return { memoryIds, assetIds };
}

async function readSseStream(res: Response, onEvent: (ev: any) => void) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buf += dec.decode(value, { stream: true });
    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx === -1) break;

      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      const lines = chunk.split("\n");
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;
        if (trimmed.startsWith(":")) continue;
        if (!trimmed.toLowerCase().startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload));
        } catch {
          // ignore malformed events
        }
      }
    }
  }
}

export function StreamingAgentChatClient(props: {
  sessionId: string;
  title: string;
  project: ProjectInfo | null;
  initialMessages: MessageRow[];
}) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<MessageRow[]>(props.initialMessages || []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasAssistant = useMemo(() => messages.some((m) => roleFromCategory(m.category) === "assistant"), [messages]);

  const loadMessages = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error("Missing Clerk session token");

    const res = await fetch(`${apiBaseUrl()}/api/agent-pro/sessions/${encodeURIComponent(props.sessionId)}/messages?limit=400`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to refresh messages (${res.status}): ${text || res.statusText}`);
    }
    const data = (await res.json()) as { messages?: MessageRow[] };
    setMessages(Array.isArray(data.messages) ? data.messages : []);
  }, [getToken, props.sessionId]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || busy) return;

    setBusy(true);
    setError(null);
    setEvents([]);

    try {
      const token = await getToken();
      if (!token) throw new Error("Missing Clerk session token");

      // Optimistic: show user message immediately.
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          category: "agent_user",
          title: "User",
          content,
          context: { role: "user" },
          created_at: new Date().toISOString(),
        },
      ]);
      setDraft("");

      const res = await fetch(`${apiBaseUrl()}/api/agent-pro/sessions/${encodeURIComponent(props.sessionId)}/continue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Agent failed (${res.status}): ${text || res.statusText}`);
      }

      await readSseStream(res, (ev) => {
        setEvents((prev) => [...prev.slice(-200), ev]);
      });

      // Canonical refresh after the run (assistant message is persisted by the API).
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, getToken, loadMessages, props.sessionId]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">AGENT</p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{props.title || "Agent Session"}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {props.project ? (
              <>
                Project: <span className="font-medium text-zinc-900">{props.project.name}</span>{" "}
                <span className="text-zinc-500">({props.project.engine})</span>
              </>
            ) : (
              "Project-scoped agent chat with streaming progress."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/agent/streaming/sessions"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Back to sessions
          </Link>
          <Link
            href="/agent"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Standard agent
          </Link>
          <Link
            href="/assets"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Files
          </Link>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="lg:col-span-8">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Chat</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              This session is backed by memories. Assistant replies include evidence pointers you can click into.
            </p>

            <div className="mt-4 space-y-3">
              {messages.length === 0 ? (
                <p className="text-sm text-zinc-600">No messages yet.</p>
              ) : (
                messages.map((m) => {
                  const role = roleFromCategory(m.category);
                  const ev = role === "assistant" ? extractEvidence(m.context) : null;
                  return (
                    <div key={m.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-zinc-900">{role === "assistant" ? "Assistant" : "You"}</p>
                        <p className="text-[11px] text-zinc-500">{fmt(m.created_at)}</p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{m.content}</p>
                      {ev && (ev.memoryIds.length || ev.assetIds.length) ? (
                        <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                          <p className="text-[11px] font-semibold text-zinc-900">Evidence</p>
                          {ev.memoryIds.length ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                              {ev.memoryIds.slice(0, 12).map((id) => (
                                <Link
                                  key={id}
                                  href={`/memories/${id}`}
                                  className="font-mono underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                                >
                                  mem:{id.slice(0, 8)}
                                </Link>
                              ))}
                            </div>
                          ) : null}
                          {ev.assetIds.length ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                              {ev.assetIds.slice(0, 12).map((id) => (
                                <Link
                                  key={id}
                                  href={`/assets/${id}`}
                                  className="font-mono underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                                >
                                  asset:{id.slice(0, 8)}
                                </Link>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-6 rounded-3xl border border-zinc-200 bg-white p-4">
              <label className="text-xs font-medium text-zinc-700" htmlFor="streaming-agent-draft">
                Message
              </label>
              <textarea
                id="streaming-agent-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                placeholder={
                  hasAssistant
                    ? "Continue the thread..."
                    : "Ask about build errors, playtests, bugs, pipelines... (the agent will cite project memory)"
                }
                className="mt-2 w-full resize-y rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-900/10 focus:ring-4"
                disabled={busy}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={send}
                  disabled={busy || !draft.trim()}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  {busy ? "Running..." : "Send (stream)"}
                </button>
                <p className="text-[11px] text-zinc-500 font-mono">session={props.sessionId}</p>
              </div>
              {error ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold">Error</p>
                  <p className="mt-1 break-words font-mono">{error}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="lg:col-span-4">
          <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Run log</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-600">Streaming events from the sandbox runner.</p>
            {events.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-600">No events yet.</p>
            ) : (
              <ul className="mt-4 space-y-2 text-[12px] text-zinc-700">
                {events.slice(-80).map((e, idx) => (
                  <li key={idx} className="rounded-xl border border-zinc-200 bg-white p-2 font-mono">
                    {JSON.stringify(e)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
