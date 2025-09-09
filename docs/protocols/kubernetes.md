# Kubernetes Protocol

## Overview

The Kubernetes Protocol enables AI assistants to interact with Kubernetes clusters, execute commands in pods, manage deployments, and automate Kubernetes workflows through the MCP Console Automation server. It provides comprehensive cluster management, pod execution, log streaming, and resource monitoring capabilities.

## Features

- **Multi-Cluster Support**: Connect to multiple Kubernetes clusters simultaneously
- **Pod Command Execution**: Execute commands in running containers
- **Log Streaming**: Real-time log streaming from pods and containers
- **Port Forwarding**: Forward cluster services to local ports
- **Resource Management**: Create, update, delete Kubernetes resources
- **File Operations**: Copy files to/from containers
- **Health Monitoring**: Cluster and pod health monitoring
- **Event Watching**: Real-time Kubernetes event monitoring
- **Scaling Operations**: Scale deployments and replica sets

## Prerequisites

- Kubernetes cluster access (local, cloud, or on-premises)
- kubectl configured and authenticated
- Appropriate RBAC permissions for desired operations

### Cluster Setup

```bash
# Verify cluster access
kubectl cluster-info
kubectl get nodes

# Check current context
kubectl config current-context

# List all contexts
kubectl config get-contexts
```

## Configuration

### Basic Configuration

```typescript
const k8sConfig: KubernetesProtocolConfig = {
  connection: {
    type: 'kubeconfig',
    kubeconfigPath: '~/.kube/config',
    context: 'default', // Optional: use specific context
    namespace: 'default' // Default namespace
  },
  monitoring: {
    enabled: true,
    healthCheckInterval: 30000,
    logStreamingEnabled: true,
    eventWatchingEnabled: true
  },
  retryOptions: {
    maxAttempts: 3,
    backoffMultiplier: 2,
    initialDelay: 1000
  }
};
```

### Advanced Configuration

```typescript
const advancedK8sConfig: KubernetesProtocolConfig = {
  connection: {
    type: 'cluster',
    server: 'https://k8s-api.example.com:6443',
    token: process.env.K8S_TOKEN,
    caData: process.env.K8S_CA_CERT,
    // or certificate auth
    clientCertData: process.env.K8S_CLIENT_CERT,
    clientKeyData: process.env.K8S_CLIENT_KEY,
    namespace: 'production'
  },
  security: {
    enableRBAC: true,
    allowedNamespaces: ['production', 'staging'],
    restrictedOperations: ['delete', 'patch'],
    requireApproval: true
  },
  monitoring: {
    enabled: true,
    metricsCollection: true,
    alerting: {
      enabled: true,
      webhookUrl: 'https://alerts.example.com/webhook'
    }
  }
};
```

### Multi-Cluster Configuration

```typescript
const multiClusterConfig = {
  clusters: [
    {
      name: 'production',
      context: 'prod-cluster',
      namespace: 'default',
      primary: true
    },
    {
      name: 'staging',
      context: 'staging-cluster', 
      namespace: 'staging'
    },
    {
      name: 'development',
      context: 'dev-cluster',
      namespace: 'development'
    }
  ],
  defaultCluster: 'production'
};
```

## Usage Examples

### 1. Basic Pod Command Execution

```javascript
// Execute command in a specific pod
const result = await console_execute_command({
  command: 'kubectl',
  args: ['exec', 'my-pod', '--', 'ls', '-la'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'default',
    container: 'main-container'
  }
});

console.log('Directory listing:', result.output);

// Interactive shell session
const shellSession = await console_create_session({
  command: 'kubectl',
  args: ['exec', '-it', 'my-pod', '--', '/bin/bash'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'production',
    container: 'app-container',
    podSelector: {
      labelSelector: 'app=web-server',
      fieldSelector: 'status.phase=Running'
    }
  }
});

// Execute commands in the shell
await console_send_input({
  sessionId: shellSession.sessionId,
  input: 'cd /app && ls -la\n'
});
```

### 2. Application Deployment and Management

```javascript
// Deploy application from YAML manifest
const deployResult = await console_execute_command({
  command: 'kubectl',
  args: ['apply', '-f', 'deployment.yaml'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'production'
  }
});

// Wait for deployment rollout
const rolloutSession = await console_create_session({
  command: 'kubectl',
  args: ['rollout', 'status', 'deployment/web-app'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'production'
  }
});

await console_wait_for_output({
  sessionId: rolloutSession.sessionId,
  pattern: 'successfully rolled out',
  timeout: 300000 // 5 minutes
});

// Scale deployment
await console_execute_command({
  command: 'kubectl',
  args: ['scale', 'deployment/web-app', '--replicas=5'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'production'
  }
});
```

### 3. Log Monitoring and Analysis

```javascript
// Stream logs from multiple pods
const logSession = await console_create_session({
  command: 'kubectl',
  args: ['logs', '-f', '-l', 'app=web-server', '--all-containers=true'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'production',
    logOptions: {
      follow: true,
      timestamps: true,
      sinceTime: new Date(Date.now() - 3600000), // Last hour
      tailLines: 100
    }
  },
  streaming: true
});

// Monitor for errors in logs
protocol.on('log-stream', (logEntry, session) => {
  if (logEntry.level === 'ERROR' || logEntry.message.includes('error')) {
    console.error(`Error in ${logEntry.pod}/${logEntry.container}: ${logEntry.message}`);
    
    // Optionally trigger alerts or remediation
    triggerAlert({
      severity: 'high',
      pod: logEntry.pod,
      container: logEntry.container,
      message: logEntry.message,
      timestamp: logEntry.timestamp
    });
  }
});

// Analyze logs for specific patterns
const errorAnalysis = await console_execute_command({
  command: 'kubectl',
  args: ['logs', '-l', 'app=web-server', '--since=1h', '--all-containers=true'],
  consoleType: 'kubernetes',
  k8sOptions: { namespace: 'production' }
});

const errors = await console_detect_errors({
  text: errorAnalysis.output
});

console.log(`Found ${errors.errors.length} errors in the last hour`);
```

### 4. Database Operations in Kubernetes

```javascript
// Connect to database pod
const dbSession = await console_create_session({
  command: 'kubectl',
  args: ['exec', '-it', 'postgres-0', '--', 'psql', '-U', 'postgres'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'database',
    container: 'postgres'
  }
});

// Run database queries
await console_send_input({
  sessionId: dbSession.sessionId,
  input: '\\l\n' // List databases
});

await console_wait_for_output({
  sessionId: dbSession.sessionId,
  pattern: 'List of databases',
  timeout: 10000
});

// Backup database
const backupSession = await console_create_session({
  command: 'kubectl',
  args: ['exec', 'postgres-0', '--', 'pg_dump', '-U', 'postgres', 'myapp'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'database',
    container: 'postgres'
  }
});

// Stream backup to local file
const backupOutput = await console_get_output({
  sessionId: backupSession.sessionId
});

// Save backup (in real scenario, you'd stream this)
require('fs').writeFileSync(`backup-${Date.now()}.sql`, backupOutput.map(o => o.data).join('\n'));
```

### 5. Port Forwarding for Local Development

```javascript
// Forward database port for local development
const portForwardSession = await console_create_session({
  command: 'kubectl',
  args: ['port-forward', 'svc/postgres', '5432:5432'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'database'
  }
});

await console_wait_for_output({
  sessionId: portForwardSession.sessionId,
  pattern: 'Forwarding from',
  timeout: 10000
});

console.log('Database accessible at localhost:5432');

// Forward web application
const webForwardSession = await console_create_session({
  command: 'kubectl',
  args: ['port-forward', 'deployment/web-app', '8080:80'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'production'
  }
});

// Application will be accessible at localhost:8080
```

### 6. CI/CD Pipeline with Kubernetes

```javascript
// Automated deployment pipeline
async function deployToKubernetes(environment, imageTag) {
  const namespace = environment;
  
  try {
    // Update deployment with new image
    const updateResult = await console_execute_command({
      command: 'kubectl',
      args: [
        'set', 'image', 
        'deployment/web-app', 
        `web-app=myregistry/web-app:${imageTag}`
      ],
      consoleType: 'kubernetes',
      k8sOptions: { namespace }
    });

    if (updateResult.exitCode !== 0) {
      throw new Error(`Failed to update deployment: ${updateResult.stderr}`);
    }

    // Wait for rollout to complete
    const rolloutSession = await console_create_session({
      command: 'kubectl',
      args: ['rollout', 'status', 'deployment/web-app', '--timeout=600s'],
      consoleType: 'kubernetes',
      k8sOptions: { namespace }
    });

    await console_wait_for_output({
      sessionId: rolloutSession.sessionId,
      pattern: 'successfully rolled out',
      timeout: 600000
    });

    // Run health checks
    const healthCheck = await console_execute_command({
      command: 'kubectl',
      args: ['get', 'pods', '-l', 'app=web-app', '--field-selector=status.phase=Running'],
      consoleType: 'kubernetes',
      k8sOptions: { namespace }
    });

    const runningPods = healthCheck.output.split('\n').length - 1; // Subtract header
    if (runningPods === 0) {
      throw new Error('No running pods after deployment');
    }

    console.log(`Deployment successful: ${runningPods} pods running`);
    return { success: true, podsRunning: runningPods };

  } catch (error) {
    // Rollback on failure
    console.error('Deployment failed, rolling back:', error.message);
    
    await console_execute_command({
      command: 'kubectl',
      args: ['rollout', 'undo', 'deployment/web-app'],
      consoleType: 'kubernetes',
      k8sOptions: { namespace }
    });

    throw error;
  }
}

// Deploy to staging first
await deployToKubernetes('staging', 'v1.2.3');

// Run integration tests
const testResult = await runIntegrationTests('staging');
if (testResult.passed) {
  // Deploy to production
  await deployToKubernetes('production', 'v1.2.3');
}
```

### 7. Resource Monitoring and Scaling

```javascript
// Monitor resource usage
const metricsSession = await console_create_session({
  command: 'kubectl',
  args: ['top', 'pods', '--all-namespaces'],
  consoleType: 'kubernetes'
});

// Auto-scaling based on metrics
protocol.on('metrics-collected', async (metrics, session) => {
  for (const pod of metrics.pods) {
    if (pod.cpuUsage > 80) {
      console.log(`High CPU usage in ${pod.name}: ${pod.cpuUsage}%`);
      
      // Scale up deployment
      await console_execute_command({
        command: 'kubectl',
        args: ['scale', `deployment/${pod.deployment}`, '--replicas=+1'],
        consoleType: 'kubernetes',
        k8sOptions: { namespace: pod.namespace }
      });
    }
  }
});

// Manual scaling with verification
async function scaleApplication(deploymentName, namespace, replicas) {
  // Scale deployment
  await console_execute_command({
    command: 'kubectl',
    args: ['scale', `deployment/${deploymentName}`, `--replicas=${replicas}`],
    consoleType: 'kubernetes',
    k8sOptions: { namespace }
  });

  // Wait for scaling to complete
  await console_wait_for_output({
    pattern: 'scaled',
    timeout: 60000
  });

  // Verify scaled pods are ready
  const verifySession = await console_create_session({
    command: 'kubectl',
    args: ['get', 'pods', '-l', `app=${deploymentName}`, '--field-selector=status.phase=Running'],
    consoleType: 'kubernetes',
    k8sOptions: { namespace }
  });

  const output = await console_get_output({
    sessionId: verifySession.sessionId
  });

  const runningPods = output.length - 1; // Subtract header
  console.log(`Scaling complete: ${runningPods}/${replicas} pods running`);
}
```

### 8. Troubleshooting and Debugging

```javascript
// Debug failing pods
async function debugFailingPods(namespace) {
  // Get all pods with issues
  const problemPodsResult = await console_execute_command({
    command: 'kubectl',
    args: ['get', 'pods', '--field-selector=status.phase!=Running'],
    consoleType: 'kubernetes',
    k8sOptions: { namespace }
  });

  if (problemPodsResult.output.includes('No resources found')) {
    console.log('No problematic pods found');
    return;
  }

  // Get detailed information for each problem pod
  const podNames = problemPodsResult.output
    .split('\n')
    .slice(1) // Skip header
    .map(line => line.split(/\s+/)[0])
    .filter(name => name && name !== 'NAME');

  for (const podName of podNames) {
    console.log(`\n--- Debugging pod: ${podName} ---`);
    
    // Describe pod
    const describeResult = await console_execute_command({
      command: 'kubectl',
      args: ['describe', 'pod', podName],
      consoleType: 'kubernetes',
      k8sOptions: { namespace }
    });
    
    console.log('Pod description:', describeResult.output);

    // Get pod logs
    const logsResult = await console_execute_command({
      command: 'kubectl',
      args: ['logs', podName, '--previous', '--tail=50'],
      consoleType: 'kubernetes',
      k8sOptions: { namespace }
    });

    console.log('Recent logs:', logsResult.output);

    // Check events
    const eventsResult = await console_execute_command({
      command: 'kubectl',
      args: ['get', 'events', '--field-selector', `involvedObject.name=${podName}`],
      consoleType: 'kubernetes',
      k8sOptions: { namespace }
    });

    console.log('Related events:', eventsResult.output);
  }
}

// Run debugging for production namespace
await debugFailingPods('production');
```

## Advanced Features

### Custom Resource Definitions (CRDs)

```javascript
// Work with custom resources
const customResourceSession = await console_create_session({
  command: 'kubectl',
  args: ['get', 'myresources.example.com'],
  consoleType: 'kubernetes',
  k8sOptions: {
    namespace: 'default'
  }
});

// Apply custom resource
const customResource = `
apiVersion: example.com/v1
kind: MyResource
metadata:
  name: my-custom-resource
  namespace: default
spec:
  replicas: 3
  image: myapp:latest
`;

await console_execute_command({
  command: 'kubectl',
  args: ['apply', '-f', '-'],
  input: customResource,
  consoleType: 'kubernetes'
});
```

### Helm Chart Management

```javascript
// Deploy Helm chart
const helmDeploy = await console_create_session({
  command: 'helm',
  args: ['install', 'my-release', 'charts/my-app', '--namespace', 'production'],
  consoleType: 'kubernetes'
});

// Upgrade Helm release
await console_execute_command({
  command: 'helm',
  args: ['upgrade', 'my-release', 'charts/my-app', '--set', 'image.tag=v1.2.3'],
  consoleType: 'kubernetes'
});

// Rollback if needed
await console_execute_command({
  command: 'helm',
  args: ['rollback', 'my-release', '1'],
  consoleType: 'kubernetes'
});
```

### Cluster Administration

```javascript
// Node management
const nodeStatus = await console_execute_command({
  command: 'kubectl',
  args: ['get', 'nodes', '-o', 'wide'],
  consoleType: 'kubernetes'
});

// Drain node for maintenance
const drainResult = await console_execute_command({
  command: 'kubectl',
  args: ['drain', 'worker-node-1', '--ignore-daemonsets', '--force'],
  consoleType: 'kubernetes',
  timeout: 300000
});

// Uncordon node after maintenance
await console_execute_command({
  command: 'kubectl',
  args: ['uncordon', 'worker-node-1'],
  consoleType: 'kubernetes'
});
```

## Error Handling

### Connection Issues

```javascript
protocol.on('connection-error', (error, clusterName) => {
  console.error(`Connection failed to cluster ${clusterName}:`, error.message);
  
  // Attempt reconnection with exponential backoff
  setTimeout(() => {
    protocol.reconnectToCluster(clusterName);
  }, 5000);
});

protocol.on('authentication-error', (error, clusterName) => {
  console.error(`Authentication failed for cluster ${clusterName}:`, error.message);
  // Handle token refresh or reconfiguration
});
```

### Resource Errors

```javascript
protocol.on('resource-error', (error, resource) => {
  console.error(`Resource operation failed for ${resource.kind}/${resource.name}:`, error.message);
  
  if (error.code === 'ENOTFOUND') {
    console.log('Resource not found, may have been deleted');
  } else if (error.code === 'FORBIDDEN') {
    console.log('Insufficient permissions for this operation');
  }
});

// Handle pod failures
protocol.on('pod-failed', (podInfo, session) => {
  console.error(`Pod ${podInfo.name} failed in namespace ${podInfo.namespace}`);
  
  // Auto-restart if configured
  if (session.autoRestart) {
    restartPod(podInfo.name, podInfo.namespace);
  }
});
```

## Best Practices

### 1. Security

```javascript
// Use service accounts with minimal permissions
const serviceAccountConfig = {
  serviceAccount: 'app-service-account',
  namespace: 'production',
  rbacRules: [
    {
      apiGroups: [''],
      resources: ['pods'],
      verbs: ['get', 'list', 'watch']
    },
    {
      apiGroups: ['apps'],
      resources: ['deployments'],
      verbs: ['get', 'update', 'patch']
    }
  ]
};

// Use network policies
const networkPolicy = `
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-netpol
spec:
  podSelector:
    matchLabels:
      app: web
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 8080
`;
```

### 2. Resource Management

```javascript
// Set resource limits and requests
const resourceLimits = {
  resources: {
    requests: {
      memory: '256Mi',
      cpu: '100m'
    },
    limits: {
      memory: '512Mi',
      cpu: '200m'
    }
  }
};

// Use pod disruption budgets
const pdbConfig = `
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-app-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: web-app
`;
```

### 3. Monitoring and Observability

```javascript
// Implement comprehensive logging
const loggingConfig = {
  logLevel: 'info',
  structuredLogging: true,
  logAggregation: {
    enabled: true,
    endpoint: 'https://logs.example.com'
  },
  metrics: {
    enabled: true,
    exportInterval: 30000,
    metricsEndpoint: 'https://metrics.example.com'
  }
};

// Set up alerts
const alertRules = [
  {
    name: 'HighCPUUsage',
    condition: 'cpu_usage > 80',
    duration: '5m',
    action: 'scale_up'
  },
  {
    name: 'PodCrashLooping',
    condition: 'restart_count > 5',
    duration: '1m',
    action: 'alert_oncall'
  }
];
```

### 4. Deployment Strategies

```javascript
// Blue-Green deployment
async function blueGreenDeploy(appName, newVersion, namespace) {
  // Create green deployment
  await console_execute_command({
    command: 'kubectl',
    args: ['apply', '-f', `deployments/${appName}-green.yaml`],
    consoleType: 'kubernetes',
    k8sOptions: { namespace }
  });

  // Wait for green deployment to be ready
  await waitForDeploymentReady(`${appName}-green`, namespace);

  // Switch traffic to green
  await console_execute_command({
    command: 'kubectl',
    args: ['patch', 'service', appName, '-p', '{"spec":{"selector":{"version":"green"}}}'],
    consoleType: 'kubernetes',
    k8sOptions: { namespace }
  });

  // Clean up blue deployment
  setTimeout(async () => {
    await console_execute_command({
      command: 'kubectl',
      args: ['delete', 'deployment', `${appName}-blue`],
      consoleType: 'kubernetes',
      k8sOptions: { namespace }
    });
  }, 300000); // Wait 5 minutes before cleanup
}
```

## Troubleshooting

### Common Issues

#### 1. Connection Problems
```javascript
// Test cluster connectivity
const connectTest = await console_execute_command({
  command: 'kubectl',
  args: ['cluster-info'],
  consoleType: 'kubernetes'
});

// Check authentication
const authTest = await console_execute_command({
  command: 'kubectl',
  args: ['auth', 'can-i', 'get', 'pods'],
  consoleType: 'kubernetes'
});
```

#### 2. Pod Startup Issues
```javascript
// Check pod events
const events = await console_execute_command({
  command: 'kubectl',
  args: ['get', 'events', '--sort-by=.metadata.creationTimestamp'],
  consoleType: 'kubernetes',
  k8sOptions: { namespace: 'production' }
});

// Check image pull secrets
const imagePullCheck = await console_execute_command({
  command: 'kubectl',
  args: ['get', 'secrets', '--field-selector=type=kubernetes.io/dockerconfigjson'],
  consoleType: 'kubernetes'
});
```

#### 3. Network Issues
```javascript
// Test network connectivity between pods
const networkTest = await console_create_session({
  command: 'kubectl',
  args: ['exec', 'test-pod', '--', 'nc', '-zv', 'service-name', '80'],
  consoleType: 'kubernetes'
});

// Check DNS resolution
const dnsTest = await console_execute_command({
  command: 'kubectl',
  args: ['exec', 'test-pod', '--', 'nslookup', 'kubernetes.default.svc.cluster.local'],
  consoleType: 'kubernetes'
});
```

## Migration Guide

### From Docker Compose to Kubernetes

#### Before (docker-compose.yml)
```yaml
version: '3.8'
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    environment:
      - ENV=production
  db:
    image: postgres:13
    environment:
      - POSTGRES_DB=myapp
    volumes:
      - db-data:/var/lib/postgresql/data
volumes:
  db-data:
```

#### After (Kubernetes Manifests)
```javascript
// Deploy web service
const webDeployment = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: nginx
        image: nginx:alpine
        ports:
        - containerPort: 80
        env:
        - name: ENV
          value: production
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
spec:
  selector:
    app: web
  ports:
  - port: 80
    targetPort: 80
  type: LoadBalancer
`;

await console_execute_command({
  command: 'kubectl',
  args: ['apply', '-f', '-'],
  input: webDeployment,
  consoleType: 'kubernetes'
});
```

## Performance Tuning

### 1. Resource Optimization
```javascript
// Use resource quotas
const resourceQuota = `
apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    persistentvolumeclaims: "10"
`;
```

### 2. Node Affinity and Anti-Affinity
```javascript
const affinityConfig = {
  affinity: {
    nodeAffinity: {
      requiredDuringSchedulingIgnoredDuringExecution: {
        nodeSelectorTerms: [{
          matchExpressions: [{
            key: 'node-type',
            operator: 'In',
            values: ['high-memory']
          }]
        }]
      }
    },
    podAntiAffinity: {
      preferredDuringSchedulingIgnoredDuringExecution: [{
        weight: 100,
        podAffinityTerm: {
          labelSelector: {
            matchExpressions: [{
              key: 'app',
              operator: 'In',
              values: ['web']
            }]
          },
          topologyKey: 'kubernetes.io/hostname'
        }
      }]
    }
  }
};
```

## API Reference

### Events

- `connection-established`: Connected to cluster
- `connection-error`: Connection failed
- `authentication-error`: Authentication failed
- `pod-created`: Pod created
- `pod-ready`: Pod ready for traffic
- `pod-failed`: Pod failed
- `deployment-updated`: Deployment updated
- `log-stream`: Log stream data
- `metrics-collected`: Metrics collected
- `resource-error`: Resource operation failed

### Methods

- `connectToCluster(config)`: Connect to cluster
- `createSession(options)`: Create exec session
- `executeInPod(podName, command, options)`: Execute command in pod
- `getPodsInNamespace(namespace, selector?)`: Get pods
- `streamLogs(podName, options)`: Stream pod logs
- `forwardPort(podName, ports)`: Forward ports
- `copyToPod(localPath, podPath, options)`: Copy files to pod
- `copyFromPod(podPath, localPath, options)`: Copy files from pod
- `scaleDeployment(name, replicas)`: Scale deployment
- `getClusterInfo()`: Get cluster information
- `watchEvents(namespace?)`: Watch cluster events

### Configuration Options

See the TypeScript interfaces in the source code for complete configuration options including `KubernetesProtocolConfig`, `KubernetesConnectionOptions`, and `PodSelectionOptions`.