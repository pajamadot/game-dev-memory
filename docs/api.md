# API Usage (Current)

The API is multi-tenant. Until Clerk auth is wired end-to-end, tenancy is passed via headers.

## Tenancy Headers

Required on most routes:

- `X-Tenant-Type`: `user` or `org`
- `X-Tenant-Id`: tenant identifier (Clerk user id or Clerk org id)

Optional:

- `X-Actor-Id`: actor/user identifier (stored as `created_by` / `updated_by`)

Example (PowerShell):

```powershell
$h = @{
  "X-Tenant-Type" = "user"
  "X-Tenant-Id" = "dev-user"
  "X-Actor-Id" = "dev-user"
}

Invoke-RestMethod "http://localhost:8787/api/projects" -Headers $h
```

## Sessions

Create a session (boundary for "auto evolve"):

```powershell
$body = @{
  project_id = "<project-uuid>"
  kind = "coding"
  context = @{ branch = "main" }
} | ConvertTo-Json

Invoke-RestMethod "http://localhost:8787/api/sessions" -Method Post -Headers $h -ContentType "application/json" -Body $body
```

Close a session:

```powershell
Invoke-RestMethod "http://localhost:8787/api/sessions/<session-uuid>/close" -Method Post -Headers $h
```

## Artifacts (R2)

Create an artifact record:

```powershell
$body = @{
  project_id = "<project-uuid>"
  session_id = "<session-uuid>"
  type = "ue_log"
  storage_mode = "single" # or "chunked"
  content_type = "text/plain"
  metadata = @{ path = "Saved/Logs/Game.log" }
} | ConvertTo-Json

Invoke-RestMethod "http://localhost:8787/api/artifacts" -Method Post -Headers $h -ContentType "application/json" -Body $body
```

Upload as a single object:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("C:\\path\\to\\Game.log")
Invoke-WebRequest "http://localhost:8787/api/artifacts/<artifact-uuid>/object" -Method Put -Headers $h -ContentType "text/plain" -Body $bytes
```

Upload chunked (repeat per chunk):

```powershell
$chunk = [System.IO.File]::ReadAllBytes("C:\\path\\chunk-000.bin")
Invoke-WebRequest "http://localhost:8787/api/artifacts/<artifact-uuid>/chunks/0?byte_start=0&byte_end=1048575" -Method Put -Headers $h -ContentType "application/octet-stream" -Body $chunk
```

List chunks:

```powershell
Invoke-RestMethod "http://localhost:8787/api/artifacts/<artifact-uuid>/chunks" -Headers $h
```

Fetch a chunk:

```powershell
Invoke-WebRequest "http://localhost:8787/api/artifacts/<artifact-uuid>/chunks/0" -Headers $h -OutFile chunk.bin
```

