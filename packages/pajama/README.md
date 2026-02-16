# Pajama CLI (npm)

Install the `pajama` CLI via npm (recommended for end users):

```bash
npm i -g @pajamadot/pajama
```

This installs a small JS launcher and downloads the CLI binary automatically.

Login (OAuth PKCE):

```bash
pajama login
```

If your environment cannot open a browser automatically:

```bash
pajama login --no-open
```

Then use the Memory API:

```bash
pajama projects list
pajama projects create --name "UE5 Prototype" --engine unreal --description "Memory sandbox"
pajama memories search-index --project-id <project-uuid> --q "cook failure" --provider memories_fts --memory-mode balanced --limit 20
pajama memories batch-get --ids <memory-id-1>,<memory-id-2>
pajama memories timeline --project-id <project-uuid> --limit 100

# EverMemOS-style derivation + active foresight lane
pajama memories derive <memory-id> --dry-run
pajama memories derive <memory-id>
pajama memories foresight-active --project-id <project-uuid> --within-days 30 --limit 25

# Run retrieval evolution from CLI
pajama evolve policy --project-id <project-uuid>
pajama evolve arena-latest --project-id <project-uuid>
pajama evolve arena-run --project-id <project-uuid>
pajama evolve arena-iterate --project-id <project-uuid> --iterations 300 --time-budget-ms 300000
pajama evolve arena-campaign --max-projects 10 --iterations-per-project 200 --time-budget-ms 600000

# Ask the memory agent
pajama agent status
pajama agent ask --project-id <project-uuid> --query "summarize latest build failures"
```

## Environment Variables

- `PAJAMA_API_URL`: Memory API base URL (defaults to `https://api-game-dev-memory.pajamadot.com`)
- `PAJAMA_TOKEN`: Bearer token override (API key)
- `PAJAMA_OAUTH_CALLBACK_TIMEOUT_SECS`: loopback callback wait (default: 900)

Installer-only:

- `PAJAMA_DOWNLOAD_BASE_URL`: override binary download base URL (defaults to `https://api-game-dev-memory.pajamadot.com/downloads/pajama`)

## Prebuilt Binary Support

This package downloads a platform-specific prebuilt binary at install time.

Current prebuilt support (initial release):

- Windows x64 (`win32/x64`)

If you are on macOS or Linux, install from source for now:

```bash
cd pajama
cargo install --path . --force
```

## Troubleshooting

If the binary is missing after install:

- Ensure npm scripts are enabled (`npm config get ignore-scripts` should be `false`)
- Re-run install scripts: `npm rebuild -g @pajamadot/pajama`
- Or just run `pajama --version` (the launcher will attempt an on-demand install)

