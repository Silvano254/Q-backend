# Binti Events - Admin credential bootstrap / recovery
#
# NO CREDENTIALS ARE HARDCODED. You must supply everything explicitly.
#
# Usage:
#   .\reset-admin.ps1 -SeedSecret "<JWT_SECRET>" -Email "<login-email>" -Password "<login-password>"
#
# Project URL / anon key resolve as: explicit param -> env var -> .\env file
#   ($env:SUPABASE_URL / $env:SUPABASE_ANON_KEY, or keys in .\.env)

param(
  [Parameter(Mandatory = $true)][string]$SeedSecret,
  [Parameter(Mandatory = $true)][string]$Email,
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$ProjectUrl = $env:SUPABASE_URL,
  [string]$ApiKey     = $env:SUPABASE_ANON_KEY,
  [string]$Name       = 'Administrator'
)

$ErrorActionPreference = 'Stop'

# Resolution order: explicit param -> environment variable -> local .env file
function Get-DotEnvValue([string]$Key) {
  $envPath = Join-Path $PSScriptRoot '.env'
  if (-not (Test-Path $envPath)) { return $null }
  foreach ($line in Get-Content $envPath) {
    if ($line -match ('^\s*' + [regex]::Escape($Key) + '\s*=\s*(.+?)\s*$')) {
      return $Matches[1].Trim('"', "'")
    }
  }
  return $null
}

if (-not $ProjectUrl) { $ProjectUrl = Get-DotEnvValue 'SUPABASE_URL' }
if (-not $ApiKey) {
  # Anon key preferred; fall back to service-role key (valid as an apikey header)
  $ApiKey = Get-DotEnvValue 'SUPABASE_ANON_KEY'
  if (-not $ApiKey) { $ApiKey = $env:SUPABASE_SERVICE_ROLE_KEY }
  if (-not $ApiKey) { $ApiKey = Get-DotEnvValue 'SUPABASE_SERVICE_ROLE_KEY' }
}

if (-not $ProjectUrl) { Write-Host "ERROR: Project URL not found. Pass -ProjectUrl, set `$env:SUPABASE_URL, or add SUPABASE_URL=<url> to .\.env" -ForegroundColor Red; exit 1 }
if (-not $ApiKey)     { Write-Host "ERROR: Anon key not found. Pass -ApiKey, set `$env:SUPABASE_ANON_KEY, or add SUPABASE_ANON_KEY=<key> to .\.env" -ForegroundColor Red; exit 1 }
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
  Write-Host "`nYou can now sign in at the app with the email/password you supplied." -ForegroundColor Yellow
}
catch {
  Write-Host "LOGIN FAILED:" -ForegroundColor Red
  Write-Host (Read-ErrorBody $_) -ForegroundColor Red
  exit 1
}