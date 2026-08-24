# Binti Events - Admin credential bootstrap / recovery
#
# Usage (values resolved in this order: explicit param -> environment variable):
#   .\reset-admin.ps1 -SeedSecret "<YOUR_JWT_SECRET>"
#   $env:SUPABASE_URL="https://<ref>.supabase.co"; $env:SUPABASE_ANON_KEY="<anon>"; .\reset-admin.ps1 -SeedSecret "..."
#
# Optional overrides:
#   .\reset-admin.ps1 -SeedSecret "..." -Email "you@domain.com" -Password "NewPass123" -Name "Administrator"

param(
  [Parameter(Mandatory = $true)][string]$SeedSecret,
  [string]$ProjectUrl = $env:SUPABASE_URL,
  [string]$ApiKey     = $env:SUPABASE_ANON_KEY,
  [string]$Email      = 'admin@bintievents.co.ke',
  [string]$Password   = 'Admin@2026',
  [string]$Name       = 'Administrator'
)

$ErrorActionPreference = 'Stop'

if (-not $ProjectUrl) { Write-Host "ERROR: Project URL not provided. Pass -ProjectUrl or set `$env:SUPABASE_URL." -ForegroundColor Red; exit 1 }
if (-not $ApiKey)     { Write-Host "ERROR: Anon key not provided. Pass -ApiKey or set `$env:SUPABASE_ANON_KEY." -ForegroundColor Red; exit 1 }
$Base = $ProjectUrl.TrimEnd('/') + '/functions/v1'

function Read-ErrorBody($err) {
  try { return $err.ErrorDetails.Message } catch {}
  try { return $err.Exception.Response.Content.ReadAsStringAsync().GetAwaiter().GetResult() } catch {}
  return $err.Exception.Message
}

Write-Host "`n=== Step 1/2: Provision / reset admin ===" -ForegroundColor Cyan
$seedBody = @{ email = $Email; password = $Password; name = $Name } | ConvertTo-Json
try {
  $seed = Invoke-RestMethod -Uri "$Base/auth-seed-admin" -Method Post `
    -ContentType 'application/json' `
    -Headers @{ apikey = $ApiKey; 'x-seed-secret' = $SeedSecret } `
    -Body $seedBody
  Write-Host ($seed | ConvertTo-Json -Depth 5) -ForegroundColor Green
}
catch {
  Write-Host "SEED FAILED:" -ForegroundColor Red
  Write-Host (Read-ErrorBody $_) -ForegroundColor Red
  exit 1
}

Write-Host "`n=== Step 2/2: Verify login ===" -ForegroundColor Cyan
$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
try {
  $login = Invoke-RestMethod -Uri "$Base/auth-login" -Method Post `
    -ContentType 'application/json' `
    -Headers @{ apikey = $ApiKey } `
    -Body $loginBody
  Write-Host "LOGIN SUCCESSFUL" -ForegroundColor Green
  Write-Host ("User : {0} ({1})" -f $login.data.user.email, $login.data.user.role) -ForegroundColor Green
  $t = $login.data.token
  Write-Host ("Token: {0}...{1}" -f $t.Substring(0,20), $t.Substring($t.Length-10)) -ForegroundColor DarkGray
  Write-Host "`nYou can now sign in at the app with:" -ForegroundColor Yellow
  Write-Host "  Email:    $Email" -ForegroundColor Yellow
  Write-Host "  Password: $Password" -ForegroundColor Yellow
}
catch {
  Write-Host "LOGIN FAILED:" -ForegroundColor Red
  Write-Host (Read-ErrorBody $_) -ForegroundColor Red
  exit 1
}