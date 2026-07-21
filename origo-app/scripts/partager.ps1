# Expose ORIGO sur Internet (tunnel Cloudflare) pour qu'un pote teste depuis chez lui.
# Prérequis : front + API déjà lancés (scripts\dev.ps1) et Postgres allumé.
$ErrorActionPreference = "Stop"

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  $candidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) {
      $cloudflared = $p
      break
    }
  }
}

if (-not $cloudflared) {
  Write-Host "cloudflared introuvable. Installe : winget install Cloudflare.cloudflared"
  exit 1
}

try {
  $null = Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing -TimeoutSec 3
} catch {
  Write-Host "Le front ne répond pas sur http://localhost:5173"
  Write-Host "Lance d'abord :  .\scripts\dev.ps1"
  exit 1
}

Write-Host ""
Write-Host "Tunnel Cloudflare en cours..."
Write-Host "Une URL https://….trycloudflare.com va s'afficher — envoie-la a ton pote."
Write-Host "Laisse cette fenetre ouverte tant qu'il teste. Ctrl+C pour couper."
Write-Host ""
Write-Host "Comptes demo :"
Write-Host "  BOMBAY / 1234     (client)"
Write-Host "  MARCO  / 1234     (client)"
Write-Host "  ORIGO  / admin2026"
Write-Host "  PREPA  / prepa2026"
Write-Host "  LIVREUR / livreur2026"
Write-Host ""

& $cloudflared tunnel --url http://localhost:5173
