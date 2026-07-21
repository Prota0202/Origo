# Configure la DB PostgreSQL ORIGO (utilisateur + base)
# Usage : powershell -ExecutionPolicy Bypass -File scripts/setup-db.ps1

$ErrorActionPreference = "Stop"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
if (-not (Test-Path $psql)) {
  Write-Error "PostgreSQL 16 introuvable. Installe-le ou utilise Docker Compose."
}

$env:PGPASSWORD = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "origo_admin" }

Write-Host "Creation role/base origo..."
& $psql -U postgres -h localhost -p 5432 -v ON_ERROR_STOP=1 -c @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'origo') THEN
    CREATE ROLE origo LOGIN PASSWORD 'origo';
  END IF;
END
`$`$;
"@

$exists = (& $psql -U postgres -h localhost -p 5432 -tc "SELECT 1 FROM pg_database WHERE datname='origo'").Trim()
if ($exists -ne "1") {
  & $psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE origo OWNER origo;"
}

& $psql -U postgres -h localhost -p 5432 -d origo -c "GRANT ALL ON SCHEMA public TO origo; ALTER SCHEMA public OWNER TO origo;"
Write-Host "OK — DATABASE_URL=postgresql://origo:origo@localhost:5432/origo"
