# Configure all MCP servers for Claude Code
# This script adds all the MCP servers that were installed globally to Claude Code

Write-Host "Configuring MCP servers for Claude Code..." -ForegroundColor Cyan

# Define all MCP servers to add
$servers = @(
    @{
        Name = "playwright"
        Command = "node"
        Args = "C:\Users\yolan\AppData\Roaming\npm\node_modules\@playwright\mcp\index.js"
    },
    @{
        Name = "filesystem"
        Command = "node"
        Args = "--max-old-space-size=8192,C:\Users\yolan\AppData\Roaming\npm\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js,C:\Users\yolan\source\repos\CrowdTrainer"
    },
    @{
        Name = "database"
        Command = "node"
        Args = "C:\Users\yolan\AppData\Roaming\npm\node_modules\@ahmetbarut\mcp-database-server\dist\index.js"
    },
    @{
        Name = "puppeteer"
        Command = "node"
        Args = "C:\Users\yolan\AppData\Roaming\npm\node_modules\puppeteer-mcp-server\dist\index.js"
    },
    @{
        Name = "firecrawl"
        Command = "node"
        Args = "C:\Users\yolan\AppData\Roaming\npm\node_modules\firecrawl-mcp\dist\index.js"
    },
    @{
        Name = "console-automation"
        Command = "node"
        Args = "C:\Users\yolan\source\repos\mcp-console-automation\dist\index.js"
    }
)

# Add each server
foreach ($server in $servers) {
    Write-Host "`nAdding $($server.Name)..." -ForegroundColor Yellow
    
    # Build the command
    $cmd = "claude mcp add $($server.Name) --command `"$($server.Command)`" --args `"$($server.Args)`""
    
    Write-Host "Running: $cmd" -ForegroundColor Gray
    
    try {
        $result = Invoke-Expression $cmd 2>&1
        if ($LASTEXITCODE -eq 0 -or $result -like "*already exists*") {
            Write-Host "[OK] $($server.Name) configured" -ForegroundColor Green
        } else {
            Write-Host "[WARNING] $($server.Name) may need manual configuration" -ForegroundColor Yellow
            Write-Host $result
        }
    } catch {
        Write-Host "[ERROR] Failed to add $($server.Name): $_" -ForegroundColor Red
    }
}

Write-Host "`n====================================" -ForegroundColor Cyan
Write-Host "Configuration complete!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Cyan

Write-Host "`nVerifying configuration..." -ForegroundColor Yellow
claude mcp list

Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Restart Claude Code (close and reopen terminal)" -ForegroundColor White
Write-Host "2. Run /mcp in Claude Code to verify servers are available" -ForegroundColor White
Write-Host "3. If servers do not appear, run /doctor for troubleshooting" -ForegroundColor White