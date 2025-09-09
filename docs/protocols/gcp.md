# Google Cloud Platform (GCP) Protocol Documentation

## Overview

The GCP Protocol provides comprehensive integration with Google Cloud Platform services, enabling automated console access to Google Cloud Shell, Compute Engine instances, and Google Kubernetes Engine (GKE) clusters. This protocol supports multiple authentication methods including service accounts, OAuth2, and Application Default Credentials (ADC).

## Features

- **Google Cloud Shell Integration**: Direct browser-based terminal access with pre-installed tools
- **Compute Engine VM Access**: SSH connections via OS Login or traditional key-based authentication
- **GKE Cluster Management**: kubectl access and pod execution capabilities
- **Identity-Aware Proxy (IAP) Support**: Secure access without external IPs
- **OS Login Integration**: Centralized SSH key and user management
- **Multi-Project Support**: Manage resources across multiple GCP projects
- **Quota Management**: Monitor and enforce API quotas and rate limits
- **Advanced Authentication**: Service accounts, OAuth2, and ADC support

## Configuration

### Basic Configuration

```javascript
const gcpOptions = {
  // Project configuration
  projectId: 'my-project-id',
  region: 'us-central1',
  zone: 'us-central1-a',
  
  // Authentication (choose one method)
  keyFile: '/path/to/service-account-key.json',
  // OR keyFilename: './service-account.json',
  // OR credentials: { /* service account object */ },
  
  // Cloud Shell settings
  cloudShellType: 'bash', // or 'fish', 'zsh'
  machineType: 'e2-small',
  diskSizeGb: 20,
  
  // Compute Engine settings
  vmName: 'my-instance',
  vmZone: 'us-central1-a',
  vmProject: 'compute-project-id',
  
  // OS Login settings
  osLoginEnabled: true,
  osLoginUser: 'user@example.com'
};
```

### OAuth2 Configuration

```javascript
const oauth2Options = {
  projectId: 'my-project-id',
  oauth2Config: {
    clientId: 'your-oauth2-client-id',
    clientSecret: 'your-oauth2-client-secret',
    refreshToken: 'your-refresh-token',
    accessToken: 'your-access-token' // optional, will be refreshed
  }
};
```

### Advanced Configuration

```javascript
const advancedOptions = {
  // Multi-project setup
  projectId: 'management-project',
  vmProject: 'compute-project',
  networkProject: 'network-project',
  
  // GKE configuration
  clusterName: 'my-gke-cluster',
  clusterLocation: 'us-central1-a', // or region for regional clusters
  namespace: 'production',
  podName: 'web-server-xyz',
  containerName: 'nginx',
  
  // IAP configuration
  iapTunnelEnabled: true,
  iapConfig: {
    clientId: 'iap-client-id',
    audience: '/projects/123456789/global/backendServices/my-backend'
  },
  
  // Network configuration
  networkTags: ['web-server', 'database'],
  serviceAccountEmail: 'compute@my-project.iam.gserviceaccount.com',
  
  // Security settings
  requireOSLogin: true,
  enableShieldedVm: true,
  enablePreemptibleInstances: false,
  
  // Custom scopes
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/compute.oslogin'
  ]
};
```

## Usage Examples

### Google Cloud Shell Session

```javascript
import { GCPProtocol } from './protocols/GCPProtocol.js';

const gcp = new GCPProtocol();

// Create Cloud Shell session
const session = await gcp.createCloudShellSession('cloudshell-1', {
  projectId: 'my-project-id',
  keyFile: './service-account-key.json',
  cloudShellType: 'bash',
  region: 'us-central1',
  diskSizeGb: 10
});

// Listen for output
gcp.on('output', (output) => {
  console.log(`[${output.sessionId}] ${output.data}`);
});

gcp.on('session-connected', async (event) => {
  console.log(`Session ${event.sessionId} connected via ${event.type}`);
  
  // Execute Cloud Shell commands
  await gcp.sendInput('cloudshell-1', 'gcloud config list\n');
  await gcp.sendInput('cloudshell-1', 'kubectl get namespaces\n');
  await gcp.sendInput('cloudshell-1', 'terraform version\n');
  await gcp.sendInput('cloudshell-1', 'docker --version\n');
});

// Handle errors
gcp.on('session-error', (event) => {
  console.error(`Session error: ${event.error.message}`);
});
```

### Compute Engine VM Access

```javascript
// Connect to Compute Engine VM via SSH
const vmSession = await gcp.createComputeSession('vm-ssh-1', {
  projectId: 'compute-project-id',
  vmName: 'web-server-1',
  vmZone: 'us-central1-a',
  osLoginEnabled: true,
  osLoginUser: 'admin@company.com',
  keyFile: './service-account-key.json'
});

gcp.on('session-connected', async (event) => {
  if (event.sessionId === 'vm-ssh-1') {
    console.log('Connected to Compute Engine VM');
    
    // System administration commands
    await gcp.sendInput('vm-ssh-1', 'sudo systemctl status nginx\n');
    await gcp.sendInput('vm-ssh-1', 'docker ps -a\n');
    await gcp.sendInput('vm-ssh-1', 'df -h\n');
    await gcp.sendInput('vm-ssh-1', 'htop\n');
  }
});
```

### GKE Cluster Management

```javascript
// Connect to GKE cluster
const gkeSession = await gcp.createGKESession('gke-1', {
  projectId: 'kubernetes-project',
  clusterName: 'production-cluster',
  clusterLocation: 'us-central1-a',
  namespace: 'default',
  keyFile: './service-account-key.json'
});

gcp.on('session-connected', async (event) => {
  if (event.sessionId === 'gke-1') {
    console.log('Connected to GKE cluster');
    
    // Kubernetes management commands
    await gcp.sendInput('gke-1', 'kubectl get pods --all-namespaces\n');
    await gcp.sendInput('gke-1', 'kubectl get services\n');
    await gcp.sendInput('gke-1', 'kubectl describe deployment nginx\n');
    await gcp.sendInput('gke-1', 'kubectl logs -f deployment/api-server\n');
  }
});
```

### Multi-Environment Management

```javascript
// Manage multiple GCP environments
const environments = [
  { name: 'dev', projectId: 'dev-project-123' },
  { name: 'staging', projectId: 'staging-project-456' },
  { name: 'prod', projectId: 'prod-project-789' }
];

const sessions = await Promise.all(
  environments.map(env => 
    gcp.createCloudShellSession(`shell-${env.name}`, {
      projectId: env.projectId,
      keyFile: `./keys/${env.name}-service-account.json`,
      cloudShellType: 'bash'
    })
  )
);

// Deploy to all environments
const deployToAllEnvironments = async (command) => {
  for (const session of sessions) {
    await gcp.sendInput(session.sessionId, command + '\n');
  }
};

// Execute deployment commands
await deployToAllEnvironments('gcloud app deploy app.yaml --quiet');
await deployToAllEnvironments('gcloud sql import sql my-instance gs://my-bucket/backup.sql');
```

## Advanced Features

### Identity-Aware Proxy (IAP) Access

```javascript
// Connect to VM behind IAP without external IP
const iapSession = await gcp.createComputeSession('iap-vm-1', {
  projectId: 'secure-project',
  vmName: 'private-server',
  vmZone: 'us-central1-a',
  iapTunnelEnabled: true,
  iapConfig: {
    clientId: 'your-iap-client-id.apps.googleusercontent.com',
    audience: '/projects/123456789/global/backendServices/my-backend'
  },
  osLoginEnabled: true,
  keyFile: './service-account-key.json'
});

// IAP tunnel will be automatically established
gcp.on('session-connected', async (event) => {
  if (event.sessionId === 'iap-vm-1') {
    console.log('Connected via IAP tunnel');
    await gcp.sendInput('iap-vm-1', 'curl -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/name\n');
  }
});
```

### OS Login Integration

```javascript
// Use OS Login for centralized SSH key management
const osLoginSession = await gcp.createComputeSession('oslogin-1', {
  projectId: 'my-project',
  vmName: 'secure-vm',
  vmZone: 'europe-west1-b',
  osLoginEnabled: true,
  osLoginUser: 'engineer@company.com', // Will use OS Login API
  keyFile: './service-account-key.json'
});

// OS Login automatically manages SSH keys and user permissions
gcp.on('session-connected', async (event) => {
  if (event.sessionId === 'oslogin-1') {
    // User permissions and SSH keys are managed by OS Login
    await gcp.sendInput('oslogin-1', 'id\n'); // Shows OS Login user info
    await gcp.sendInput('oslogin-1', 'sudo whoami\n'); // May work if user has sudo access
  }
});
```

### GKE Pod Execution

```javascript
// Execute commands inside specific GKE pods
const podExecSession = await gcp.createGKESession('pod-exec-1', {
  projectId: 'k8s-project',
  clusterName: 'app-cluster',
  clusterLocation: 'us-west1-a',
  namespace: 'production',
  podName: 'api-server-abc123',
  containerName: 'app-container',
  keyFile: './service-account-key.json'
});

gcp.on('session-connected', async (event) => {
  if (event.sessionId === 'pod-exec-1') {
    console.log('Connected to pod container');
    
    // Execute commands inside the container
    await gcp.sendInput('pod-exec-1', 'kubectl exec -it api-server-abc123 -c app-container -- /bin/bash\n');
    
    // Now commands run inside the container
    await gcp.sendInput('pod-exec-1', 'ps aux\n');
    await gcp.sendInput('pod-exec-1', 'netstat -tulpn\n');
    await gcp.sendInput('pod-exec-1', 'cat /app/config.yaml\n');
  }
});
```

### Batch Operations

```javascript
// Execute commands across multiple VMs
class GCPFleetManager {
  constructor() {
    this.gcp = new GCPProtocol();
    this.sessions = new Map();
  }
  
  async connectToFleet(vmList) {
    const connections = vmList.map(vm => 
      this.gcp.createComputeSession(vm.name, {
        projectId: vm.projectId,
        vmName: vm.name,
        vmZone: vm.zone,
        osLoginEnabled: true,
        keyFile: './service-account-key.json'
      })
    );
    
    const sessions = await Promise.all(connections);
    sessions.forEach(session => 
      this.sessions.set(session.sessionId, session)
    );
    
    return sessions;
  }
  
  async broadcastCommand(command) {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(
      sessionIds.map(sessionId =>
        this.gcp.sendInput(sessionId, command + '\n')
      )
    );
  }
  
  async updateSecurity() {
    await this.broadcastCommand('sudo apt update && sudo apt upgrade -y');
    await this.broadcastCommand('sudo systemctl restart security-agent');
    await this.broadcastCommand('sudo fail2ban-client status');
  }
}

// Usage
const fleetManager = new GCPFleetManager();
await fleetManager.connectToFleet([
  { name: 'web-1', projectId: 'prod', zone: 'us-central1-a' },
  { name: 'web-2', projectId: 'prod', zone: 'us-central1-b' },
  { name: 'api-1', projectId: 'prod', zone: 'us-central1-a' }
]);

await fleetManager.updateSecurity();
```

## Authentication Methods

### Service Account Authentication

```javascript
// Method 1: JSON Key File
const serviceAccountAuth = {
  projectId: 'my-project-id',
  keyFile: '/path/to/service-account-key.json'
};

// Method 2: Key File Path
const keyFilenameAuth = {
  projectId: 'my-project-id',
  keyFilename: './credentials/service-account.json'
};

// Method 3: Inline Credentials
const inlineAuth = {
  projectId: 'my-project-id',
  credentials: {
    type: 'service_account',
    project_id: 'my-project-id',
    private_key_id: 'key-id',
    private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
    client_email: 'service@my-project.iam.gserviceaccount.com',
    client_id: '123456789',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/service%40my-project.iam.gserviceaccount.com'
  }
};
```

### Application Default Credentials (ADC)

```javascript
// Uses environment variables or metadata service
const adcAuth = {
  projectId: 'my-project-id'
  // No explicit credentials - uses GOOGLE_APPLICATION_CREDENTIALS
  // environment variable or GCE/Cloud Shell metadata service
};

// Set environment variable before running
// export GOOGLE_APPLICATION_CREDENTIALS="path/to/service-account-key.json"
```

### OAuth2 User Authentication

```javascript
const oauth2Auth = {
  projectId: 'my-project-id',
  oauth2Config: {
    clientId: '123456789-abc.apps.googleusercontent.com',
    clientSecret: 'your-oauth2-client-secret',
    refreshToken: 'refresh-token-from-oauth2-flow'
  }
};
```

## Error Handling

### Common Error Scenarios

```javascript
gcp.on('session-error', (event) => {
  const { sessionId, error } = event;
  
  switch (error.code) {
    case 401:
      console.error(`Authentication failed for ${sessionId}: ${error.message}`);
      // Handle credential refresh or re-authentication
      break;
      
    case 403:
      console.error(`Permission denied for ${sessionId}: ${error.message}`);
      // Check IAM permissions and service account roles
      break;
      
    case 404:
      console.error(`Resource not found for ${sessionId}: ${error.message}`);
      // Verify project ID, zone, instance name, etc.
      break;
      
    case 429:
      console.error(`Rate limit exceeded for ${sessionId}: ${error.message}`);
      // Implement exponential backoff
      break;
      
    case 'COMPUTE_VM_NOT_RUNNING':
      console.error(`VM is not in RUNNING state: ${error.message}`);
      // Start the VM or wait for it to be ready
      break;
      
    case 'GKE_CLUSTER_UNREACHABLE':
      console.error(`GKE cluster is unreachable: ${error.message}`);
      // Check cluster status and network connectivity
      break;
      
    default:
      console.error(`Unexpected error in ${sessionId}:`, error);
  }
});
```

### Connection Recovery

```javascript
// Implement automatic reconnection with exponential backoff
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

gcp.on('session-disconnected', async (event) => {
  const { sessionId } = event;
  console.log(`Session ${sessionId} disconnected`);
  
  if (reconnectAttempts < maxReconnectAttempts) {
    reconnectAttempts++;
    const backoffDelay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
    
    console.log(`Attempting reconnection ${reconnectAttempts}/${maxReconnectAttempts} in ${backoffDelay}ms...`);
    
    setTimeout(async () => {
      try {
        const session = gcp.getSession(sessionId);
        if (session) {
          // Recreate session based on type
          if ('webSocketUrl' in session) {
            await gcp.createCloudShellSession(sessionId, session);
          } else if ('vmName' in session) {
            await gcp.createComputeSession(sessionId, session);
          } else if ('clusterName' in session) {
            await gcp.createGKESession(sessionId, session);
          }
        }
        reconnectAttempts = 0; // Reset on successful reconnection
      } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
      }
    }, backoffDelay);
  } else {
    console.error(`Max reconnection attempts reached for ${sessionId}`);
  }
});
```

## Performance Optimization

### Connection Pooling

```javascript
class GCPConnectionPool {
  constructor(maxConnections = 10) {
    this.gcp = new GCPProtocol();
    this.pool = new Map();
    this.maxConnections = maxConnections;
  }
  
  async getConnection(type, config) {
    const poolKey = this.generatePoolKey(type, config);
    
    if (!this.pool.has(poolKey)) {
      this.pool.set(poolKey, {
        connections: [],
        waiting: []
      });
    }
    
    const pool = this.pool.get(poolKey);
    
    // Return available connection
    const available = pool.connections.find(conn => !conn.inUse);
    if (available) {
      available.inUse = true;
      return available;
    }
    
    // Create new connection if under limit
    if (pool.connections.length < this.maxConnections) {
      const newConnection = await this.createConnection(type, config);
      newConnection.inUse = true;
      pool.connections.push(newConnection);
      return newConnection;
    }
    
    // Wait for available connection
    return new Promise((resolve) => {
      pool.waiting.push(resolve);
    });
  }
  
  releaseConnection(connection) {
    connection.inUse = false;
    
    // Fulfill waiting requests
    const poolKey = this.getPoolKeyForConnection(connection);
    const pool = this.pool.get(poolKey);
    
    if (pool && pool.waiting.length > 0) {
      const waitingResolve = pool.waiting.shift();
      connection.inUse = true;
      waitingResolve(connection);
    }
  }
  
  private async createConnection(type, config) {
    switch (type) {
      case 'cloudshell':
        return await this.gcp.createCloudShellSession(this.generateSessionId(), config);
      case 'compute':
        return await this.gcp.createComputeSession(this.generateSessionId(), config);
      case 'gke':
        return await this.gcp.createGKESession(this.generateSessionId(), config);
      default:
        throw new Error(`Unknown connection type: ${type}`);
    }
  }
}
```

### Resource Monitoring

```javascript
// Monitor GCP quotas and usage
class GCPResourceMonitor {
  constructor(gcp) {
    this.gcp = gcp;
    this.quotaAlerts = new Map();
  }
  
  async monitorQuotas(services = ['compute', 'gke', 'cloudshell']) {
    for (const service of services) {
      const quotas = await this.gcp.getQuotaInfo(service);
      
      for (const quota of quotas) {
        const usagePercent = (quota.usage / quota.limit) * 100;
        
        if (usagePercent > 80) {
          console.warn(`High quota usage for ${quota.quotaName}: ${usagePercent.toFixed(1)}%`);
          
          if (usagePercent > 90) {
            this.sendQuotaAlert(quota, usagePercent);
          }
        }
      }
    }
  }
  
  sendQuotaAlert(quota, usagePercent) {
    const alertKey = `${quota.service}:${quota.quotaName}`;
    const lastAlert = this.quotaAlerts.get(alertKey);
    const now = Date.now();
    
    // Throttle alerts to once per hour
    if (!lastAlert || (now - lastAlert) > 3600000) {
      console.error(`QUOTA ALERT: ${quota.quotaName} usage is ${usagePercent.toFixed(1)}% (${quota.usage}/${quota.limit} ${quota.unit})`);
      this.quotaAlerts.set(alertKey, now);
      
      // Send notification (implement your notification system)
      this.sendNotification('quota-alert', {
        service: quota.service,
        quota: quota.quotaName,
        usage: quota.usage,
        limit: quota.limit,
        usagePercent
      });
    }
  }
}
```

## Security Best Practices

### IAM and Permissions

```javascript
// Use least privilege principle for service accounts
const secureConfig = {
  projectId: 'my-project',
  keyFile: './service-account-key.json', // Restricted service account
  
  // Required roles for different operations:
  // Cloud Shell: roles/cloudshell.user
  // Compute SSH: roles/compute.osLogin or roles/compute.instanceAdmin
  // GKE: roles/container.developer or roles/container.clusterAdmin
  // IAP: roles/iap.tunnelResourceAccessor
  
  // Additional security settings
  requireOSLogin: true,
  enableShieldedVm: true,
  usePrivateGoogleAccess: true
};
```

### Network Security

```javascript
// Secure network configuration
const secureNetworkConfig = {
  projectId: 'secure-project',
  keyFile: './limited-service-account.json',
  
  // Use IAP instead of external IPs
  iapTunnelEnabled: true,
  
  // OS Login for centralized SSH key management
  osLoginEnabled: true,
  
  // Network tags for firewall rules
  networkTags: ['secure-access', 'monitoring'],
  
  // VPC configuration
  network: 'projects/shared-vpc-host/global/networks/secure-network',
  subnetwork: 'projects/shared-vpc-host/regions/us-central1/subnetworks/private-subnet',
  
  // Disable external IP access
  externalIpDisabled: true
};
```

### Secret Management

```javascript
// Use Google Secret Manager for sensitive data
const secretConfig = {
  projectId: 'my-project',
  keyFile: './service-account-key.json',
  
  // Reference secrets instead of hardcoding
  secrets: {
    databasePassword: 'projects/my-project/secrets/db-password/versions/latest',
    apiKey: 'projects/my-project/secrets/api-key/versions/latest'
  }
};

// Retrieve secrets during session setup
gcp.on('session-connected', async (event) => {
  // Retrieve secret values (implement Secret Manager client)
  const dbPassword = await getSecretValue(secretConfig.secrets.databasePassword);
  const apiKey = await getSecretValue(secretConfig.secrets.apiKey);
  
  // Use secrets in commands
  await gcp.sendInput(event.sessionId, `export DB_PASSWORD='${dbPassword}'\n`);
  await gcp.sendInput(event.sessionId, `export API_KEY='${apiKey}'\n`);
});
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   ```bash
   # Check service account permissions
   gcloud auth activate-service-account --key-file=service-account-key.json
   gcloud auth list
   
   # Verify project access
   gcloud projects get-iam-policy PROJECT_ID
   ```

2. **Cloud Shell Access Issues**
   - Verify Cloud Shell API is enabled
   - Check if user has `cloudshell.user` role
   - Ensure quota limits are not exceeded

3. **Compute Engine Connection Issues**
   - Verify VM is in RUNNING state
   - Check firewall rules allow SSH (port 22)
   - Ensure OS Login is properly configured
   - Verify service account has necessary compute roles

4. **GKE Access Issues**
   - Check cluster status and master authorized networks
   - Verify service account has container.developer role
   - Ensure kubectl credentials are valid

### Debug Mode

```javascript
// Enable comprehensive logging
const debugGcp = new GCPProtocol();

// Monitor all events
debugGcp.on('*', (eventName, ...args) => {
  console.log(`GCP Event: ${eventName}`, args);
});

// Get detailed session information
const sessions = debugGcp.listSessions();
sessions.forEach(({ sessionId, type, session }) => {
  console.log(`Session ${sessionId} (${type}):`, session);
});

// Monitor quota usage
const quotaInfo = await debugGcp.getQuotaInfo('compute', 'us-central1');
console.log('Quota Information:', quotaInfo);

// Check rate limiting
const rateLimitInfo = debugGcp.getRateLimitInfo('compute', 'instances.get');
console.log('Rate Limit Info:', rateLimitInfo);
```

## Integration Examples

### CI/CD Pipeline Integration

```javascript
// Google Cloud Build integration
class CloudBuildPipeline {
  constructor() {
    this.gcp = new GCPProtocol();
  }
  
  async deployToGKE(environment) {
    const session = await this.gcp.createGKESession(`deploy-${environment}`, {
      projectId: process.env[`GCP_PROJECT_${environment.toUpperCase()}`],
      clusterName: `app-cluster-${environment}`,
      clusterLocation: 'us-central1-a',
      namespace: environment,
      keyFile: `./keys/${environment}-deploy-sa.json`
    });
    
    try {
      // Deploy application
      await this.gcp.sendInput(session.sessionId, 'kubectl apply -f k8s/\n');
      
      // Wait for rollout
      await this.gcp.sendInput(session.sessionId, 'kubectl rollout status deployment/app\n');
      
      // Run smoke tests
      await this.gcp.sendInput(session.sessionId, 'kubectl run smoke-test --image=smoketest:latest --rm -it --restart=Never\n');
      
      return { success: true, sessionId: session.sessionId };
    } catch (error) {
      throw new Error(`Deployment failed: ${error.message}`);
    }
  }
}
```

### Infrastructure as Code

```javascript
// Terraform deployment via Cloud Shell
async function deployInfrastructure(workspaceName) {
  const session = await gcp.createCloudShellSession(`terraform-${workspaceName}`, {
    projectId: 'infrastructure-project',
    keyFile: './terraform-service-account.json',
    cloudShellType: 'bash',
    diskSizeGb: 20 // Extra space for Terraform state
  });
  
  const terraformCommands = [
    `cd /home/user/terraform/${workspaceName}`,
    'terraform init',
    'terraform workspace select ' + workspaceName,
    'terraform plan -out=tfplan',
    'terraform apply tfplan',
    'terraform output -json > outputs.json',
    'gsutil cp outputs.json gs://terraform-state-bucket/'
  ];
  
  for (const command of terraformCommands) {
    await gcp.sendInput(session.sessionId, command + '\n');
    
    // Wait for command completion
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 30000); // 30 second timeout
      
      gcp.once('output', (output) => {
        if (output.sessionId === session.sessionId && output.data.includes('$')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }
  
  return session.sessionId;
}
```

## API Reference

### Class: GCPProtocol

#### Methods

- `createCloudShellSession(sessionId, options)` - Create Cloud Shell session
- `createComputeSession(sessionId, options)` - Create Compute Engine session
- `createGKESession(sessionId, options)` - Create GKE session
- `sendInput(sessionId, input)` - Send input to session
- `closeSession(sessionId)` - Close session
- `getSession(sessionId)` - Get session information
- `listSessions()` - List all active sessions
- `getQuotaInfo(service, region, zone)` - Get quota information
- `getRateLimitInfo(service, method)` - Get rate limit information
- `cleanup()` - Cleanup all sessions and resources

#### Events

- `session-created` - Session created successfully
- `session-connected` - Session connection established
- `session-disconnected` - Session connection lost
- `session-error` - Session error occurred
- `output` - Output received from session

This comprehensive documentation covers all aspects of the GCP Protocol implementation, providing production-ready examples and best practices for Google Cloud Platform automation.