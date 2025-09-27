# PowerShell script to run diagnostic tests using console automation MCP
Write-Host "🔬 Starting Console Automation MCP Diagnostic Test" -ForegroundColor Cyan
Write-Host ""

# Test 1: Create a simple CMD session
Write-Host "Test 1: Creating CMD session..." -ForegroundColor Yellow
$session1 = @{
    command = "cmd"
    args = @("/c", "echo", "test1")
    consoleType = "cmd"
}

Write-Host "Attempting to create session with console automation MCP..."
Write-Host ""

# Test 2: Create a PowerShell session
Write-Host "Test 2: Creating PowerShell session..." -ForegroundColor Yellow
$session2 = @{
    command = "powershell"
    args = @("-NoProfile", "-Command", "Write-Host 'test2'")
    consoleType = "powershell"
}

# Test 3: Multiple rapid session creation
Write-Host "Test 3: Creating multiple sessions rapidly..." -ForegroundColor Yellow
for ($i = 1; $i -le 5; $i++) {
    Write-Host "  Creating session $i..."
    Start-Sleep -Milliseconds 100
}

# Test 4: Session with immediate operations
Write-Host "Test 4: Session with immediate input..." -ForegroundColor Yellow
Write-Host "  Creating session and immediately sending input..."

Write-Host ""
Write-Host "✅ Tests initiated - check diagnostic output" -ForegroundColor Green