# One-shot deploy of the VelOps CUSTOMER AI proxy to Azure (a separate Function
# App from the internal hub's velops-ai-proxy — own key, own CORS, own caps).
# Creates a resource group, storage account, and Function App (Node 24, v4 —
# Azure refuses new Node 20 apps since its EOL on 2026-04-30),
# publishes the code, and sets ALLOWED_ORIGINS. It does NOT set the Anthropic
# key or configure Easy Auth — those are deliberate manual/secure steps printed
# at the end. Run after `az login` to the correct (VelOps/getdigit) account.
#
# Usage (pass the real portal origin once the Power Pages site is activated):
#   ./deploy.ps1 -AllowedOrigins https://<your-site>.powerappsportals.com
param(
  [string]$FunctionApp   = "velops-customer-ai",
  [string]$ResourceGroup = "velops-customer-ai-rg",
  [string]$Location      = "westeurope",
  [string]$StorageAccount = "",
  [string]$AllowedOrigins = "https://velops-support.powerappsportals.com",
  [string]$SubscriptionId = ""
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($SubscriptionId) { az account set --subscription $SubscriptionId | Out-Null }
$acct = az account show --query "{name:name, user:user.name}" -o json | ConvertFrom-Json
Write-Host "Deploying as: $($acct.user)  /  subscription: $($acct.name)" -ForegroundColor Cyan

if (-not $StorageAccount) {
  # Reuse the storage account from an earlier (partial) run so re-runs are
  # idempotent instead of leaving orphans behind.
  $StorageAccount = az storage account list -g $ResourceGroup --query "[0].name" -o tsv 2>$null
}
if (-not $StorageAccount) {
  # Storage account names: 3-24 chars, lowercase letters+digits only, globally unique.
  $StorageAccount = ("velopscustai" + (Get-Random -Maximum 999999)).ToLower()
}

Write-Host "1/4  Resource group $ResourceGroup ($Location)..."
az group create -n $ResourceGroup -l $Location | Out-Null

Write-Host "2/4  Storage account $StorageAccount..."
az storage account create -n $StorageAccount -g $ResourceGroup -l $Location --sku Standard_LRS | Out-Null

Write-Host "3/4  Function App $FunctionApp (Node 24, Functions v4)..."
az functionapp create -n $FunctionApp -g $ResourceGroup `
  --storage-account $StorageAccount --consumption-plan-location $Location `
  --runtime node --runtime-version 24 --functions-version 4 `
  --disable-app-insights true | Out-Null
az functionapp config appsettings set -n $FunctionApp -g $ResourceGroup `
  --settings "ALLOWED_ORIGINS=$AllowedOrigins" | Out-Null

Write-Host "4/4  Installing deps + publishing code..."
npm install | Out-Null
# --javascript: language detection needs local.settings.json, which is not in
# the repo (only the .example) — CI checkouts must state the worker explicitly.
func azure functionapp publish $FunctionApp --javascript
if ($LASTEXITCODE -ne 0) { throw "func publish failed (exit $LASTEXITCODE)" }

$url = "https://$FunctionApp.azurewebsites.net/api/messages"
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Function deployed:  $url" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Remaining steps (the deploy-ai-proxy workflow does the first one" -ForegroundColor Yellow
Write-Host "automatically when the ANTHROPIC_API_KEY repo secret is set):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  A) Set the Anthropic key (secret — never commit it):"
Write-Host "     az functionapp config appsettings set -n $FunctionApp -g $ResourceGroup ``"
Write-Host "       --settings ANTHROPIC_API_KEY=""<your-anthropic-key>"""
Write-Host ""
Write-Host "  NOTE: no Easy Auth on this app — the CUSTOMER portal's visitors are"
Write-Host "  not tenant users, so Entra auth would block them. Access control is"
Write-Host "  the function key + ALLOWED_ORIGINS CORS (see src/functions/messages.js)."
Write-Host ""
Write-Host "Then set the repo variable AI_PROXY_URL to this URL and the secret"
Write-Host "AI_PROXY_FUNCTION_KEY to the dedicated 'portal' function key, and run"
Write-Host "Run Ops Script -> scripts/sync-spa-bundle.mjs so the SPA picks them up."
