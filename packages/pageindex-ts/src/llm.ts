export type LlmRole = "user" | "assistant";

export type LlmMessage = { role: LlmRole; content: string };

// Mirrors the upstream `ChatGPT_API_with_finish_reason` contract.
export type LlmFinishReason = "finished" | "max_output_reached";

export type LlmCompletion = {
  text: string;
  finish_reason?: LlmFinishReason;
};

export type LlmCompleteOptions = {
  model: string;
  prompt: string;
  chat_history?: LlmMessage[];
  // Provider-specific max output tokens. Optional because some providers clamp.
  max_tokens?: number;
};

export interface PageIndexLlm {
  complete(opts: LlmCompleteOptions): Promise<LlmCompletion>;
}

export type LoggerLike = {
  info: (message: any) => void;
  error: (message: any) => void;
};

export function createNullLogger(): LoggerLike {
  return {
    info: () => {},
    error: () => {},
  };
}

export async function sleepMs(ms: number): Promise<void> {
  const t = Math.max(0, Math.trunc(ms));
  if (t === 0) return;
  await new Promise((r) => setTimeout(r, t));
}

