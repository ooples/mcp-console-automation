# Compile and Run SSH Crash Tests for MCP Console Automation
# This script compiles TypeScript test files and runs the comprehensive test suite

param(
    [switch]$SkipBuild,
    [switch]$QuickTest,
    [string]$TestSuite = "all"
)

Write-Host "🔧 MCP Console Automation SSH Crash Test Runner" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray

$ErrorActionPreference = "Continue"
$baseDir = "C:\Users\yolan\source\repos\mcp-console-automation"

# Set working directory
Set-Location $baseDir
Write-Host "📁 Working directory: $baseDir" -ForegroundColor Green

# Function to check if process is running
function Test-ProcessRunning {
    param([int]$ProcessId)
    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# Function to kill MCP server processes
function Stop-MCPServers {
    Write-Host "🛑 Stopping any existing MCP server processes..." -ForegroundColor Yellow

    # Kill any existing node processes running server.js
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        $_.MainModule.FileName -like "*server.js" -or
        $_.CommandLine -like "*server.js*" -or
        $_.CommandLine -like "*mcp*server*"
    } | ForEach-Object {
        Write-Host "   Killing process $($_.Id): $($_.ProcessName)" -ForegroundColor Red
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }

    Start-Sleep -Seconds 2
}

# Clean up function
function Cleanup {
    Write-Host "`n🧹 Cleaning up..." -ForegroundColor Yellow
    Stop-MCPServers

    # Clean up temporary files
    $tempFiles = @(
        "mcp-debug.log",
        "ssh-crash-test.log",
        "health-monitoring.log",
        "debug-logging-test.log",
        "comprehensive-test-results.log"
    )

    foreach ($file in $tempFiles) {
        $fullPath = Join-Path $baseDir $file
        if (Test-Path $fullPath) {
            Remove-Item $fullPath -Force -ErrorAction SilentlyContinue
            Write-Host "   Removed: $file" -ForegroundColor Gray
        }
    }
}

# Compilation function
function Build-Tests {
    if ($SkipBuild) {
        Write-Host "⏭️  Skipping TypeScript build (--SkipBuild specified)" -ForegroundColor Yellow
        return $true
    }

    Write-Host "🔨 Compiling TypeScript test files..." -ForegroundColor Blue

    # Check if TypeScript is available
    $tscAvailable = $false
    try {
        $null = Get-Command tsc -ErrorAction Stop
        $tscAvailable = $true
    } catch {
        try {
            $null = Get-Command npx -ErrorAction Stop
            Write-Host "   Using npx tsc..." -ForegroundColor Gray
            $buildResult = Start-Process -FilePath "npx" -ArgumentList "tsc", "--build" -Wait -PassThru -NoNewWindow
        } catch {
            Write-Host "⚠️  TypeScript compiler not found, using existing JS files" -ForegroundColor Yellow
            return $true
        }
    }

    if ($tscAvailable) {
        Write-Host "   Using direct tsc..." -ForegroundColor Gray
        $buildResult = Start-Process -FilePath "tsc" -ArgumentList "--build" -Wait -PassThru -NoNewWindow
    }

    if ($buildResult.ExitCode -eq 0) {
        Write-Host "✅ TypeScript compilation successful" -ForegroundColor Green
        return $true
    } else {
        Write-Host "❌ TypeScript compilation failed (exit code: $($buildResult.ExitCode))" -ForegroundColor Red
        Write-Host "   Continuing with existing files..." -ForegroundColor Yellow
        return $true  # Continue anyway
    }
}

# Test execution function
function Run-TestSuite {
    param(
        [string]$SuiteName,
        [string]$ScriptPath,
        [int]$TimeoutMinutes = 10
    )

    Write-Host "`n🧪 Running Test Suite: $SuiteName" -ForegroundColor Cyan
    Write-Host "   Script: $ScriptPath" -ForegroundColor Gray
    Write-Host "   Timeout: $TimeoutMinutes minutes" -ForegroundColor Gray

    if (-not (Test-Path $ScriptPath)) {
        Write-Host "❌ Test script not found: $ScriptPath" -ForegroundColor Red
        return $false
    }

    $startTime = Get-Date

    try {
        # Start the test process
        $process = Start-Process -FilePath "node" -ArgumentList $ScriptPath -PassThru -NoNewWindow

        # Wait for completion or timeout
        $timeoutReached = $false
        while (-not $process.HasExited -and -not $timeoutReached) {
            Start-Sleep -Seconds 5
            $elapsed = (Get-Date) - $startTime
            if ($elapsed.TotalMinutes -gt $TimeoutMinutes) {
                $timeoutReached = $true
                Write-Host "⏰ Test suite timed out after $TimeoutMinutes minutes" -ForegroundColor Yellow
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
        }

        $duration = (Get-Date) - $startTime

        if ($timeoutReached) {
            Write-Host "❌ $SuiteName TIMED OUT (${TimeoutMinutes}m)" -ForegroundColor Red
            return $false
        } elseif ($process.ExitCode -eq 0) {
            Write-Host "✅ $SuiteName PASSED ($($duration.TotalSeconds.ToString('F1'))s)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ $SuiteName FAILED (exit code: $($process.ExitCode), $($duration.TotalSeconds.ToString('F1'))s)" -ForegroundColor Red
            return $false
        }

    } catch {
        Write-Host "❌ Error running $SuiteName`: $_" -ForegroundColor Red
        return $false
    }
}

# Main execution
try {
    # Initial cleanup
    Cleanup

    # Build tests
    $buildSuccess = Build-Tests
    if (-not $buildSuccess) {
        Write-Host "❌ Build failed, aborting tests" -ForegroundColor Red
        exit 1
    }

    # Define test suites
    $testSuites = @()

    if ($TestSuite -eq "all" -or $TestSuite -eq "crash") {
        $testSuites += @{
            Name = "SSH Crash Scenarios"
            Script = "test-ssh-crash-scenarios.ts"
            Timeout = if ($QuickTest) { 5 } else { 10 }
        }
    }

    if ($TestSuite -eq "all" -or $TestSuite -eq "resilience") {
        $testSuites += @{
            Name = "Server Resilience"
            Script = "test-mcp-server-resilience.ts"
            Timeout = if ($QuickTest) { 8 } else { 15 }
        }
    }

    if ($TestSuite -eq "all" -or $TestSuite -eq "logging") {
        $testSuites += @{
            Name = "Debug Logging"
            Script = "test-debug-logging-verification.ts"
            Timeout = if ($QuickTest) { 3 } else { 8 }
        }
    }

    if ($TestSuite -eq "all" -or $TestSuite -eq "comprehensive") {
        $testSuites += @{
            Name = "Comprehensive Suite"
            Script = "run-comprehensive-ssh-tests.ts"
            Timeout = if ($QuickTest) { 10 } else { 20 }
        }
    }

    if ($testSuites.Count -eq 0) {
        Write-Host "❌ No test suites selected. Use -TestSuite all|crash|resilience|logging|comprehensive" -ForegroundColor Red
        exit 1
    }

    # Run test suites
    $overallStartTime = Get-Date
    $results = @()

    Write-Host "`n🎬 Starting SSH Crash Test Execution" -ForegroundColor Cyan
    Write-Host "   Test Mode: $(if ($QuickTest) { 'Quick Test' } else { 'Full Test' })" -ForegroundColor Gray
    Write-Host "   Suites: $($testSuites.Count)" -ForegroundColor Gray

    foreach ($suite in $testSuites) {
        $scriptPath = Join-Path $baseDir $suite.Script
        $result = Run-TestSuite -SuiteName $suite.Name -ScriptPath $scriptPath -TimeoutMinutes $suite.Timeout
        $results += @{
            Name = $suite.Name
            Success = $result
        }

        # Cleanup between tests
        Stop-MCPServers
        Start-Sleep -Seconds 2
    }

    # Final results
    $totalDuration = (Get-Date) - $overallStartTime
    $passed = ($results | Where-Object { $_.Success }).Count
    $failed = $results.Count - $passed

    Write-Host "`n" + "=" * 60 -ForegroundColor Gray
    Write-Host "🎯 SSH CRASH TEST RESULTS" -ForegroundColor Cyan
    Write-Host "=" * 60 -ForegroundColor Gray
    Write-Host "Total Duration: $($totalDuration.TotalMinutes.ToString('F1')) minutes" -ForegroundColor Gray
    Write-Host "Test Suites: $($results.Count)" -ForegroundColor Gray
    Write-Host "Passed: $passed" -ForegroundColor $(if ($passed -gt 0) { "Green" } else { "Gray" })
    Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Gray" })

    Write-Host "`nDetailed Results:" -ForegroundColor Gray
    foreach ($result in $results) {
        $status = if ($result.Success) { "✅ PASS" } else { "❌ FAIL" }
        Write-Host "   $status $($result.Name)" -ForegroundColor $(if ($result.Success) { "Green" } else { "Red" })
    }

    # Check for generated reports
    Write-Host "`n📄 Generated Reports:" -ForegroundColor Gray
    $reportFiles = @(
        "ssh-crash-test-report.txt",
        "mcp-resilience-report.txt",
        "debug-logging-report.txt",
        "COMPREHENSIVE_SSH_TEST_REPORT.md"
    )

    foreach ($reportFile in $reportFiles) {
        $reportPath = Join-Path $baseDir $reportFile
        if (Test-Path $reportPath) {
            $size = (Get-Item $reportPath).Length
            Write-Host "   📄 $reportFile ($([math]::Round($size/1KB, 1)) KB)" -ForegroundColor Blue
        }
    }

    # Overall result
    if ($failed -eq 0) {
        Write-Host "`n🎉 ALL SSH CRASH TESTS PASSED!" -ForegroundColor Green
        Write-Host "   The MCP server properly handles SSH errors without crashing." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "`n⚠️  SOME TESTS FAILED" -ForegroundColor Yellow
        Write-Host "   Review the test reports for detailed analysis." -ForegroundColor Yellow
        exit 1
    }

} finally {
    # Final cleanup
    Cleanup
}