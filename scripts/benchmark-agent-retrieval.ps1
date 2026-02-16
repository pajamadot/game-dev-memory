param(
  [string]$ApiUrl = "https://api-game-dev-memory.pajamadot.com",
  [string]$Token = $env:E2E_API_TOKEN,
  [string]$Query = "what changed in build failures this week",
  [string]$ProjectId = "",
  [int]$Iterations = 8,
  [int]$Warmup = 2,
  [string]$MemoryMode = "auto",
  [string]$RetrievalMode = "auto",
  [int]$Limit = 12,
  [int]$DocumentLimit = 8,
  [int]$CacheTtlMs = 20000,
  [switch]$NoCache
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Token)) {
  throw "Token required. Pass -Token or set E2E_API_TOKEN."
}

if ($Iterations -lt 1) { throw "Iterations must be >= 1" }
if ($Warmup -lt 0) { throw "Warmup must be >= 0" }

$api = $ApiUrl.TrimEnd("/")
$uri = "$api/api/agent/ask"
$headers = @{
  Authorization = "Bearer $Token"
  "Content-Type" = "application/json"
  Accept = "application/json"
}

function Percentile([double[]]$values, [double]$p) {
  if (-not $values -or $values.Count -eq 0) { return 0 }
  $sorted = $values | Sort-Object
  if ($sorted.Count -eq 1) { return [double]$sorted[0] }
  $idx = [Math]::Min($sorted.Count - 1, [Math]::Max(0, [int][Math]::Ceiling(($p / 100.0) * $sorted.Count) - 1))
  return [double]$sorted[$idx]
}

function Run-Ask([int]$runIndex) {
  $payload = @{
    query = $Query
    project_id = $(if ([string]::IsNullOrWhiteSpace($ProjectId)) { $null } else { $ProjectId })
    limit = $Limit
    document_limit = $DocumentLimit
    memory_mode = $MemoryMode
    retrieval_mode = $RetrievalMode
    include_assets = $true
    include_documents = $true
    dry_run = $true
    include_diagnostics = $true
    no_cache = [bool]$NoCache
    cache_ttl_ms = $CacheTtlMs
  }

  $json = $payload | ConvertTo-Json -Depth 10
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $json
  $sw.Stop()

  $diag = $resp.diagnostics
  $cache = $diag.cache
  $timings = $diag.timings_ms

  [pscustomobject]@{
    run = $runIndex
    latency_ms = [Math]::Round($sw.Elapsed.TotalMilliseconds, 2)
    api_total_ms = $(if ($timings -and $timings.total -ne $null) { [double]$timings.total } else { 0 })
    api_retrieval_ms = $(if ($timings -and $timings.retrieval -ne $null) { [double]$timings.retrieval } else { 0 })
    api_synthesis_ms = $(if ($timings -and $timings.synthesis -ne $null) { [double]$timings.synthesis } else { 0 })
    cache_enabled = $(if ($cache -and $cache.enabled -ne $null) { [bool]$cache.enabled } else { $false })
    cache_retrieval = $(if ($cache -and $cache.retrieval) { [string]$cache.retrieval } else { "-" })
    cache_plan = $(if ($cache -and $cache.plan) { [string]$cache.plan } else { "-" })
    cache_arena = $(if ($cache -and $cache.arena) { [string]$cache.arena } else { "-" })
    memory_count = $(if ($resp.retrieved.memories) { [int]$resp.retrieved.memories.Count } else { 0 })
    doc_count = $(if ($resp.retrieved.documents) { [int]$resp.retrieved.documents.Count } else { 0 })
  }
}

Write-Host "Benchmarking /api/agent/ask (dry_run=true)" -ForegroundColor Cyan
Write-Host "api=$api iterations=$Iterations warmup=$Warmup no_cache=$NoCache memory_mode=$MemoryMode retrieval_mode=$RetrievalMode" -ForegroundColor DarkCyan

for ($i = 1; $i -le $Warmup; $i++) {
  [void](Run-Ask -runIndex (-1 * $i))
}

$rows = @()
for ($i = 1; $i -le $Iterations; $i++) {
  $rows += Run-Ask -runIndex $i
}

$lat = @($rows | ForEach-Object { [double]$_.latency_ms })
$apiTotal = @($rows | ForEach-Object { [double]$_.api_total_ms })
$apiRetrieval = @($rows | ForEach-Object { [double]$_.api_retrieval_ms })

$summary = [pscustomobject]@{
  iterations = $Iterations
  latency_avg_ms = [Math]::Round((($lat | Measure-Object -Average).Average), 2)
  latency_p50_ms = [Math]::Round((Percentile -values $lat -p 50), 2)
  latency_p95_ms = [Math]::Round((Percentile -values $lat -p 95), 2)
  api_total_avg_ms = [Math]::Round((($apiTotal | Measure-Object -Average).Average), 2)
  api_retrieval_avg_ms = [Math]::Round((($apiRetrieval | Measure-Object -Average).Average), 2)
  cache_retrieval_hits = ($rows | Where-Object { $_.cache_retrieval -eq "hit" }).Count
  cache_retrieval_misses = ($rows | Where-Object { $_.cache_retrieval -eq "miss" }).Count
}

$rows | Format-Table run, latency_ms, api_total_ms, api_retrieval_ms, cache_retrieval, cache_plan, cache_arena, memory_count, doc_count -AutoSize
Write-Host ""
$summary | Format-List
