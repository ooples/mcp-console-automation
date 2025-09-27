# Verify ultra-persistent server configuration
$configPath = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"

Write-Host ""
Write-Host "Checking Claude Configuration..." -ForegroundColor Cyan
Write-Host "Config path: $configPath" -ForegroundColor Gray
Write-Host ""

if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $consoleAutomation = $config.mcpServers.'console-automation'
    
    if ($consoleAutomation) {
        Write-Host "console-automation MCP server found!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Configuration:" -ForegroundColor Yellow
        Write-Host "  Command: $($consoleAutomation.command)" -ForegroundColor Gray
        Write-Host "  Args: $($consoleAutomation.args -join ' ')" -ForegroundColor Gray
        Write-Host ""
        
        if ($consoleAutomation.args[1] -like "*ultra-persistent-server.ts") {
            Write-Host "ULTRA-PERSISTENT SERVER IS CONFIGURED!" -ForegroundColor Green
            Write-Host "SSH errors will no longer disconnect the MCP server." -ForegroundColor Green
        } elseif ($consoleAutomation.args[1] -like "*persistent-server.ts") {
            Write-Host "Using persistent-server.ts (not ultra)" -ForegroundColor Yellow
            Write-Host "Run setup-ultra-persistent.ps1 to upgrade" -ForegroundColor Yellow
        } else {
            Write-Host "Using old server configuration" -ForegroundColor Red
            Write-Host "Run setup-ultra-persistent.ps1 to upgrade" -ForegroundColor Red
        }
    } else {
        Write-Host "console-automation not found in config!" -ForegroundColor Red
    }
} else {
    Write-Host "Claude config file not found!" -ForegroundColor Red
}