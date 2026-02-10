import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyAgentProRedirect() {
  // Keep legacy links working while removing "pro" from the URL surface.
  redirect("/agent/streaming");
}

