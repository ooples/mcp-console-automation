# Azure Protocol Documentation

## Overview

The Azure Protocol enables seamless integration with Microsoft Azure cloud services, providing comprehensive console automation capabilities for Azure Cloud Shell, Azure Bastion, and Azure Arc-enabled servers. This protocol supports multiple authentication methods and provides robust session management for hybrid cloud environments.

## Features

- **Azure Cloud Shell Integration**: Direct access to bash and PowerShell environments in the cloud
- **Azure Bastion Support**: Secure RDP and SSH connections to Azure VMs
- **Azure Arc Connectivity**: Manage on-premises and multi-cloud servers through Azure Arc
- **Multiple Authentication Methods**: Service principal, managed identity, CLI, and interactive authentication
- **Token Management**: Automatic token refresh and credential handling
- **WebSocket Communication**: Real-time bidirectional communication with Azure services
- **Health Monitoring**: Connection health checks and automatic reconnection
- **Key Vault Integration**: Secure secrets management through Azure Key Vault

## Configuration

### Basic Configuration

```javascript
const azureOptions = {
  // Authentication
  tenantId: 'your-tenant-id',
  subscriptionId: 'your-subscription-id',
  
  // Service Principal Authentication
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  
  // Or use managed identity
  managedIdentity: true,
  
  // Cloud Shell settings
  cloudShellType: 'bash', // or 'powershell'
  region: 'eastus',
  
  // Storage settings
  resourceGroupName: 'my-resource-group',
  storageAccountName: 'mystorageaccount',
  fileShareName: 'myfileshare'
};
```

### Advanced Configuration

```javascript
const advancedOptions = {
  // Certificate-based authentication
  clientCertificatePath: '/path/to/certificate.pem',
  
  // Bastion configuration
  bastionResourceId: '/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.Network/bastionHosts/bastion',
  targetVmResourceId: '/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm',
  targetVmName: 'my-vm',
  protocol: 'ssh', // or 'rdp'
  
  // Arc configuration
  arcResourceId: '/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.HybridCompute/machines/server',
  
  // Key Vault
  keyVaultUrl: 'https://myvault.vault.azure.net/',
  
  // Connection settings
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000
};
```

## Usage Examples

### Azure Cloud Shell Session

```javascript
import { AzureProtocol } from './protocols/AzureProtocol.js';

const azure = new AzureProtocol();

// Create Cloud Shell session
const session = await azure.createCloudShellSession('cloud-shell-1', {
  tenantId: process.env.AZURE_TENANT_ID,
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
  clientId: process.env.AZURE_CLIENT_ID,
  clientSecret: process.env.AZURE_CLIENT_SECRET,
  cloudShellType: 'bash',
  region: 'eastus'
});

// Listen for output
azure.on('output', (sessionId, output) => {
  console.log(`[${sessionId}] ${output.data}`);
});

azure.on('session-ready', async (sessionId) => {
  console.log(`Session ${sessionId} is ready`);
  
  // Execute commands
  await azure.sendInput(sessionId, 'az account show\n');
  await azure.sendInput(sessionId, 'kubectl get pods\n');
  await azure.sendInput(sessionId, 'terraform plan\n');
});

// Handle errors
azure.on('error', (sessionId, error) => {
  console.error(`Session error: ${error.message}`);
});
```

### Azure Bastion SSH Connection

```javascript
// Create Bastion session for SSH access
const bastionSession = await azure.createBastionSession('bastion-ssh-1', {
  tenantId: process.env.AZURE_TENANT_ID,
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
  managedIdentity: true,
  bastionResourceId: '/subscriptions/12345/resourceGroups/my-rg/providers/Microsoft.Network/bastionHosts/my-bastion',
  targetVmResourceId: '/subscriptions/12345/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm',
  targetVmName: 'my-linux-vm',
  protocol: 'ssh'
});

azure.on('connected', async (sessionId) => {
  console.log(`Bastion session connected: ${sessionId}`);
  
  // Execute SSH commands
  await azure.sendInput(sessionId, 'whoami\n');
  await azure.sendInput(sessionId, 'docker ps\n');
  await azure.sendInput(sessionId, 'systemctl status nginx\n');
});
```

### Azure Arc Server Management

```javascript
// Connect to Arc-enabled server
const arcSession = await azure.createArcSession('arc-server-1', {
  tenantId: process.env.AZURE_TENANT_ID,
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
  clientId: process.env.AZURE_CLIENT_ID,
  clientSecret: process.env.AZURE_CLIENT_SECRET,
  arcResourceId: '/subscriptions/12345/resourceGroups/my-rg/providers/Microsoft.HybridCompute/machines/on-prem-server'
});

azure.on('session-ready', async (sessionId) => {
  console.log(`Arc session ready: ${sessionId}`);
  
  // Manage on-premises server through Arc
  await azure.sendInput(sessionId, 'Get-Process | Where-Object { $_.CPU -gt 100 }\n');
  await azure.sendInput(sessionId, 'Install-WindowsUpdate -AcceptAll -AutoReboot\n');
  await azure.sendInput(sessionId, 'Get-EventLog -LogName System -Newest 10\n');
});
```

### Multi-Session Management

```javascript
// Manage multiple Azure environments
const sessions = await Promise.all([
  // Production Cloud Shell
  azure.createCloudShellSession('prod-shell', {
    subscriptionId: 'prod-subscription-id',
    cloudShellType: 'bash'
  }),
  
  // Development Cloud Shell
  azure.createCloudShellSession('dev-shell', {
    subscriptionId: 'dev-subscription-id',
    cloudShellType: 'powershell'
  }),
  
  // On-premises Arc server
  azure.createArcSession('on-prem-1', {
    arcResourceId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.HybridCompute/machines/server1'
  })
]);

// Broadcast commands to all sessions
const broadcastCommand = async (command) => {
  const activeSessions = azure.listSessions();
  await Promise.all(
    activeSessions.map(sessionId => 
      azure.sendInput(sessionId, command + '\n')
    )
  );
};

// Execute deployment commands across environments
await broadcastCommand('az deployment group create --resource-group myRG --template-file template.json');
```

## Advanced Features

### Automatic Token Refresh

```javascript
// Token refresh is handled automatically
azure.on('token-refreshed', (sessionId, tokenInfo) => {
  console.log(`Token refreshed for session ${sessionId}, expires: ${tokenInfo.expiresOn}`);
});

// Manual token refresh if needed
const isHealthy = await azure.healthCheck('session-1');
if (!isHealthy) {
  console.log('Session health check failed, attempting recovery...');
}
```

### Key Vault Integration

```javascript
// Sessions automatically use Key Vault for secure credential storage
const sessionWithKeyVault = await azure.createCloudShellSession('secure-session', {
  tenantId: process.env.AZURE_TENANT_ID,
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
  managedIdentity: true,
  keyVaultUrl: 'https://myvault.vault.azure.net/',
  // Additional secrets will be retrieved from Key Vault as needed
});
```

### Connection Resilience

```javascript
// Handle connection interruptions
azure.on('reconnecting', (sessionId, attempt) => {
  console.log(`Reconnecting session ${sessionId}, attempt ${attempt}`);
});

azure.on('connected', (sessionId) => {
  console.log(`Session ${sessionId} reconnected successfully`);
});

// Manual reconnection with custom logic
azure.on('error', async (sessionId, error) => {
  if (error.message.includes('authentication')) {
    console.log('Authentication error, refreshing credentials...');
    // Custom error handling logic
  }
});
```

### Terminal Resizing

```javascript
// Handle terminal resize events
window.addEventListener('resize', async () => {
  const rows = Math.floor(window.innerHeight / 20);
  const cols = Math.floor(window.innerWidth / 10);
  
  const sessions = azure.listSessions();
  await Promise.all(
    sessions.map(sessionId => 
      azure.resizeTerminal(sessionId, rows, cols)
    )
  );
});
```

## Authentication Methods

### Service Principal Authentication

```javascript
const servicePrincipalAuth = {
  tenantId: 'your-tenant-id',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  subscriptionId: 'your-subscription-id'
};
```

### Managed Identity Authentication

```javascript
const managedIdentityAuth = {
  managedIdentity: true,
  clientId: 'optional-user-assigned-identity-client-id',
  subscriptionId: 'your-subscription-id'
};
```

### Certificate-Based Authentication

```javascript
const certificateAuth = {
  tenantId: 'your-tenant-id',
  clientId: 'your-client-id',
  clientCertificatePath: '/path/to/certificate.pem',
  subscriptionId: 'your-subscription-id'
};
```

### Azure CLI Authentication

```javascript
// Uses Azure CLI authentication automatically if no other method specified
const cliAuth = {
  subscriptionId: 'your-subscription-id'
  // AzureCliCredential will be used in the credential chain
};
```

## Error Handling

### Common Error Scenarios

```javascript
azure.on('error', (sessionId, error) => {
  switch (error.message) {
    case 'Token expired':
      console.log('Token expired, refreshing...');
      // Automatic refresh is handled, but you can add custom logic
      break;
      
    case 'Subscription not found':
      console.error('Invalid subscription ID provided');
      break;
      
    case 'Bastion resource not found':
      console.error('Check Bastion resource ID and permissions');
      break;
      
    case 'Arc resource not connected':
      console.error('Arc server is offline or not properly configured');
      break;
      
    default:
      console.error(`Unexpected error: ${error.message}`);
  }
});
```

### Connection Recovery

```javascript
// Implement custom recovery logic
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

azure.on('disconnected', async (sessionId) => {
  console.log(`Session disconnected: ${sessionId}`);
  
  if (reconnectAttempts < maxReconnectAttempts) {
    reconnectAttempts++;
    console.log(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`);
    
    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, 2000 * reconnectAttempts));
    
    try {
      const session = azure.getSession(sessionId);
      if (session) {
        // Recreate session based on type
        if ('webSocketUrl' in session) {
          await azure.createCloudShellSession(sessionId, session);
        }
      }
      reconnectAttempts = 0; // Reset on successful reconnection
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  } else {
    console.error('Max reconnection attempts reached');
  }
});
```

## Performance Optimization

### Connection Pooling

```javascript
class AzureSessionManager {
  constructor() {
    this.azure = new AzureProtocol();
    this.sessionPool = new Map();
    this.maxPoolSize = 10;
  }
  
  async getSession(type, config) {
    const poolKey = this.getPoolKey(type, config);
    
    if (this.sessionPool.has(poolKey)) {
      const sessions = this.sessionPool.get(poolKey);
      const availableSession = sessions.find(s => !s.inUse);
      
      if (availableSession) {
        availableSession.inUse = true;
        return availableSession;
      }
    }
    
    // Create new session if pool is not full
    if (!this.sessionPool.has(poolKey)) {
      this.sessionPool.set(poolKey, []);
    }
    
    const sessions = this.sessionPool.get(poolKey);
    if (sessions.length < this.maxPoolSize) {
      const newSession = await this.createPooledSession(type, config);
      sessions.push(newSession);
      return newSession;
    }
    
    throw new Error('Session pool exhausted');
  }
  
  releaseSession(session) {
    session.inUse = false;
  }
}
```

### Batch Operations

```javascript
// Execute commands on multiple sessions in parallel
async function executeBatchCommands(sessionIds, commands) {
  const operations = sessionIds.flatMap(sessionId =>
    commands.map(command => ({
      sessionId,
      command,
      execute: () => azure.sendInput(sessionId, command + '\n')
    }))
  );
  
  // Execute in batches to avoid overwhelming the system
  const batchSize = 5;
  for (let i = 0; i < operations.length; i += batchSize) {
    const batch = operations.slice(i, i + batchSize);
    await Promise.all(batch.map(op => op.execute()));
    
    // Brief pause between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

## Security Best Practices

### Credential Management

```javascript
// Use Azure Key Vault for sensitive data
const secureConfig = {
  // Never hardcode credentials
  tenantId: process.env.AZURE_TENANT_ID,
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
  
  // Use managed identity when possible
  managedIdentity: true,
  
  // Store certificates securely
  keyVaultUrl: 'https://myvault.vault.azure.net/',
  
  // Enable audit logging
  auditLogging: true
};
```

### Network Security

```javascript
// Use private endpoints and secure communication
const secureNetworkConfig = {
  // Restrict to specific virtual networks
  allowedVirtualNetworks: [
    '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet'
  ],
  
  // Use private endpoints for Key Vault
  usePrivateEndpoints: true,
  
  // Enable firewall rules
  firewallRules: [
    {
      name: 'AllowOfficeNetwork',
      startIpAddress: '203.0.113.0',
      endIpAddress: '203.0.113.255'
    }
  ]
};
```

### Session Security

```javascript
// Implement session timeout and cleanup
const secureSessionConfig = {
  sessionTimeout: 1800000, // 30 minutes
  idleTimeout: 300000,     // 5 minutes
  maxConcurrentSessions: 10,
  requireMFA: true
};

// Auto-cleanup idle sessions
setInterval(async () => {
  const sessions = azure.listSessions();
  
  for (const sessionId of sessions) {
    const metrics = azure.getSessionMetrics(sessionId);
    const idleTime = Date.now() - metrics.lastActivity;
    
    if (idleTime > secureSessionConfig.idleTimeout) {
      console.log(`Closing idle session: ${sessionId}`);
      await azure.closeSession(sessionId);
    }
  }
}, 60000); // Check every minute
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   ```bash
   # Verify Azure CLI authentication
   az account show
   
   # Check managed identity
   curl -H "Metadata:true" "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/"
   ```

2. **Cloud Shell Creation Fails**
   - Verify subscription has Cloud Shell enabled
   - Check storage account permissions
   - Ensure adequate quota in selected region

3. **Bastion Connection Issues**
   - Verify Bastion host is deployed and running
   - Check NSG rules allow Bastion traffic
   - Ensure VM is in same virtual network as Bastion

4. **Arc Server Connectivity**
   - Verify Arc agent is installed and connected
   - Check Azure Arc service status
   - Ensure proper firewall rules for Arc communication

### Debug Mode

```javascript
// Enable detailed logging
const azure = new AzureProtocol(console);

// Monitor all events
azure.on('*', (eventName, ...args) => {
  console.log(`Azure Event: ${eventName}`, args);
});

// Get detailed session metrics
const sessionMetrics = azure.getSessionMetrics('session-1');
console.log('Session Metrics:', sessionMetrics);

// Perform health checks
const isHealthy = await azure.healthCheck('session-1');
console.log('Session Health:', isHealthy);
```

## Integration Examples

### CI/CD Pipeline Integration

```javascript
// Azure DevOps pipeline integration
class AzureDevOpsPipeline {
  constructor() {
    this.azure = new AzureProtocol();
  }
  
  async deployToAzure(environment) {
    const session = await this.azure.createCloudShellSession(`deploy-${environment}`, {
      subscriptionId: process.env[`AZURE_SUBSCRIPTION_${environment.toUpperCase()}`],
      cloudShellType: 'bash'
    });
    
    try {
      // Deploy infrastructure
      await this.azure.sendInput(session.sessionId, 'az deployment group create --resource-group myRG --template-file infrastructure.json\n');
      
      // Deploy application
      await this.azure.sendInput(session.sessionId, 'az webapp deployment source config --name myApp --resource-group myRG --repo-url https://github.com/myrepo\n');
      
      // Run post-deployment tests
      await this.azure.sendInput(session.sessionId, 'az webapp log tail --name myApp --resource-group myRG\n');
      
    } finally {
      await this.azure.closeSession(session.sessionId);
    }
  }
}
```

### Infrastructure as Code

```javascript
// Terraform deployment via Azure Cloud Shell
async function deployTerraform(workspaceName) {
  const session = await azure.createCloudShellSession(`terraform-${workspaceName}`, {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    cloudShellType: 'bash'
  });
  
  const commands = [
    `cd /home/user/terraform/${workspaceName}`,
    'terraform init',
    'terraform plan -out=tfplan',
    'terraform apply tfplan',
    'terraform output -json > outputs.json'
  ];
  
  for (const command of commands) {
    await azure.sendInput(session.sessionId, command + '\n');
    
    // Wait for command completion (implement your own logic)
    await waitForCommandCompletion(session.sessionId);
  }
  
  return session.sessionId;
}
```

## API Reference

### Class: AzureProtocol

#### Methods

- `createCloudShellSession(sessionId, options)` - Create Cloud Shell session
- `createBastionSession(sessionId, options)` - Create Bastion session
- `createArcSession(sessionId, options)` - Create Arc session
- `sendInput(sessionId, input)` - Send input to session
- `resizeTerminal(sessionId, rows, cols)` - Resize terminal
- `closeSession(sessionId)` - Close session
- `getSession(sessionId)` - Get session information
- `listSessions()` - List all active sessions
- `isConnected(sessionId)` - Check connection status
- `healthCheck(sessionId)` - Perform health check
- `getSessionMetrics(sessionId)` - Get session metrics
- `cleanup()` - Cleanup all sessions

#### Events

- `connected` - Session connected
- `disconnected` - Session disconnected
- `error` - Error occurred
- `output` - Output received
- `token-refreshed` - Access token refreshed
- `session-ready` - Session ready for input
- `reconnecting` - Attempting reconnection

This documentation provides comprehensive coverage of the Azure Protocol's capabilities, from basic usage to advanced enterprise scenarios, ensuring production-ready implementation for Azure cloud automation.