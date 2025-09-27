# SSH Crash Test Suite for MCP Console Automation

This comprehensive test suite is designed to reproduce and verify SSH crash issues in the MCP (Model Context Protocol) server. It systematically tests various SSH error conditions to ensure the server remains stable and responsive.

## 🎯 Purpose

The test suite verifies that the MCP server:
1. **Does not crash** when SSH connection errors occur
2. **Remains responsive** after SSH failures
3. **Properly isolates** SSH errors from the main server process
4. **Logs errors correctly** without exposing sensitive data
5. **Recovers automatically** from SSH issues

## 📁 Test Files

| File | Purpose |
|------|---------|
| `test-ssh-crash-scenarios.ts` | Core SSH error scenarios that historically caused crashes |
| `test-mcp-server-resilience.ts` | Server health monitoring and recovery testing |
| `test-debug-logging-verification.ts` | Verification of proper error logging |
| `run-comprehensive-ssh-tests.ts` | Master test runner that orchestrates all tests |
| `compile-and-run-tests.ps1` | PowerShell script for easy test execution |

## 🚀 Quick Start

### Method 1: PowerShell Script (Recommended)

```powershell
# Run all tests (full suite)
.\compile-and-run-tests.ps1

# Quick test (shorter timeouts)
.\compile-and-run-tests.ps1 -QuickTest

# Run specific test suite
.\compile-and-run-tests.ps1 -TestSuite crash        # SSH crash scenarios only
.\compile-and-run-tests.ps1 -TestSuite resilience  # Server resilience only
.\compile-and-run-tests.ps1 -TestSuite logging     # Debug logging only

# Skip TypeScript compilation
.\compile-and-run-tests.ps1 -SkipBuild
```

### Method 2: Direct Node Execution

```bash
# Compile TypeScript files
npx tsc --build

# Run individual test suites
node test-ssh-crash-scenarios.ts
node test-mcp-server-resilience.ts
node test-debug-logging-verification.ts

# Run comprehensive suite
node run-comprehensive-ssh-tests.ts
```

## 🧪 Test Scenarios

### 1. SSH Connection with Invalid Host
**Trigger:** Connect to non-existent hostname
```json
{
  "sshOptions": {
    "host": "invalid-host-that-does-not-exist.local",
    "username": "testuser",
    "password": "testpass"
  }
}
```
**Expected:** Server returns error but continues running
**Debug Log:** Should contain "SSH/Network error isolated", "Server MUST continue"

### 2. SSH Connection with Wrong Credentials
**Trigger:** Use invalid username/password
```json
{
  "sshOptions": {
    "host": "localhost",
    "username": "invalid_user",
    "password": "wrong_password"
  }
}
```
**Expected:** Authentication error, server continues
**Debug Log:** Should contain "Authentication failed", "Check SSH credentials"

### 3. SSH Executable Not Found (ENOENT)
**Trigger:** Use non-existent SSH executable path
```json
{
  "sshOptions": {
    "host": "localhost",
    "username": "testuser",
    "sshExecutable": "/non/existent/ssh/path"
  }
}
```
**Expected:** ENOENT error handled gracefully
**Debug Log:** Should contain "ENOENT", "SSH client not found"

### 4. SSH Process Dies Unexpectedly
**Trigger:** Kill SSH process after connection
**Expected:** Server detects process death and recovers
**Debug Log:** Should contain "SSH process terminated", "Recovery attempt"

### 5. Multiple Simultaneous SSH Errors
**Trigger:** Send multiple concurrent SSH requests with different errors
**Expected:** All errors handled without server crash
**Debug Log:** Should contain "Multiple SSH errors", "Error isolation active"

## 📊 Understanding Test Results

### Exit Codes
- `0`: All tests passed, server is stable
- `1`: Some tests failed, review reports

### Generated Reports
- `ssh-crash-test-report.txt`: Detailed crash scenario results
- `mcp-resilience-report.txt`: Server health and recovery analysis
- `debug-logging-report.txt`: Log quality and security analysis
- `COMPREHENSIVE_SSH_TEST_REPORT.md`: Complete test suite summary

### Log Files
- `mcp-debug.log`: Server debug output during tests
- `ssh-crash-test.log`: Test execution log
- `health-monitoring.log`: Server health metrics
- `comprehensive-test-results.log`: Master test log

## 🔍 Verifying Fixes Work

### Manual Verification Steps

1. **Start MCP Server**
   ```bash
   node dist/mcp/server.js
   ```

2. **Send SSH Error Request**
   ```json
   {
     "jsonrpc": "2.0",
     "method": "tools/call",
     "params": {
       "name": "console_create_session",
       "arguments": {
         "command": "echo test",
         "consoleType": "ssh",
         "sshOptions": {
           "host": "invalid-host.test",
           "username": "test"
         }
       }
     }
   }
   ```

3. **Check Server Process**
   - Server process should still be running
   - Should respond to: `{"jsonrpc":"2.0","method":"tools/list"}`

4. **Verify Debug Log**
   - Check `mcp-debug.log` for isolation messages
   - Should NOT contain uncaught exceptions
   - Should NOT contain sensitive data

### Key Indicators of Success

✅ **Server Stability**
- Process remains running after SSH errors
- Responds to MCP protocol requests
- Memory usage stays stable

✅ **Error Isolation**
- Debug log shows "SSH/Network error isolated"
- Error classification working properly
- No propagation to main server process

✅ **Security**
- No passwords/keys in debug logs
- Proper error sanitization
- Consistent log format

## 🛠 Debugging Failed Tests

### Common Issues

1. **Server Won't Start**
   - Check if port is available
   - Verify TypeScript compilation
   - Check Node.js version compatibility

2. **Tests Timeout**
   - Use `-QuickTest` flag for faster execution
   - Check system resources
   - Verify network connectivity

3. **False Failures**
   - Review debug logs for actual vs expected behavior
   - Check timing issues in test execution
   - Verify MCP protocol compatibility

### Debug Commands

```bash
# Check server status
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*server.js*" }

# Monitor debug log in real-time
Get-Content -Path "mcp-debug.log" -Wait

# Test basic MCP connectivity
echo '{"jsonrpc":"2.0","method":"tools/list"}' | node dist/mcp/server.js
```

## 📈 Performance Expectations

### Typical Test Duration
- **SSH Crash Scenarios**: 5-10 minutes
- **Server Resilience**: 8-15 minutes
- **Debug Logging**: 3-8 minutes
- **Comprehensive Suite**: 10-20 minutes

### Success Criteria
- **Server Stability Score**: ≥90/100
- **Zero Crashes**: No server process terminations
- **Response Time**: <10 seconds for MCP requests
- **Memory Stability**: <50% increase during tests

## 🔄 Continuous Integration

To integrate into CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Run SSH Crash Tests
  run: |
    cd mcp-console-automation
    powershell -File compile-and-run-tests.ps1 -QuickTest
  timeout-minutes: 15
```

## 📞 Troubleshooting

### Issue: "TypeScript compiler not found"
**Solution:** Install TypeScript globally or use existing compiled files
```bash
npm install -g typescript
# or
.\compile-and-run-tests.ps1 -SkipBuild
```

### Issue: "Server process not found"
**Solution:** Check if MCP server builds correctly
```bash
npx tsc --build
node dist/mcp/server.js --help
```

### Issue: "SSH tests always fail"
**Solution:** Verify SSH client availability and network settings
```bash
ssh -V  # Should show SSH client version
ping localhost  # Should respond
```

## 📋 Test Checklist

Before declaring SSH crash fixes complete:

- [ ] All crash scenarios pass without server termination
- [ ] Server remains responsive after each error type
- [ ] Debug logs show proper error isolation
- [ ] No sensitive data leaked in logs
- [ ] Memory usage remains stable
- [ ] MCP tools remain available after errors
- [ ] Error recovery mechanisms work correctly
- [ ] Comprehensive report shows 90%+ stability score

---

**Generated by:** SSH Crash Test Suite v1.0
**Compatible with:** MCP Console Automation Server
**Last Updated:** 2024-12-23