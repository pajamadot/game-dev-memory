---
name: pajama-cli
description: Use the `pajama` CLI to authenticate with OAuth PKCE and operate on Game Dev Memory projects, memories, assets, evolution endpoints, and agent routes. Use this skill when you need repeatable end-to-end API workflows from terminal sessions without hand-writing REST calls.
---

# Pajama CLI Skill

Use this skill to run production-like memory workflows from terminal sessions.

## Current Release

- npm package: `@pajamadot/pajama@0.1.10`
- API base default: `https://api-game-dev-memory.pajamadot.com`
- Download prefix: `https://api-game-dev-memory.pajamadot.com/downloads/pajama`

## Install

```powershell
npm i -g @pajamadot/pajama
pajama --version
```

Source build (optional):

```powershell
cd pajama
cargo build --release
```

## Auth

Interactive OAuth:

```powershell
pajama login
```

If browser auto-open fails:

```powershell
pajama login --no-open
```

Non-interactive token mode:

- set `PAJAMA_TOKEN=gdm_...`, or
- pass `--token gdm_...` per command.

## Core Workflow

```powershell
# projects
pajama projects list
pajama projects create --name "UE5 Prototype" --engine unreal --description "Memory sandbox"

# memory operations
pajama memories list --project-id <project-uuid> --limit 50
pajama memories search-index --project-id <project-uuid> --q "cook failure" --provider memories_fts --memory-mode balanced --limit 20
pajama memories batch-get --ids <memory-id-1>,<memory-id-2>
pajama memories timeline --project-id <project-uuid> --limit 100

# derivation and foresight
pajama memories derive <memory-id> --dry-run
pajama memories derive <memory-id>
pajama memories foresight-active --project-id <project-uuid> --within-days 30 --limit 25

# assets
pajama assets upload --project-id <project-uuid> --path "C:\\tmp\\build.zip"
pajama assets upload --project-id <project-uuid> --memory-id <memory-uuid> --path "C:\\tmp\\Saved\\Logs\\MyProject.log"
```

## Agent Diagnostics and Cache Tuning

```powershell
pajama agent status
pajama agent ask --project-id <project-uuid> --query "summarize build regressions" --dry-run --diagnostics
pajama agent ask --project-id <project-uuid> --query "summarize build regressions" --dry-run --diagnostics --no-cache --cache-ttl-ms 15000
```

Use diagnostics output to compare retrieval and synthesis timing across runs.

## Benchmark Loop

Run the benchmark helper for repeated latency comparison:

```powershell
./scripts/benchmark-agent-retrieval.ps1 -Token "<gdm_api_key>" -ProjectId "<project-uuid>" -Iterations 12
```

Useful switches:

- `-NoCache`
- `-MemoryMode fast|balanced|deep`
- `-RetrievalMode auto|memories|hybrid|documents`
- `-CacheTtlMs <ms>`

## Use This Skill When

- validating OAuth + API key behavior end-to-end,
- validating retrieval features after API/DB changes,
- recording memory plus evidence assets from agentic coding sessions,
- measuring performance regressions in retrieval routing.
