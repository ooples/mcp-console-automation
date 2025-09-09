# Kubernetes Protocol Support

This document describes the comprehensive Kubernetes support added to the MCP Console Automation server, providing production-ready kubectl exec protocol support for Kubernetes pod access.

## Overview

The Kubernetes protocol integration provides full support for:

- **Pod Exec Sessions**: Interactive shell access to running containers
- **Log Streaming**: Real-time log streaming with follow mode from single or multiple pods
- **Port Forwarding**: Tunnel local ports to pod services
- **File Transfers**: Copy files to/from pods using kubectl cp
- **Multi-Context Support**: Work with multiple Kubernetes clusters and contexts
- **Pod Selection**: Advanced pod selection by name, labels, deployments, services
- **Container Selection**: Support for multi-container pods with container targeting
- **Health Monitoring**: Comprehensive health checks and monitoring integration
- **Auto-Reconnection**: Robust error handling and automatic reconnection
- **RBAC Support**: Proper authentication and authorization handling

## Architecture

### Core Components

1. **KubernetesProtocol** (`src/protocols/KubernetesProtocol.ts`)
   - Main protocol implementation using @kubernetes/client-node
   - Handles all Kubernetes API interactions
   - Manages session lifecycle and connection state
   - Implements comprehensive health monitoring

2. **ConsoleManager Integration** (`src/core/ConsoleManager.ts`)
   - Seamless integration with existing session management
   - Automatic protocol detection and initialization
   - Unified error handling and recovery mechanisms

3. **Type System** (`src/types/index.ts`)
   - Complete TypeScript type definitions
   - Kubernetes-specific configuration interfaces
   - Session state and monitoring types

## Configuration

### Connection Options

```typescript
interface KubernetesConnectionOptions {
  kubeconfig?: string;           // Path to kubeconfig or YAML content
  context?: string;              // Kubernetes context to use  
  namespace?: string;            // Default namespace
  cluster?: string;              // Cluster name override
  user?: string;                 // User name override
  token?: string;                // Bearer token for authentication
  clientCertificate?: string;    // Client certificate data
  clientKey?: string;            // Client private key data
  clusterCertificateAuthority?: string; // CA certificate data
  insecureSkipTlsVerify?: boolean; // Skip TLS verification
  timeout?: number;              // Request timeout in milliseconds
  server?: string;               // Kubernetes API server URL override
  inCluster?: boolean;           // Use in-cluster service account
}
```

### Session Creation

```typescript
// Create Kubernetes exec session
const sessionId = await consoleManager.createSession({
  command: 'kubectl',
  args: ['exec', '-it', 'my-pod', '--', '/bin/bash'],
  consoleType: 'k8s-exec',
  kubernetesOptions: {
    context: 'my-cluster',
    namespace: 'production'
  },
  streaming: true
});
```

## Usage Examples

### 1. Pod Exec Sessions

```typescript
// Basic pod exec
const sessionId = await consoleManager.createSession({
  command: 'kubectl',
  args: ['exec', '-it', 'nginx-pod', '--', '/bin/bash'],
  consoleType: 'k8s-exec',
  kubernetesOptions: { context: 'minikube' }
});

// Multi-container pod exec
const sessionId = await consoleManager.createSession({
  command: 'kubectl', 
  args: ['exec', '-it', 'multi-pod', '-c', 'web-container', '--', '/bin/sh'],
  consoleType: 'k8s-exec',
  kubernetesOptions: { namespace: 'default' }
});

// Pod selection by deployment
const sessionId = await consoleManager.createSession({
  command: 'kubectl',
  args: ['exec', '-it', 'deployment/nginx', '--', 'bash'],
  consoleType: 'k8s-exec'
});
```

### 2. Log Streaming

```typescript
// Stream logs from specific pod
const logSession = await consoleManager.createSession({
  command: 'kubectl',
  args: ['logs', '-f', 'my-pod', '--tail=100'],
  consoleType: 'kubectl',
  kubernetesOptions: { namespace: 'production' }
});

// Stream logs from multiple pods by label
const logSession = await consoleManager.createSession({
  command: 'kubectl',
  args: ['logs', '-f', '-l', 'app=nginx', '--prefix=true'],
  consoleType: 'kubectl'
});

// Stream logs with timestamps
const logSession = await consoleManager.createSession({
  command: 'kubectl',
  args: ['logs', '-f', 'my-pod', '--timestamps'],
  consoleType: 'kubectl'
});
```

### 3. Port Forwarding

```typescript
// Forward local port to pod port
const portForwardSession = await consoleManager.createSession({
  command: 'kubectl',
  args: ['port-forward', 'pod/nginx', '8080:80'],
  consoleType: 'kubectl',
  kubernetesOptions: { namespace: 'default' }
});

// Forward to service
const serviceForwardSession = await consoleManager.createSession({
  command: 'kubectl', 
  args: ['port-forward', 'service/my-service', '3000:3000'],
  consoleType: 'kubectl'
});
```

### 4. Multi-Context Operations

```typescript
// Work with multiple clusters
const contexts = ['dev-cluster', 'staging-cluster', 'prod-cluster'];

for (const context of contexts) {
  const sessionId = await consoleManager.createSession({
    command: 'kubectl',
    args: ['get', 'pods'],
    consoleType: 'kubectl',
    kubernetesOptions: {
      context: context,
      namespace: 'monitoring'
    }
  });
}
```

## Advanced Features

### Pod Selection Methods

1. **By Name**: Direct pod name specification
2. **By Labels**: Label selectors for multiple pods
3. **By Deployment**: Automatic pod selection from deployments
4. **By Service**: Select pods backing a specific service
5. **By ReplicaSet**: Target specific replica set pods

### Container Selection

For multi-container pods, the system automatically:
- Detects single-container pods and uses them directly
- Prompts for container selection in multi-container scenarios
- Supports explicit container specification via `-c` flag

### Health Monitoring

```typescript
// Get comprehensive health status
const health = await consoleManager.getHealthStatus();
const k8sHealth = health.connectionHealth.get('kubernetes');

console.log(`Kubernetes Status: ${k8sHealth.status}`);
console.log(`Health Score: ${k8sHealth.overallScore}`);
console.log(`Active Sessions: ${k8sHealth.activeSessions}`);
```

Health checks include:
- API server connectivity and response time
- Current context validation  
- Active session health monitoring
- Memory and resource usage tracking
- Connection pool status

### Error Handling and Recovery

The system provides robust error handling:

1. **Automatic Reconnection**: Failed connections are automatically retried
2. **Session Recovery**: Pod restarts and network issues trigger recovery
3. **Context Switching**: Dynamic context changes with validation
4. **Resource Cleanup**: Proper cleanup of failed or terminated sessions
5. **Circuit Breaker**: Protection against repeatedly failing operations

## Security Considerations

### Authentication Methods

1. **Kubeconfig**: Standard kubectl configuration files
2. **Service Account**: In-cluster service account tokens
3. **Bearer Tokens**: Direct token-based authentication  
4. **Client Certificates**: X.509 certificate authentication
5. **Exec Plugins**: External authentication providers

### RBAC Integration

The system respects Kubernetes RBAC policies:
- Validates permissions before attempting operations
- Provides clear error messages for authorization failures
- Supports role-based access control at namespace and cluster levels

### Security Best Practices

1. **Principle of Least Privilege**: Configure minimal required permissions
2. **Network Policies**: Respect pod-to-pod communication restrictions
3. **TLS Verification**: Enable certificate validation (disable `insecureSkipTlsVerify`)
4. **Audit Logging**: Enable comprehensive audit trails
5. **Token Rotation**: Support for automatic token refresh

## Monitoring and Observability

### Metrics Collection

```typescript
// Enable comprehensive monitoring
const sessionId = await consoleManager.createSession({
  command: 'kubectl',
  args: ['exec', '-it', 'my-pod', '--', 'bash'],
  consoleType: 'k8s-exec',
  monitoring: {
    enableMetrics: true,
    enableAuditing: true,
    enableTracing: true
  }
});
```

### Available Metrics

- **Session Metrics**: Connection count, duration, success rates
- **Performance Metrics**: Response times, throughput, error rates  
- **Resource Metrics**: Memory usage, CPU utilization, network I/O
- **Health Metrics**: Health check results, availability scores

### Event Monitoring

```typescript
consoleManager.on('sessionCreated', (event) => {
  if (event.data.type === 'kubernetes') {
    console.log(`K8s session created: ${event.sessionId}`);
  }
});

consoleManager.on('logData', (event) => {
  console.log(`Log from ${event.podName}: ${event.data}`);
});

consoleManager.on('portForwardStarted', (event) => {
  console.log(`Port forward active: ${event.localPort} -> ${event.remotePort}`);
});
```

## Troubleshooting

### Common Issues

1. **Connection Failures**
   ```
   Error: Failed to connect to Kubernetes cluster
   Solution: Check kubeconfig, context, and network connectivity
   ```

2. **Permission Denied**
   ```
   Error: Forbidden: pod exec not allowed
   Solution: Verify RBAC permissions for pod/exec resource
   ```

3. **Pod Not Found**  
   ```
   Error: Pod not found matching criteria
   Solution: Check pod name, namespace, and label selectors
   ```

4. **Multi-Container Ambiguity**
   ```
   Error: Multiple containers found, specify container name
   Solution: Use -c flag to specify target container
   ```

### Debug Mode

Enable detailed logging for troubleshooting:

```typescript
const consoleManager = new ConsoleManager({
  logLevel: 'debug',
  kubernetes: {
    enableDebugLogging: true
  }
});
```

### Health Diagnostics

```typescript
// Run comprehensive health check
const health = await kubernetesProtocol.performHealthCheck();
console.log('Kubernetes Diagnostics:');
console.log(JSON.stringify(health, null, 2));
```

## Performance Optimization

### Connection Pooling

The system automatically manages connections efficiently:
- Reuses existing connections when possible
- Implements connection pooling for multiple sessions
- Monitors connection health and performs cleanup

### Resource Management

- **Memory Optimization**: Efficient buffer management for large outputs
- **CPU Efficiency**: Optimized streaming and processing algorithms  
- **Network Optimization**: Minimal API calls and request batching

### Scaling Considerations

- Supports thousands of concurrent sessions
- Horizontal scaling through multiple protocol instances
- Resource-aware session distribution

## API Reference

### Core Methods

```typescript
class KubernetesProtocol {
  // Connection management
  async connect(): Promise<void>
  async disconnect(): Promise<void>
  
  // Context operations
  getContexts(): KubernetesContext[]
  async switchContext(contextName: string): Promise<void>
  
  // Pod operations
  async listPods(options?: PodSelectionOptions): Promise<KubernetesPod[]>
  async getPod(name: string, namespace?: string): Promise<KubernetesPod>
  
  // Session management
  async createExecSession(sessionId: string, options: KubernetesExecOptions): Promise<KubernetesSessionState>
  async sendInput(sessionId: string, input: string): Promise<void>
  async closeSession(sessionId: string): Promise<void>
  
  // Log streaming
  async streamLogs(streamId: string, options: KubernetesLogOptions): Promise<void>
  async stopLogStream(streamId: string): Promise<void>
  
  // Port forwarding
  async startPortForward(portForwardId: string, options: PortForwardOptions): Promise<void>
  async stopPortForward(portForwardId: string): Promise<void>
  
  // File operations
  async copyFiles(copyId: string, options: KubernetesCopyOptions): Promise<void>
  
  // Health and monitoring
  async performHealthCheck(): Promise<HealthCheckResult>
  getActiveSessions(): Map<string, KubernetesSessionState>
}
```

### Event System

The protocol emits comprehensive events for monitoring and integration:

- `connected` - Successful cluster connection
- `disconnected` - Cluster disconnection  
- `contextChanged` - Context switch completed
- `sessionCreated` - New session established
- `sessionClosed` - Session terminated
- `logData` - Log data received
- `logError` - Log streaming error
- `portForwardStarted` - Port forward active
- `portForwardStopped` - Port forward terminated
- `copyCompleted` - File copy finished
- `reconnected` - Automatic reconnection successful

## Dependencies

### Required Packages

```json
{
  "@kubernetes/client-node": "^1.0.0",
  "js-yaml": "^4.1.0"
}
```

### TypeScript Types

```json
{
  "@types/js-yaml": "^4.0.9"
}
```

## Conclusion

The Kubernetes protocol support provides a production-ready, comprehensive solution for Kubernetes pod access and management through the MCP Console Automation system. With robust error handling, comprehensive monitoring, security best practices, and extensive configuration options, it seamlessly integrates with existing console automation workflows while providing powerful Kubernetes-specific capabilities.

For more examples and advanced usage patterns, see the `KubernetesDemo.ts` file in the examples directory.