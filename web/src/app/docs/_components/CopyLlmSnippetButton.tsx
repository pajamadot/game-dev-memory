"use client";

import { useCallback, useMemo, useState } from "react";

async function copyText(text: string): Promise<void> {
  // Modern clipboard API.
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for older browsers / stricter contexts.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export function CopyLlmSnippetButton(props: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  const label = props.label || "Copy for LLM";

  const buttonText = useMemo(() => {
    if (state === "copied") return "Copied";
    if (state === "error") return "Copy failed";
    return label;
  }, [label, state]);

  const onClick = useCallback(async () => {
    try {
      await copyText(props.text);
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 1800);
    }
  }, [props.text]);

  const tone =
    state === "copied"
      ? "bg-emerald-600 hover:bg-emerald-500"
      : state === "error"
        ? "bg-amber-600 hover:bg-amber-500"
        : "bg-zinc-900 hover:bg-zinc-800";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium text-white ${tone}`}
    >
      {buttonText}
    </button>
  );
}

