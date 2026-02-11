import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentSessionsPage() {
  // Non-streaming sessions UI is retired in favor of the interactive streaming route.
  redirect("/agent/streaming/sessions");
}
