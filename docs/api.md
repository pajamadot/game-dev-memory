# API Usage (Auth + Examples)

The Memory API is the core of the system. MCP is a thin tool layer on top of it.

## Auth

All `/api/*` routes require:

- `Authorization: Bearer <token>`

Supported tokens:

- API key (recommended for agents/services): `gdm_...`
  - Create in the web app: `/settings/tokens`
- Clerk session JWT (used by the web app)
  - The Next.js app calls `auth().getToken()` and forwards it as `Authorization: Bearer ...`

### Local Escape Hatch (Not Recommended)

For local-only testing, you can allow the legacy `X-Tenant-*` headers by setting:

- `ALLOW_INSECURE_TENANT_HEADERS=true` in the Worker env

Do not enable this in production.

## PowerShell Examples (API Key)

```powershell
$api = "http://localhost:8787"
$token = "gdm_your_api_key_here"
$h = @{ Authorization = "Bearer $token" }

Invoke-RestMethod "$api/api/projects" -Headers $h
```

### Create Project

```powershell
$body = @{
  name = "UE5 Shooter Prototype"
  engine = "unreal"
  description = "Goals, constraints, pipeline notes"
} | ConvertTo-Json

Invoke-RestMethod "$api/api/projects" -Method Post -Headers $h -ContentType "application/json" -Body $body
```

### Create Session

```powershell
$body = @{
  project_id = "<project-uuid>"
  kind = "coding"
  context = @{ branch = "main" }
} | ConvertTo-Json

Invoke-RestMethod "$api/api/sessions" -Method Post -Headers $h -ContentType "application/json" -Body $body
```

### Close Session (Auto-Evolve)

```powershell
Invoke-RestMethod "$api/api/sessions/<session-uuid>/close" -Method Post -Headers $h
```

### Create Memory

```powershell
$body = @{
  project_id = "<project-uuid>"
  session_id = $null
  category = "bug"
  source_type = "manual"
  title = "Fixed shader compile crash on DX12"
  content = "Root cause + fix steps..."
  tags = @("dx12","shader","crash")
  context = @{ platform = "Win64" }
  confidence = 0.7
} | ConvertTo-Json

Invoke-RestMethod "$api/api/memories" -Method Post -Headers $h -ContentType "application/json" -Body $body
```

## Assets (Large Files, R2 Multipart)

Use assets for large binary files you want to reference from memories (zips, builds, pak files, crash dumps, captures).

Flow:

1. `POST /api/assets` to create the asset record + initiate an R2 multipart upload.
2. Upload parts via `PUT /api/assets/{assetId}/parts/{partNumber}` (1-indexed).
3. `POST /api/assets/{assetId}/complete` to finalize into a single R2 object.

Notes:

- Each part must be at least 5MB (except the last).
- For safety with Cloudflare Workers request limits, keep parts <= ~95MB.
- After completion, download via `GET /api/assets/{assetId}/object` (supports `byte_start`/`byte_end` for ranged reads).

### Create Asset (Initiate Upload)

```powershell
$body = @{
  project_id = "<project-uuid>"
  original_name = "Saved\\Builds\\Win64.zip"
  content_type = "application/zip"
  byte_size = 10737418240 # 10GB (optional but recommended)
  memory_id = "<memory-uuid>" # optional: auto-link as attachment
} | ConvertTo-Json

$asset = Invoke-RestMethod "$api/api/assets" -Method Post -Headers $h -ContentType "application/json" -Body $body
$asset | ConvertTo-Json -Depth 10
```

### Upload One Part

```powershell
# Example: upload part 1
$assetId = $asset.id
$partNumber = 1

# Read a part from disk (your client should slice the file into chunks)
$bytes = [System.IO.File]::ReadAllBytes("C:\\path\\to\\part-1.bin")

Invoke-RestMethod "$api/api/assets/$assetId/parts/$partNumber" -Method Put -Headers $h -Body $bytes -ContentType "application/octet-stream"
```

### Complete Upload

```powershell
Invoke-RestMethod "$api/api/assets/$assetId/complete" -Method Post -Headers $h -ContentType "application/json" -Body "{}"
```

## MCP (Thin Layer)

MCP endpoint:

- `POST /mcp`

Auth is the same:

- `Authorization: Bearer <gdm_...>`

Example JSON-RPC:

```powershell
$mcp = "$api/mcp"
$req = @{
  jsonrpc = "2.0"
  id = 1
  method = "tools/list"
} | ConvertTo-Json

Invoke-RestMethod $mcp -Method Post -Headers $h -ContentType "application/json" -Body $req
```

## Evolution + Retrieval Policy

Arena endpoints:

- `POST /api/evolve/memory-arena/run`
- `POST /api/evolve/memory-arena/iterate`
- `POST /api/evolve/memory-arena/campaign`
- `GET /api/evolve/memory-arena/latest`

Project retrieval policy endpoint (materialized winner for hot agent paths):

- `GET /api/evolve/retrieval-policy?project_id=<project-uuid>`

Example:

```powershell
Invoke-RestMethod "$api/api/evolve/retrieval-policy?project_id=<project-uuid>" -Headers $h
```

Run a multi-project campaign:

```powershell
$body = @{
  max_projects = 10
  iterations_per_project = 200
  time_budget_ms = 600000
  persist_each_iteration = $false
} | ConvertTo-Json

Invoke-RestMethod "$api/api/evolve/memory-arena/campaign" -Method Post -Headers $h -ContentType "application/json" -Body $body
```

## Agent Endpoints

- `GET /api/agent/status`
- `POST /api/agent/ask`
- `POST /api/agent/sessions/:id/continue`
- `POST /api/agent-pro/sessions/:id/continue` (SSE streaming)

Notes:

- Agent routes are retrieval-first and now include deterministic fallback synthesis when LLM output is unavailable, so callers receive a usable `answer` payload.
- `dry_run=true` keeps retrieval-only semantics and does not persist assistant messages.
