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

