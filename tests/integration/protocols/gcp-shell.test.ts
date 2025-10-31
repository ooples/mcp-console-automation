/**
 * Google Cloud Platform (GCP) Shell Protocol Integration Tests
 * 
 * Comprehensive testing suite for GCP Cloud Shell protocol implementation including:
 * - gcloud CLI integration
 * - Cloud Shell environments
 * - IAM and service accounts
 * - Project and organization management
 * - Compute Engine operations
 * - Kubernetes Engine integration
 * - Cloud Storage operations
 * - Cloud Functions deployment
 */

import { GCPProtocol } from '../../../src/protocols/GCPProtocol.js';
import { SessionOptions } from '../../../src/types/index.js';
import { MockTestServerFactory } from '../../utils/protocol-mocks.js';
import { TestServerManager } from '../../utils/test-servers.js';
import { PerformanceBenchmark } from '../../performance/protocol-benchmarks.js';
import { SecurityTester } from '../../security/protocol-security.js';

// Mock Google Cloud SDK
jest.mock('@google-cloud/compute');
jest.mock('@google-cloud/storage');
jest.mock('@google-cloud/container');
jest.mock('@google-cloud/functions');
jest.mock('@google-cloud/iam');

const mockComputeClient = {
  getInstances: jest.fn<any>(),
  insert: jest.fn<any>(),
  delete: jest.fn<any>(),
  start: jest.fn<any>(),
  stop: jest.fn<any>(),
  getZones: jest.fn<any>()
};

const mockStorageClient = {
  getBuckets: jest.fn<any>(),
  createBucket: jest.fn<any>(),
  deleteBucket: jest.fn<any>(),
  bucket: jest.fn<any>().mockReturnThis(),
  file: jest.fn<any>().mockReturnThis(),
  upload: jest.fn<any>(),
  download: jest.fn<any>(),
  exists: jest.fn<any>()
};

const mockContainerClient = {
  getClusters: jest.fn<any>(),
  createCluster: jest.fn<any>(),
  deleteCluster: jest.fn<any>(),
  getNodePools: jest.fn<any>()
};

const mockFunctionsClient = {
  listFunctions: jest.fn<any>(),
  createFunction: jest.fn<any>(),
  deleteFunction: jest.fn<any>(),
  callFunction: jest.fn<any>()
};

const mockIAMClient = {
  getServiceAccounts: jest.fn<any>(),
  createServiceAccount: jest.fn<any>(),
  deleteServiceAccount: jest.fn<any>(),
  getPolicy: jest.fn<any>(),
  setPolicy: jest.fn<any>()
};

// Mock GCP Cloud Shell WebSocket API
class MockGCPCloudShellWebSocket {
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
      // Simulate gcloud CLI responses
      if (message.includes('gcloud projects list')) {
        this.dispatchEvent({
          type: 'message',
          data: `PROJECT_ID: test-project-123\nNAME: Test Project\nPROJECT_NUMBER: 123456789012`
        });
      } else if (message.includes('gcloud compute instances list')) {
        this.dispatchEvent({
          type: 'message',
          data: `NAME: test-instance\nZONE: us-central1-a\nMACHINE_TYPE: e2-micro\nSTATUS: RUNNING`
        });
      } else if (message.includes('gcloud container clusters list')) {
        this.dispatchEvent({
          type: 'message',
          data: `NAME: test-cluster\nLOCATION: us-central1\nMASTER_VERSION: 1.27.3-gke.100\nNODE_VERSION: 1.27.3-gke.100\nSTATUS: RUNNING`
        });
      } else {
        this.dispatchEvent({
          type: 'message',
          data: `GCP Shell: ${message}`
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

// Skip cloud protocol tests if SKIP_HARDWARE_TESTS is set (requires GCP infrastructure)
const describeIfCloud = process.env.SKIP_HARDWARE_TESTS ? describe.skip : describe;

describeIfCloud('GCPShellProtocol Integration Tests', () => {
  let protocol: GCPProtocol;
  let mockFactory: MockTestServerFactory;
  let testServerManager: TestServerManager;
  let performanceBenchmark: PerformanceBenchmark;
  let securityTester: SecurityTester;

  beforeAll(async () => {
    // Setup test infrastructure
    mockFactory = new MockTestServerFactory();
    testServerManager = new TestServerManager();

    performanceBenchmark = new PerformanceBenchmark();
    securityTester = new SecurityTester();

    // Setup Google Cloud SDK mocks
    jest.doMock('@google-cloud/compute', () => ({
      InstancesClient: jest.fn(() => mockComputeClient),
      ZonesClient: jest.fn(() => mockComputeClient)
    }));

    jest.doMock('@google-cloud/storage', () => ({
      Storage: jest.fn(() => mockStorageClient)
    }));

    jest.doMock('@google-cloud/container', () => ({
      ClusterManagerClient: jest.fn(() => mockContainerClient)
    }));

    jest.doMock('@google-cloud/functions', () => ({
      CloudFunctionsServiceClient: jest.fn(() => mockFunctionsClient)
    }));

    jest.doMock('@google-cloud/iam', () => ({
      IAMClient: jest.fn(() => mockIAMClient)
    }));

    // Mock WebSocket for GCP Cloud Shell
    (global as any).WebSocket = MockGCPCloudShellWebSocket;
  });

  beforeEach(async () => {
    protocol = new GCPProtocol('gcp-shell');
    
    // Setup successful mock responses
    setupSuccessfulMockResponses();
    
    await protocol.initialize();
  });

  afterEach(async () => {
    await protocol.dispose();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await testServerManager.stopAllServers();
  });

  describe('Initialization and Authentication', () => {
    it('should initialize with proper GCP credentials', async () => {
      expect(protocol.type).toBe('gcp-shell');
      expect(protocol.capabilities.supportsAuthentication).toBe(true);
      expect(protocol.capabilities.supportsEncryption).toBe(true);
      expect(protocol.capabilities.maxConcurrentSessions).toBe(100);
    });

    it('should authenticate with service account', async () => {
      const serviceAccountConfig = {
        keyFilename: '/path/to/service-account.json',
        projectId: 'test-project-123'
      };

      const newProtocol = new GCPShellProtocol('gcp-shell', serviceAccountConfig);
      await expect(newProtocol.initialize()).resolves.not.toThrow();
    });

    it('should handle authentication failures gracefully', async () => {
      mockComputeClient.getZones.mockRejectedValueOnce(new Error('Authentication failed'));

      const newProtocol = new GCPProtocol('gcp-shell');
      await expect(newProtocol.initialize()).rejects.toThrow('GCP authentication failed');
    });

    it('should support different authentication methods', async () => {
      const authMethods = [
        { method: 'default', config: {} },
        { method: 'service-account', config: { keyFilename: 'test-key.json' } },
        { method: 'user-credentials', config: { clientEmail: 'user@example.com' } }
      ];

      for (const auth of authMethods) {
        const authProtocol = new GCPProtocol('gcp-shell', auth.config);
        await authProtocol.initialize();
        expect(authProtocol.healthStatus.isHealthy).toBe(true);
        await authProtocol.dispose();
      }
    });

    it('should validate GCP project access', async () => {
      mockComputeClient.getZones.mockResolvedValueOnce([
        [
          {
            name: 'us-central1-a',
            description: 'us-central1-a',
            status: 'UP'
          }
        ]
      ]);

      const healthStatus = await protocol.getHealthStatus();
      expect(healthStatus.isHealthy).toBe(true);
      expect(mockComputeClient.getZones).toHaveBeenCalled();
    });
  });

  describe('gcloud CLI Operations', () => {
    it('should execute gcloud commands successfully', async () => {
      const sessionOptions: SessionOptions = {
        command: 'gcloud',
        args: ['projects', 'list'],
        streaming: true,
        shellType: 'bash'
      };

      const session = await protocol.createSession(sessionOptions);

      expect(session).toBeDefined();
      expect(session.command).toBe('gcloud');
      expect(session.args).toEqual(['projects', 'list']);
      expect(session.type).toBe('gcp-shell');
      expect(session.status).toBe('running');
    });

    it('should manage GCP projects', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'gcloud projects list');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('test-project-123');
      expect(output).toContain('Test Project');
    });

    it('should switch between projects', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'gcloud config set project test-project-123');
      await protocol.executeCommand(sessionId, 'gcloud config get-value project');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should manage compute instances', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'gcloud compute instances list');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('test-instance');
      expect(output).toContain('us-central1-a');
    });

    it('should support deployment manager operations', async () => {
      const sessionOptions: SessionOptions = {
        command: 'gcloud',
        args: ['deployment-manager', 'deployments', 'create', 'test-deployment'],
        streaming: true,
        env: {
          GCP_TEMPLATE_FILE: '/cloudshell/templates/vm-template.yaml',
          GCP_CONFIG_FILE: '/cloudshell/config/deployment-config.yaml'
        }
      };

      const session = await protocol.createSession(sessionOptions);
      
      expect(session.env?.GCP_TEMPLATE_FILE).toContain('vm-template.yaml');
      expect(session.args).toContain('test-deployment');
    });
  });

  describe('Compute Engine Operations', () => {
    it('should create and manage VM instances', async () => {
      mockComputeClient.insert.mockResolvedValueOnce([
        {
          name: 'operation-123',
          status: 'PENDING'
        }
      ]);

      const sessionOptions: SessionOptions = {
        command: 'gcloud',
        args: [
          'compute', 'instances', 'create', 'test-vm',
          '--zone=us-central1-a',
          '--machine-type=e2-micro'
        ],
        streaming: true
      };

      const session = await protocol.createSession(sessionOptions);
      
      await protocol.executeCommand(session.id, 'create-instance');
      
      expect(session.args).toContain('test-vm');
      expect(session.args).toContain('us-central1-a');
    });

    it('should manage instance groups', async () => {
      const sessionId = await createTestSession();

      const instanceGroupCommands = [
        'gcloud compute instance-groups managed list',
        'gcloud compute instance-groups managed create test-group --size=3',
        'gcloud compute instance-groups managed set-autoscaling test-group --max-num-replicas=10'
      ];

      for (const command of instanceGroupCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should handle load balancer configuration', async () => {
      const sessionId = await createTestSession();

      const lbCommands = [
        'gcloud compute url-maps create test-lb --default-service=test-backend',
        'gcloud compute target-http-proxies create test-proxy --url-map=test-lb',
        'gcloud compute forwarding-rules create test-rule --global --target-http-proxy=test-proxy --ports=80'
      ];

      for (const command of lbCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });
  });

  describe('Kubernetes Engine Operations', () => {
    it('should manage GKE clusters', async () => {
      mockContainerClient.createCluster.mockResolvedValueOnce([
        {
          name: 'operation-456',
          status: 'RUNNING'
        }
      ]);

      const sessionOptions: SessionOptions = {
        command: 'gcloud',
        args: [
          'container', 'clusters', 'create', 'test-cluster',
          '--zone=us-central1-a',
          '--num-nodes=3'
        ],
        streaming: true
      };

      const session = await protocol.createSession(sessionOptions);
      
      expect(session.args).toContain('test-cluster');
      expect(session.args).toContain('us-central1-a');
    });

    it('should get cluster credentials and use kubectl', async () => {
      const sessionId = await createTestSession();

      const k8sCommands = [
        'gcloud container clusters get-credentials test-cluster --zone=us-central1-a',
        'kubectl get nodes',
        'kubectl get pods --all-namespaces'
      ];

      for (const command of k8sCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should manage node pools', async () => {
      mockContainerClient.getNodePools.mockResolvedValueOnce([
        [
          {
            name: 'default-pool',
            status: 'RUNNING',
            initialNodeCount: 3
          }
        ]
      ]);

      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'gcloud container node-pools list --cluster=test-cluster');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should deploy applications to GKE', async () => {
      const sessionOptions: SessionOptions = {
        command: 'kubectl',
        args: ['apply', '-f', '/cloudshell/k8s/deployment.yaml'],
        streaming: true,
        env: {
          KUBECONFIG: '/cloudshell/.kube/config'
        }
      };

      const session = await protocol.createSession(sessionOptions);
      
      expect(session.command).toBe('kubectl');
      expect(session.args).toContain('deployment.yaml');
    });
  });

  describe('Cloud Storage Operations', () => {
    it('should manage Cloud Storage buckets', async () => {
      mockStorageClient.getBuckets.mockResolvedValueOnce([
        [
          {
            name: 'test-bucket-123',
            location: 'US',
            storageClass: 'STANDARD'
          }
        ]
      ]);

      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'gsutil ls');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should upload and download files', async () => {
      const sessionOptions: SessionOptions = {
        command: 'gsutil',
        args: ['cp', '/cloudshell/data/file.txt', 'gs://test-bucket/file.txt'],
        streaming: true
      };

      mockStorageClient.upload.mockResolvedValueOnce([
        { name: 'file.txt' }
      ]);

      const session = await protocol.createSession(sessionOptions);
      
      expect(session.command).toBe('gsutil');
      expect(session.args).toContain('gs://test-bucket/file.txt');
    });

    it('should manage bucket permissions', async () => {
      const sessionId = await createTestSession();

      const permissionCommands = [
        'gsutil iam get gs://test-bucket',
        'gsutil iam ch user:test@example.com:objectViewer gs://test-bucket',
        'gsutil acl get gs://test-bucket/file.txt'
      ];

      for (const command of permissionCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should sync directories with Cloud Storage', async () => {
      const sessionOptions: SessionOptions = {
        command: 'gsutil',
        args: ['-m', 'rsync', '-r', '/cloudshell/project', 'gs://test-bucket/backup'],
        streaming: true
      };

      const session = await protocol.createSession(sessionOptions);
      
      expect(session.args).toContain('rsync');
      expect(session.args).toContain('gs://test-bucket/backup');
    });
  });

  describe('Cloud Functions Operations', () => {
    it('should deploy Cloud Functions', async () => {
      mockFunctionsClient.createFunction.mockResolvedValueOnce([
        {
          name: 'projects/test-project/locations/us-central1/functions/test-function',
          status: 'ACTIVE'
        }
      ]);

      const sessionOptions: SessionOptions = {
        command: 'gcloud',
        args: [
          'functions', 'deploy', 'test-function',
          '--runtime=nodejs18',
          '--trigger=http',
          '--source=/cloudshell/functions'
        ],
        streaming: true
      };

      const session = await protocol.createSession(sessionOptions);
      
      expect(session.args).toContain('test-function');
      expect(session.args).toContain('nodejs18');
    });

    it('should manage function triggers', async () => {
      const sessionId = await createTestSession();

      const functionCommands = [
        'gcloud functions list',
        'gcloud functions logs read test-function',
        'gcloud functions call test-function --data=\'{"test": "data"}\''
      ];

      for (const command of functionCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should handle Cloud Run deployments', async () => {
      const sessionOptions: SessionOptions = {
        command: 'gcloud',
        args: [
          'run', 'deploy', 'test-service',
          '--image=gcr.io/test-project/app:latest',
          '--platform=managed',
          '--region=us-central1'
        ],
        streaming: true
      };

      const session = await protocol.createSession(sessionOptions);
      
      expect(session.args).toContain('test-service');
      expect(session.args).toContain('gcr.io/test-project/app:latest');
    });
  });

  describe('IAM and Security Operations', () => {
    it('should manage service accounts', async () => {
      mockIAMClient.getServiceAccounts.mockResolvedValueOnce([
        [
          {
            name: 'projects/test-project/serviceAccounts/test-sa@test-project.iam.gserviceaccount.com',
            email: 'test-sa@test-project.iam.gserviceaccount.com',
            displayName: 'Test Service Account'
          }
        ]
      ]);

      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'gcloud iam service-accounts list');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should manage IAM policies', async () => {
      const sessionId = await createTestSession();

      const iamCommands = [
        'gcloud projects get-iam-policy test-project',
        'gcloud projects add-iam-policy-binding test-project --member="user:test@example.com" --role="roles/viewer"',
        'gcloud iam roles list --filter="stage:GA"'
      ];

      for (const command of iamCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should create and manage API keys', async () => {
      const sessionId = await createTestSession();

      const apiKeyCommands = [
        'gcloud alpha services api-keys list',
        'gcloud alpha services api-keys create --display-name="Test API Key"',
        'gcloud alpha services api-keys update key-id --restrictions-file=restrictions.yaml'
      ];

      for (const command of apiKeyCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });
  });

  describe('Performance Testing', () => {
    it('should handle concurrent GCP operations efficiently', async () => {
      const benchmark = await performanceBenchmark.measureOperation(
        'concurrent-gcp-operations',
        async () => {
          const sessionPromises = Array.from({ length: 3 }, () =>
            createTestSession()
          );
          
          const sessionIds = await Promise.all(sessionPromises);
          
          // Execute concurrent operations
          const operationPromises = sessionIds.map(sessionId =>
            protocol.executeCommand(sessionId, 'gcloud projects list')
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

    it('should optimize gcloud command execution', async () => {
      const sessionId = await createTestSession();
      
      const benchmark = await performanceBenchmark.measureOperation(
        'gcloud-commands',
        async () => {
          const commands = [
            'gcloud projects list',
            'gcloud compute zones list',
            'gcloud container clusters list',
            'gcloud functions list'
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
        'gcloud compute instances list --format=json',
        'gcloud container clusters list --format=json',
        'gsutil ls -L gs://test-bucket/**',
        'gcloud functions list --format=json'
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
    it('should handle GCP service outages gracefully', async () => {
      mockComputeClient.getZones.mockRejectedValueOnce(new Error('ServiceUnavailable'));
      
      const healthStatus = await protocol.getHealthStatus();
      expect(healthStatus.isHealthy).toBe(false);
      expect(healthStatus.errors).toContain('ServiceUnavailable');
    });

    it('should retry failed GCP API calls', async () => {
      let attemptCount = 0;
      mockComputeClient.getInstances.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error('rateLimitExceeded'));
        }
        return Promise.resolve([[]]);
      });

      const sessionId = await createTestSession();
      await protocol.executeCommand(sessionId, 'gcloud compute instances list');
      
      expect(attemptCount).toBe(3);
    });

    it('should handle quota exceeded errors', async () => {
      mockComputeClient.insert.mockRejectedValueOnce(new Error('Quota \'CPUS\' exceeded'));

      const sessionId = await createTestSession();

      await expect(
        protocol.executeCommand(sessionId, 'gcloud compute instances create test-vm')
      ).rejects.toThrow('Quota');
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
        expect.stringMatching(/wss.*cloud\.google\.com/),
        expect.any(Array)
      );
    });
  });

  describe('Multi-project Operations', () => {
    it('should support project switching', async () => {
      const sessionId = await createTestSession();

      await protocol.executeCommand(sessionId, 'gcloud config set project test-project-456');
      await protocol.executeCommand(sessionId, 'gcloud config get-value project');
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should manage multiple billing accounts', async () => {
      const sessionId = await createTestSession();

      const billingCommands = [
        'gcloud beta billing accounts list',
        'gcloud beta billing projects link test-project --billing-account=012345-678901-234567',
        'gcloud beta billing projects describe test-project'
      ];

      for (const command of billingCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });
  });

  describe('DevOps and CI/CD Integration', () => {
    it('should integrate with Cloud Build', async () => {
      const sessionId = await createTestSession();

      const buildCommands = [
        'gcloud builds list',
        'gcloud builds submit --config=cloudbuild.yaml .',
        'gcloud builds triggers list'
      ];

      for (const command of buildCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should work with Container Registry', async () => {
      const sessionId = await createTestSession();

      const registryCommands = [
        'gcloud container images list',
        'docker tag app:latest gcr.io/test-project/app:v1.0.0',
        'docker push gcr.io/test-project/app:v1.0.0'
      ];

      for (const command of registryCommands) {
        await protocol.executeCommand(sessionId, command);
      }

      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('GCP Shell:');
    });

    it('should support Terraform integration', async () => {
      const sessionOptions: SessionOptions = {
        command: 'terraform',
        args: ['apply', '-var-file=terraform.tfvars'],
        streaming: true,
        env: {
          GOOGLE_APPLICATION_CREDENTIALS: '/cloudshell/service-account.json',
          TF_VAR_project_id: 'test-project-123'
        }
      };

      const session = await protocol.createSession(sessionOptions);
      
      expect(session.command).toBe('terraform');
      expect(session.env?.GOOGLE_APPLICATION_CREDENTIALS).toContain('service-account.json');
    });
  });

  // Helper functions
  function setupSuccessfulMockResponses(): void {
    mockComputeClient.getZones.mockResolvedValue([
      [
        {
          name: 'us-central1-a',
          description: 'us-central1-a',
          status: 'UP'
        }
      ]
    ]);

    mockComputeClient.getInstances.mockResolvedValue([[]]);
    mockStorageClient.getBuckets.mockResolvedValue([[]]);
    mockContainerClient.getClusters.mockResolvedValue([[]]);
    mockFunctionsClient.listFunctions.mockResolvedValue([[]]);
    mockIAMClient.getServiceAccounts.mockResolvedValue([[]]);
  }

  async function createTestSession(): Promise<string> {
    const sessionOptions: SessionOptions = {
      command: 'bash',
      streaming: true,
      shellType: 'bash',
      env: {
        GOOGLE_CLOUD_PROJECT: 'test-project-123'
      }
    };

    const session = await protocol.createSession(sessionOptions);
    return session.id;
  }
});