param(
  [string]$InstallDir = "$HOME\.platform-dna\bootstrap",
  [string]$Ref = "v0.3.0"
)

$ErrorActionPreference = "Stop"
$BinDir = "$HOME\.local\bin"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("platform-dna-" + [guid]::NewGuid())
git clone --depth 1 --branch $Ref "https://github.com/raintr91/platform-dna.git" $TempDir
Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Split-Path $InstallDir) | Out-Null
Move-Item $TempDir $InstallDir
Push-Location $InstallDir
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  pnpm install --frozen-lockfile
  pnpm build
} else {
  npm ci
  npm run build
}
Pop-Location
New-Item -ItemType Directory -Force $BinDir | Out-Null
"@node `"$InstallDir\bin\platform-dna.mjs`" %*" | Set-Content "$BinDir\platform-dna.cmd"
Write-Host "Installed Platform DNA. Next:"
Write-Host "  cd C:\path\to\product"
Write-Host "  platform-dna init"
