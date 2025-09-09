# Console Automation Protocol Documentation

## Overview

The MCP Console Automation Server supports a comprehensive range of console protocols, providing unified access to local shells, remote systems, containers, cloud platforms, hardware interfaces, and more. This document provides detailed information about all supported protocols, their capabilities, configuration options, and usage patterns.

## Architecture

The protocol system is built on a factory pattern with dependency injection, lazy loading, and comprehensive monitoring. Key components include:

- **ProtocolFactory**: Central factory for creating and managing protocol instances
- **ProtocolDetector**: Automatic protocol detection based on commands and connection strings  
- **ConsoleManager**: Unified session management across all protocols
- **Health Monitoring**: Protocol-specific health checks and capability discovery
- **Error Recovery**: Comprehensive error handling and recovery strategies

## Protocol Categories

### Local Shell Protocols

These protocols provide access to native local shells and command interpreters.

#### Supported Types
- `cmd` - Windows Command Prompt
- `powershell` - Windows PowerShell  
- `pwsh` - PowerShell Core (cross-platform)
- `bash` - Bourne Again Shell
- `zsh` - Z Shell
- `sh` - POSIX shell
- `auto` - Automatic shell detection based on platform

#### Capabilities
- ✅ Streaming output
- ✅ Custom environment variables
- ✅ Working directory support
- ✅ Signal handling
- ✅ Terminal resizing
- ✅ PTY support
- ❌ File transfer
- ❌ Authentication
- ❌ Encryption

#### Configuration Example
```typescript
{
  type: 'bash',
  command: '/bin/bash',
  args: ['--login'],
  cwd: '/home/user',
  env: { PATH: '/usr/local/bin:/usr/bin:/bin' },
  streaming: true
}
```

### Remote Access Protocols

These protocols enable secure access to remote systems over the network.

#### SSH Protocol (`ssh`)

Secure Shell protocol for encrypted remote access.

**Capabilities:**
- ✅ Streaming output
- ✅ File transfer (SFTP/SCP)
- ✅ X11 forwarding
- ✅ Port forwarding
- ✅ Public key authentication
- ✅ Encryption
- ✅ Compression
- ✅ Connection multiplexing
- ✅ Keep-alive
- ✅ Reconnection

**Configuration:**
```typescript
{
  type: 'ssh',
  sshOptions: {
    host: 'example.com',
    port: 22,
    username: 'user',
    privateKey: '/path/to/private_key',
    passphrase: 'key_passphrase',
    keepAliveInterval: 30000,
    compression: true
  }
}
```

**Authentication Methods:**
- Password authentication
- Public key authentication  
- Keyboard-interactive authentication
- Certificate-based authentication

#### Telnet Protocol (`telnet`)

Simple network protocol for remote terminal access.

**Capabilities:**
- ✅ Streaming output
- ❌ Encryption (plain text)
- ❌ File transfer
- ❌ Authentication (basic)

**Configuration:**
```typescript
{
  type: 'telnet',
  telnetOptions: {
    host: 'router.local',
    port: 23,
    timeout: 30000,
    echomode: false
  }
}
```

### Container Protocols

These protocols provide access to containerized environments.

#### Docker Protocol (`docker`)

Access to Docker containers for execution and management.

**Capabilities:**
- ✅ Streaming output
- ✅ File transfer
- ✅ Binary data support
- ✅ Signal handling
- ✅ Terminal resizing
- ✅ PTY support
- ✅ Multiplexing
- ❌ Authentication (uses Docker daemon)
- ❌ Encryption (local socket)

**Configuration:**
```typescript
{
  type: 'docker',
  dockerOptions: {
    image: 'ubuntu:latest',
    containerName: 'test-container',
    command: ['/bin/bash'],
    workingDir: '/app',
    environment: { NODE_ENV: 'development' },
    attachStdout: true,
    attachStderr: true,
    attachStdin: true,
    tty: true
  }
}
```

#### Kubernetes Protocol (`kubectl`, `k8s-exec`)

Kubernetes pod execution and management.

**Capabilities:**
- ✅ Streaming output
- ✅ File transfer
- ✅ Authentication (kubeconfig)
- ✅ Encryption (TLS)
- ✅ Multiplexing
- ✅ Keep-alive
- ✅ Reconnection

**Configuration:**
```typescript
{
  type: 'kubectl',
  kubernetesOptions: {
    kubeconfig: '/path/to/kubeconfig',
    namespace: 'default',
    pod: 'webapp-pod-12345',
    container: 'webapp',
    command: ['/bin/sh'],
    context: 'production-cluster'
  }
}
```

### Cloud Platform Protocols

These protocols integrate with major cloud providers for remote shell access.

#### Azure Cloud Shell (`azure-shell`)

Microsoft Azure Cloud Shell integration.

**Capabilities:**
- ✅ Streaming output
- ✅ File transfer
- ✅ Authentication (Azure AD)
- ✅ Encryption
- ✅ Keep-alive
- ✅ Reconnection

**Configuration:**
```typescript
{
  type: 'azure-shell',
  azureOptions: {
    subscriptionId: 'subscription-uuid',
    tenantId: 'tenant-uuid',
    resourceGroup: 'my-resource-group',
    authMethod: 'azure-cli' | 'service-principal',
    credentials: {
      clientId: 'client-id',
      clientSecret: 'client-secret'
    }
  }
}
```

#### Google Cloud Shell (`gcp-shell`)

Google Cloud Shell integration.

**Configuration:**
```typescript
{
  type: 'gcp-shell',
  gcpOptions: {
    projectId: 'my-project-123',
    zone: 'us-central1-a',
    authMethod: 'gcloud-cli' | 'service-account',
    serviceAccountPath: '/path/to/service-account.json'
  }
}
```

#### AWS Systems Manager (`aws-ssm`)

AWS Systems Manager Session Manager for EC2 instance access.

**Configuration:**
```typescript
{
  type: 'aws-ssm',
  awsSSMOptions: {
    instanceId: 'i-0123456789abcdef0',
    region: 'us-west-2',
    profile: 'default',
    documentName: 'SSM-SessionManagerRunShell',
    parameters: {}
  }
}
```

### Virtualization Protocols

These protocols access virtualized environments.

#### Windows Subsystem for Linux (`wsl`)

Access to WSL distributions on Windows.

**Capabilities:**
- ✅ Streaming output
- ✅ File transfer
- ✅ Working directory support
- ❌ Authentication
- ❌ Encryption
- ❌ Network protocols

**Configuration:**
```typescript
{
  type: 'wsl',
  wslOptions: {
    distribution: 'Ubuntu',
    user: 'username',
    workingDirectory: '/home/username',
    command: '/bin/bash'
  }
}
```

### Hardware Access Protocols

These protocols provide direct hardware interface access.

#### Serial Protocol (`serial`)

Serial port communication for embedded systems and hardware.

**Capabilities:**
- ✅ Streaming output
- ✅ Reconnection
- ❌ File transfer
- ❌ Authentication
- ❌ Encryption

**Configuration:**
```typescript
{
  type: 'serial',
  serialOptions: {
    port: '/dev/ttyUSB0', // or 'COM1' on Windows
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: false,
    timeout: 5000
  }
}
```

#### IPMI Protocol (`ipmi`)

Intelligent Platform Management Interface for server management.

**Configuration:**
```typescript
{
  type: 'ipmi',
  ipmiOptions: {
    host: 'server-bmc.local',
    username: 'admin',
    password: 'password',
    interface: 'lan' | 'lanplus',
    port: 623
  }
}
```

### Remote Desktop Protocols

These protocols provide graphical remote desktop access.

#### Remote Desktop Protocol (`rdp`)

Microsoft Remote Desktop Protocol.

**Capabilities:**
- ✅ Streaming output (graphical)
- ✅ File transfer
- ✅ Authentication
- ✅ Encryption
- ✅ Compression
- ✅ Keep-alive
- ✅ Reconnection

**Configuration:**
```typescript
{
  type: 'rdp',
  rdpOptions: {
    host: 'windows-server.local',
    port: 3389,
    username: 'administrator',
    password: 'password',
    domain: 'COMPANY',
    width: 1024,
    height: 768,
    colorDepth: 16,
    enableClipboard: true,
    enableDrives: false
  }
}
```

#### VNC Protocol (`vnc`)

Virtual Network Computing protocol.

**Configuration:**
```typescript
{
  type: 'vnc',
  vncOptions: {
    host: 'desktop.local',
    port: 5900,
    password: 'vnc-password',
    viewOnly: false,
    shared: true
  }
}
```

### Windows Remote Management

These protocols provide Windows-specific remote management capabilities.

#### Windows Remote Management (`winrm`)

Windows Remote Management protocol.

**Capabilities:**
- ✅ Streaming output
- ✅ Authentication
- ✅ Encryption
- ✅ Keep-alive
- ✅ Reconnection

**Configuration:**
```typescript
{
  type: 'winrm',
  winrmOptions: {
    host: 'windows-server.local',
    port: 5985,
    username: 'administrator',
    password: 'password',
    useSSL: false,
    domain: 'COMPANY',
    authMethod: 'basic' | 'negotiate' | 'kerberos'
  }
}
```

### Network Terminal Protocols

These protocols provide web-based terminal access.

#### WebSocket Terminal (`websocket-term`)

WebSocket-based terminal access.

**Configuration:**
```typescript
{
  type: 'websocket-term',
  webSocketTerminalOptions: {
    url: 'wss://terminal.example.com/ws',
    protocols: ['xterm'],
    authentication: {
      type: 'bearer',
      token: 'auth-token'
    },
    pingInterval: 30000,
    reconnectDelay: 5000
  }
}
```

### Automation Protocols

These protocols integrate with configuration management and automation tools.

#### Ansible Protocol (`ansible`)

Ansible automation platform integration.

**Configuration:**
```typescript
{
  type: 'ansible',
  ansibleOptions: {
    playbook: '/path/to/playbook.yml',
    inventory: '/path/to/inventory',
    extraVars: { env: 'production' },
    tags: ['deploy', 'config'],
    limit: 'webservers',
    verbosity: 2
  }
}
```

## Protocol Detection

The system automatically detects protocols based on command patterns and connection strings:

### Detection Patterns

```typescript
const PROTOCOL_PATTERNS = {
  'ssh': [/^ssh:\/\//, /^.+@.+:.+$/, /^.+ -p \d+/],
  'docker': [/^docker\s+/, /^docker:\/\//, /container:/],
  'kubectl': [/^kubectl\s+/, /^k8s:\/\//, /^kubernetes:/],
  'wsl': [/^wsl\s+/, /^wsl\.exe/, /\\\\wsl\$/],
  'rdp': [/^rdp:\/\//, /^mstsc\s+/, /:3389$/],
  'vnc': [/^vnc:\/\//, /:5900$/, /:59\d\d$/],
  'serial': [/^\/dev\/tty/, /^COM\d+/, /^serial:/]
};
```

### Usage Examples

```typescript
// Automatic detection
const session = await consoleManager.createSession({
  command: 'ssh user@server.com',  // Detected as SSH
  streaming: true
});

const dockerSession = await consoleManager.createSession({
  command: 'docker exec -it container bash',  // Detected as Docker
  streaming: true
});

// Explicit protocol specification
const explicitSession = await consoleManager.createSession({
  type: 'kubernetes',
  command: 'kubectl exec -it pod-name -- /bin/bash',
  kubernetesOptions: {
    namespace: 'production',
    context: 'prod-cluster'
  }
});
```

## Health Monitoring

All protocols support comprehensive health monitoring:

### Health Status Structure

```typescript
interface ProtocolHealthStatus {
  isHealthy: boolean;
  lastChecked: Date;
  errors: string[];
  warnings: string[];
  metrics: {
    activeSessions: number;
    totalSessions: number;
    averageLatency: number;
    successRate: number;
    uptime: number;
  };
  dependencies: {
    [key: string]: {
      available: boolean;
      version?: string;
      error?: string;
    };
  };
}
```

### Health Check API

```typescript
// Check specific protocol health
const sshHealth = await consoleManager.getProtocolHealthStatus('ssh');

// Check overall system health
const systemHealth = await consoleManager.getSystemHealthStatus();

// Get protocol capabilities
const capabilities = await consoleManager.getProtocolCapabilities('docker');
```

## Error Handling and Recovery

The system includes comprehensive error handling with automatic recovery strategies:

### Error Types
- Connection errors
- Authentication failures
- Network timeouts
- Protocol-specific errors
- Resource exhaustion

### Recovery Strategies
- Automatic reconnection
- Connection pooling
- Circuit breaker patterns
- Exponential backoff
- Session migration
- Command queue persistence

### Configuration

```typescript
const errorRecoveryConfig = {
  maxRetryAttempts: 3,
  retryDelay: 1000,
  exponentialBackoff: true,
  circuitBreakerThreshold: 5,
  connectionPooling: true,
  sessionPersistence: true
};
```

## Performance Optimization

### Connection Pooling

Connection pooling is available for protocols that support it:

```typescript
const poolingOptions = {
  maxConnections: 50,
  maxConnectionsPerHost: 10,
  connectionTimeout: 30000,
  idleTimeout: 300000,
  enableConnectionReuse: true
};
```

### Lazy Loading

Protocol modules are loaded on-demand to reduce startup time and memory usage:

```typescript
// Protocols are only loaded when first used
const protocol = await protocolFactory.createProtocol('kubernetes');
```

### Session Management

Advanced session management with persistence and migration:

```typescript
const sessionConfig = {
  enablePersistence: true,
  persistenceInterval: 30000,
  maxBookmarks: 10,
  bookmarkStrategy: 'hybrid',
  enableSessionMigration: true
};
```

## Security Considerations

### Authentication
- Support for multiple authentication methods per protocol
- Secure credential storage and management
- Token refresh and rotation
- Certificate-based authentication where supported

### Encryption
- TLS/SSL encryption for network protocols
- End-to-end encryption for sensitive protocols
- Certificate validation and pinning

### Access Control
- Protocol-level access controls
- Session isolation
- Resource limits and quotas
- Audit logging

## Development and Extension

### Adding New Protocols

1. Implement the `IProtocol` interface:

```typescript
export class CustomProtocol extends EventEmitter implements IProtocol {
  public readonly type = 'custom';
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;

  async initialize(): Promise<void> { /* Implementation */ }
  async createSession(options: SessionOptions): Promise<ConsoleSession> { /* Implementation */ }
  // ... other required methods
}
```

2. Register the protocol:

```typescript
protocolFactory.registerProtocol(
  'custom',
  () => Promise.resolve(new CustomProtocol()),
  {
    enabled: true,
    maxSessions: 10,
    defaultTimeout: 30000,
    // ... other config
  }
);
```

### Testing

Comprehensive test coverage includes:

- Unit tests for individual protocols
- Integration tests for protocol interactions
- Stress tests for high-load scenarios
- End-to-end tests for complete workflows

### Monitoring Integration

The system integrates with monitoring platforms:

- Prometheus metrics
- Grafana dashboards  
- ELK stack logging
- Custom webhook notifications
- Health check endpoints

## Troubleshooting

### Common Issues

1. **Protocol Detection Fails**
   - Check command patterns match detection rules
   - Specify protocol type explicitly
   - Verify protocol is enabled and available

2. **Connection Timeouts**
   - Adjust timeout settings
   - Check network connectivity
   - Verify authentication credentials
   - Review firewall rules

3. **Session Limits Exceeded**
   - Monitor active session counts
   - Implement session cleanup
   - Adjust maxSessions configuration

4. **Authentication Failures**
   - Verify credentials are correct
   - Check authentication method support
   - Review protocol-specific auth requirements

### Debugging

Enable detailed logging:

```bash
node dist/index.js --log-level debug
```

Health check endpoints:
- `/health` - Overall system health
- `/protocols` - Protocol status
- `/sessions` - Active session information
- `/metrics` - Performance metrics

### Support

For additional support:
- Check the GitHub issues
- Review error logs with debug level
- Run health checks on problematic protocols
- Verify platform-specific requirements

---

This documentation provides a comprehensive overview of the console automation protocol system. For specific implementation details, refer to the source code and API documentation.