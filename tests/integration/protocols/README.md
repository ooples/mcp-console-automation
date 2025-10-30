# Protocol Integration Tests

## Overview

This directory contains integration tests for hardware/local protocol implementations:

- **docker.test.ts** - Docker container protocol tests
- **ipmi.test.ts** - IPMI/BMC hardware management tests
- **serial.test.ts** - Serial port communication tests
- **sftp.test.ts** - SFTP file transfer protocol tests
- **wsl.test.ts** - Windows Subsystem for Linux tests

## Test Status

⚠️ **These tests are currently INCOMPLETE** ⚠️

The protocol implementations in `src/protocols/` are stub/partial implementations. These integration tests were written before the protocol implementations were completed and expect methods and functionality that don't yet exist.

### Current Issues

1. **Missing Protocol Methods**: Tests call methods like `listPorts()`, `executeCommand()`, `uploadFile()` etc. that are not implemented in the protocol classes
2. **Hardware Dependencies**: Even with mocks, these tests require actual hardware services:
   - Docker: Requires Docker daemon running
   - IPMI: Requires BMC hardware or simulator
   - Serial: Requires physical serial ports
   - SFTP: Requires SSH server
   - WSL: Requires Windows with WSL2 installed

3. **Mock Limitations**: While jest mocks have been added for external dependencies (dockerode, serialport, ssh2, dgram, child_process), the protocol classes themselves don't implement the expected interfaces.

## Running These Tests

### Skip in CI

Set environment variable to skip these tests:
```bash
export SKIP_HARDWARE_TESTS=true
npm test
```

### Run Locally (will fail)

```bash
# Individual protocol tests
npm test -- tests/integration/protocols/docker.test.ts
npm test -- tests/integration/protocols/serial.test.ts
npm test -- tests/integration/protocols/sftp.test.ts
npm test -- tests/integration/protocols/ipmi.test.ts
npm test -- tests/integration/protocols/wsl.test.ts
```

## Fixing These Tests

To make these tests pass, one of the following approaches is needed:

### Option 1: Complete Protocol Implementations
Implement all methods expected by tests in the protocol classes:
- `src/protocols/DockerProtocol.ts`
- `src/protocols/SerialProtocol.ts`
- `src/protocols/SFTPProtocol.ts`
- `src/protocols/IPMIProtocol.ts`
- `src/protocols/WSLProtocol.ts`

### Option 2: Use Mock Protocols
Refactor tests to use the mock protocol implementations from `tests/utils/protocol-mocks.ts` instead of real protocols.

### Option 3: Mark as E2E Tests
Move these to an `e2e/` directory and document them as end-to-end tests that require actual hardware/services.

## Mock Status

The following mocks are configured:

| Dependency | Mock Location | Status |
|------------|---------------|--------|
| dockerode | Inline in test file | ✅ Complete |
| serialport | Inline in test file | ✅ Complete |
| ssh2 | Inline in test file | ✅ Complete |
| dgram | Inline in test file | ✅ Complete |
| child_process | Inline in test file | ✅ Complete |

However, mocking external dependencies isn't sufficient when the protocol classes themselves are incomplete.

## Recommendations

1. **Short term**: Skip these tests in CI until implementations are complete
2. **Medium term**: Implement missing protocol methods or refactor tests to match actual implementations
3. **Long term**: Create separate E2E test suite with docker-compose for integration testing with real services
