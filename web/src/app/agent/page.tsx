import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentRootRedirect() {
  // Default agent UX: full multi-turn, streaming sessions.
  redirect("/agent/streaming/sessions");
}
