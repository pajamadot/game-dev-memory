import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AgentSessionPage(props: { params: Promise<{ id: string }> | { id: string } }) {
  const params = "then" in (props.params as any) ? await (props.params as Promise<{ id: string }>) : (props.params as { id: string });
  const id = String(params.id || "").trim();
  redirect(`/agent/streaming/sessions/${encodeURIComponent(id)}`);
}
