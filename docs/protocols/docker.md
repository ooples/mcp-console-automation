# Docker Protocol

## Overview

The Docker Protocol enables AI assistants to interact with Docker containers, execute commands, and automate Docker workflows through the MCP Console Automation server. This protocol provides comprehensive container management, health monitoring, log streaming, and metrics collection capabilities.

## Features

- **Container Management**: Create, start, stop, and remove containers
- **Docker Exec**: Execute commands in running containers
- **Health Monitoring**: Built-in health checks and status monitoring
- **Log Streaming**: Real-time log streaming with timestamps
- **Metrics Collection**: CPU, memory, network, and I/O metrics
- **Multi-platform Support**: Works with Docker Desktop, Docker Engine, and Docker in WSL2
- **Auto-cleanup**: Automatic container removal and resource cleanup
- **Event Monitoring**: Real-time Docker event monitoring

## Configuration

### Basic Configuration

```typescript
const dockerConfig: DockerProtocolConfig = {
  connection: {
    socketPath: '/var/run/docker.sock', // Unix systems
    // socketPath: '\\\\.\\pipe\\docker_engine', // Windows Docker Desktop
    // host: 'localhost',
    // port: 2375
  },
  autoCleanup: true,
  healthCheck: {
    enabled: true,
    interval: 30000,
    timeout: 5000,
    retries: 3
  },
  logStreaming: {
    enabled: true,
    timestamps: true,
    maxBufferSize: 1024 * 1024 // 1MB
  },
  monitoring: {
    enableMetrics: true,
    metricsInterval: 10000
  }
};
```

### Environment-specific Configuration

#### Windows Docker Desktop
```typescript
const windowsConfig: DockerProtocolConfig = {
  connection: {
    socketPath: '\\\\.\\pipe\\docker_engine'
  },
  // ... other config
};
```

#### WSL2 Docker
```typescript
const wsl2Config: DockerProtocolConfig = {
  connection: {
    socketPath: '/var/run/docker.sock'
  },
  // ... other config
};
```

#### Remote Docker
```typescript
const remoteConfig: DockerProtocolConfig = {
  connection: {
    host: 'remote-docker-host',
    port: 2376,
    ca: fs.readFileSync('ca.pem'),
    cert: fs.readFileSync('cert.pem'),
    key: fs.readFileSync('key.pem')
  },
  // ... other config
};
```

## Usage Examples

### 1. Running a Development Environment

```javascript
// Create a Node.js development container
const session = await console_create_session({
  command: 'node',
  args: ['server.js'],
  consoleType: 'docker',
  cwd: '/app',
  dockerContainerOptions: {
    image: 'node:18',
    name: 'dev-server',
    workingDir: '/app',
    hostConfig: {
      binds: ['/host/project:/app:rw'],
      portBindings: {
        '3000/tcp': [{ hostPort: '3000' }]
      },
      autoRemove: true
    },
    env: [
      'NODE_ENV=development',
      'PORT=3000',
      'DEBUG=app:*'
    ]
  },
  streaming: true,
  detectErrors: true
});

// Wait for server to start
await console_wait_for_output({
  sessionId: session.sessionId,
  pattern: 'Server listening on port 3000',
  timeout: 30000
});

console.log('Development server is ready!');
```

### 2. Database Container Management

```javascript
// Start a PostgreSQL database container
const dbSession = await console_create_session({
  command: 'docker-entrypoint.sh',
  args: ['postgres'],
  consoleType: 'docker',
  dockerContainerOptions: {
    image: 'postgres:15',
    name: 'app-database',
    env: [
      'POSTGRES_DB=appdb',
      'POSTGRES_USER=appuser',
      'POSTGRES_PASSWORD=secret123'
    ],
    hostConfig: {
      portBindings: {
        '5432/tcp': [{ hostPort: '5432' }]
      },
      binds: ['/host/data:/var/lib/postgresql/data:rw']
    }
  }
});

// Wait for database to be ready
await console_wait_for_output({
  sessionId: dbSession.sessionId,
  pattern: 'database system is ready to accept connections',
  timeout: 60000
});

// Execute database commands
const psqlSession = await console_create_session({
  command: 'psql',
  args: ['-U', 'appuser', '-d', 'appdb'],
  consoleType: 'docker-exec',
  dockerOptions: {
    containerId: dbSession.containerId
  }
});

await console_send_input({
  sessionId: psqlSession.sessionId,
  input: 'CREATE TABLE users (id SERIAL PRIMARY KEY, name VARCHAR(100));'
});
```

### 3. Docker Compose Automation

```javascript
// Start a multi-container application
const composeSession = await console_create_session({
  command: 'docker-compose',
  args: ['up', '-d'],
  cwd: '/path/to/docker-compose-project',
  detectErrors: true
});

// Monitor startup logs
const output = await console_get_output({
  sessionId: composeSession.sessionId
});

// Check if all services are running
const statusSession = await console_execute_command({
  command: 'docker-compose',
  args: ['ps'],
  cwd: '/path/to/docker-compose-project'
});

console.log('Service status:', statusSession.output);
```

### 4. Container Health Monitoring

```javascript
// Create a web application container with health checks
const webAppSession = await console_create_session({
  command: 'npm',
  args: ['start'],
  consoleType: 'docker',
  dockerContainerOptions: {
    image: 'node:18',
    name: 'webapp',
    workingDir: '/app',
    healthcheck: {
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health'],
      interval: 30000,
      timeout: 10000,
      retries: 3,
      startPeriod: 60000
    },
    hostConfig: {
      portBindings: {
        '3000/tcp': [{ hostPort: '8080' }]
      }
    }
  }
});

// Monitor health status
protocol.on('health-check', (healthResult, session) => {
  console.log(`Health check for ${session.containerName}: ${healthResult.status}`);
  if (healthResult.status === 'unhealthy') {
    console.error(`Health check failed: ${healthResult.output}`);
  }
});
```

### 5. Log Aggregation and Analysis

```javascript
// Start multiple containers and aggregate logs
const services = ['api', 'worker', 'scheduler'];
const sessions = [];

for (const service of services) {
  const session = await console_create_session({
    command: 'node',
    args: [`${service}.js`],
    consoleType: 'docker',
    dockerContainerOptions: {
      image: 'node:18',
      name: `app-${service}`,
      labels: {
        'service': service,
        'environment': 'production'
      }
    },
    streaming: true
  });
  sessions.push(session);
}

// Aggregate logs from all services
protocol.on('log-stream', (logEntry, session) => {
  console.log(`[${session.containerName}] ${logEntry.timestamp.toISOString()}: ${logEntry.message}`);
  
  // Detect errors across all services
  if (logEntry.message.toLowerCase().includes('error')) {
    console.error(`ERROR in ${session.containerName}: ${logEntry.message}`);
  }
});
```

### 6. CI/CD Pipeline Integration

```javascript
// Build and test application in Docker
async function runCIPipeline() {
  // Build stage
  const buildSession = await console_execute_command({
    command: 'docker',
    args: ['build', '-t', 'myapp:latest', '.'],
    timeout: 300000 // 5 minutes
  });

  if (buildSession.exitCode !== 0) {
    throw new Error(`Build failed: ${buildSession.stderr}`);
  }

  // Test stage
  const testSession = await console_create_session({
    command: 'npm',
    args: ['test'],
    consoleType: 'docker',
    dockerContainerOptions: {
      image: 'myapp:latest',
      env: ['NODE_ENV=test'],
      hostConfig: {
        autoRemove: true
      }
    }
  });

  // Wait for tests to complete
  await console_wait_for_output({
    sessionId: testSession.sessionId,
    pattern: 'Tests completed',
    timeout: 180000 // 3 minutes
  });

  const testResults = await console_get_output({
    sessionId: testSession.sessionId
  });

  // Analyze test results
  const errors = await console_detect_errors({
    text: testResults.map(r => r.data).join('\n')
  });

  if (errors.hasErrors) {
    throw new Error(`Tests failed: ${errors.errors.length} errors detected`);
  }

  console.log('CI pipeline completed successfully');
}
```

### 7. Resource Monitoring and Alerts

```javascript
// Monitor container resources and set up alerts
protocol.on('metrics-collected', (metrics, session) => {
  const cpuThreshold = 80; // 80%
  const memoryThreshold = 0.9; // 90%
  
  if (metrics.cpu.usage > cpuThreshold) {
    console.warn(`High CPU usage in ${session.containerName}: ${metrics.cpu.usage.toFixed(2)}%`);
  }
  
  const memoryUsagePercent = (metrics.memory.usage / metrics.memory.limit) * 100;
  if (memoryUsagePercent > memoryThreshold * 100) {
    console.warn(`High memory usage in ${session.containerName}: ${memoryUsagePercent.toFixed(2)}%`);
  }
  
  // Log metrics for monitoring dashboard
  console.log(`[${session.containerName}] CPU: ${metrics.cpu.usage.toFixed(2)}%, Memory: ${memoryUsagePercent.toFixed(2)}%`);
});
```

## Advanced Features

### Custom Health Checks

```javascript
const containerOptions = {
  image: 'myapp:latest',
  healthcheck: {
    test: [
      'CMD-SHELL',
      'curl -f http://localhost:3000/health || exit 1'
    ],
    interval: 30000,    // 30 seconds
    timeout: 10000,     // 10 seconds
    retries: 3,
    startPeriod: 60000  // 1 minute grace period
  }
};
```

### Volume Management

```javascript
const containerOptions = {
  image: 'postgres:15',
  hostConfig: {
    binds: [
      '/host/data:/var/lib/postgresql/data:rw',
      '/host/backups:/backups:ro',
      'app-logs:/var/log/app'
    ],
    mounts: [{
      type: 'volume',
      source: 'postgres-data',
      target: '/var/lib/postgresql/data'
    }]
  }
};
```

### Network Configuration

```javascript
const containerOptions = {
  image: 'nginx:alpine',
  hostConfig: {
    networkMode: 'app-network',
    portBindings: {
      '80/tcp': [{ hostPort: '8080', hostIp: '127.0.0.1' }],
      '443/tcp': [{ hostPort: '8443' }]
    }
  },
  networkingConfig: {
    endpointsConfig: {
      'app-network': {
        aliases: ['web-server']
      }
    }
  }
};
```

### Resource Limits

```javascript
const containerOptions = {
  image: 'myapp:latest',
  hostConfig: {
    memory: 512 * 1024 * 1024, // 512MB
    memorySwap: 1024 * 1024 * 1024, // 1GB
    cpuShares: 512, // 50% of CPU
    cpuCount: 2,
    pidsLimit: 100
  }
};
```

## Error Handling

### Connection Issues

```javascript
protocol.on('connection-error', (error) => {
  console.error('Docker connection failed:', error.message);
  
  // Implement retry logic
  setTimeout(() => {
    protocol.reconnect();
  }, 5000);
});

protocol.on('reconnected', (connection) => {
  console.log('Docker connection restored');
});
```

### Container Failures

```javascript
protocol.on('container-error', (containerId, error, session) => {
  console.error(`Container ${session.containerName} failed:`, error.message);
  
  // Restart container if needed
  if (session.restartPolicy === 'always') {
    setTimeout(async () => {
      try {
        await protocol.stopSession(session.id);
        await protocol.createSession(session.originalOptions);
      } catch (restartError) {
        console.error('Failed to restart container:', restartError.message);
      }
    }, 5000);
  }
});
```

## Best Practices

### 1. Resource Management

```javascript
// Always set resource limits
const resourceLimits = {
  memory: 512 * 1024 * 1024, // 512MB
  cpuShares: 512,
  pidsLimit: 100
};

// Use auto-cleanup for temporary containers
const cleanupOptions = {
  autoRemove: true,
  removeVolumes: true
};
```

### 2. Security

```javascript
// Run containers with non-root user
const securityOptions = {
  user: '1000:1000',
  readonlyRootfs: true,
  securityOpt: ['no-new-privileges'],
  capDrop: ['ALL'],
  capAdd: ['NET_BIND_SERVICE'] // Only if needed
};

// Use secrets for sensitive data
const secretsOptions = {
  env: [], // Don't put secrets in environment variables
  secrets: [
    {
      secretId: 'db-password',
      secretName: 'database_password',
      uid: '1000',
      gid: '1000',
      mode: 0o400
    }
  ]
};
```

### 3. Logging

```javascript
// Configure proper log drivers
const loggingOptions = {
  logConfig: {
    type: 'json-file',
    config: {
      'max-size': '10m',
      'max-file': '3'
    }
  }
};

// Use structured logging in applications
const structuredLog = {
  timestamp: new Date().toISOString(),
  level: 'info',
  service: 'api-server',
  message: 'Request processed',
  requestId: 'req-123',
  userId: 'user-456'
};
```

### 4. Monitoring

```javascript
// Set up comprehensive health checks
const healthCheck = {
  test: ['CMD', 'healthcheck.sh'],
  interval: 30000,
  timeout: 10000,
  retries: 3,
  startPeriod: 60000
};

// Monitor key metrics
protocol.on('metrics-collected', (metrics, session) => {
  // Send metrics to monitoring system
  sendMetrics({
    container: session.containerName,
    cpu: metrics.cpu.usage,
    memory: metrics.memory.usage / metrics.memory.limit,
    network: metrics.network,
    timestamp: metrics.timestamp
  });
});
```

## Troubleshooting

### Common Issues

#### 1. Permission Denied
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Or use sudo with docker commands
sudo docker ps
```

#### 2. Connection Refused
```javascript
// Check Docker daemon status
const statusCheck = await console_execute_command({
  command: 'systemctl',
  args: ['status', 'docker']
});

// Verify Docker socket exists
const socketCheck = await console_execute_command({
  command: 'ls',
  args: ['-la', '/var/run/docker.sock']
});
```

#### 3. Container Won't Start
```javascript
// Check container logs
const logs = await console_get_output({
  sessionId: session.sessionId
});

// Inspect container configuration
const containerInfo = await protocol.getContainerInfo(session.containerId);
console.log('Container state:', containerInfo.state);
```

#### 4. Resource Exhaustion
```javascript
// Monitor system resources
protocol.on('metrics-collected', (metrics) => {
  if (metrics.memory.usage / metrics.memory.limit > 0.9) {
    console.warn('Container approaching memory limit');
    // Implement scaling or cleanup logic
  }
});
```

### Debugging Tips

1. **Enable Debug Logging**
```javascript
const config = {
  debug: true,
  logLevel: 'debug'
};
```

2. **Use Interactive Mode**
```javascript
const debugSession = await console_create_session({
  command: 'bash',
  consoleType: 'docker-exec',
  dockerOptions: { containerId: 'existing-container' }
});
```

3. **Check Docker Events**
```bash
docker events --filter container=myapp
```

## Migration Guide

### From Docker CLI to MCP Docker Protocol

#### Before (Docker CLI)
```bash
docker run -d --name web-app -p 8080:80 nginx:alpine
docker exec -it web-app sh
docker logs web-app
docker stop web-app
docker rm web-app
```

#### After (MCP Docker Protocol)
```javascript
// Create and start container
const session = await console_create_session({
  command: 'nginx',
  args: ['-g', 'daemon off;'],
  consoleType: 'docker',
  dockerContainerOptions: {
    image: 'nginx:alpine',
    name: 'web-app',
    hostConfig: {
      portBindings: { '80/tcp': [{ hostPort: '8080' }] }
    }
  }
});

// Execute commands
const execSession = await console_create_session({
  command: 'sh',
  consoleType: 'docker-exec',
  dockerOptions: { containerId: session.containerId }
});

// Get logs
const logs = await console_get_output({ sessionId: session.sessionId });

// Stop and cleanup
await console_stop_session({ sessionId: session.sessionId });
```

### From Docker Compose to MCP

#### Before (docker-compose.yml)
```yaml
version: '3.8'
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
  api:
    image: node:18
    working_dir: /app
    volumes:
      - ./:/app
    command: npm start
```

#### After (MCP Configuration)
```javascript
const services = [
  {
    name: 'web',
    image: 'nginx:alpine',
    ports: { '80/tcp': '8080' }
  },
  {
    name: 'api',
    image: 'node:18',
    workingDir: '/app',
    volumes: ['./:/app'],
    command: 'npm start'
  }
];

for (const service of services) {
  await console_create_session({
    command: service.command.split(' ')[0],
    args: service.command.split(' ').slice(1),
    consoleType: 'docker',
    dockerContainerOptions: {
      image: service.image,
      name: service.name,
      workingDir: service.workingDir,
      hostConfig: {
        binds: service.volumes,
        portBindings: service.ports ? 
          { [`${Object.keys(service.ports)[0]}`]: [{ hostPort: service.ports[Object.keys(service.ports)[0]] }] } : 
          undefined
      }
    }
  });
}
```

## Performance Tuning

### 1. Container Optimization
```javascript
// Use alpine images for smaller size
const optimizedConfig = {
  image: 'node:18-alpine',
  hostConfig: {
    memory: 256 * 1024 * 1024, // Limit memory
    cpuShares: 256, // Limit CPU
    ulimits: [
      { name: 'nofile', soft: 1024, hard: 1024 }
    ]
  }
};
```

### 2. Log Management
```javascript
// Limit log size and rotation
const logConfig = {
  logConfig: {
    type: 'json-file',
    config: {
      'max-size': '10m',
      'max-file': '3',
      'compress': 'true'
    }
  }
};
```

### 3. Network Optimization
```javascript
// Use host networking for high-performance applications
const networkConfig = {
  hostConfig: {
    networkMode: 'host' // Use with caution
  }
};

// Or create custom networks
const customNetwork = {
  networkingConfig: {
    endpointsConfig: {
      'high-performance-network': {
        // Network-specific configuration
      }
    }
  }
};
```

## Security Best Practices

1. **Use Minimal Base Images**
2. **Run as Non-Root User**
3. **Limit Container Capabilities**
4. **Use Read-Only Root Filesystem**
5. **Scan Images for Vulnerabilities**
6. **Keep Docker and Images Updated**
7. **Use Secrets Management**
8. **Implement Network Policies**

## API Reference

### Events

- `container-created`: Container successfully created
- `container-started`: Container started
- `container-stopped`: Container stopped
- `container-removed`: Container removed
- `container-error`: Container error occurred
- `exec-created`: Exec session created
- `exec-started`: Exec session started
- `exec-completed`: Exec session completed
- `health-check`: Health check result
- `log-stream`: Log stream data
- `metrics-collected`: Metrics collected
- `docker-event`: Docker daemon event
- `connection-error`: Connection error
- `reconnected`: Connection restored

### Methods

- `createSession(options)`: Create container session
- `createExecSession(options)`: Create exec session
- `executeCommand(sessionId, command)`: Execute command
- `stopSession(sessionId, options)`: Stop session
- `getSessionOutput(sessionId, options)`: Get output
- `getContainerInfo(containerId)`: Get container info
- `getAllSessions()`: Get all sessions
- `getSession(sessionId)`: Get specific session
- `isConnectionHealthy()`: Check connection status
- `cleanup()`: Cleanup all resources

### Configuration Options

See the TypeScript interfaces in the source code for complete configuration options.