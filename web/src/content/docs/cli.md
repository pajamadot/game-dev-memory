# Pajama CLI

The `pajama` CLI is the fastest way to write and retrieve project memories from your terminal.

- Install once, then **auto sync your memory everywhere**.
- Use **Organization scope** for shared team memory, and **Personal scope** for private notes.
- Upload **large files** to R2 and link them to memories for evidence-first debugging.

## Install (Recommended)

Install the prebuilt binary via npm:

```powershell
npm i -g @pajamadot/pajama
```

Supported (current): `win32/x64`.

## Login (Browser OAuth PKCE)

Interactive login:

```powershell
pajama login
```

If your environment cannot auto-open a browser:

```powershell
pajama login --no-open
```

The CLI opens the web consent page, you approve, then it redirects back to `http://localhost:...` and saves the token locally.

Show where the token is stored:

```powershell
pajama config-path
```

## Use An API Key (Non-Interactive)

For agents and services, you usually want an API key:

1. Go to `Settings -> API Keys`
2. Create a key in the scope you want (Org shared vs Personal private)
3. Set it in your environment

```powershell
$env:PAJAMA_TOKEN = "gdm_..."
pajama projects list
```

You can also pass a token per-command:

```powershell
pajama --token gdm_... projects list
```

## Configure

Environment variables:

| Name | What it does |
| --- | --- |
| `PAJAMA_API_URL` | API base URL (default: `https://api-game-dev-memory.pajamadot.com`) |
| `PAJAMA_TOKEN` | API key for all operations (Bearer token) |
| `PAJAMA_DOWNLOAD_BASE_URL` | Binary download prefix for npm install (default: `https://api-game-dev-memory.pajamadot.com/downloads/pajama`) |
| `PAJAMA_OAUTH_CALLBACK_TIMEOUT_SECS` | OAuth loopback callback timeout (default: `900`) |

## Core Commands

Projects:

```powershell
pajama projects list
pajama projects create --name "UE5 Shooter Prototype" --engine unreal --description "Goals, constraints"
```

Memories:

```powershell
pajama memories list --project-id <project-uuid> --limit 50
pajama memories create --project-id <project-uuid> --category bug --title "Crash on PIE exit" --content "Root cause..." --tags "unreal,crash"
```

Assets (large files):

```powershell
# Upload a file (multipart) and get an asset id back
pajama assets upload --project-id <project-uuid> --path "C:\\tmp\\build.zip"

# Download an asset by id
pajama assets download <asset-uuid> --out "C:\\tmp\\build.zip"
```

## Evidence-First: Link Files To Memories

Create a memory first:

```powershell
$mem = pajama memories create --project-id <project-uuid> --category build-error --title "Packaging failed" --content "See attached log" --tags "ue,packaging"
```

Upload the log or artifact and link it to that memory:

```powershell
pajama assets upload --project-id <project-uuid> --memory-id $mem --path "C:\\tmp\\Saved\\Logs\\MyProject.log"
```

Verify the link:

```powershell
pajama assets list --memory-id $mem
```

## Troubleshooting

### Install worked but `pajama` is missing

Rebuild global install scripts:

```powershell
npm rebuild -g @pajamadot/pajama
```

### OAuth login times out

Give yourself more time to approve in the browser:

```powershell
$env:PAJAMA_OAUTH_CALLBACK_TIMEOUT_SECS = "1800"
pajama login
```

### Binary download 404

The npm installer downloads from:

```text
https://api-game-dev-memory.pajamadot.com/downloads/pajama/v{version}/{file}
```

If you are running a dev environment or custom domain, override the prefix:

```powershell
$env:PAJAMA_DOWNLOAD_BASE_URL = "https://api-game-dev-memory.pajamadot.com/downloads/pajama"
npm i -g @pajamadot/pajama
```

## Agent Skills (Codex / Claude Code)

This repo ships public agent skills in `skills/` (for example: `skills/pajama-cli`). A skill is just a folder with a `SKILL.md` (and optional scripts/references).

To make a skill "public":

- Keep `skills/<name>/` in a public GitHub repo (and make sure it contains **no secrets**).
- Document a copy/install command into the agent's skill directory.

Full guide: `/docs/skills`.

Install `pajama-cli` skill (PowerShell):

```powershell
$CODEX = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$tmp = Join-Path $env:TEMP "gdm-skill"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
git clone --depth 1 https://github.com/pajamadot/game-dev-memory.git $tmp
New-Item -ItemType Directory -Force (Join-Path $CODEX "skills\\pajama-cli") | Out-Null
Copy-Item -Recurse -Force (Join-Path $tmp "skills\\pajama-cli\\*") (Join-Path $CODEX "skills\\pajama-cli")
```

Install `pajama-cli` skill (macOS/Linux):

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
tmp="$(mktemp -d)"
git clone --depth 1 https://github.com/pajamadot/game-dev-memory.git "$tmp/gdm"
mkdir -p "$CODEX_HOME/skills/pajama-cli"
cp -R "$tmp/gdm/skills/pajama-cli/"* "$CODEX_HOME/skills/pajama-cli/"
```

After install, you can tell your agent to use the `pajama-cli` skill to record memories and attach evidence files (assets) during sessions.
