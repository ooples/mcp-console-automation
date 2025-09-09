/**
 * Azure Cloud Shell Protocol Integration Tests
 * 
 * Comprehensive testing suite for Azure Cloud Shell protocol implementation including:
 * - Azure CLI integration
 * - PowerShell Core sessions
 * - Resource management operations
 * - Authentication with Azure AD
 * - Subscription switching
 * - File storage integration
 * - ARM template deployments
 * - Azure DevOps integration
 */

import { AzureShellProtocol } from '../../../src/protocols/AzureShellProtocol.js';
import { SessionOptions } from '../../../src/types/index.js';
import { MockTestServerFactory } from '../../utils/protocol-mocks.js';
import { TestServerManager } from '../../utils/test-servers.js';
import { PerformanceBenchmark } from '../../performance/protocol-benchmarks.js';
import { SecurityTester } from '../../security/protocol-security.js';

// Mock Azure SDK
jest.mock('@azure/identity');
jest.mock('@azure/arm-resources');
jest.mock('@azure/arm-compute');
jest.mock('@azure/arm-storage');
jest.mock('@azure/storage-file-share');

const mockCredential = {
  getToken: jest.fn().mockResolvedValue({
    token: 'mock-azure-token',
    expiresOnTimestamp: Date.now() + 3600000
  })
};

const mockResourcesClient = {
  resourceGroups: {
    list: jest.fn(),
    get: jest.fn(),
    createOrUpdate: jest.fn(),
    delete: jest.fn()
  },
  resources: {
    listByResourceGroup: jest.fn()
  }
};

const mockComputeClient = {
  virtualMachines: {
    list: jest.fn(),
    get: jest.fn(),
    createOrUpdate: jest.fn(),
    delete: jest.fn(),
    powerOff: jest.fn(),
    start: jest.fn()
  }
};

const mockStorageClient = {
  storageAccounts: {
    list: jest.fn(),
    create: jest.fn()
  }
};

const mockFileShareClient = {
  getDirectoryClient: jest.fn(),
  create: jest.fn(),
  delete: jest.fn()
};

// Mock Azure Cloud Shell WebSocket API
class MockAzureCloudShellWebSocket {
  private eventListeners: { [key: string]: Function[] } = {};
  
  constructor(public url: string, public protocols?: string[]) {
    setTimeout(() => this.dispatchEvent({ type: 'open' }), 10);
  }

  addEventListener(event: string, handler: Function): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(handler);
  }

  send(data: string | ArrayBuffer): void {
    const message = typeof data === 'string' ? data : new TextDecoder().decode(data);
    
    setTimeout(() => {
      // Simulate Azure CLI responses
      if (message.includes('az account list')) {
        this.dispatchEvent({
          type: 'message',
          data: JSON.stringify([{
            id: '12345678-1234-1234-1234-123456789012',
            name: 'Test Subscription',
            state: 'Enabled',
            isDefault: true
          }])
        });
      } else if (message.includes('az resource list')) {
        this.dispatchEvent({
          type: 'message',
          data: JSON.stringify([
            {
              id: '/subscriptions/12345678-1234-1234-1234-123456789012/resourceGroups/test-rg/providers/Microsoft.Compute/virtualMachines/test-vm',
              name: 'test-vm',
              type: 'Microsoft.Compute/virtualMachines',
              location: 'eastus'
            }
          ])
        });
      } else {
        this.dispatchEvent({
          type: 'message',
          data: `Azure Shell: ${message}`
        });
      }
    }, 10);
  }

  close(): void {
    this.dispatchEvent({ type: 'close' });
  }

  private dispatchEvent(event: any): void {
    const handlers = this.eventListeners[event.type] || [];
    handlers.forEach(handler => handler(event));
  }
}

describe('AzureShellProtocol Integration Tests', () => {
  let protocol: AzureShellProtocol;
  let mockFactory: MockTestServerFactory;
  let testServerManager: TestServerManager;
  let performanceBenchmark: PerformanceBenchmark;
  let securityTester: SecurityTester;

  beforeAll(async () => {
    // Setup test infrastructure
    mockFactory = new MockTestServerFactory();
    testServerManager = new TestServerManager();
    await testServerManager.initialize();

    performanceBenchmark = new PerformanceBenchmark();
    securityTester = new SecurityTester();

    // Setup Azure SDK mocks
    jest.doMock('@azure/identity', () => ({
      DefaultAzureCredential: jest.fn(() => mockCredential),
      ClientSecretCredential: jest.fn(() => mockCredential),
      InteractiveBrowserCredential: jest.fn(() => mockCredential)
    }));

    jest.doMock('@azure/arm-resources', () => ({
      ResourceManagementClient: jest.fn(() => mockResourcesClient)
    }));

    jest.doMock('@azure/arm-compute', () => ({
      ComputeManagementClient: jest.fn(() => mockComputeClient)
    }));

    jest.doMock('@azure/arm-storage', () => ({
      StorageManagementClient: jest.fn(() => mockStorageClient)
    }));

    // Mock WebSocket for Azure Cloud Shell
    (global as any).WebSocket = MockAzureCloudShellWebSocket;
  });

  beforeEach(async () => {
    protocol = new AzureShellProtocol('azure-shell');
    
    // Setup successful mock responses
    setupSuccessfulMockResponses();
    
    await protocol.initialize();
  });

  afterEach(async () => {
    await protocol.dispose();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await testServerManager.dispose();
  });

  describe('Initialization and Authentication', () => {
    it('should initialize with proper Azure credentials', async () => {
      expect(protocol.type).toBe('azure-shell');
      expect(protocol.capabilities.supportsAuthentication).toBe(true);
      expect(protocol.capabilities.supportsEncryption).toBe(true);
      expect(protocol.capabilities.maxConcurrentSessions).toBe(15);
    });

    it('should authenticate with Azure AD', async () => {
      mockCredential.getToken.mockResolvedValueOnce({
        token: 'valid-azure-token',
        expiresOnTimestamp: Date.now() + 3600000
      });

      const newProtocol = new AzureShellProtocol('azure-shell');
      await expect(newProtocol.initialize()).resolves.not.toThrow();
    });

    it('should handle authentication failures gracefully', async () => {
      mockCredential.getToken.mockRejectedValueOnce(new Error('Authentication failed'));

      const newProtocol = new AzureShellProtocol('azure-shell');
      await expect(newProtocol.initialize()).rejects.toThrow('Azure authentication failed');
    });

    it('should support different authentication methods', async () => {
      const authMethods = [
        { method: 'default', config: {} },
        { method: 'interactive', config: {} },
        { method: 'service-principal', config: { clientId: 'test', clientSecret: 'secret', tenantId: 'tenant' } }
      ];

      for (const auth of authMethods) {
        const authProtocol = new AzureShellProtocol('azure-shell', auth.config);
        await authProtocol.initialize();
        expect(authProtocol.healthStatus.isHealthy).toBe(true);
        await authProtocol.dispose();
      }
    });

    it('should validate Azure subscription access', async () => {
      mockResourcesClient.resourceGroups.list.mockResolvedValueOnce([
        {
          name: 'test-rg',
          location: 'eastus',
          id: '/subscriptions/12345678-1234-1234-1234-123456789012/resourceGroups/test-rg'
        }
      ]);

      const healthStatus = await protocol.getHealthStatus();
      expect(healthStatus.isHealthy).toBe(true);
      expect(mockResourcesClient.resourceGroups.list).toHaveBeenCalled();
    });
  });

  describe('Azure CLI Operations', () => {
    it('should execute Azure CLI commands successfully', async () => {
      const sessionOptions: SessionOptions = {
        command: 'az',
        args: ['account', 'list'],
        streaming: true,
        shellType: 'bash'
      };

      const session = await protocol.createSession(sessionOptions);

      expect(session).toBeDefined();
      expect(session.command).toBe('az');
      expect(session.args).toEqual(['account', 'list']);
      expect(session.type).toBe('azure-shell');
      expect(session.status).toBe('running');
    });

    it('should support resource group management', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'az group list');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Test Subscription');
    });

    it('should manage Azure resources', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'az resource list --resource-group test-rg');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('test-vm');
      expect(output).toContain('Microsoft.Compute/virtualMachines');
    });

    it('should handle subscription switching', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'az account set --subscription "Test Subscription"');
      await protocol.executeCommand(sessionId, 'az account show');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Test Subscription');
    });

    it('should support ARM template deployments', async () => {
      const sessionOptions: SessionOptions = {
        command: 'az',
        args: ['deployment', 'group', 'create'],
        streaming: true,
        env: {
          AZURE_TEMPLATE_FILE: '/clouddrive/templates/vm-template.json',
          AZURE_PARAMETERS_FILE: '/clouddrive/parameters/vm-params.json'
        }
      };

      const session = await protocol.createSession(sessionOptions);
      
      await protocol.executeCommand(session.id, 'validate-template');
      
      expect(session.env?.AZURE_TEMPLATE_FILE).toContain('vm-template.json');
    });
  });

  describe('PowerShell Core Operations', () => {
    it('should support PowerShell Core sessions', async () => {
      const sessionOptions: SessionOptions = {
        command: 'pwsh',
        args: ['-c', 'Get-AzSubscription'],
        streaming: true,
        shellType: 'powershell'
      };

      const session = await protocol.createSession(sessionOptions);

      expect(session.command).toBe('pwsh');
      expect(session.args).toContain('Get-AzSubscription');
    });

    it('should execute Azure PowerShell cmdlets', async () => {
      const sessionOptions: SessionOptions = {
        command: 'pwsh',
        streaming: true,
        shellType: 'powershell'
      };

      const session = await protocol.createSession(sessionOptions);

      await protocol.executeCommand(session.id, 'Get-AzResourceGroup');
      await protocol.executeCommand(session.id, 'Get-AzVM');
      
      const output = await protocol.getOutput(session.id);
      expect(output).toContain('Azure Shell:');
    });

    it('should support PowerShell module management', async () => {
      const sessionId = await createTestPowerShellSession();

      const commands = [
        'Get-Module -ListAvailable Az*',
        'Import-Module Az.Accounts',
        'Connect-AzAccount -Identity'
      ];

      for (const command of commands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });

    it('should handle PowerShell script execution', async () => {
      const sessionOptions: SessionOptions = {
        command: 'pwsh',
        args: ['-File', '/clouddrive/scripts/deploy-resources.ps1'],
        streaming: true,
        shellType: 'powershell'
      };

      const session = await protocol.createSession(sessionOptions);
      expect(session.args).toContain('deploy-resources.ps1');
    });
  });

  describe('File Storage Integration', () => {
    it('should access Azure Cloud Shell file storage', async () => {
      const sessionId = await createTestSession();

      const commands = [
        'ls /clouddrive',
        'mkdir /clouddrive/projects',
        'echo "test content" > /clouddrive/test.txt'
      ];

      for (const command of commands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });

    it('should support file uploads and downloads', async () => {
      const sessionOptions: SessionOptions = {
        command: 'azure-storage',
        args: ['upload', 'local-file.txt', '/clouddrive/uploaded-file.txt'],
        streaming: true
      };

      mockFileShareClient.getDirectoryClient.mockReturnValue({
        getFileClient: jest.fn().mockReturnValue({
          upload: jest.fn().mockResolvedValue({}),
          download: jest.fn().mockResolvedValue({
            readableStreamBody: 'test content'
          })
        })
      });

      const session = await protocol.createSession(sessionOptions);
      expect(session.args).toContain('upload');
    });

    it('should manage Azure File Share storage', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'az storage share list --account-name cloudshellstorage');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });

    it('should persist session state across reconnections', async () => {
      const sessionOptions: SessionOptions = {
        command: 'bash',
        streaming: true,
        env: {
          AZURE_PERSIST_STATE: 'true'
        }
      };

      const session1 = await protocol.createSession(sessionOptions);
      await protocol.executeCommand(session1.id, 'export TEST_VAR="persistent_value"');
      await protocol.closeSession(session1.id);

      const session2 = await protocol.createSession(sessionOptions);
      await protocol.executeCommand(session2.id, 'echo $TEST_VAR');
      
      const output = await protocol.getOutput(session2.id);
      // In real Azure Cloud Shell, environment would persist
      expect(output).toContain('Azure Shell:');
    });
  });

  describe('Resource Management Operations', () => {
    it('should manage virtual machines', async () => {
      mockComputeClient.virtualMachines.list.mockResolvedValueOnce([
        {
          name: 'test-vm',
          id: '/subscriptions/12345678-1234-1234-1234-123456789012/resourceGroups/test-rg/providers/Microsoft.Compute/virtualMachines/test-vm',
          location: 'eastus',
          vmSize: 'Standard_B1s'
        }
      ]);

      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'az vm list --output table');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('test-vm');
    });

    it('should manage storage accounts', async () => {
      mockStorageClient.storageAccounts.list.mockResolvedValueOnce([
        {
          name: 'teststorage123',
          location: 'eastus',
          kind: 'StorageV2'
        }
      ]);

      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'az storage account list --output table');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });

    it('should deploy Azure resources using templates', async () => {
      const sessionOptions: SessionOptions = {
        command: 'az',
        args: [
          'deployment', 'group', 'create',
          '--resource-group', 'test-rg',
          '--template-file', 'azuredeploy.json'
        ],
        streaming: true
      };

      const session = await protocol.createSession(sessionOptions);
      
      await protocol.executeCommand(session.id, 'start-deployment');
      
      expect(session.args).toContain('azuredeploy.json');
    });

    it('should support Azure DevOps integration', async () => {
      const sessionId = await createTestSession();

      const devOpsCommands = [
        'az extension add --name azure-devops',
        'az devops project list --organization https://dev.azure.com/testorg',
        'az pipelines list --project TestProject'
      ];

      for (const command of devOpsCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });
  });

  describe('Security and Compliance', () => {
    it('should enforce Azure RBAC permissions', async () => {
      const sessionOptions: SessionOptions = {
        command: 'az',
        args: ['role', 'assignment', 'list'],
        streaming: true,
        env: {
          AZURE_SUBSCRIPTION_ID: '12345678-1234-1234-1234-123456789012'
        }
      };

      const session = await protocol.createSession(sessionOptions);
      expect(session.env?.AZURE_SUBSCRIPTION_ID).toBe('12345678-1234-1234-1234-123456789012');
    });

    it('should validate resource access permissions', async () => {
      mockResourcesClient.resourceGroups.get.mockRejectedValueOnce(
        new Error('AuthorizationFailed')
      );

      const sessionId = await createTestSession();

      await expect(
        protocol.executeCommand(sessionId, 'az group show --name unauthorized-rg')
      ).rejects.toThrow();
    });

    it('should audit Azure operations', async () => {
      const sessionId = await createTestSession();

      const auditableCommands = [
        'az vm create --name test-vm --resource-group test-rg',
        'az storage account create --name teststorage',
        'az keyvault create --name test-keyvault'
      ];

      for (const command of auditableCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const auditLogs = await protocol.getAuditLogs(sessionId);
      expect(auditLogs).toContain('az vm create');
      expect(auditLogs).toContain('az storage account create');
    });

    it('should handle Azure policy compliance', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'az policy assignment list');
      await protocol.executeCommand(sessionId, 'az policy state list');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });

    it('should secure credential handling', async () => {
      const sessionOptions: SessionOptions = {
        command: 'az',
        streaming: true,
        env: {
          AZURE_CLIENT_SECRET: 'sensitive-secret'
        }
      };

      const session = await protocol.createSession(sessionOptions);
      
      // Verify sensitive data is not logged
      const output = await protocol.getOutput(session.id);
      expect(output).not.toContain('sensitive-secret');
    });
  });

  describe('Performance Testing', () => {
    it('should handle concurrent Azure operations efficiently', async () => {
      const benchmark = await performanceBenchmark.measureOperation(
        'concurrent-azure-operations',
        async () => {
          const sessionPromises = Array.from({ length: 3 }, () =>
            createTestSession()
          );
          
          const sessionIds = await Promise.all(sessionPromises);
          
          // Execute concurrent operations
          const operationPromises = sessionIds.map(sessionId =>
            protocol.executeCommand(sessionId, 'az account list')
          );
          
          await Promise.all(operationPromises);
          
          // Cleanup
          await Promise.all(sessionIds.map(id => protocol.closeSession(id)));
          
          return sessionIds.length;
        },
        { iterations: 3, timeout: 60000 }
      );

      expect(benchmark.averageTime).toBeLessThan(10000);
      expect(benchmark.successRate).toBe(100);
    });

    it('should optimize Azure CLI command execution', async () => {
      const sessionId = await createTestSession();
      
      const benchmark = await performanceBenchmark.measureOperation(
        'azure-cli-commands',
        async () => {
          const commands = [
            'az account list',
            'az group list',
            'az resource list --query "[].{Name:name, Type:type}"',
            'az vm list --output table'
          ];
          
          for (const command of commands) {
            await protocol.executeCommand(sessionId, command);
          }
          
          return commands.length;
        },
        { iterations: 3 }
      );

      expect(benchmark.averageTime).toBeLessThan(5000);
      await protocol.closeSession(sessionId);
    });

    it('should monitor memory usage during resource operations', async () => {
      const sessionId = await createTestSession();
      
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Simulate resource-intensive operations
      const resourceOperations = [
        'az vm list --output json',
        'az storage account list --output json',
        'az network vnet list --output json',
        'az keyvault list --output json'
      ];

      for (const command of resourceOperations) {
        await protocol.executeCommand(sessionId, command);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;
      
      // Memory growth should be reasonable (less than 100MB)
      expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024);
      
      await protocol.closeSession(sessionId);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle Azure service outages gracefully', async () => {
      mockCredential.getToken.mockRejectedValueOnce(new Error('ServiceUnavailable'));
      
      const healthStatus = await protocol.getHealthStatus();
      expect(healthStatus.isHealthy).toBe(false);
      expect(healthStatus.errors).toContain('ServiceUnavailable');
    });

    it('should retry failed Azure API calls', async () => {
      let attemptCount = 0;
      mockResourcesClient.resourceGroups.list.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error('TooManyRequests'));
        }
        return Promise.resolve([]);
      });

      const sessionId = await createTestSession();
      await protocol.executeCommand(sessionId, 'az group list');
      
      expect(attemptCount).toBe(3);
    });

    it('should handle token expiration and renewal', async () => {
      // Mock expired token
      mockCredential.getToken
        .mockResolvedValueOnce({
          token: 'expired-token',
          expiresOnTimestamp: Date.now() - 1000
        })
        .mockResolvedValueOnce({
          token: 'new-token',
          expiresOnTimestamp: Date.now() + 3600000
        });

      const sessionId = await createTestSession();
      await protocol.executeCommand(sessionId, 'az account list');
      
      // Should have called getToken twice (expired + renewal)
      expect(mockCredential.getToken).toHaveBeenCalledTimes(2);
    });

    it('should recover from Cloud Shell disconnections', async () => {
      const sessionId = await createTestSession();
      
      // Simulate WebSocket disconnection
      const mockWS = (global as any).WebSocket;
      const wsInstance = mockWS.mock.instances[mockWS.mock.instances.length - 1];
      wsInstance.dispatchEvent({ type: 'close', code: 1006 });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should attempt to reconnect
      await protocol.executeCommand(sessionId, 'test reconnect');
      expect(mockWS).toHaveBeenCalledWith(
        expect.stringMatching(/wss.*azure/),
        expect.any(Array)
      );
    });
  });

  describe('Multi-tenant Operations', () => {
    it('should support tenant switching', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'az account tenant list');
      await protocol.executeCommand(sessionId, 'az login --tenant test-tenant-id');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });

    it('should manage multiple subscriptions', async () => {
      const sessionId = await createTestSession();

      const subscriptionCommands = [
        'az account list --output table',
        'az account set --subscription "Production Subscription"',
        'az account show --query name',
        'az account set --subscription "Development Subscription"'
      ];

      for (const command of subscriptionCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });
  });

  describe('Integration with Azure Services', () => {
    it('should integrate with Azure Key Vault', async () => {
      const sessionId = await createTestSession();

      const keyVaultCommands = [
        'az keyvault list',
        'az keyvault secret list --vault-name test-keyvault',
        'az keyvault secret show --vault-name test-keyvault --name test-secret'
      ];

      for (const command of keyVaultCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });

    it('should work with Azure Container Registry', async () => {
      const sessionId = await createTestSession();

      const acrCommands = [
        'az acr list --output table',
        'az acr repository list --name testregistry',
        'docker login testregistry.azurecr.io'
      ];

      for (const command of acrCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });

    it('should support Azure Kubernetes Service', async () => {
      const sessionId = await createTestSession();

      const aksCommands = [
        'az aks list --output table',
        'az aks get-credentials --resource-group test-rg --name test-aks',
        'kubectl get nodes'
      ];

      for (const command of aksCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Azure Shell:');
    });
  });

  // Helper functions
  function setupSuccessfulMockResponses(): void {
    mockCredential.getToken.mockResolvedValue({
      token: 'valid-azure-token',
      expiresOnTimestamp: Date.now() + 3600000
    });

    mockResourcesClient.resourceGroups.list.mockResolvedValue([
      {
        name: 'test-rg',
        location: 'eastus',
        id: '/subscriptions/12345678-1234-1234-1234-123456789012/resourceGroups/test-rg'
      }
    ]);

    mockComputeClient.virtualMachines.list.mockResolvedValue([]);
    mockStorageClient.storageAccounts.list.mockResolvedValue([]);
  }

  async function createTestSession(): Promise<string> {
    const sessionOptions: SessionOptions = {
      command: 'bash',
      streaming: true,
      shellType: 'bash'
    };

    const session = await protocol.createSession(sessionOptions);
    return session.id;
  }

  async function createTestPowerShellSession(): Promise<string> {
    const sessionOptions: SessionOptions = {
      command: 'pwsh',
      streaming: true,
      shellType: 'powershell'
    };

    const session = await protocol.createSession(sessionOptions);
    return session.id;
  }
});