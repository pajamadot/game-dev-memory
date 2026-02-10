param(
  [string]$Bucket = "game-dev-memory",
  [string]$BaseUrl = "https://api-game-dev-memory.pajamadot.com/downloads/pajama"
)

$ErrorActionPreference = "Stop"

$IsWin = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
$IsMac = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::OSX)
$IsLin = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Linux)

function Get-CrateVersion([string]$CargoTomlPath) {
  $text = Get-Content -Path $CargoTomlPath -Raw
  if ($text -match '(?m)^version\s*=\s*"([^"]+)"\s*$') {
    return $Matches[1]
  }
  throw "Could not parse version from $CargoTomlPath"
}

function Get-PlatformTriplet() {
  $plat =
    if ($IsWin) { "win32" }
    elseif ($IsMac) { "darwin" }
    else { "linux" }

  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLower()
  if ($arch -eq "x64") { $arch = "x64" }
  elseif ($arch -eq "arm64") { $arch = "arm64" }
  else { throw "Unsupported arch for release script: $arch" }

  return @{ platform = $plat; arch = $arch }
}

$root = Split-Path -Parent $PSScriptRoot
$crateDir = Join-Path $root "pajama"
$cargoToml = Join-Path $crateDir "Cargo.toml"
$ver = Get-CrateVersion $cargoToml
$tag = "v$ver"

$triplet = Get-PlatformTriplet
$platform = $triplet.platform
$arch = $triplet.arch

$srcExe =
  if ($IsWin) { Join-Path $crateDir "target\\release\\pajama.exe" }
  else { Join-Path $crateDir "target/release/pajama" }

$fileName =
  if ($platform -eq "win32") { "pajama-win32-$arch.exe" }
  else { "pajama-$platform-$arch" }

Write-Host "[release] Building pajama $tag ($platform/$arch)..."
Push-Location $crateDir
cargo build --release
Pop-Location

if (!(Test-Path $srcExe)) {
  throw "Missing release binary at $srcExe"
}

$sha = (Get-FileHash -Algorithm SHA256 -Path $srcExe).Hash.ToLower()
$shaTmp = Join-Path $env:TEMP ("$fileName.sha256")
Set-Content -Path $shaTmp -Value $sha -NoNewline

$key = "releases/pajama/$tag/$fileName"
$shaKey = "$key.sha256"

Write-Host "[release] Uploading to R2: $Bucket/$key"
Push-Location (Join-Path $root "api")
npx wrangler r2 object put "$Bucket/$key" --file "$srcExe" --content-type "application/octet-stream" --content-disposition "attachment; filename=\"$fileName\""
npx wrangler r2 object put "$Bucket/$shaKey" --file "$shaTmp" --content-type "text/plain; charset=utf-8" --cache-control "public, max-age=31536000, immutable"
Pop-Location

Write-Host "[release] Done."
Write-Host "[release] Download URL:"
Write-Host ("{0}/{1}/{2}" -f $BaseUrl, $tag, $fileName)
Write-Host "[release] SHA256:"
Write-Host $sha
