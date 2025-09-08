# Test Suite for MCP Console Automation

This directory contains comprehensive tests for the MCP Console Automation project, including unit tests, integration tests, stress tests, and mock servers.

## Test Structure

```
test/
├── integration/           # Integration tests
│   ├── ssh.test.ts       # SSH connection and command execution tests
│   ├── session-management.test.ts  # Session lifecycle and resource management
│   └── error-detection.test.ts     # Error pattern matching and recovery
├── mocks/                # Mock implementations
│   └── SSHServer.ts      # Mock SSH server for testing
├── stress/               # Load and performance tests  
│   └── load.test.ts      # Concurrent sessions, memory usage, performance
├── jest.setup.ts         # Jest configuration and global test setup
└── README.md            # This file
```

## Test Categories

### 1. SSH Integration Tests (`test/integration/ssh.test.ts`)

Tests SSH functionality including:
- **Password Authentication**: Valid/invalid credentials, password prompts
- **Key Authentication**: Private key auth, invalid keys  
- **Command Execution**: Simple commands, command sequences, long-running processes
- **Session Persistence**: Environment variables, working directory changes
- **Connection Pooling**: Connection reuse, pool limits, cleanup
- **Error Handling**: Connection failures, timeouts, authentication errors
- **Configuration**: Non-standard ports, IPv6, host key checking

**Key Features Tested:**
- SSH connection establishment with various auth methods
- Command execution and output capture
- Session state persistence across commands  
- Connection pool management and limits
- Error handling and retry mechanisms
- Performance under different network conditions

### 2. Session Management Tests (`test/integration/session-management.test.ts`)

Tests session lifecycle and resource management:
- **Concurrent Limits**: Maximum session enforcement, rapid creation/destruction
- **Crash Recovery**: Failed session detection, resource cleanup after crashes
- **State Transitions**: Session status changes, metadata preservation
- **Resource Cleanup**: Process cleanup, buffer management, monitoring resources
- **Memory Management**: Leak prevention, buffer size limits, garbage collection

**Key Features Tested:**
- Session creation and destruction under load
- Resource limit enforcement and graceful degradation
- Memory leak prevention and cleanup
- Session state management and transitions
- Recovery from system resource exhaustion

### 3. Error Detection Tests (`test/integration/error-detection.test.ts`)

Tests error pattern matching and classification:
- **Multi-language Support**: JavaScript, Python, Java, C/C++, SQL errors
- **Severity Classification**: Critical, high, medium, low severity levels
- **Recovery Strategies**: Connection errors, permission errors, timeouts
- **Performance**: High-frequency error detection, concurrent processing
- **Custom Patterns**: Domain-specific error patterns, pattern management

**Key Features Tested:**
- Error pattern matching across different programming languages
- Stack trace analysis and language detection
- Severity scoring and classification
- Performance under high error rates
- Custom error pattern support

### 4. Load and Stress Tests (`test/stress/load.test.ts`)

Tests system performance and limits:
- **Concurrent Sessions**: 50+ simultaneous sessions, mixed workloads
- **Memory Monitoring**: Memory usage tracking, leak detection, buffer management  
- **Connection Pooling**: Pool saturation, recovery from exhaustion
- **Performance Benchmarks**: Session creation speed, memory efficiency, throughput
- **Recovery Testing**: System overload recovery, graceful degradation

**Key Features Tested:**
- High concurrency session management (50+ sessions)
- Memory usage monitoring and leak prevention
- Connection pool behavior under stress
- Performance benchmarks and SLA compliance
- System recovery after overload conditions

## Mock Infrastructure

### SSH Server Mock (`test/mocks/SSHServer.ts`)

A comprehensive mock SSH server that simulates:
- **Authentication**: Password and key-based authentication
- **Command Processing**: Common Unix/Linux commands, shell interactions
- **Connection Management**: Multiple concurrent connections, connection limits
- **Failure Simulation**: Network issues, authentication failures, timeouts
- **Performance Testing**: High connection counts, command throughput

**Mock Capabilities:**
- Simulates real SSH server behavior without external dependencies
- Supports both password and public key authentication
- Implements common shell commands (echo, ls, cd, pwd, etc.)
- Can simulate various failure modes for resilience testing
- Provides performance testing capabilities with metrics

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm test -- --selectProjects unit
```

### Integration Tests Only
```bash
npm test -- --selectProjects integration
```

### Stress Tests Only
```bash
npm test -- --selectProjects stress
```

### Specific Test File
```bash
npm test -- test/integration/ssh.test.ts
```

### With Coverage
```bash
npm test -- --coverage
```

### Watch Mode
```bash
npm test -- --watch
```

## Test Configuration

### Jest Configuration
- **Projects**: Separate configurations for unit, integration, and stress tests
- **Timeouts**: Different timeouts for different test types (10s unit, 60s integration, 120s stress)
- **Workers**: Limited workers for integration/stress tests to prevent resource contention
- **Coverage**: 70% threshold for branches, functions, lines, and statements

### Environment Variables
- `NODE_ENV=test`: Enables test mode
- `LOG_LEVEL=error`: Reduces log noise during testing
- `DISABLE_TELEMETRY=true`: Disables telemetry in test environment
- `NODE_OPTIONS=--max_old_space_size=4096`: Increases memory for stress tests

### Setup and Teardown
- Global error handlers for unhandled rejections and exceptions
- Automatic garbage collection between tests (when available)
- Console mocking to reduce test output noise
- Extended timeouts for long-running integration tests

## CI/CD Integration

### GitHub Actions Workflows

**Test Workflow** (`.github/workflows/test.yml`):
- Runs on multiple Node.js versions (18, 20, 21)
- Tests across platforms (Ubuntu, Windows, macOS)  
- Includes security scanning and Docker testing
- Separate jobs for different test categories
- Performance benchmarking on schedule

**Release Workflow** (`.github/workflows/release.yml`):
- Pre-release test validation
- Automated NPM and Docker publishing
- Documentation updates
- Post-release verification

### Test Strategy
1. **Unit Tests**: Fast feedback on individual components
2. **Integration Tests**: Real-world scenarios with external dependencies
3. **Stress Tests**: Performance validation and limit testing
4. **Security Tests**: Vulnerability scanning and security validation
5. **Cross-platform Tests**: Compatibility across different operating systems

## Performance Benchmarks

### Session Creation
- **Target**: < 100ms average per session
- **Concurrency**: Support 50+ concurrent sessions
- **Memory**: < 10MB per session average

### Error Detection  
- **Throughput**: > 20 commands/second processing
- **Latency**: < 50ms average detection time
- **Memory**: < 200MB increase for large log processing

### SSH Operations
- **Connection**: < 2s average connection time
- **Command Execution**: < 1s for simple commands  
- **Throughput**: > 100 commands/minute per session

## Troubleshooting

### Common Issues

1. **SSH Tests Failing**: Ensure SSH server is available (CI handles this automatically)
2. **Memory Tests Failing**: May need to run with `--expose-gc` flag
3. **Timeout Issues**: Integration tests may need increased timeouts on slow systems
4. **Port Conflicts**: Mock servers use random ports to avoid conflicts

### Debug Mode
```bash
# Run with debug output
DEBUG=* npm test

# Run with Node.js inspector
node --inspect-brk node_modules/.bin/jest test/integration/ssh.test.ts
```

### Memory Debugging
```bash
# Run with memory profiling
node --expose-gc --inspect node_modules/.bin/jest test/stress/load.test.ts
```

## Contributing

When adding new tests:
1. Place unit tests in `tests/` directory
2. Place integration tests in `test/integration/`  
3. Place stress tests in `test/stress/`
4. Update this README with new test descriptions
5. Ensure tests are deterministic and can run in parallel
6. Add appropriate timeouts and cleanup logic
7. Follow existing patterns for mocking and setup

## Dependencies

### Test Dependencies
- **Jest**: Test framework and runner
- **@types/jest**: TypeScript definitions for Jest
- **ts-jest**: TypeScript support for Jest

### Runtime Dependencies (for testing)
- **ssh2**: SSH client implementation (mocked in tests)
- **uuid**: Unique ID generation for sessions
- **eventemitter3**: Event handling

The test suite is designed to be comprehensive, reliable, and maintainable while providing thorough coverage of all system components and edge cases.