import { SessionOptions, AzureConnectionOptions } from '../src/types/index.js';

/**
 * Example Azure Cloud Shell configuration
 */
export const azureCloudShellConfig: SessionOptions = {
  command: 'bash', // or 'powershell'
  consoleType: 'azure-shell',
  azureOptions: {
    // Authentication options (choose one method)
    
    // Method 1: Service Principal with Secret
    tenantId: 'your-tenant-id',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    subscriptionId: 'your-subscription-id',
    
    // Method 2: Managed Identity (for Azure VMs/Services)
    // managedIdentity: true,
    // clientId: 'your-managed-identity-client-id', // optional
    
    // Method 3: Certificate-based authentication
    // tenantId: 'your-tenant-id',
    // clientId: 'your-client-id',
    // clientCertificatePath: '/path/to/certificate.pem',
    // clientCertificateThumbprint: 'cert-thumbprint',
    
    // Cloud Shell specific options
    cloudShellType: 'bash', // 'bash' or 'powershell'
    region: 'eastus',
    resourceGroupName: 'cloud-shell-storage-eastus',
    storageAccountName: 'your-storage-account',
    fileShareName: 'cloudshell-files',
    
    // Connection settings
    timeout: 60000,
    keepAliveInterval: 30000,
    retryAttempts: 3,
    enableAutoReconnect: true
  },
  streaming: true,
  timeout: 120000,
  monitoring: {
    enableMetrics: true,
    enableTracing: true,
    enableAuditing: true
  }
};

/**
 * Example Azure Bastion configuration
 */
export const azureBastionConfig: SessionOptions = {
  command: 'ssh',
  consoleType: 'azure-bastion',
  azureOptions: {
    // Authentication
    tenantId: 'your-tenant-id',
    subscriptionId: 'your-subscription-id',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    
    // Bastion specific options
    bastionResourceId: '/subscriptions/sub-id/resourceGroups/rg-name/providers/Microsoft.Network/bastionHosts/bastion-name',
    bastionName: 'your-bastion-host',
    targetVmResourceId: '/subscriptions/sub-id/resourceGroups/rg-name/providers/Microsoft.Compute/virtualMachines/vm-name',
    targetVmName: 'your-target-vm',
    targetVmUser: 'azureuser',
    protocol: 'ssh', // 'ssh' or 'rdp'
    
    // Optional: Use SSH key instead of password
    targetVmPrivateKey: `-----BEGIN OPENSSH PRIVATE KEY-----
...your private key here...
-----END OPENSSH PRIVATE KEY-----`,
    
    // Connection settings
    timeout: 60000,
    keepAliveInterval: 30000
  },
  streaming: true
};

/**
 * Example Azure Arc-enabled server configuration
 */
export const azureArcConfig: SessionOptions = {
  command: 'bash',
  consoleType: 'azure-ssh',
  azureOptions: {
    // Authentication
    tenantId: 'your-tenant-id',
    subscriptionId: 'your-subscription-id',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    
    // Arc specific options
    arcResourceId: '/subscriptions/sub-id/resourceGroups/rg-name/providers/Microsoft.HybridCompute/machines/machine-name',
    hybridConnectionEndpoint: 'https://management.azure.com',
    
    // Connection settings
    timeout: 60000,
    keepAliveInterval: 30000,
    retryAttempts: 3
  },
  streaming: true
};

/**
 * Example Azure Key Vault integration
 */
export const azureWithKeyVaultConfig: SessionOptions = {
  command: 'bash',
  consoleType: 'azure-shell',
  azureOptions: {
    // Use Key Vault for secrets
    tenantId: 'your-tenant-id',
    clientId: 'your-client-id',
    
    // Key Vault configuration
    keyVaultUrl: 'https://your-keyvault.vault.azure.net/',
    secretName: 'azure-client-secret', // Secret containing client secret
    
    subscriptionId: 'your-subscription-id',
    cloudShellType: 'bash',
    region: 'eastus'
  },
  streaming: true
};

/**
 * Example Private Link configuration for enhanced security
 */
export const azurePrivateLinkConfig: SessionOptions = {
  command: 'bash',
  consoleType: 'azure-shell',
  azureOptions: {
    // Authentication
    tenantId: 'your-tenant-id',
    subscriptionId: 'your-subscription-id',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    
    // Private Link configuration
    privateLinkServiceId: '/subscriptions/sub-id/resourceGroups/rg-name/providers/Microsoft.Network/privateLinkServices/pls-name',
    privateDnsZoneName: 'privatelink.management.azure.com',
    
    cloudShellType: 'bash',
    region: 'eastus'
  },
  streaming: true
};

/**
 * Example environment-based configuration
 */
export function getAzureConfigFromEnvironment(): SessionOptions {
  return {
    command: process.env.AZURE_SHELL_TYPE || 'bash',
    consoleType: 'azure-shell',
    azureOptions: {
      tenantId: process.env.AZURE_TENANT_ID,
      subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      
      cloudShellType: (process.env.AZURE_SHELL_TYPE as 'bash' | 'powershell') || 'bash',
      region: process.env.AZURE_REGION || 'eastus',
      
      // Optional configurations from environment
      resourceGroupName: process.env.AZURE_RESOURCE_GROUP,
      storageAccountName: process.env.AZURE_STORAGE_ACCOUNT,
      keyVaultUrl: process.env.AZURE_KEY_VAULT_URL,
      secretName: process.env.AZURE_SECRET_NAME,
      
      timeout: parseInt(process.env.AZURE_TIMEOUT || '60000'),
      keepAliveInterval: parseInt(process.env.AZURE_KEEPALIVE_INTERVAL || '30000'),
      retryAttempts: parseInt(process.env.AZURE_RETRY_ATTEMPTS || '3'),
      enableAutoReconnect: process.env.AZURE_AUTO_RECONNECT !== 'false'
    },
    streaming: true,
    monitoring: {
      enableMetrics: true,
      enableTracing: process.env.NODE_ENV !== 'production',
      enableAuditing: true
    }
  };
}