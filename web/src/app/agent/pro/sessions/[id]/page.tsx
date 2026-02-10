import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyAgentProSessionRedirect(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/agent/streaming/sessions/${encodeURIComponent(id)}`);
}

