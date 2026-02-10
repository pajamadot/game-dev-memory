import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyAgentProSessionsRedirect() {
  redirect("/agent/streaming/sessions");
}

