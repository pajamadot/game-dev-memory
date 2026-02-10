---
name: pajama-cli
description: Use the Rust `pajama` CLI to authenticate (OAuth PKCE via web) and operate on org/project memory (projects, memories, assets) through the Memory API. Use in agentic coding sessions to verify end-to-end flows without hand-writing curl/Invoke-RestMethod snippets.
tags: [cli, oauth, pkce, api-keys, assets, memory]
---

# Pajama CLI Skill

Use the `pajama/` Rust CLI for end-to-end testing and operational workflows against the Memory API.

This is the preferred interface for scripts and agents once installed:

- Web login is handled once via OAuth PKCE.
- All subsequent operations use `Authorization: Bearer gdm_...`.

## Build / Install

```powershell
cd pajama
cargo build --release
```

Optional install:

```powershell
cargo install --path . --force
```

Install via npm (prebuilt binary):

```powershell
npm i -g @pajamadot/pajama
```

## Auth

Interactive login (opens browser, loopback redirect):

```powershell
pajama login
```

If the environment can't open a browser:

```powershell
pajama login --no-open
```

If you need more time to approve in the browser:

- Set `PAJAMA_OAUTH_CALLBACK_TIMEOUT_SECS=900` (default) or higher

Non-interactive (CI-like) auth for local agent sessions:

- Set `PAJAMA_TOKEN=gdm_...`
- Or pass `--token gdm_...` on the command line

## Common Operations

Projects:

```powershell
pajama projects list
pajama projects create --name "UE5 Prototype" --engine unreal --description "Memory sandbox"
```

Memories:

```powershell
pajama memories list --project-id <project-uuid> --limit 50
pajama memories create --project-id <project-uuid> --category bug --title "DX12 crash" --content "Root cause..." --tags "dx12,crash"
```

Assets (large files via multipart upload):

```powershell
pajama assets upload --project-id <project-uuid> --path "C:\\tmp\\build.zip"
pajama assets list --project-id <project-uuid>
```

## When To Use This Skill

- You changed auth/OAuth and need to validate the full browser login loop.
- You changed Memory API endpoints and want a stable, repeatable way to exercise them.
- You are building ingestion tooling (UE logs, traces) and want to upload/link large artifacts quickly.
