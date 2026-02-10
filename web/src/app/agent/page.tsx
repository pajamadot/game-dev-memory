import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentRootRedirect() {
  // Default agent UX: full multi-turn, streaming pro sessions.
  // One-shot retrieval Q&A lives at /agent/ask.
  redirect("/agent/streaming/sessions");
}

