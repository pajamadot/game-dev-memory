# Pajama CLI (npm)

Install the `pajama` CLI via npm (recommended for end users):

```bash
npm i -g @pajamadot/pajama
```

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
