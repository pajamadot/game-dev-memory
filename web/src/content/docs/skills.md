# Agent Skills

A **skill** is a folder that contains a `SKILL.md` (plus optional scripts/references) that teaches an agent how to do a workflow end-to-end.

In this repo, skills live under:

```text
skills/<skill-name>/
```

To make a skill **public**, keep it in a public GitHub repo and make sure it contains **no secrets**.

## Install The CLI First

Most of our skills assume you can call the CLI:

```powershell
npm i -g @pajamadot/pajama
pajama login
```

## Install A Skill (Codex / Claude Code)

The default skill directory is:

- Windows: `%USERPROFILE%\\.codex\\skills`
- macOS/Linux: `~/.codex/skills`

### PowerShell (Windows)

Installs the `pajama-cli` skill:

```powershell
$CODEX = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$tmp = Join-Path $env:TEMP "gdm-skill"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
git clone --depth 1 https://github.com/pajamadot/game-dev-memory.git $tmp
New-Item -ItemType Directory -Force (Join-Path $CODEX "skills\\pajama-cli") | Out-Null
Copy-Item -Recurse -Force (Join-Path $tmp "skills\\pajama-cli\\*") (Join-Path $CODEX "skills\\pajama-cli")
```

### Bash (macOS/Linux)

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
tmp="$(mktemp -d)"
git clone --depth 1 https://github.com/pajamadot/game-dev-memory.git "$tmp/gdm"
mkdir -p "$CODEX_HOME/skills/pajama-cli"
cp -R "$tmp/gdm/skills/pajama-cli/"* "$CODEX_HOME/skills/pajama-cli/"
```

## Bundled Skills

| Skill | What it's for |
| --- | --- |
| `pajama-cli` | Use `pajama` to record memories and attach evidence assets (logs/zips/traces). |
| `memory-evolver` | Self-evolution loop that reads `/api/evolve/signals` and writes evolution events and seed knowledge. |
| `unreal-agents` | Unreal Engine + AI agent research workflows (and daily digest). |
| `agent-memory-research` | Research and notes on memory organization patterns and schema design. |
| `ux-e2e` | End-to-end UX testing guidance (Playwright). |

## A Good Default Workflow For Agents

1. Create a memory for what happened and why.
2. Upload evidence files as assets and link them to the memory.
3. Run evolver cycles (optional) when sessions close or when the system is stable.
