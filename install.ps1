# MCP Console Automation Installer for Windows
# Supports: Claude Desktop, Google AI Studio, OpenAI Desktop, and custom MCP clients

param(
    [Parameter()]
    [ValidateSet("claude", "claude-code", "google", "openai", "custom", "all")]
    [string]$Target = "claude",
    
    [Parameter()]
    [string]$CustomPath = "",
    
    [Parameter()]
    [switch]$Dev = $false
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Error { Write-Host $args -ForegroundColor Red }

Write-Info @"
===================================================
MCP Console Automation Server - Installer
===================================================
"@

# Get installation directory
$installDir = $PSScriptRoot

# Check Node.js installation
Write-Info "`nChecking Node.js installation..."
try {
    $nodeVersion = node --version
    Write-Success "✓ Node.js $nodeVersion found"
} catch {
    Write-Error "✗ Node.js not found. Please install Node.js 18+ from https://nodejs.org"
    exit 1
}

# Install dependencies
Write-Info "`nInstalling dependencies..."
Set-Location $installDir
npm install --production 2>&1 | Out-String

# Build TypeScript
Write-Info "Building TypeScript..."
npm run build 2>&1 | Out-String

if (-not (Test-Path "dist\index.js")) {
    Write-Error "✗ Build failed. dist\index.js not found"
    exit 1
}

Write-Success "✓ Build completed successfully"

# Configuration functions
function Install-ClaudeDesktop {
    Write-Info "`nConfiguring for Claude Desktop..."
    
    $configPath = "$env:APPDATA\Claude\claude_desktop_config.json"
    $configDir = Split-Path $configPath -Parent
    
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    
    $config = if (Test-Path $configPath) {
        Get-Content $configPath -Raw | ConvertFrom-Json
    } else {
        @{}
    }
    
    if (-not $config.mcpServers) {
        $config | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value @{} -Force
    }
    
    $serverPath = if ($Dev) { 
        "$installDir\src\index.ts"
    } else {
        "$installDir\dist\index.js"
    }
    
    $serverConfig = @{
        command = if ($Dev) { "npx" } else { "node" }
        args = if ($Dev) { @("tsx", $serverPath) } else { @($serverPath) }
        env = @{
            LOG_LEVEL = "info"
        }
    }
    
    $config.mcpServers."console-automation" = $serverConfig
    
    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath
    
    Write-Success "✓ Claude Desktop configured at: $configPath"
    Write-Warning "  Please restart Claude Desktop for changes to take effect"
}

function Install-GoogleAI {
    Write-Info "`nConfiguring for Google AI Studio..."
    
    $configPath = "$env:USERPROFILE\.config\google-ai-studio\mcp_config.json"
    $configDir = Split-Path $configPath -Parent
    
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    
    $config = if (Test-Path $configPath) {
        Get-Content $configPath -Raw | ConvertFrom-Json
    } else {
        @{ servers = @{} }
    }
    
    $serverPath = "$installDir\dist\index.js"
    
    $config.servers."console-automation" = @{
        type = "stdio"
        command = "node"
        args = @($serverPath)
        description = "Console application automation and monitoring"
    }
    
    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath
    
    Write-Success "✓ Google AI Studio configured at: $configPath"
}

function Install-OpenAI {
    Write-Info "`nConfiguring for OpenAI Desktop..."
    
    $configPath = "$env:LOCALAPPDATA\OpenAI\desktop\mcp_servers.json"
    $configDir = Split-Path $configPath -Parent
    
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    
    $config = if (Test-Path $configPath) {
        Get-Content $configPath -Raw | ConvertFrom-Json
    } else {
        @{ servers = @() }
    }
    
    $serverPath = "$installDir\dist\index.js"
    
    $serverEntry = @{
        name = "console-automation"
        command = "node"
        args = @($serverPath)
        type = "stdio"
    }
    
    # Remove existing entry if present
    $config.servers = @($config.servers | Where-Object { $_.name -ne "console-automation" })
    $config.servers += $serverEntry
    
    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath
    
    Write-Success "✓ OpenAI Desktop configured at: $configPath"
}

function Install-ClaudeCode {
    Write-Info "`nConfiguring for Claude Code (CLI)..."
    
    $serverPath = if ($Dev) { 
        "$installDir\src\index.ts"
    } else {
        "$installDir\dist\index.js"
    }
    
    # Use claude mcp add command to configure the server
    $command = if ($Dev) { "npx" } else { "node" }
    $args = if ($Dev) { "tsx,$serverPath" } else { $serverPath }
    
    Write-Info "Adding console-automation server to Claude Code..."
    
    # Build the command to add MCP server
    $addCommand = "claude mcp add console-automation --command `"$command`" --args `"$args`""
    
    Write-Info "Running: $addCommand"
    
    try {
        $result = Invoke-Expression $addCommand 2>&1
        Write-Success "✓ Claude Code MCP server configured"
        Write-Info "  Server: console-automation"
        Write-Info "  Command: $command"
        Write-Info "  Args: $args"
    } catch {
        Write-Warning "Failed to add server automatically. Please run manually:"
        Write-Host "claude mcp add console-automation --command `"$command`" --args `"$args`"" -ForegroundColor Yellow
    }
    
    Write-Info "`nYou can verify with: claude mcp list"
}

function Install-Custom {
    param([string]$Path)
    
    Write-Info "`nConfiguring for custom MCP client..."
    
    if (-not $Path) {
        Write-Warning "Please provide a config file path with -CustomPath parameter"
        return
    }
    
    $configDir = Split-Path $Path -Parent
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    
    $serverPath = "$installDir\dist\index.js"
    
    Write-Info "Add the following to your MCP configuration:"
    $configJson = @"
{
  "console-automation": {
    "command": "node",
    "args": ["$serverPath"],
    "env": {
      "LOG_LEVEL": "info"
    }
  }
}
"@
    Write-Host $configJson -ForegroundColor Yellow
    
    if (Test-Path $Path) {
        Write-Warning "`nConfiguration file exists at: $Path"
        Write-Warning "Please manually add the above configuration to avoid overwriting"
    } else {
        $config = @{
            servers = @{
                "console-automation" = @{
                    command = "node"
                    args = @($serverPath)
                    env = @{
                        LOG_LEVEL = "info"
                    }
                }
            }
        }
        $config | ConvertTo-Json -Depth 10 | Set-Content $Path
        Write-Success "✓ Configuration written to: $Path"
    }
}

# Perform installation based on target
switch ($Target) {
    "claude" { Install-ClaudeDesktop }
    "claude-code" { Install-ClaudeCode }
    "google" { Install-GoogleAI }
    "openai" { Install-OpenAI }
    "custom" { Install-Custom -Path $CustomPath }
    "all" {
        Install-ClaudeDesktop
        Install-ClaudeCode
        Install-GoogleAI
        Install-OpenAI
    }
}

# Create desktop shortcut for testing
$shortcutPath = "$env:USERPROFILE\Desktop\Test MCP Console.lnk"
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoExit -Command `"cd '$installDir'; npm run dev`""
$Shortcut.WorkingDirectory = $installDir
$Shortcut.IconLocation = "powershell.exe"
$Shortcut.Description = "Test MCP Console Automation Server"
$Shortcut.Save()

Write-Success "`n✓ Installation completed successfully!"
$nextSteps = @"

Next steps:
1. Restart your MCP client ($Target)
2. The console-automation server should appear in available tools
3. Test with a simple command like 'echo Hello World'

Testing shortcut created on desktop: 'Test MCP Console'

For documentation, visit: https://github.com/ooples/mcp-console-automation
"@
Write-Info $nextSteps