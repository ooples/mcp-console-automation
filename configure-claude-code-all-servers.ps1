# Configure all MCP servers for Claude Code
# This script properly adds all the MCP servers to Claude Code

Write-Host "Configuring MCP servers for Claude Code..." -ForegroundColor Cyan
Write-Host "Note: This will configure servers for the current directory project" -ForegroundColor Yellow

# Add playwright
Write-Host "`nAdding playwright server..." -ForegroundColor Yellow
claude mcp add playwright node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@playwright\mcp\index.js" -e "NODE_OPTIONS=--enable-source-maps"

# Add filesystem
Write-Host "Adding filesystem server..." -ForegroundColor Yellow
claude mcp add filesystem node "--max-old-space-size=8192" "C:\Users\yolan\AppData\Roaming\npm\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js" "C:\Users\yolan\source\repos\CrowdTrainer" -e "NODE_OPTIONS=--max-old-space-size=8192"

# Add database
Write-Host "Adding database server..." -ForegroundColor Yellow
claude mcp add database node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@ahmetbarut\mcp-database-server\dist\index.js" -e "DATABASE_URL=postgresql://monitoring:monitoring_password@localhost:5433/monitoring_service" -e "MYSQL_HOST=localhost" -e "MYSQL_PORT=3306" -e "MYSQL_USER=root" -e "MYSQL_PASSWORD=password" -e "MYSQL_DATABASE=crowdtrainer"

# Add puppeteer
Write-Host "Adding puppeteer server..." -ForegroundColor Yellow
claude mcp add puppeteer node "C:\Users\yolan\AppData\Roaming\npm\node_modules\puppeteer-mcp-server\dist\index.js" -e "PUPPETEER_HEADLESS=false"

# Add firecrawl
Write-Host "Adding firecrawl server..." -ForegroundColor Yellow
claude mcp add firecrawl node "C:\Users\yolan\AppData\Roaming\npm\node_modules\firecrawl-mcp\dist\index.js" -e "FIRECRAWL_API_KEY=your-api-key-here"

# Add azure (optional - requires credentials)
Write-Host "Adding azure server..." -ForegroundColor Yellow
claude mcp add azure node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@azure\mcp\dist\index.js" -e "AZURE_SUBSCRIPTION_ID=your-subscription-id" -e "AZURE_TENANT_ID=your-tenant-id" -e "AZURE_CLIENT_ID=your-client-id" -e "AZURE_CLIENT_SECRET=your-client-secret"

# Add vercel (optional - requires token)
Write-Host "Adding vercel server..." -ForegroundColor Yellow
claude mcp add vercel node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@vercel\mcp-adapter\dist\index.js" -e "VERCEL_TOKEN=your-vercel-token"

# Add sentry (optional - requires DSN)
Write-Host "Adding sentry server..." -ForegroundColor Yellow
claude mcp add sentry node "C:\Users\yolan\AppData\Roaming\npm\node_modules\@sentry\mcp-server\dist\index.js" -e "SENTRY_DSN=your-sentry-dsn" -e "SENTRY_ORG=your-org" -e "SENTRY_PROJECT=crowdtrainer"

Write-Host "`n====================================" -ForegroundColor Cyan
Write-Host "Configuration complete!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Cyan

Write-Host "`nVerifying configuration..." -ForegroundColor Yellow
claude mcp list

Write-Host "`nIMPORTANT:" -ForegroundColor Red
Write-Host "1. MCP servers are configured PER PROJECT in Claude Code" -ForegroundColor Yellow
Write-Host "2. This configuration is saved in: .claude.json in your project root" -ForegroundColor Yellow
Write-Host "3. To use these servers in other projects, run this script from those directories" -ForegroundColor Yellow
Write-Host "4. Some servers (Azure, Vercel, Sentry, Firecrawl) need valid API keys to work" -ForegroundColor Yellow