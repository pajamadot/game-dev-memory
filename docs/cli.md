# Pajama CLI (`pajama/`)

`pajama` is a Rust CLI that talks to the Memory API. It uses browser-based OAuth (PKCE) to get an API key, then uses that API key for all operations.

This is the "Claude Code / Codex style" flow: open a browser, approve, redirect back to localhost, then the CLI stores the token.

## Build / Install

From repo root:

```powershell
cd pajama
cargo build --release
```

Binary:

- `pajama\target\release\pajama.exe`

Optional install to your Cargo bin dir:

```powershell
cargo install --path . --force
```

## Install via npm (Recommended)

If you just want the CLI without Rust toolchains, install the prebuilt binary via npm:

```powershell
npm i -g @pajamadot/pajama
```

## Login (OAuth PKCE)

```powershell
pajama login
```

If the CLI cannot open a browser automatically:

```powershell
pajama login --no-open
```

The token is saved locally (platform config dir). You can see the path with:

```powershell
pajama config-path
```

## Basic Usage

```powershell
# Projects
pajama projects list
pajama projects create --name "UE5 Shooter Prototype" --engine unreal --description "Goals, constraints"

# Memories
pajama memories list --project-id <project-uuid> --limit 50
pajama memories create --project-id <project-uuid> --category bug --title "Crash on PIE exit" --content "Root cause..." --tags "unreal,crash"
pajama memories search-index --project-id <project-uuid> --q "shader compile crash" --provider memories_fts --memory-mode balanced --limit 20
pajama memories batch-get --ids <memory-id-1>,<memory-id-2>
pajama memories timeline --project-id <project-uuid> --limit 100
pajama memories derive <memory-id> --dry-run
pajama memories derive <memory-id>
pajama memories foresight-active --project-id <project-uuid> --within-days 30 --limit 25

# Assets (large files)
pajama assets upload --project-id <project-uuid> --path "C:\\tmp\\build.zip"

# Evolve (arena)
pajama evolve policy --project-id <project-uuid>
pajama evolve arena-latest --project-id <project-uuid>
pajama evolve arena-run --project-id <project-uuid>
pajama evolve arena-iterate --project-id <project-uuid> --iterations 300 --time-budget-ms 300000
pajama evolve arena-campaign --max-projects 10 --iterations-per-project 200 --time-budget-ms 600000

# Agent (retrieval-first ask)
pajama agent status
pajama agent ask --project-id <project-uuid> --query "why is cook failing in CI?"`r`npajama agent ask --project-id <project-uuid> --query "why is cook failing in CI?" --dry-run --diagnostics`r`npajama agent ask --project-id <project-uuid> --query "why is cook failing in CI?" --dry-run --diagnostics --no-cache
```


## Retrieval Benchmark Script

For live performance tuning, run the benchmark helper against the deployed API:

```powershell
./scripts/benchmark-agent-retrieval.ps1 -Token "<gdm_api_key>" -ProjectId "<project-uuid>" -Iterations 12
```

Useful switches:

- `-NoCache` to measure cold-path retrieval latency.
- `-MemoryMode fast|balanced|deep` to compare retrieval profiles.
- `-RetrievalMode auto|memories|hybrid|documents` to compare routing policy.
## Automation

You can override config values without re-login:

- `PAJAMA_API_URL` (base API URL)
- `PAJAMA_TOKEN` (Bearer token; API key)
- `PAJAMA_OAUTH_CALLBACK_TIMEOUT_SECS` (loopback callback wait; default 900)

Or pass a token explicitly:

```powershell
pajama --token gdm_... projects list
```
