# PowerShell script to update Claude configuration for ultra-persistent server
$configPath = "$env:APPDATA\Claude\claude_desktop_config.json"

Write-Host "Updating Claude configuration to use ultra-persistent server..." -ForegroundColor Green

# Read current config
$config = Get-Content $configPath -Raw | ConvertFrom-Json

# Update the console-automation configuration
$config.mcpServers.'console-automation'.args[1] = "C:\Users\yolan\source\repos\mcp-console-automation\src\mcp\ultra-persistent-server.ts"

# Save updated config
$config | ConvertTo-Json -Depth 10 | Set-Content $configPath

Write-Host "Configuration updated successfully!" -ForegroundColor Green
Write-Host "Path: $configPath" -ForegroundColor Yellow
Write-Host "New server: ultra-persistent-server.ts" -ForegroundColor Yellow
Write-Host ""
Write-Host "Please restart Claude Code for changes to take effect." -ForegroundColor Cyan