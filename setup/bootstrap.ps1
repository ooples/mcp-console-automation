# One-time onboarding for a Windows machine to use the console-automation MCP
# against the shared server. Safe to re-run (idempotent).
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$sshDir = Join-Path $HOME '.ssh'
$key = Join-Path $sshDir 'claude_automation'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node >=18 required" }

Write-Host "[1/4] Build the MCP"
Push-Location $repo; npm install; npm run build; Pop-Location

Write-Host "[2/4] Register the MCP with Claude Code (user scope)"
if (Get-Command claude -ErrorAction SilentlyContinue) {
  try { claude mcp add console-automation --scope user -- node "$repo\dist\mcp\server.js" } catch { Write-Host "  (already registered or add manually)" }
} else { Write-Host "  WARN: 'claude' CLI not found on PATH — register manually." }

Write-Host "[3/4] Ensure this machine's ed25519 key"
New-Item -ItemType Directory -Force $sshDir | Out-Null
if (-not (Test-Path $key)) {
  ssh-keygen -t ed25519 -f $key -N '' -C "claude-automation@$env:COMPUTERNAME"
}
Write-Host "  >>> ADD THIS PUBLIC KEY to the server's ~/.ssh/authorized_keys:"
Write-Host "  ----------------------------------------------------------------"
Get-Content "$key.pub" | ForEach-Object { "  $_" }
Write-Host "  ----------------------------------------------------------------"

Write-Host "[4/4] Write the shared connection profile"
node "$repo\setup\apply-profile.mjs" "$repo\setup\server.json" $key

Write-Host ""
Write-Host "DONE. Restart Claude Code (or /mcp reconnect), then connect with the 'ooples-prod' profile."
Write-Host "NOTE: the connection only works after this machine's public key (above) is in the server's authorized_keys."
