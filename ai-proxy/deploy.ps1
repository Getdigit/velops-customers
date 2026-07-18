# One-shot deploy of the VelOps CUSTOMER AI proxy to Azure (a separate Function
# App from the internal hub's velops-ai-proxy — own key, own CORS, own caps).
# Creates a resource group, storage account, and Function App (Node 20, v4),
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
  # Storage account names: 3-24 chars, lowercase letters+digits only, globally unique.
  $StorageAccount = ("velopscustai" + (Get-Random -Maximum 999999)).ToLower()
}

Write-Host "1/4  Resource group $ResourceGroup ($Location)..."
az group create -n $ResourceGroup -l $Location | Out-Null

Write-Host "2/4  Storage account $StorageAccount..."
az storage account create -n $StorageAccount -g $ResourceGroup -l $Location --sku Standard_LRS | Out-Null

Write-Host "3/4  Function App $FunctionApp (Node 20, Functions v4)..."
az functionapp create -n $FunctionApp -g $ResourceGroup `
  --storage-account $StorageAccount --consumption-plan-location $Location `
  --runtime node --runtime-version 20 --functions-version 4 `
  --disable-app-insights true | Out-Null
az functionapp config appsettings set -n $FunctionApp -g $ResourceGroup `
  --settings "ALLOWED_ORIGINS=$AllowedOrigins" | Out-Null

Write-Host "4/4  Installing deps + publishing code..."
npm install | Out-Null
func azure functionapp publish $FunctionApp

$url = "https://$FunctionApp.azurewebsites.net/api/messages"
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Function deployed:  $url" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "TWO manual steps remain (security — do them in this order):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  A) Lock it down with Easy Auth (Entra ID) so only signed-in"
Write-Host "     team members can call it — Portal > $FunctionApp >"
Write-Host "     Authentication > Add identity provider > Microsoft >"
Write-Host "     Require authentication, unauthenticated = HTTP 401."
Write-Host ""
Write-Host "  B) Set your Anthropic key (your secret — never commit it):"
Write-Host "     az functionapp config appsettings set -n $FunctionApp -g $ResourceGroup ``"
Write-Host "       --settings ANTHROPIC_API_KEY=""<your-anthropic-key>"""
Write-Host ""
Write-Host "Then set the repo variable AI_PROXY_URL to this URL and the secret"
Write-Host "AI_PROXY_FUNCTION_KEY to a dedicated function key, and re-run the"
Write-Host "deploy-portal workflow so the SPA bundle picks them up."
