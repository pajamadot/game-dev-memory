import type { Env } from "../types";

type AnthropicMessage = { role: "user" | "assistant"; content: string };

type AnthropicResponse = {
  content?: { type?: string; text?: string }[];
  stop_reason?: string | null;
  model?: string;
};

function requiredString(v: unknown, name: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new Error(`${name} is required`);
  return s;
}

function resolveAnthropicVersion(env: Env): string {
  // The Messages API requires an explicit version header.
  return (env.ANTHROPIC_VERSION && env.ANTHROPIC_VERSION.trim()) || "2023-06-01";
}

function resolveAnthropicModel(env: Env): string {
  // Keep a reasonable default, but allow override in env.
  // Opus 4.5 model id per Anthropic announcement.
  return (env.ANTHROPIC_MODEL && env.ANTHROPIC_MODEL.trim()) || "claude-opus-4-5-20251101";
}

export async function anthropicMessages(env: Env, opts: {
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
}): Promise<{ text: string; model: string }> {
  const apiKey = requiredString(env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY");
  const model = resolveAnthropicModel(env);
  const version = resolveAnthropicVersion(env);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": version,
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.max(64, Math.min(4096, Math.trunc(opts.maxTokens))),
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const parts = Array.isArray(data.content) ? data.content : [];
  const out = parts
    .filter((p) => p && (p.type === "text" || p.type === undefined) && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();

  return { text: out, model: data.model || model };
}
