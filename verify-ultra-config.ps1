# Verify ultra-persistent server configuration
$configPath = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"

Write-Host "`n🔍 Checking Claude Configuration..." -ForegroundColor Cyan
Write-Host "Config path: $configPath`n" -ForegroundColor Gray

if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $consoleAutomation = $config.mcpServers.'console-automation'
    
    if ($consoleAutomation) {
        Write-Host "✅ console-automation MCP server found!" -ForegroundColor Green
        Write-Host "`nConfiguration:" -ForegroundColor Yellow
        Write-Host "  Command: $($consoleAutomation.command)" -ForegroundColor Gray
        Write-Host "  Args: $($consoleAutomation.args -join ' ')" -ForegroundColor Gray
        
        if ($consoleAutomation.args[1] -like "*ultra-persistent-server.ts") {
            Write-Host "`n🎉 ULTRA-PERSISTENT SERVER IS CONFIGURED!" -ForegroundColor Green
            Write-Host "SSH errors will no longer disconnect the MCP server." -ForegroundColor Green
        } elseif ($consoleAutomation.args[1] -like "*persistent-server.ts") {
            Write-Host "`n⚠️ Using persistent-server.ts (not ultra)" -ForegroundColor Yellow
            Write-Host "Run setup-ultra-persistent.ps1 to upgrade" -ForegroundColor Yellow
        } else {
            Write-Host "`n❌ Using old server configuration" -ForegroundColor Red
            Write-Host "Run setup-ultra-persistent.ps1 to upgrade" -ForegroundColor Red
        }
        
        Write-Host "`nEnvironment Variables:" -ForegroundColor Yellow
        $consoleAutomation.env.PSObject.Properties | ForEach-Object {
            Write-Host "  $($_.Name): $($_.Value)" -ForegroundColor Gray
        }
    } else {
        Write-Host "console-automation not found in config!" -ForegroundColor Red
    }
} else {
    Write-Host "Claude config file not found at: $configPath" -ForegroundColor Red
}