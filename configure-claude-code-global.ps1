# Configure MCP servers GLOBALLY for Claude Code
# This script sets up MCP servers to be available in ALL projects

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Configuring GLOBAL MCP servers for Claude Code" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

# First, remove all local configurations
Write-Host "`nRemoving local MCP server configurations..." -ForegroundColor Yellow
$servers = @("console-automation", "playwright", "database", "puppeteer", "firecrawl", "azure", "vercel", "sentry", "filesystem")
foreach ($server in $servers) {
    claude mcp remove $server 2>&1 | Out-Null
}

Write-Host "Local configurations removed." -ForegroundColor Green

# Now add servers globally with --scope user
Write-Host "`nAdding MCP servers globally (--scope user)..." -ForegroundColor Cyan

# Console Automation
Write-Host "`n[1/9] Adding console-automation..." -ForegroundColor Yellow
claude mcp add console-automation node "C:\Users\yolan\source\repos\mcp-console-automation\dist\index.js" --scope user -e "LOG_LEVEL=info"

# Playwright (using npx for ES module)
Write-Host "[2/9] Adding playwright..." -ForegroundColor Yellow
claude mcp add playwright npx "@playwright/mcp" --scope user -e "NODE_OPTIONS=--enable-source-maps"

# Filesystem - Note: Path can be overridden per project if needed
Write-Host "[3/9] Adding filesystem..." -ForegroundColor Yellow
claude mcp add filesystem node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js" "C:\Users\yolan\source\repos" --scope user -e "NODE_OPTIONS=--max-old-space-size=8192"

# Database
Write-Host "[4/9] Adding database..." -ForegroundColor Yellow
claude mcp add database node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@ahmetbarut\mcp-database-server\dist\index.js" --scope user -e "DATABASE_URL=postgresql://monitoring:monitoring_password@localhost:5433/monitoring_service" -e "MYSQL_HOST=localhost" -e "MYSQL_PORT=3306" -e "MYSQL_USER=root" -e "MYSQL_PASSWORD=password" -e "MYSQL_DATABASE=crowdtrainer"

# Puppeteer
Write-Host "[5/9] Adding puppeteer..." -ForegroundColor Yellow
claude mcp add puppeteer node "C:\Users\yolan\AppData\Roaming\npm\node_modules\puppeteer-mcp-server\dist\index.js" --scope user -e "PUPPETEER_HEADLESS=false"

# Firecrawl
Write-Host "[6/9] Adding firecrawl..." -ForegroundColor Yellow
claude mcp add firecrawl node "C:\Users\yolan\AppData\Roaming\npm\node_modules\firecrawl-mcp\dist\index.js" --scope user -e "FIRECRAWL_API_KEY=your-api-key-here"

# Azure (optional - requires credentials)
Write-Host "[7/9] Adding azure..." -ForegroundColor Yellow
claude mcp add azure node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@azure\mcp\dist\index.js" --scope user -e "AZURE_SUBSCRIPTION_ID=your-subscription-id" -e "AZURE_TENANT_ID=your-tenant-id" -e "AZURE_CLIENT_ID=your-client-id" -e "AZURE_CLIENT_SECRET=your-client-secret"

# Vercel (optional - requires token)
Write-Host "[8/9] Adding vercel..." -ForegroundColor Yellow
claude mcp add vercel node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@vercel\mcp-adapter\dist\index.js" --scope user -e "VERCEL_TOKEN=your-vercel-token"

# Sentry (optional - requires DSN)
Write-Host "[9/9] Adding sentry..." -ForegroundColor Yellow
claude mcp add sentry node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@sentry\mcp-server\dist\index.js" --scope user -e "SENTRY_DSN=your-sentry-dsn" -e "SENTRY_ORG=your-org" -e "SENTRY_PROJECT=crowdtrainer"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Global configuration complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nVerifying global configuration..." -ForegroundColor Yellow
claude mcp list --scope user

Write-Host "`nIMPORTANT:" -ForegroundColor Red
Write-Host "1. MCP servers are now configured GLOBALLY for ALL Claude Code projects" -ForegroundColor Green
Write-Host "2. You may need to restart Claude Code for changes to take effect" -ForegroundColor Yellow
Write-Host "3. Some servers (Azure, Vercel, Sentry) need valid API keys to work" -ForegroundColor Yellow
Write-Host "4. The filesystem server defaults to C:\Users\yolan\source\repos" -ForegroundColor Yellow
Write-Host "   You can override this per-project if needed" -ForegroundColor Yellow