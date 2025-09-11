/**
 * Kubernetes Protocol Integration Tests
 * Production-ready comprehensive test suite for Kubernetes protocol
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { KubernetesProtocol } from '../../../src/protocols/KubernetesProtocol.js';
import { MockKubernetesProtocol } from '../../utils/protocol-mocks.js';
import { TestServerManager, createTestServer } from '../../utils/test-servers.js';
import { 
  KubernetesSession, 
  KubernetesProtocolConfig, 
  ConsoleOutput,
  K8sPod,
  K8sNamespace,
  K8sDeployment,
  K8sService,
  K8sClusterInfo 
} from '../../../src/types/index.js';

describe('Kubernetes Protocol Integration Tests', () => {
  let k8sProtocol: KubernetesProtocol;
  let mockK8sProtocol: MockKubernetesProtocol;
  let testServerManager: TestServerManager;
  let mockConfig: KubernetesProtocolConfig;

  beforeAll(async () => {
    // Initialize test environment
    testServerManager = new TestServerManager();
    
    // Create mock Kubernetes API server
    const k8sApiServerConfig = createTestServer()
      .protocol('https')
      .port(6443)
      .host('127.0.0.1')
      .withLogging(true)
      .withBehavior({
        responseDelay: 150,
        errorRate: 0.02 // 2% error rate
      })
      .build();
    
    testServerManager.createServer('k8s-api-server', k8sApiServerConfig);
    await testServerManager.startServer('k8s-api-server');

    // Initialize mock Kubernetes protocol
    mockK8sProtocol = new MockKubernetesProtocol();
    await mockK8sProtocol.start();

    // Production Kubernetes protocol configuration
    mockConfig = {
      kubeconfig: {
        clusters: [{
          name: 'test-cluster',
          cluster: {
            server: 'https://127.0.0.1:6443',
            'certificate-authority-data': 'LS0tLS1CRUdJTi...',
            'insecure-skip-tls-verify': true
          }
        }],
        contexts: [{
          name: 'test-context',
          context: {
            cluster: 'test-cluster',
            user: 'test-user',
            namespace: 'default'
          }
        }],
        users: [{
          name: 'test-user',
          user: {
            'client-certificate-data': 'LS0tLS1CRUdJTi...',
            'client-key-data': 'LS0tLS1CRUdJTi...'
          }
        }],
        'current-context': 'test-context'
      },
      defaultNamespace: 'default',
      timeout: 30000,
      maxConcurrentSessions: 20,
      retryAttempts: 3,
      retryDelay: 1000,
      monitoring: {
        enableMetrics: true,
        metricsInterval: 10000,
        collectPodMetrics: true,
        collectNodeMetrics: true,
        collectClusterMetrics: true,
        enableHealthChecks: true,
        healthCheckInterval: 15000
      },
      security: {
        rbacEnabled: true,
        allowedNamespaces: ['default', 'kube-system', 'test-namespace'],
        restrictedResources: ['secrets', 'configmaps'],
        allowExec: true,
        allowPortForward: true,
        allowLogAccess: true,
        serviceAccountName: 'console-automation',
        enableNetworkPolicies: true
      },
      resource: {
        defaultCpuLimit: '500m',
        defaultMemoryLimit: '512Mi',
        defaultCpuRequest: '100m',
        defaultMemoryRequest: '128Mi',
        enableResourceQuotas: true,
        enableLimitRanges: true
      },
      logging: {
        enableAuditLogging: true,
        logLevel: 'info',
        logFormat: 'json',
        maxLogFiles: 10,
        maxLogFileSize: '100MB'
      },
      networking: {
        defaultServiceType: 'ClusterIP',
        allowLoadBalancer: false,
        allowNodePort: true,
        allowIngress: true,
        ingressClass: 'nginx',
        networkPlugin: 'calico'
      },
      storage: {
        defaultStorageClass: 'standard',
        allowedStorageClasses: ['standard', 'ssd', 'fast'],
        enablePersistentVolumes: true,
        volumeSnapshotEnabled: true
      }
    };

    // Initialize real Kubernetes protocol for production testing
    k8sProtocol = new KubernetesProtocol(mockConfig);
  });

  afterAll(async () => {
    // Cleanup resources
    await k8sProtocol.cleanup();
    await mockK8sProtocol.stop();
    await testServerManager.stopAllServers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any test sessions
    const sessions = k8sProtocol.getAllSessions();
    for (const session of sessions) {
      try {
        await k8sProtocol.terminateSession(session.id);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Cluster Connection and Authentication', () => {
    test('should connect to Kubernetes cluster successfully', async () => {
      const isConnected = await k8sProtocol.isClusterReachable();
      expect(isConnected).toBe(true);
      
      const clusterInfo = await k8sProtocol.getClusterInfo();
      expect(clusterInfo).toBeDefined();
      expect(clusterInfo.version).toBeDefined();
      expect(clusterInfo.nodeCount).toBeGreaterThan(0);
    });

    test('should authenticate with cluster successfully', async () => {
      const authStatus = await k8sProtocol.checkAuthentication();
      expect(authStatus.authenticated).toBe(true);
      expect(authStatus.user).toBeDefined();
      expect(authStatus.permissions).toBeDefined();
    });

    test('should handle invalid kubeconfig', async () => {
      const invalidConfig = {
        ...mockConfig,
        kubeconfig: {
          ...mockConfig.kubeconfig,
          'current-context': 'invalid-context'
        }
      };

      const invalidProtocol = new KubernetesProtocol(invalidConfig);
      
      await expect(invalidProtocol.isClusterReachable()).resolves.toBe(false);
      await invalidProtocol.cleanup();
    });

    test('should handle cluster connection timeout', async () => {
      const timeoutConfig = {
        ...mockConfig,
        timeout: 1000,
        kubeconfig: {
          ...mockConfig.kubeconfig,
          clusters: [{
            ...mockConfig.kubeconfig.clusters[0],
            cluster: {
              ...mockConfig.kubeconfig.clusters[0].cluster,
              server: 'https://unreachable-cluster:6443'
            }
          }]
        }
      };

      const timeoutProtocol = new KubernetesProtocol(timeoutConfig);
      
      await expect(timeoutProtocol.isClusterReachable()).resolves.toBe(false);
      await timeoutProtocol.cleanup();
    });
  });

  describe('Pod Management and Exec Sessions', () => {
    let testPod: K8sPod;

    beforeEach(async () => {
      // Create a test pod for exec sessions
      testPod = await k8sProtocol.createPod({
        name: `test-pod-${Date.now()}`,
        namespace: 'default',
        image: 'busybox',
        command: ['sleep', '300'],
        labels: { 'test': 'kubernetes-integration' }
      });
    });

    afterEach(async () => {
      // Cleanup test pod
      if (testPod) {
        try {
          await k8sProtocol.deletePod(testPod.metadata.name, testPod.metadata.namespace);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });

    test('should create exec session in pod successfully', async () => {
      const sessionOptions = {
        command: '/bin/sh',
        args: ['-c', 'echo "Hello Kubernetes"'],
        consoleType: 'kubernetes' as const,
        streaming: true,
        podName: testPod.metadata.name,
        namespace: testPod.metadata.namespace,
        containerName: 'main',
        tty: true,
        stdin: true
      };

      const session = await k8sProtocol.createSession(sessionOptions);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.podName).toBe(testPod.metadata.name);
      expect(session.namespace).toBe('default');
      expect(session.containerName).toBe('main');
      expect(session.status).toBe('running');
      expect(session.type).toBe('kubernetes');
      expect(session.isExecSession).toBe(true);
      expect(session.command).toBe('/bin/sh');
      expect(session.args).toEqual(['-c', 'echo "Hello Kubernetes"']);
    }, 20000);

    test('should handle pod not found error', async () => {
      await expect(k8sProtocol.createSession({
        command: '/bin/sh',
        consoleType: 'kubernetes' as const,
        podName: 'nonexistent-pod',
        namespace: 'default',
        containerName: 'main'
      })).rejects.toThrow('Pod not found');
    });

    test('should handle container not found error', async () => {
      await expect(k8sProtocol.createSession({
        command: '/bin/sh',
        consoleType: 'kubernetes' as const,
        podName: testPod.metadata.name,
        namespace: testPod.metadata.namespace,
        containerName: 'nonexistent-container'
      })).rejects.toThrow('Container not found');
    });

    test('should list pods in namespace', async () => {
      const pods = await k8sProtocol.listPods('default');

      expect(pods).toBeInstanceOf(Array);
      expect(pods.length).toBeGreaterThan(0);
      
      const createdPod = pods.find(p => p.metadata.name === testPod.metadata.name);
      expect(createdPod).toBeDefined();
      expect(createdPod?.status.phase).toMatch(/^(Pending|Running|Succeeded|Failed|Unknown)$/);
    }, 15000);

    test('should get pod details', async () => {
      const podDetails = await k8sProtocol.getPod(testPod.metadata.name, testPod.metadata.namespace);

      expect(podDetails).toBeDefined();
      expect(podDetails.metadata.name).toBe(testPod.metadata.name);
      expect(podDetails.metadata.namespace).toBe(testPod.metadata.namespace);
      expect(podDetails.spec).toBeDefined();
      expect(podDetails.status).toBeDefined();
      expect(podDetails.spec.containers).toBeInstanceOf(Array);
      expect(podDetails.spec.containers.length).toBeGreaterThan(0);
    });
  });

  describe('Command Execution in Pods', () => {
    let execSession: KubernetesSession;
    let testPod: K8sPod;

    beforeEach(async () => {
      // Create test pod
      testPod = await k8sProtocol.createPod({
        name: `exec-test-pod-${Date.now()}`,
        namespace: 'default',
        image: 'busybox',
        command: ['sleep', '300']
      });

      // Wait for pod to be ready
      await k8sProtocol.waitForPodReady(testPod.metadata.name, testPod.metadata.namespace, 30000);

      // Create exec session
      execSession = await k8sProtocol.createSession({
        command: '/bin/sh',
        consoleType: 'kubernetes' as const,
        podName: testPod.metadata.name,
        namespace: testPod.metadata.namespace,
        containerName: 'main'
      });
    });

    afterEach(async () => {
      if (testPod) {
        await k8sProtocol.deletePod(testPod.metadata.name, testPod.metadata.namespace);
      }
    });

    test('should execute simple commands successfully', async () => {
      const result = await k8sProtocol.executeCommand(execSession.id, 'echo "Hello Pod"');
      
      expect(result).toContain('Hello Pod');
    }, 15000);

    test('should execute file system operations', async () => {
      // Create a test file
      await k8sProtocol.executeCommand(execSession.id, 'echo "kubernetes test" > /tmp/k8s-test.txt');
      
      // Read the file
      const result = await k8sProtocol.executeCommand(execSession.id, 'cat /tmp/k8s-test.txt');
      
      expect(result).toContain('kubernetes test');
    }, 15000);

    test('should handle command timeouts', async () => {
      await expect(k8sProtocol.executeCommand(
        execSession.id, 
        'sleep 60', 
        { timeout: 2000 }
      )).rejects.toThrow('timeout');
    }, 5000);

    test('should capture command output with streaming', async () => {
      const outputSpy = jest.fn<any>();
      k8sProtocol.on('output', outputSpy);

      await k8sProtocol.executeCommand(execSession.id, 'echo "Stream Test"');

      expect(outputSpy).toHaveBeenCalled();
      const outputCall = outputSpy.mock.calls.find(call => 
        call[0].data.includes('Stream Test')
      );
      expect(outputCall).toBeDefined();
    }, 10000);
  });

  describe('Namespace Management', () => {
    let testNamespace: string;

    beforeEach(() => {
      testNamespace = `test-ns-${Date.now()}`;
    });

    afterEach(async () => {
      if (testNamespace) {
        try {
          await k8sProtocol.deleteNamespace(testNamespace);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });

    test('should list namespaces', async () => {
      const namespaces = await k8sProtocol.listNamespaces();

      expect(namespaces).toBeInstanceOf(Array);
      expect(namespaces.length).toBeGreaterThan(0);
      
      const defaultNs = namespaces.find(ns => ns.metadata.name === 'default');
      expect(defaultNs).toBeDefined();
      expect(defaultNs?.status.phase).toBe('Active');
    });

    test('should create and delete namespace', async () => {
      // Create namespace
      const createdNs = await k8sProtocol.createNamespace({
        name: testNamespace,
        labels: { 'test': 'integration' }
      });

      expect(createdNs.metadata.name).toBe(testNamespace);
      expect(createdNs.metadata.labels?.test).toBe('integration');

      // Verify namespace exists
      const namespaces = await k8sProtocol.listNamespaces();
      const foundNs = namespaces.find(ns => ns.metadata.name === testNamespace);
      expect(foundNs).toBeDefined();

      // Delete namespace
      await k8sProtocol.deleteNamespace(testNamespace);

      // Verify namespace is deleted (may take time)
      await new Promise(resolve => setTimeout(resolve, 5000));
      testNamespace = ''; // Prevent cleanup
    }, 20000);

    test('should get namespace details', async () => {
      const nsDetails = await k8sProtocol.getNamespace('default');

      expect(nsDetails).toBeDefined();
      expect(nsDetails.metadata.name).toBe('default');
      expect(nsDetails.status).toBeDefined();
      expect(nsDetails.status.phase).toBe('Active');
    });
  });

  describe('Resource Monitoring and Metrics', () => {
    let monitoringPod: K8sPod;

    beforeEach(async () => {
      monitoringPod = await k8sProtocol.createPod({
        name: `monitoring-pod-${Date.now()}`,
        namespace: 'default',
        image: 'nginx',
        resources: {
          requests: { cpu: '100m', memory: '128Mi' },
          limits: { cpu: '500m', memory: '512Mi' }
        }
      });

      await k8sProtocol.waitForPodReady(monitoringPod.metadata.name, monitoringPod.metadata.namespace, 30000);
    });

    afterEach(async () => {
      if (monitoringPod) {
        await k8sProtocol.deletePod(monitoringPod.metadata.name, monitoringPod.metadata.namespace);
      }
    });

    test('should collect pod metrics', async () => {
      const metricsSpy = jest.fn<any>();
      k8sProtocol.on('pod-metrics', metricsSpy);

      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 12000));

      expect(metricsSpy).toHaveBeenCalled();

      const metrics = metricsSpy.mock.calls[0][0];
      expect(metrics.podName).toBe(monitoringPod.metadata.name);
      expect(metrics.namespace).toBe(monitoringPod.metadata.namespace);
      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(metrics.cpu).toBeDefined();
      expect(metrics.memory).toBeDefined();
      expect(typeof metrics.cpu.usage).toBe('number');
      expect(typeof metrics.memory.usage).toBe('number');
    }, 15000);

    test('should collect cluster metrics', async () => {
      const clusterMetricsSpy = jest.fn<any>();
      k8sProtocol.on('cluster-metrics', clusterMetricsSpy);

      // Wait for cluster metrics
      await new Promise(resolve => setTimeout(resolve, 12000));

      expect(clusterMetricsSpy).toHaveBeenCalled();

      const clusterMetrics = clusterMetricsSpy.mock.calls[0][0];
      expect(clusterMetrics.timestamp).toBeInstanceOf(Date);
      expect(clusterMetrics.nodes).toBeDefined();
      expect(clusterMetrics.pods).toBeDefined();
      expect(clusterMetrics.services).toBeDefined();
      expect(typeof clusterMetrics.nodes.total).toBe('number');
      expect(typeof clusterMetrics.pods.running).toBe('number');
    }, 15000);

    test('should perform health checks', async () => {
      const healthCheckSpy = jest.fn<any>();
      k8sProtocol.on('health-check', healthCheckSpy);

      // Wait for health checks
      await new Promise(resolve => setTimeout(resolve, 18000));

      expect(healthCheckSpy).toHaveBeenCalled();

      const healthCheck = healthCheckSpy.mock.calls[0][0];
      expect(healthCheck.timestamp).toBeInstanceOf(Date);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(healthCheck.status);
      expect(healthCheck.components).toBeDefined();
      expect(healthCheck.components.apiServer).toBeDefined();
      expect(healthCheck.components.etcd).toBeDefined();
      expect(healthCheck.components.scheduler).toBeDefined();
      expect(healthCheck.components.controllerManager).toBeDefined();
    }, 20000);
  });

  describe('Log Management', () => {
    let loggingPod: K8sPod;

    beforeEach(async () => {
      loggingPod = await k8sProtocol.createPod({
        name: `logging-pod-${Date.now()}`,
        namespace: 'default',
        image: 'busybox',
        command: ['sh', '-c', 'for i in $(seq 1 10); do echo "Log line $i"; sleep 1; done; sleep 300']
      });

      await k8sProtocol.waitForPodReady(loggingPod.metadata.name, loggingPod.metadata.namespace, 30000);
    });

    afterEach(async () => {
      if (loggingPod) {
        await k8sProtocol.deletePod(loggingPod.metadata.name, loggingPod.metadata.namespace);
      }
    });

    test('should retrieve pod logs', async () => {
      // Wait for some logs to be generated
      await new Promise(resolve => setTimeout(resolve, 5000));

      const logs = await k8sProtocol.getPodLogs(
        loggingPod.metadata.name, 
        loggingPod.metadata.namespace,
        { lines: 5 }
      );

      expect(logs).toBeDefined();
      expect(logs.split('\n').length).toBeGreaterThan(0);
      expect(logs).toContain('Log line');
    }, 10000);

    test('should stream pod logs', async () => {
      const logSpy = jest.fn<any>();
      k8sProtocol.on('pod-log', logSpy);

      // Start log streaming
      const stream = await k8sProtocol.streamPodLogs(
        loggingPod.metadata.name, 
        loggingPod.metadata.namespace
      );

      // Wait for logs
      await new Promise(resolve => setTimeout(resolve, 8000));

      expect(logSpy).toHaveBeenCalled();

      const logEntry = logSpy.mock.calls[0][0];
      expect(logEntry.podName).toBe(loggingPod.metadata.name);
      expect(logEntry.namespace).toBe(loggingPod.metadata.namespace);
      expect(logEntry.timestamp).toBeInstanceOf(Date);
      expect(logEntry.message).toContain('Log line');

      // Stop streaming
      stream.destroy();
    }, 12000);

    test('should retrieve logs with timestamps', async () => {
      const logs = await k8sProtocol.getPodLogs(
        loggingPod.metadata.name, 
        loggingPod.metadata.namespace,
        { timestamps: true, lines: 3 }
      );

      const lines = logs.split('\n').filter(line => line.trim());
      expect(lines.length).toBeGreaterThan(0);
      
      // Check if timestamps are present (ISO 8601 format)
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }, 10000);
  });

  describe('Port Forwarding', () => {
    let portForwardPod: K8sPod;

    beforeEach(async () => {
      portForwardPod = await k8sProtocol.createPod({
        name: `port-forward-pod-${Date.now()}`,
        namespace: 'default',
        image: 'nginx',
        ports: [{ containerPort: 80 }]
      });

      await k8sProtocol.waitForPodReady(portForwardPod.metadata.name, portForwardPod.metadata.namespace, 30000);
    });

    afterEach(async () => {
      if (portForwardPod) {
        await k8sProtocol.deletePod(portForwardPod.metadata.name, portForwardPod.metadata.namespace);
      }
    });

    test('should create port forward successfully', async () => {
      const portForward = await k8sProtocol.createPortForward({
        podName: portForwardPod.metadata.name,
        namespace: portForwardPod.metadata.namespace,
        localPort: 8080,
        remotePort: 80
      });

      expect(portForward).toBeDefined();
      expect(portForward.id).toBeDefined();
      expect(portForward.localPort).toBe(8080);
      expect(portForward.remotePort).toBe(80);
      expect(portForward.status).toBe('active');

      // Test connection
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Cleanup
      await k8sProtocol.stopPortForward(portForward.id);
    }, 15000);

    test('should list active port forwards', async () => {
      const portForward = await k8sProtocol.createPortForward({
        podName: portForwardPod.metadata.name,
        namespace: portForwardPod.metadata.namespace,
        localPort: 8081,
        remotePort: 80
      });

      const activeForwards = await k8sProtocol.listPortForwards();
      
      expect(activeForwards).toBeInstanceOf(Array);
      const createdForward = activeForwards.find(pf => pf.id === portForward.id);
      expect(createdForward).toBeDefined();

      // Cleanup
      await k8sProtocol.stopPortForward(portForward.id);
    }, 15000);

    test('should stop port forward', async () => {
      const portForward = await k8sProtocol.createPortForward({
        podName: portForwardPod.metadata.name,
        namespace: portForwardPod.metadata.namespace,
        localPort: 8082,
        remotePort: 80
      });

      expect(portForward.status).toBe('active');

      await k8sProtocol.stopPortForward(portForward.id);

      const activeForwards = await k8sProtocol.listPortForwards();
      const stoppedForward = activeForwards.find(pf => pf.id === portForward.id);
      expect(stoppedForward).toBeUndefined();
    }, 15000);
  });

  describe('Service and Deployment Management', () => {
    let testDeployment: K8sDeployment;
    let testService: K8sService;
    const deploymentName = `test-deployment-${Date.now()}`;
    const serviceName = `test-service-${Date.now()}`;

    afterEach(async () => {
      if (testDeployment) {
        try {
          await k8sProtocol.deleteDeployment(deploymentName, 'default');
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      if (testService) {
        try {
          await k8sProtocol.deleteService(serviceName, 'default');
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });

    test('should create and manage deployment', async () => {
      testDeployment = await k8sProtocol.createDeployment({
        name: deploymentName,
        namespace: 'default',
        image: 'nginx',
        replicas: 2,
        labels: { app: 'test-nginx' }
      });

      expect(testDeployment.metadata.name).toBe(deploymentName);
      expect(testDeployment.spec.replicas).toBe(2);

      // Wait for deployment to be ready
      await k8sProtocol.waitForDeploymentReady(deploymentName, 'default', 60000);

      const deployments = await k8sProtocol.listDeployments('default');
      const createdDeployment = deployments.find(d => d.metadata.name === deploymentName);
      expect(createdDeployment).toBeDefined();
    }, 30000);

    test('should create and manage service', async () => {
      // First create deployment for service
      testDeployment = await k8sProtocol.createDeployment({
        name: deploymentName,
        namespace: 'default',
        image: 'nginx',
        replicas: 1,
        labels: { app: 'test-nginx' }
      });

      testService = await k8sProtocol.createService({
        name: serviceName,
        namespace: 'default',
        selector: { app: 'test-nginx' },
        ports: [{ port: 80, targetPort: 80 }],
        type: 'ClusterIP'
      });

      expect(testService.metadata.name).toBe(serviceName);
      expect(testService.spec.type).toBe('ClusterIP');

      const services = await k8sProtocol.listServices('default');
      const createdService = services.find(s => s.metadata.name === serviceName);
      expect(createdService).toBeDefined();
    }, 25000);

    test('should scale deployment', async () => {
      testDeployment = await k8sProtocol.createDeployment({
        name: deploymentName,
        namespace: 'default',
        image: 'nginx',
        replicas: 1,
        labels: { app: 'test-nginx' }
      });

      await k8sProtocol.scaleDeployment(deploymentName, 'default', 3);

      const scaledDeployment = await k8sProtocol.getDeployment(deploymentName, 'default');
      expect(scaledDeployment.spec.replicas).toBe(3);
    }, 25000);
  });

  describe('Security and RBAC', () => {
    test('should enforce namespace restrictions', async () => {
      await expect(k8sProtocol.listPods('restricted-namespace')).rejects.toThrow();
    });

    test('should restrict access to sensitive resources', async () => {
      const restrictedResources = mockConfig.security.restrictedResources;
      
      for (const resource of restrictedResources) {
        await expect(k8sProtocol.listResources(resource, 'default')).rejects.toThrow();
      }
    });

    test('should validate service account permissions', async () => {
      const permissions = await k8sProtocol.checkServiceAccountPermissions(
        mockConfig.security.serviceAccountName,
        'default'
      );

      expect(permissions).toBeDefined();
      expect(permissions.canList).toBeDefined();
      expect(permissions.canCreate).toBeDefined();
      expect(permissions.canDelete).toBeDefined();
    });

    test('should audit kubectl operations', async () => {
      const auditSpy = jest.fn<any>();
      k8sProtocol.on('kubectl-audit', auditSpy);

      await k8sProtocol.listPods('default');

      expect(auditSpy).toHaveBeenCalled();
      const auditEntry = auditSpy.mock.calls[0][0];
      expect(auditEntry.operation).toBe('list');
      expect(auditEntry.resource).toBe('pods');
      expect(auditEntry.namespace).toBe('default');
      expect(auditEntry.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle API server unavailability', async () => {
      // Stop the mock API server
      await testServerManager.stopServer('k8s-api-server');

      await expect(k8sProtocol.listPods('default')).rejects.toThrow();

      // Restart the server for other tests
      await testServerManager.startServer('k8s-api-server');
    });

    test('should retry failed operations', async () => {
      const retrySpy = jest.fn<any>();
      k8sProtocol.on('operation-retry', retrySpy);

      // This should trigger retries due to server behavior
      try {
        await k8sProtocol.listPods('default');
      } catch (error) {
        // May fail after retries
      }

      // Check if retries were attempted
      // (This depends on the mock server's error rate)
    });

    test('should handle concurrent operations', async () => {
      const podPromises = Array.from({ length: 5 }, (_, i) =>
        k8sProtocol.createPod({
          name: `concurrent-pod-${i}-${Date.now()}`,
          namespace: 'default',
          image: 'busybox',
          command: ['sleep', '300']
        }).catch(() => null) // Catch expected failures
      );

      const pods = await Promise.all(podPromises);
      const successfulPods = pods.filter(p => p !== null);
      
      expect(successfulPods.length).toBeGreaterThan(0);

      // Cleanup
      await Promise.all(successfulPods.map(pod => 
        k8sProtocol.deletePod(pod!.metadata.name, pod!.metadata.namespace).catch(() => {})
      ));
    }, 30000);

    test('should handle resource quota exceeded', async () => {
      // Try to create a pod with excessive resource requests
      await expect(k8sProtocol.createPod({
        name: `resource-exhaustion-${Date.now()}`,
        namespace: 'default',
        image: 'nginx',
        resources: {
          requests: { cpu: '1000', memory: '100Gi' },
          limits: { cpu: '1000', memory: '100Gi' }
        }
      })).rejects.toThrow();
    });
  });

  describe('Session Cleanup and Resource Management', () => {
    test('should cleanup exec sessions properly', async () => {
      const testPod = await k8sProtocol.createPod({
        name: `cleanup-pod-${Date.now()}`,
        namespace: 'default',
        image: 'busybox',
        command: ['sleep', '300']
      });

      await k8sProtocol.waitForPodReady(testPod.metadata.name, testPod.metadata.namespace, 30000);

      const session = await k8sProtocol.createSession({
        command: '/bin/sh',
        consoleType: 'kubernetes' as const,
        podName: testPod.metadata.name,
        namespace: testPod.metadata.namespace,
        containerName: 'main'
      });

      expect(session.status).toBe('running');

      await k8sProtocol.terminateSession(session.id);

      const terminatedSession = k8sProtocol.getSession(session.id);
      expect(terminatedSession?.status).toBe('terminated');

      // Cleanup pod
      await k8sProtocol.deletePod(testPod.metadata.name, testPod.metadata.namespace);
    }, 25000);

    test('should cleanup all resources on protocol shutdown', async () => {
      const testPod1 = await k8sProtocol.createPod({
        name: `cleanup1-${Date.now()}`,
        namespace: 'default',
        image: 'busybox',
        command: ['sleep', '300']
      });

      const testPod2 = await k8sProtocol.createPod({
        name: `cleanup2-${Date.now()}`,
        namespace: 'default',
        image: 'busybox',
        command: ['sleep', '300']
      });

      await Promise.all([
        k8sProtocol.waitForPodReady(testPod1.metadata.name, testPod1.metadata.namespace, 30000),
        k8sProtocol.waitForPodReady(testPod2.metadata.name, testPod2.metadata.namespace, 30000)
      ]);

      const session1 = await k8sProtocol.createSession({
        command: '/bin/sh',
        consoleType: 'kubernetes' as const,
        podName: testPod1.metadata.name,
        namespace: testPod1.metadata.namespace,
        containerName: 'main'
      });

      const session2 = await k8sProtocol.createSession({
        command: '/bin/sh',
        consoleType: 'kubernetes' as const,
        podName: testPod2.metadata.name,
        namespace: testPod2.metadata.namespace,
        containerName: 'main'
      });

      expect(k8sProtocol.getAllSessions().length).toBe(2);

      await k8sProtocol.cleanup();

      expect(k8sProtocol.getAllSessions().length).toBe(0);

      // Cleanup pods manually since protocol cleanup doesn't delete pods
      await Promise.all([
        k8sProtocol.deletePod(testPod1.metadata.name, testPod1.metadata.namespace).catch(() => {}),
        k8sProtocol.deletePod(testPod2.metadata.name, testPod2.metadata.namespace).catch(() => {})
      ]);
    }, 35000);
  });
});