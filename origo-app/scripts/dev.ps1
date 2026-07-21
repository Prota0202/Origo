# Démarre API + front ORIGO (Postgres doit tourner)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ">> API (port 3001)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\server'; npm run dev"
Start-Sleep -Seconds 2
Write-Host ">> Front (port 5173)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; npm run dev"
Write-Host ""
Write-Host "Front : http://localhost:5173"
Write-Host "API   : http://localhost:3001"
Write-Host "Comptes : BOMBAY/1234 · MARCO/1234 · ORIGO/admin2026 · PREPA/prepa2026 · LIVREUR/livreur2026"
