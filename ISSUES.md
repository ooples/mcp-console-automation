# Console Automation MCP Issues Tracker

## Critical Issues

### 1. console_execute_command Hanging Issue
**Status**: RESOLVED
**Description**: The console_execute_command tool hangs indefinitely when executing SSH commands
**Root Cause**:
- Added `waitForSessionReady()` method that waits for `session.executionState === 'idle'` at line 3702
- SSH sessions never reach 'idle' state, causing infinite wait
- Missing command execution in executeCommand Promise (line 7918)
**Fix Applied**:
- Removed `waitForSessionReady()` call from createSessionInternal
- Added missing `sendInput()` call to actually send command to session
- Confirmed working version (33eb9e5) did not have waitForSessionReady

### 2. Build Errors in ConsoleManager.original.ts
**Status**: ACTIVE
**Errors**:
```
src/core/ConsoleManager.original.ts(540,44): error TS2554: Expected 0 arguments, but got 1.
src/core/ConsoleManager.original.ts(3217,73): error TS2339: Property 'size' does not exist on type 'ConsoleSession[]'.
src/core/ConsoleManager.original.ts(7226,9): error TS2322: Type 'ConsoleOutput[]' is not assignable to type 'string'.
```
**Impact**: Cannot build the project after attempting to restore working version

### 3. Session Limit Exceeded
**Status**: PARTIALLY RESOLVED
**Description**: Hit 50 session maximum limit
**Root Cause**:
- Stuck Python processes accumulating from hanging sessions
- Sessions not properly cleaned up due to hanging issue
**Temporary Fix**:
- Cleared sessions.json file: `echo '{"sessions":[]}' > sessions.json`
- Killed stuck Python processes
**Long-term Fix Needed**: Proper session cleanup and timeout handling

### 4. SSH Authentication Issues
**Status**: ONGOING
**Description**: Cannot use regular SSH commands on Windows
**Constraint**: Must use console automation MCP exclusively for SSH connections
**Impact**: All SSH operations depend on fixing the console_execute_command hanging issue

## Historical Issues

### 5. Timeout Removal Issue
**Description**: Previous attempt removed 30-second timeout but didn't fix root cause
**Commit**: Issues started after removing timeout limitations
**Learning**: Need to understand why sessions aren't reaching 'idle' state

### 6. Session State Management
**Description**: SSH sessions have different lifecycle than local console sessions
**Problem**: waitForSessionReady assumes all sessions reach 'idle' state
**Solution Needed**: Different handling for SSH vs local sessions

## Required Actions

1. Fix build errors in ConsoleManager.original.ts
2. Remove or fix waitForSessionReady for SSH sessions
3. Implement proper session cleanup on timeout/error
4. Add SSH-specific session state handling
5. Test with actual SSH connections to verify fixes