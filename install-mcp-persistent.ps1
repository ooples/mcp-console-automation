# Install MCP Persistent Server Configuration for Claude
# This script sets up the persistent MCP server configuration

$ErrorActionPreference = "Stop"

Write-Host "Installing MCP Console Automation Persistent Server..." -ForegroundColor Green

# Define paths
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$claudeConfigPath = "$env:APPDATA\Claude\claude_desktop_config.json"
$claudeConfigDir = Split-Path -Parent $claudeConfigPath

# Create Claude config directory if it doesn't exist
if (-not (Test-Path $claudeConfigDir)) {
    New-Item -ItemType Directory -Path $claudeConfigDir -Force | Out-Null
    Write-Host "Created Claude configuration directory" -ForegroundColor Yellow
}

# Load existing config or create new one
$config = @{}
if (Test-Path $claudeConfigPath) {
    Write-Host "Found existing Claude configuration" -ForegroundColor Yellow
    $config = Get-Content -Raw $claudeConfigPath | ConvertFrom-Json -AsHashtable
}

# Ensure mcpServers object exists
if (-not $config.ContainsKey("mcpServers")) {
    $config["mcpServers"] = @{}
}

# Configure the persistent server
$serverConfig = @{
    "command" = "npx"
    "args" = @(
        "tsx",
        "$projectPath\src\mcp\persistent-server.ts"
    )
    "env" = @{
        "LOG_LEVEL" = "info"
        "NODE_ENV" = "production"
        "NODE_OPTIONS" = "--max-old-space-size=4096"
    }
}

# Add or update the console-automation server
$config["mcpServers"]["console-automation"] = $serverConfig

# Save the configuration
$config | ConvertTo-Json -Depth 10 | Set-Content $claudeConfigPath -Encoding UTF8

Write-Host "`nConfiguration saved to: $claudeConfigPath" -ForegroundColor Green
Write-Host "`nPersistent MCP server features:" -ForegroundColor Cyan
Write-Host "  - Automatic reconnection on disconnect" -ForegroundColor White
Write-Host "  - Keepalive heartbeat (15s interval)" -ForegroundColor White
Write-Host "  - Connection state monitoring" -ForegroundColor White
Write-Host "  - Graceful error recovery" -ForegroundColor White
Write-Host "  - Session persistence across reconnects" -ForegroundColor White

Write-Host "`nInstallation complete!" -ForegroundColor Green
Write-Host "Please restart Claude Desktop for changes to take effect." -ForegroundColor Yellow

# Offer to test the server
$test = Read-Host "`nWould you like to test the persistent server now? (y/n)"
if ($test -eq 'y' -or $test -eq 'Y') {
    Write-Host "`nStarting persistent server test..." -ForegroundColor Cyan
    & npx tsx "$projectPath\src\mcp\persistent-server.ts"
}