[CmdletBinding()]
param(
    [ValidateSet('codex', 'custom')]
    [string]$Target = 'codex',

    [string]$CustomPath = '',

    [switch]$Dev,

    [switch]$SkipDependencies,

    [switch]$KeepDevDependencies
)

$ErrorActionPreference = 'Stop'
$installDir = $PSScriptRoot
$serverPath = Join-Path $installDir 'dist\mcp\server.js'

function Write-Step([string]$Message) {
    Write-Host $Message -ForegroundColor Cyan
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)] [string]$Command,
        [string[]]$Arguments = @()
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 promotes native stderr to error records. Keep
        # those records non-terminating and use the process exit code instead.
        $ErrorActionPreference = 'Continue'
        & $Command @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -ne 0) {
        throw "Command failed with exit code ${exitCode}: $Command $($Arguments -join ' ')"
    }
}

function Test-NativeSuccess {
    param(
        [Parameter(Mandatory)] [string]$Command,
        [string[]]$Arguments = @()
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Command @Arguments *> $null
        return $LASTEXITCODE -eq 0
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Resolve-Application([string[]]$Names) {
    foreach ($name in $Names) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }
    throw "Required command not found: $($Names -join ' or ')"
}

$node = Resolve-Application @('node.exe', 'node')
$npm = Resolve-Application @('npm.cmd', 'npm')
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $nodeVersionOutput = & $node --version
    $nodeVersionExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($nodeVersionExitCode -ne 0) {
    throw "Unable to determine Node.js version (exit code $nodeVersionExitCode)."
}
$nodeVersion = $nodeVersionOutput.TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
    throw "Node.js 18 or newer is required; found $nodeVersion"
}

Write-Step "Using Node.js $nodeVersion from $node"

Push-Location $installDir
try {
    if (-not $SkipDependencies) {
        Write-Step 'Installing locked dependencies...'
        Invoke-Checked -Command $npm -Arguments @('ci')
    }

    Write-Step 'Building the MCP server...'
    Invoke-Checked -Command $npm -Arguments @('run', 'build')

    if (-not $Dev -and -not $KeepDevDependencies) {
        Write-Step 'Removing development-only and optional protocol packages...'
        Invoke-Checked -Command $npm -Arguments @('prune', '--omit=dev', '--omit=optional')
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "Build completed without the MCP entry point: $serverPath"
}

if ($Target -eq 'codex') {
    $codex = Resolve-Application @('codex.exe', 'codex')

    if (Test-NativeSuccess -Command $codex -Arguments @('mcp', 'get', 'console-automation')) {
        Write-Step 'Replacing the existing Codex MCP registration...'
        Invoke-Checked -Command $codex -Arguments @('mcp', 'remove', 'console-automation')
    }

    Write-Step 'Registering console-automation with Codex...'
    Invoke-Checked -Command $codex -Arguments @(
        'mcp', 'add', 'console-automation', '--env', 'LOG_LEVEL=warn', '--', $node, $serverPath
    )
    Invoke-Checked -Command $codex -Arguments @('mcp', 'get', 'console-automation')

    Write-Host ''
    Write-Host 'Installation complete. Restart Codex, then use /mcp to verify the server.' -ForegroundColor Green
    exit 0
}

if ([string]::IsNullOrWhiteSpace($CustomPath)) {
    throw '-CustomPath is required when -Target custom is selected.'
}

$customConfig = @{
    mcpServers = @{
        'console-automation' = @{
            command = $node
            args = @($serverPath)
            env = @{ LOG_LEVEL = 'warn' }
        }
    }
}

if (Test-Path -LiteralPath $CustomPath) {
    throw "Refusing to overwrite existing custom MCP configuration: $CustomPath"
}

$customDirectory = Split-Path -Parent $CustomPath
if ($customDirectory) {
    New-Item -ItemType Directory -Path $customDirectory -Force | Out-Null
}
$customJson = $customConfig | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText(
    $CustomPath,
    $customJson,
    [System.Text.UTF8Encoding]::new($false)
)
Write-Host "Custom MCP configuration written to $CustomPath" -ForegroundColor Green
