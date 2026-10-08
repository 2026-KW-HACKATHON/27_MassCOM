$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location -LiteralPath $repoRoot
$pgRoot = if ($env:MERCHANT_DUAL_STUDIO_QA_POSTGRES_ROOT) { $env:MERCHANT_DUAL_STUDIO_QA_POSTGRES_ROOT } else { Join-Path $repoRoot '.omx\qa-postgres' }
Set-Item -Path Env:PGPASSWORD -Value ([IO.File]::ReadAllText((Join-Path $pgRoot 'db-password.txt')).Trim())
$env:DATABASE_URL = 'postgresql://masscom_qa@127.0.0.1:55437/masscom_showcase_ci_202610082fea38_test'
$env:PORT = '3309'
$env:API_BIND_HOST = '127.0.0.1'
# Local demo QA only: synthetic account headers must never be enabled in production.
$env:ALLOW_INSECURE_DEMO_ACCOUNT = 'true'
$env:NFT_MINTING_MODE = 'PREPARING'
$taskPreviewBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($taskPreviewBytes)
$taskPreviewHmac = [BitConverter]::ToString($taskPreviewBytes) -replace '-', ''
Set-Item -Path Env:ACCOUNT_DELETION_HMAC_SECRET -Value $taskPreviewHmac
Set-Item -Path Env:MERCHANT_REFERENCE_HMAC_SECRET -Value $taskPreviewHmac
Remove-Item Env:SHOWCASE_MODE -ErrorAction SilentlyContinue
Remove-Item Env:GOOGLE_OAUTH_CLIENT_IDS -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_PUSH_ACCESS_TOKEN -ErrorAction SilentlyContinue
& '.\apps\api\node_modules\.bin\tsx.cmd' apps/api/src/server.ts
exit $LASTEXITCODE
