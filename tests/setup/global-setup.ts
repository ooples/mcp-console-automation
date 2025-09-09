/**
 * Global Jest Setup
 * 
 * This file runs once before all test suites across all workers.
 * It initializes test infrastructure and external dependencies.
 */

import { TestServerManager } from '../utils/test-servers.js';
import { Logger } from '../../src/utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Global test configuration
const GLOBAL_CONFIG = {
  testDataDir: path.join(process.cwd(), 'tests', 'data'),
  logLevel: process.env.CI ? 'warn' : 'debug',
  testTimeout: 30000,
  maxRetries: 3,
  cleanup: {
    tempFiles: true,
    testServers: true,
    dockerContainers: true,
    kubernetesResources: true
  }
};

let testServerManager: TestServerManager;
let globalCleanupHandlers: (() => Promise<void>)[] = [];

export default async function globalSetup(): Promise<void> {
  console.log('🚀 Starting global test setup...');

  try {
    // Set test environment variables
    setupEnvironmentVariables();
    
    // Initialize logger for testing
    process.env.LOG_LEVEL = GLOBAL_CONFIG.logLevel;
    const logger = Logger.getInstance();
    logger.info('Global test setup initialized');

    // Create test data directory
    await ensureTestDataDirectory();

    // Initialize test server manager
    testServerManager = new TestServerManager();
    await testServerManager.initialize();

    // Start essential test servers
    await startEssentialTestServers();

    // Setup Docker test environment
    await setupDockerTestEnvironment();

    // Setup Kubernetes test environment
    await setupKubernetesTestEnvironment();

    // Register cleanup handlers
    setupGlobalCleanupHandlers();

    // Verify all systems are ready
    await verifyTestEnvironment();

    console.log('✅ Global test setup completed successfully');

  } catch (error) {
    console.error('❌ Global test setup failed:', error);
    
    // Attempt cleanup on failure
    await performGlobalCleanup();
    
    throw error;
  }
}

/**
 * Setup environment variables for testing
 */
function setupEnvironmentVariables(): void {
  const testEnvVars = {
    NODE_ENV: 'test',
    LOG_LEVEL: GLOBAL_CONFIG.logLevel,
    TEST_TIMEOUT: GLOBAL_CONFIG.testTimeout.toString(),
    DISABLE_TELEMETRY: 'true',
    JEST_WORKER_ID: process.env.JEST_WORKER_ID || '1',
    
    // Protocol-specific test configurations
    DOCKER_TEST_IMAGE: 'alpine:latest',
    KUBERNETES_TEST_NAMESPACE: 'test-console-automation',
    SSH_TEST_HOST: 'localhost',
    SSH_TEST_PORT: '2222',
    SERIAL_TEST_PORT: process.platform === 'win32' ? 'COM99' : '/dev/ttyS99',
    
    // Security test configurations  
    ENABLE_SECURITY_TESTS: 'true',
    SECURITY_TEST_TIMEOUT: '180000',
    
    // Performance test configurations
    ENABLE_PERFORMANCE_TESTS: 'true',
    PERFORMANCE_TEST_ITERATIONS: '10',
    PERFORMANCE_TEST_CONCURRENT_SESSIONS: '5'
  };

  Object.entries(testEnvVars).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

/**
 * Ensure test data directory exists
 */
async function ensureTestDataDirectory(): Promise<void> {
  try {
    await fs.access(GLOBAL_CONFIG.testDataDir);
  } catch {
    await fs.mkdir(GLOBAL_CONFIG.testDataDir, { recursive: true });
  }

  // Create subdirectories for different test types
  const subdirs = [
    'fixtures',
    'temp',
    'logs',
    'certificates',
    'keys',
    'docker',
    'kubernetes',
    'serial-data'
  ];

  for (const subdir of subdirs) {
    const dirPath = path.join(GLOBAL_CONFIG.testDataDir, subdir);
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
}

/**
 * Start essential test servers
 */
async function startEssentialTestServers(): Promise<void> {
  console.log('Starting essential test servers...');

  try {
    // SSH test server
    const sshServer = testServerManager
      .createServer('ssh')
      .withPort(parseInt(process.env.SSH_TEST_PORT || '2222'))
      .withAuth({ username: 'test', password: 'test123' })
      .withFeatures({ sftp: true, exec: true })
      .build();
    
    await testServerManager.startServer('ssh-test', sshServer);

    // HTTP test server for webhooks and APIs
    const httpServer = testServerManager
      .createServer('http')
      .withPort(3000)
      .withRoutes({
        '/webhook': { method: 'POST', response: { status: 'ok' } },
        '/health': { method: 'GET', response: { status: 'healthy' } }
      })
      .build();
    
    await testServerManager.startServer('http-test', httpServer);

    // WebSocket test server
    const wsServer = testServerManager
      .createServer('websocket')
      .withPort(8080)
      .withProtocols(['terminal', 'shell'])
      .build();
    
    await testServerManager.startServer('websocket-test', wsServer);

    console.log('✅ Essential test servers started');

  } catch (error) {
    console.error('❌ Failed to start essential test servers:', error);
    throw error;
  }
}

/**
 * Setup Docker test environment
 */
async function setupDockerTestEnvironment(): Promise<void> {
  if (!isDockerAvailable()) {
    console.log('⚠️ Docker not available, skipping Docker test setup');
    return;
  }

  console.log('Setting up Docker test environment...');

  try {
    // Pull required test images
    const testImages = [
      'alpine:latest',
      'ubuntu:20.04',
      'nginx:alpine',
      'node:18-alpine'
    ];

    for (const image of testImages) {
      await pullDockerImage(image);
    }

    // Create test network
    await createDockerNetwork('console-automation-test');

    console.log('✅ Docker test environment ready');

  } catch (error) {
    console.error('❌ Docker test environment setup failed:', error);
    // Don't fail the entire setup for Docker issues
  }
}

/**
 * Setup Kubernetes test environment
 */
async function setupKubernetesTestEnvironment(): Promise<void> {
  if (!isKubernetesAvailable()) {
    console.log('⚠️ Kubernetes not available, skipping K8s test setup');
    return;
  }

  console.log('Setting up Kubernetes test environment...');

  try {
    const namespace = process.env.KUBERNETES_TEST_NAMESPACE;
    
    // Create test namespace
    await createKubernetesNamespace(namespace);
    
    // Deploy test pods
    await deployTestPods(namespace);

    console.log('✅ Kubernetes test environment ready');

  } catch (error) {
    console.error('❌ Kubernetes test environment setup failed:', error);
    // Don't fail the entire setup for K8s issues
  }
}

/**
 * Setup global cleanup handlers
 */
function setupGlobalCleanupHandlers(): void {
  // Register cleanup on process exit
  process.on('exit', () => {
    console.log('Process exit detected, performing cleanup...');
  });

  process.on('SIGINT', async () => {
    console.log('SIGINT received, performing graceful shutdown...');
    await performGlobalCleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, performing graceful shutdown...');
    await performGlobalCleanup();
    process.exit(0);
  });

  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await performGlobalCleanup();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    await performGlobalCleanup();
    process.exit(1);
  });
}

/**
 * Verify test environment is ready
 */
async function verifyTestEnvironment(): Promise<void> {
  console.log('Verifying test environment...');

  const verifications = [
    verifyTestDataDirectory(),
    verifyTestServers(),
    verifyDockerEnvironment(),
    verifyKubernetesEnvironment()
  ];

  const results = await Promise.allSettled(verifications);
  
  const failures = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, index }) => ({ 
      check: ['TestData', 'TestServers', 'Docker', 'Kubernetes'][index],
      error: (result as PromiseRejectedResult).reason
    }));

  if (failures.length > 0) {
    console.warn('⚠️ Some environment verifications failed:', failures);
  } else {
    console.log('✅ All environment verifications passed');
  }
}

/**
 * Perform global cleanup
 */
async function performGlobalCleanup(): Promise<void> {
  console.log('Performing global cleanup...');

  try {
    // Run all registered cleanup handlers
    for (const cleanup of globalCleanupHandlers) {
      try {
        await cleanup();
      } catch (error) {
        console.error('Cleanup handler failed:', error);
      }
    }

    // Stop test servers
    if (testServerManager) {
      await testServerManager.stopAllServers();
      await testServerManager.dispose();
    }

    // Clean up Docker resources
    if (GLOBAL_CONFIG.cleanup.dockerContainers) {
      await cleanupDockerResources();
    }

    // Clean up Kubernetes resources
    if (GLOBAL_CONFIG.cleanup.kubernetesResources) {
      await cleanupKubernetesResources();
    }

    // Clean up temp files
    if (GLOBAL_CONFIG.cleanup.tempFiles) {
      await cleanupTempFiles();
    }

    console.log('✅ Global cleanup completed');

  } catch (error) {
    console.error('❌ Global cleanup failed:', error);
  }
}

// Helper functions
function isDockerAvailable(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('docker --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isKubernetesAvailable(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('kubectl version --client', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function pullDockerImage(image: string): Promise<void> {
  const { execSync } = require('child_process');
  console.log(`Pulling Docker image: ${image}`);
  execSync(`docker pull ${image}`, { stdio: 'inherit' });
}

async function createDockerNetwork(name: string): Promise<void> {
  const { execSync } = require('child_process');
  try {
    execSync(`docker network create ${name}`, { stdio: 'ignore' });
  } catch {
    // Network might already exist
  }
}

async function createKubernetesNamespace(namespace: string): Promise<void> {
  const { execSync } = require('child_process');
  try {
    execSync(`kubectl create namespace ${namespace}`, { stdio: 'ignore' });
  } catch {
    // Namespace might already exist
  }
}

async function deployTestPods(namespace: string): Promise<void> {
  const { execSync } = require('child_process');
  const podManifest = `
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
  namespace: ${namespace}
spec:
  containers:
  - name: test-container
    image: alpine:latest
    command: ['sleep', '3600']
`;

  const manifestPath = path.join(GLOBAL_CONFIG.testDataDir, 'test-pod.yaml');
  await fs.writeFile(manifestPath, podManifest);
  
  try {
    execSync(`kubectl apply -f ${manifestPath}`, { stdio: 'ignore' });
  } catch (error) {
    console.warn('Failed to deploy test pod:', error);
  }
}

async function verifyTestDataDirectory(): Promise<void> {
  await fs.access(GLOBAL_CONFIG.testDataDir);
}

async function verifyTestServers(): Promise<void> {
  const servers = testServerManager.getActiveServers();
  if (servers.length === 0) {
    throw new Error('No test servers are running');
  }
}

async function verifyDockerEnvironment(): Promise<void> {
  if (isDockerAvailable()) {
    const { execSync } = require('child_process');
    execSync('docker info', { stdio: 'ignore' });
  }
}

async function verifyKubernetesEnvironment(): Promise<void> {
  if (isKubernetesAvailable()) {
    const { execSync } = require('child_process');
    execSync('kubectl cluster-info', { stdio: 'ignore' });
  }
}

async function cleanupDockerResources(): Promise<void> {
  if (!isDockerAvailable()) return;

  try {
    const { execSync } = require('child_process');
    
    // Stop and remove test containers
    execSync('docker container prune -f', { stdio: 'ignore' });
    
    // Remove test network
    execSync('docker network rm console-automation-test', { stdio: 'ignore' });
    
  } catch (error) {
    console.warn('Docker cleanup warnings:', error);
  }
}

async function cleanupKubernetesResources(): Promise<void> {
  if (!isKubernetesAvailable()) return;

  try {
    const { execSync } = require('child_process');
    const namespace = process.env.KUBERNETES_TEST_NAMESPACE;
    
    // Delete test namespace and all resources
    execSync(`kubectl delete namespace ${namespace}`, { stdio: 'ignore' });
    
  } catch (error) {
    console.warn('Kubernetes cleanup warnings:', error);
  }
}

async function cleanupTempFiles(): Promise<void> {
  const tempDir = path.join(GLOBAL_CONFIG.testDataDir, 'temp');
  
  try {
    const files = await fs.readdir(tempDir);
    for (const file of files) {
      await fs.unlink(path.join(tempDir, file));
    }
  } catch (error) {
    console.warn('Temp file cleanup warnings:', error);
  }
}

// Export cleanup function for programmatic use
export async function cleanup(): Promise<void> {
  await performGlobalCleanup();
}

// Store reference for global teardown
(global as any).__GLOBAL_SETUP__ = {
  testServerManager,
  cleanup: performGlobalCleanup,
  config: GLOBAL_CONFIG
};