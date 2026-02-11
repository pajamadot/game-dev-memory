import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentAskPage() {
  // One-shot ask mode is retired. Keep this route for backward compatibility.
  redirect("/agent/streaming/sessions");
}
