import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { auth } from "@clerk/nextjs/server";
import { CopyTextButton } from "@/app/_components/CopyTextButton";

export const dynamic = "force-dynamic";

async function loadMarkdown(): Promise<string> {
  const mdPath = path.join(process.cwd(), "src", "content", "docs", "cli.md");
  return await readFile(mdPath, "utf8");
}

function llmBootstrapSnippet(): string {
  return [
    "# Game Dev Memory: CLI + Skills (LLM Bootstrap)",
    "",
    "Use this snippet to teach an agent how to install the `pajama` CLI, authenticate, and install the public skills shipped in this repo.",
    "",
    "## Install CLI",
    "```powershell",
    "npm i -g @pajamadot/pajama",
    "```",
    "",
    "## Login (interactive OAuth)",
    "```powershell",
    "pajama login",
    "# or if browser auto-open is blocked:",
    "pajama login --no-open",
    "```",
    "",
    "## API Key (non-interactive agents)",
    "- Create an API key in the web UI: `Settings -> API Keys` (org scope = shared, personal scope = private).",
    "- Use it via env var or per-command flag.",
    "",
    "```powershell",
    "$env:PAJAMA_API_URL = \"https://api-game-dev-memory.pajamadot.com\"",
    "$env:PAJAMA_TOKEN = \"gdm_...\"",
    "pajama projects list",
    "```",
    "",
    "## Common Operations",
    "```powershell",
    "pajama projects list",
    "pajama memories list --project-id <project-uuid> --limit 50",
    "pajama memories create --project-id <project-uuid> --category note --title \"...\" --content \"...\" --tags \"tag1,tag2\"",
    "",
    "# Evidence files (R2 assets): upload + link to memory",
    "pajama assets upload --project-id <project-uuid> --path \"C:\\\\tmp\\\\build.zip\"",
    "pajama assets upload --project-id <project-uuid> --memory-id <memory-uuid> --path \"C:\\\\tmp\\\\Saved\\\\Logs\\\\MyProject.log\"",
    "```",
    "",
    "## Install Agent Skill: pajama-cli (Codex / Claude Code)",
    "Skill directory defaults:",
    "- Windows: `%USERPROFILE%\\\\.codex\\\\skills`",
    "- macOS/Linux: `~/.codex/skills`",
    "",
    "### PowerShell (Windows)",
    "```powershell",
    "$CODEX = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME \".codex\" }",
    "$tmp = Join-Path $env:TEMP \"gdm-skill\"",
    "if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }",
    "git clone --depth 1 https://github.com/pajamadot/game-dev-memory.git $tmp",
    "New-Item -ItemType Directory -Force (Join-Path $CODEX \"skills\\\\pajama-cli\") | Out-Null",
    "Copy-Item -Recurse -Force (Join-Path $tmp \"skills\\\\pajama-cli\\\\*\") (Join-Path $CODEX \"skills\\\\pajama-cli\")",
    "```",
    "",
    "### Bash (macOS/Linux)",
    "```bash",
    "CODEX_HOME=\"${CODEX_HOME:-$HOME/.codex}\"",
    "tmp=\"$(mktemp -d)\"",
    "git clone --depth 1 https://github.com/pajamadot/game-dev-memory.git \"$tmp/gdm\"",
    "mkdir -p \"$CODEX_HOME/skills/pajama-cli\"",
    "cp -R \"$tmp/gdm/skills/pajama-cli/\"* \"$CODEX_HOME/skills/pajama-cli/\"",
    "```",
    "",
    "Docs:",
    "- https://game-dev-memory.pajamadot.com/docs/cli",
    "- https://game-dev-memory.pajamadot.com/docs/skills",
  ].join("\n");
}

function scopeLabel(orgId: string | null): { label: string; hint: string } {
  if (orgId) {
    return {
      label: "Organization (shared)",
      hint: "Your org scope is shared across all org members.",
    };
  }
  return {
    label: "Personal (private)",
    hint: "Your personal scope is private to you only.",
  };
}

export default async function CliDocsPage() {
  const markdown = await loadMarkdown();
  const { userId, orgId } = await auth();
  const scope = scopeLabel(orgId ?? null);

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_-20%,#bfdbfe_0%,transparent_55%),radial-gradient(900px_circle_at_90%_0%,#fde68a_0%,transparent_55%),linear-gradient(180deg,#fafafa_0%,#ffffff_60%,#fafafa_100%)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.22em] text-zinc-500">DOCS</p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">CLI</h1>
            <p className="mt-1 text-sm text-zinc-600">Install once. Auto sync your memory everywhere.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyTextButton text={llmBootstrapSnippet()} label="Copy for LLM" />
            <Link
              href="/"
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Back to console
            </Link>
            {userId ? (
              <Link
                href="/settings/tokens"
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                API Keys
              </Link>
            ) : null}
          </div>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <article className="rounded-3xl border border-zinc-200/70 bg-white/70 p-7 shadow-sm backdrop-blur lg:col-span-8">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: (props) => <h2 className="text-xl font-semibold tracking-tight text-zinc-950" {...props} />,
                h2: (props) => <h3 className="mt-6 text-lg font-semibold tracking-tight text-zinc-950" {...props} />,
                h3: (props) => <h4 className="mt-5 text-base font-semibold text-zinc-950" {...props} />,
                p: (props) => <p className="mt-3 text-sm leading-6 text-zinc-700" {...props} />,
                ul: (props) => <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700" {...props} />,
                ol: (props) => <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-700" {...props} />,
                li: (props) => <li className="leading-6" {...props} />,
                blockquote: (props) => (
                  <blockquote className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700" {...props} />
                ),
                a: ({ href, ...props }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                    {...props}
                  />
                ),
                code: ({ className, children, ...props }) => {
                  const isBlock = Boolean(className);
                  if (isBlock) {
                    return (
                      <pre className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-zinc-950 p-4 text-xs text-zinc-100">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    );
                  }
                  return (
                    <code className="rounded-md border border-zinc-200 bg-zinc-50 px-1 py-0.5 font-mono text-[12px]" {...props}>
                      {children}
                    </code>
                  );
                },
                table: (props) => (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full border-collapse text-sm" {...props} />
                  </div>
                ),
                th: (props) => <th className="border border-zinc-200 bg-zinc-50 px-3 py-2 text-left font-semibold text-zinc-900" {...props} />,
                td: (props) => <td className="border border-zinc-200 px-3 py-2 text-zinc-700" {...props} />,
                hr: (props) => <hr className="my-6 border-zinc-200" {...props} />,
              }}
            >
              {markdown}
            </ReactMarkdown>
          </article>

          <aside className="space-y-6 lg:col-span-4">
            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Scope</h2>
              {userId ? (
                <>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">
                    Current: <span className="font-semibold text-zinc-950">{scope.label}</span>. {scope.hint}
                  </p>
                  <p className="mt-3 text-xs leading-5 text-zinc-600">
                    Tip: use the org switcher on the console to choose shared vs private scope before creating API keys.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs leading-5 text-zinc-600">
                  Sign in to use <span className="font-medium text-zinc-900">Organization</span> scope for shared project memory, or{" "}
                  <span className="font-medium text-zinc-900">Personal</span> scope for private memory.
                </p>
              )}
            </section>

            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Quick Commands</h2>
              <pre className="mt-3 overflow-auto rounded-2xl border border-zinc-200 bg-zinc-950 px-4 py-3 font-mono text-[12px] leading-5 text-zinc-50">
npm i -g @pajamadot/pajama
pajama login
pajama projects list
              </pre>
              <p className="mt-3 text-xs text-zinc-600">
                API base defaults to <span className="font-mono">https://api-game-dev-memory.pajamadot.com</span>.
              </p>
            </section>

            <section className="rounded-3xl border border-zinc-200/70 bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Related</h2>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                <Link
                  className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                  href="/docs/skills"
                >
                  Agent skills install
                </Link>
                <Link
                  className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                  href="/research/agent-memory"
                >
                  Agent Memory research
                </Link>
                <Link
                  className="text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800"
                  href="/settings/tokens"
                >
                  API Keys
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
