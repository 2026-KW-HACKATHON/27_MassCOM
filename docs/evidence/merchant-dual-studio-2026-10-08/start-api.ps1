$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\Hackerton\27_MassCOM-latest'
$env:PGPASSWORD = [IO.File]::ReadAllText('C:\Hackerton\27_MassCOM\.omx\qa-postgres\db-password.txt').Trim()
$env:DATABASE_URL = 'postgresql://masscom_qa@127.0.0.1:55437/masscom_showcase_ci_20261008133817_test'
$env:PORT = '3308'
$env:API_BIND_HOST = '127.0.0.1'
$env:ALLOW_INSECURE_DEMO_ACCOUNT = 'true'
$env:NFT_MINTING_MODE = 'PREPARING'
$taskPreviewBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($taskPreviewBytes)
$taskPreviewHmac = [BitConverter]::ToString($taskPreviewBytes) -replace '-', ''
$env:ACCOUNT_DELETION_HMAC_SECRET = $taskPreviewHmac
$env:MERCHANT_REFERENCE_HMAC_SECRET = $taskPreviewHmac
Remove-Item Env:SHOWCASE_MODE -ErrorAction SilentlyContinue
Remove-Item Env:GOOGLE_OAUTH_CLIENT_IDS -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_PUSH_ACCESS_TOKEN -ErrorAction SilentlyContinue
& '.\apps\api\node_modules\.bin\tsx.cmd' apps/api/src/server.ts
exit $LASTEXITCODE
