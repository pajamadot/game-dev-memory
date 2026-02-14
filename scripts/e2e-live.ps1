param(
  [string]$WebOrigin = "https://game-dev-memory.pajamadot.com",
  [string]$ApiOrigin = "https://api-game-dev-memory.pajamadot.com",
  [string]$McpOrigin = "https://mcp-game-dev-memory.pajamadot.com",
  [string]$AgentOrigin = "https://game-dev-agent.pajamadot.com",
  [string]$ApiToken = ""
)

$ErrorActionPreference = "Stop"

$env:E2E_LIVE = "true"
$env:E2E_START_SERVER = "false"
$env:PLAYWRIGHT_BASE_URL = $WebOrigin
$env:E2E_API_ORIGIN = $ApiOrigin
$env:E2E_MCP_ORIGIN = $McpOrigin
$env:E2E_AGENT_ORIGIN = $AgentOrigin

if ($ApiToken) {
  $env:E2E_API_TOKEN = $ApiToken
}

Write-Host "[e2e-live] Web:   $WebOrigin"
Write-Host "[e2e-live] API:   $ApiOrigin"
Write-Host "[e2e-live] MCP:   $McpOrigin"
Write-Host "[e2e-live] Agent: $AgentOrigin"
Write-Host ("[e2e-live] Auth:  " + ($(if ($ApiToken) { "token provided (authenticated checks enabled)" } else { "no token (public + unauth checks only)" })))

npm run e2e

