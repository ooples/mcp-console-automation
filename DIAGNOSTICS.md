# Console Automation MCP Diagnostics

## Overview

The Console Automation MCP now includes comprehensive diagnostic capabilities to help identify and resolve complex issues with session management, performance, and reliability.

## Features

### 1. DiagnosticsManager

The core diagnostic system that tracks:
- **Event Logging**: All operations with detailed context
- **Performance Metrics**: Response times, success rates, throughput
- **Error Tracking**: Errors with stack traces and recovery suggestions
- **Health Monitoring**: System health checks and status
- **Alert System**: Automatic alerts for critical issues

### 2. Enhanced MCP Server

The MCP server with integrated diagnostics provides:
- Enhanced error messages with diagnostic context
- Automatic session validation and cleanup
- Performance monitoring for all operations
- Event correlation for troubleshooting

### 3. Diagnostic CLI Tool

Command-line tool for system management and troubleshooting.

## Usage

### Command Line Interface

```bash
# Run system checks
npx ts-node src/cli/diagnostics.ts check

# Start real-time monitoring
npx ts-node src/cli/diagnostics.ts monitor

# Generate diagnostic report
npx ts-node src/cli/diagnostics.ts report -o report.json

# Fix common issues automatically
npx ts-node src/cli/diagnostics.ts fix

# Manage sessions
npx ts-node src/cli/diagnostics.ts sessions --list
npx ts-node src/cli/diagnostics.ts sessions --kill <session-id>
npx ts-node src/cli/diagnostics.ts sessions --cleanup
```

### Diagnostic Events

Events are automatically tracked with the following levels:
- `trace`: Detailed debug information
- `debug`: Debug messages
- `info`: Informational messages
- `warn`: Warning conditions
- `error`: Error conditions
- `fatal`: Critical failures

### Performance Metrics

The system tracks:
- Session creation/destruction times
- Operation execution times
- Success/failure rates
- Resource utilization
- Queue depths

### Health Checks

Automatic health monitoring includes:
- Session limit checks
- Memory usage monitoring
- Process health verification
- Connection state validation
- Event queue overflow detection

## Troubleshooting Common Issues

### Session Not Found Errors

**Symptoms:**
- "Session not found" immediately after creation
- Sessions disappearing unexpectedly

**Diagnostics:**
```bash
# Check session status
npx ts-node src/cli/diagnostics.ts sessions --list

# View recent session events
npx ts-node src/cli/diagnostics.ts report | grep session
```

**Resolution:**
```bash
# Clean up orphaned sessions
npx ts-node src/cli/diagnostics.ts fix
```

### Maximum Session Limit

**Symptoms:**
- Cannot create new sessions
- "Maximum session limit reached" errors

**Diagnostics:**
```bash
# Check session count
npx ts-node src/cli/diagnostics.ts check
```

**Resolution:**
```bash
# Clean up all stopped sessions
npx ts-node src/cli/diagnostics.ts sessions --cleanup
```

### High Memory Usage

**Symptoms:**
- Slow performance
- Out of memory errors

**Diagnostics:**
```bash
# Monitor memory usage
npx ts-node src/cli/diagnostics.ts monitor
```

**Resolution:**
```bash
# Trigger garbage collection and cleanup
npx ts-node src/cli/diagnostics.ts fix
```

## Configuration

### Environment Variables

```bash
# Enable verbose diagnostics
DIAGNOSTICS_LEVEL=trace

# Set maximum diagnostic events
MAX_DIAGNOSTIC_EVENTS=10000

# Enable automatic cleanup
AUTO_CLEANUP_ENABLED=true
```

### Starting the Diagnostic-Enabled Server

```bash
# Start MCP server with diagnostics
node src/mcp/server-with-diagnostics.ts

# Or with npx
npx @modelcontextprotocol/server-stdio node src/mcp/server-with-diagnostics.ts
```

## API Reference

### DiagnosticsManager Methods

```typescript
// Track an event
diagnostics.trackEvent(event: DiagnosticEvent)

// Track performance
diagnostics.trackPerformance(operation: string, duration: number)

// Track errors
diagnostics.trackError(error: Error, context?: any)

// Get metrics
diagnostics.getMetrics(): DiagnosticMetrics

// Get health status
diagnostics.getHealthStatus(): HealthStatus

// Generate report
diagnostics.generateReport(): DiagnosticReport
```

### Diagnostic Events Structure

```typescript
interface DiagnosticEvent {
  id: string;
  timestamp: Date;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  category: string;
  operation: string;
  sessionId?: string;
  message: string;
  data?: any;
  stack?: string;
  duration?: number;
  metadata?: Record<string, any>;
}
```

## Integration

### Adding Diagnostics to Custom Code

```typescript
import { DiagnosticsManager } from './core/DiagnosticsManager';

const diagnostics = DiagnosticsManager.getInstance();

// Track custom events
diagnostics.trackEvent({
  level: 'info',
  category: 'custom',
  operation: 'myOperation',
  message: 'Custom operation completed',
  data: { result: 'success' }
});

// Track performance
const startTime = Date.now();
// ... perform operation ...
diagnostics.trackPerformance('myOperation', Date.now() - startTime);

// Track errors with context
try {
  // ... operation ...
} catch (error) {
  diagnostics.trackError(error, { 
    operation: 'myOperation',
    input: data 
  });
}
```

## Best Practices

1. **Regular Monitoring**: Run `diagnostics monitor` during development
2. **Periodic Cleanup**: Schedule regular `diagnostics fix` runs
3. **Report Analysis**: Generate reports before and after issues
4. **Event Correlation**: Use session IDs to track related events
5. **Alert Response**: Set up monitoring for critical alerts

## Support

For issues or questions:
1. Run `diagnostics check` for system status
2. Generate a report with `diagnostics report`
3. Check recent errors in the diagnostic output
4. Review session logs for detailed traces