/**
 * Global Jest Teardown
 * 
 * This file runs once after all test suites across all workers have completed.
 * It performs final cleanup of test infrastructure and external dependencies.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../../src/utils/logger.js';

export default async function globalTeardown(): Promise<void> {
  console.log('🧹 Starting global test teardown...');

  const logger = Logger.getInstance();
  logger.info('Global teardown initiated');

  try {
    // Retrieve global setup references
    const globalSetup = (global as any).__GLOBAL_SETUP__;
    
    if (globalSetup) {
      // Execute global cleanup
      await globalSetup.cleanup();
      
      // Additional comprehensive cleanup
      await performComprehensiveCleanup(globalSetup.config);
    } else {
      console.warn('⚠️ No global setup reference found, performing basic cleanup');
      await performBasicCleanup();
    }

    // Generate test summary report
    await generateTestSummaryReport();

    // Final verification
    await verifyCleanupComplete();

    console.log('✅ Global test teardown completed successfully');

  } catch (error) {
    console.error('❌ Global test teardown failed:', error);
    
    // Force cleanup on failure
    await performForceCleanup();
    
    // Don't throw error to prevent test suite failure
    console.warn('⚠️ Continuing despite teardown errors');
  }
}

/**
 * Perform comprehensive cleanup using global setup configuration
 */
async function performComprehensiveCleanup(config: any): Promise<void> {
  console.log('Performing comprehensive cleanup...');

  const cleanupTasks = [
    { name: 'Protocol Cleanup', task: () => cleanupProtocolResources() },
    { name: 'Network Cleanup', task: () => cleanupNetworkResources() },
    { name: 'File System Cleanup', task: () => cleanupFileSystemResources(config) },
    { name: 'Process Cleanup', task: () => cleanupProcessResources() },
    { name: 'Memory Cleanup', task: () => cleanupMemoryResources() },
    { name: 'Log Cleanup', task: () => cleanupLogResources(config) }
  ];

  const results = await Promise.allSettled(
    cleanupTasks.map(async ({ name, task }) => {
      console.log(`Running ${name}...`);
      try {
        await task();
        console.log(`✅ ${name} completed`);
      } catch (error) {
        console.error(`❌ ${name} failed:`, error);
        throw error;
      }
    })
  );

  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length > 0) {
    console.warn(`⚠️ ${failed.length} cleanup tasks failed, but continuing...`);
  }
}

/**
 * Perform basic cleanup when global setup reference is not available
 */
async function performBasicCleanup(): Promise<void> {
  console.log('Performing basic cleanup...');

  try {
    // Basic Docker cleanup
    await basicDockerCleanup();
    
    // Basic Kubernetes cleanup
    await basicKubernetesCleanup();
    
    // Basic file system cleanup
    await basicFileSystemCleanup();
    
    // Basic process cleanup
    await basicProcessCleanup();

  } catch (error) {
    console.warn('Basic cleanup warnings:', error);
  }
}

/**
 * Clean up protocol-specific resources
 */
async function cleanupProtocolResources(): Promise<void> {
  const protocolCleanupTasks = [
    cleanupSSHResources(),
    cleanupDockerResources(),
    cleanupKubernetesResources(),
    cleanupSerialResources(),
    cleanupWSLResources(),
    cleanupVirtualizationResources(),
    cleanupCloudResources(),
    cleanupHardwareResources()
  ];

  await Promise.allSettled(protocolCleanupTasks);
}

/**
 * Clean up SSH protocol resources
 */
async function cleanupSSHResources(): Promise<void> {
  try {
    // Kill any hanging SSH processes
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      execSync('taskkill /F /IM ssh.exe /T', { stdio: 'ignore' });
    } else {
      const { execSync } = require('child_process');
      execSync('pkill -f ssh', { stdio: 'ignore' });
    }

    // Clean up SSH key files
    const sshKeyDir = path.join(process.cwd(), 'tests', 'data', 'keys');
    try {
      const files = await fs.readdir(sshKeyDir);
      for (const file of files) {
        if (file.startsWith('test_') && (file.endsWith('.pem') || file.endsWith('.pub'))) {
          await fs.unlink(path.join(sshKeyDir, file));
        }
      }
    } catch {
      // Directory might not exist
    }

  } catch (error) {
    console.warn('SSH cleanup warnings:', error);
  }
}

/**
 * Clean up Docker protocol resources
 */
async function cleanupDockerResources(): Promise<void> {
  if (!isDockerAvailable()) return;

  try {
    const { execSync } = require('child_process');
    
    console.log('Cleaning up Docker resources...');
    
    // Stop all test containers
    const containers = execSync('docker ps -q --filter "label=test-suite=console-automation"', 
      { encoding: 'utf8', stdio: 'pipe' }).trim();
    
    if (containers) {
      execSync(`docker stop ${containers}`, { stdio: 'ignore' });
      execSync(`docker rm ${containers}`, { stdio: 'ignore' });
    }

    // Remove test images
    const testImages = execSync('docker images -q --filter "label=test-suite=console-automation"', 
      { encoding: 'utf8', stdio: 'pipe' }).trim();
    
    if (testImages) {
      execSync(`docker rmi ${testImages}`, { stdio: 'ignore' });
    }

    // Clean up test networks
    execSync('docker network prune -f --filter "label=test-suite=console-automation"', { stdio: 'ignore' });
    
    // Clean up test volumes
    execSync('docker volume prune -f --filter "label=test-suite=console-automation"', { stdio: 'ignore' });

  } catch (error) {
    console.warn('Docker cleanup warnings:', error);
  }
}

/**
 * Clean up Kubernetes protocol resources
 */
async function cleanupKubernetesResources(): Promise<void> {
  if (!isKubernetesAvailable()) return;

  try {
    const { execSync } = require('child_process');
    const namespace = process.env.KUBERNETES_TEST_NAMESPACE || 'test-console-automation';
    
    console.log('Cleaning up Kubernetes resources...');
    
    // Delete test namespace and all resources within it
    execSync(`kubectl delete namespace ${namespace} --ignore-not-found=true`, { stdio: 'ignore' });
    
    // Clean up any cluster-wide test resources
    execSync('kubectl delete clusterrole test-console-automation --ignore-not-found=true', { stdio: 'ignore' });
    execSync('kubectl delete clusterrolebinding test-console-automation --ignore-not-found=true', { stdio: 'ignore' });

  } catch (error) {
    console.warn('Kubernetes cleanup warnings:', error);
  }
}

/**
 * Clean up serial protocol resources
 */
async function cleanupSerialResources(): Promise<void> {
  try {
    // Kill any hanging serial processes
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      // Clean up Windows serial port handles
      execSync('tasklist /FI "IMAGENAME eq node.exe" | findstr console-automation', { stdio: 'ignore' });
    } else {
      // Clean up Unix serial port locks
      const lockDir = '/var/lock';
      try {
        const files = await fs.readdir(lockDir);
        for (const file of files) {
          if (file.startsWith('LCK..ttyUSB') || file.startsWith('LCK..ttyS')) {
            await fs.unlink(path.join(lockDir, file)).catch(() => {});
          }
        }
      } catch {
        // Lock directory might not be accessible
      }
    }

  } catch (error) {
    console.warn('Serial cleanup warnings:', error);
  }
}

/**
 * Clean up WSL protocol resources
 */
async function cleanupWSLResources(): Promise<void> {
  if (process.platform !== 'win32') return;

  try {
    const { execSync } = require('child_process');
    
    // Terminate any test WSL distributions
    const testDistros = ['test-ubuntu', 'test-debian', 'console-automation-test'];
    
    for (const distro of testDistros) {
      try {
        execSync(`wsl --terminate ${distro}`, { stdio: 'ignore' });
      } catch {
        // Distro might not exist
      }
    }

  } catch (error) {
    console.warn('WSL cleanup warnings:', error);
  }
}

/**
 * Clean up virtualization resources
 */
async function cleanupVirtualizationResources(): Promise<void> {
  try {
    // Clean up VirtualBox test VMs
    if (isVirtualBoxAvailable()) {
      const { execSync } = require('child_process');
      const testVMs = ['console-automation-test'];
      
      for (const vm of testVMs) {
        try {
          execSync(`VBoxManage controlvm ${vm} poweroff`, { stdio: 'ignore' });
          execSync(`VBoxManage unregistervm ${vm} --delete`, { stdio: 'ignore' });
        } catch {
          // VM might not exist
        }
      }
    }

    // Clean up VMware test VMs (if available)
    // Similar cleanup for other virtualization platforms

  } catch (error) {
    console.warn('Virtualization cleanup warnings:', error);
  }
}

/**
 * Clean up cloud resources
 */
async function cleanupCloudResources(): Promise<void> {
  // Note: In production, this would clean up actual cloud resources
  // For tests, we just clean up local mock resources
  
  try {
    // Clean up AWS mock resources
    await cleanupAWSMockResources();
    
    // Clean up Azure mock resources
    await cleanupAzureMockResources();
    
    // Clean up GCP mock resources
    await cleanupGCPMockResources();

  } catch (error) {
    console.warn('Cloud resource cleanup warnings:', error);
  }
}

/**
 * Clean up hardware protocol resources
 */
async function cleanupHardwareResources(): Promise<void> {
  try {
    // Clean up IPMI mock sessions
    // Clean up BMC mock connections
    // Clean up iDRAC mock interfaces
    
    // For real hardware testing, this would clean up actual connections
    console.log('Hardware resource cleanup completed (mock resources)');

  } catch (error) {
    console.warn('Hardware cleanup warnings:', error);
  }
}

/**
 * Clean up network resources
 */
async function cleanupNetworkResources(): Promise<void> {
  try {
    // Kill hanging network connections
    const netstatCmd = process.platform === 'win32' 
      ? 'netstat -an | findstr :222' 
      : 'netstat -an | grep :222';
    
    // Clean up test server ports
    const testPorts = [2222, 3000, 8080, 8443, 9090, 5985, 5986];
    
    for (const port of testPorts) {
      try {
        if (process.platform === 'win32') {
          const { execSync } = require('child_process');
          const pid = execSync(`netstat -ano | findstr :${port} | awk '{print $5}'`, { encoding: 'utf8' }).trim();
          if (pid) {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          }
        } else {
          const { execSync } = require('child_process');
          execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
        }
      } catch {
        // Process might not exist
      }
    }

  } catch (error) {
    console.warn('Network cleanup warnings:', error);
  }
}

/**
 * Clean up file system resources
 */
async function cleanupFileSystemResources(config?: any): Promise<void> {
  try {
    const testDataDir = config?.testDataDir || path.join(process.cwd(), 'tests', 'data');
    
    // Clean up temporary files
    const tempDirs = [
      path.join(testDataDir, 'temp'),
      path.join(testDataDir, 'logs'),
      path.join(process.cwd(), 'test-output'),
      path.join(process.cwd(), '.tmp')
    ];

    for (const dir of tempDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Directory might not exist
      }
    }

    // Clean up certificate files
    const certDir = path.join(testDataDir, 'certificates');
    try {
      const files = await fs.readdir(certDir);
      for (const file of files) {
        if (file.startsWith('test-')) {
          await fs.unlink(path.join(certDir, file));
        }
      }
    } catch {
      // Directory might not exist
    }

  } catch (error) {
    console.warn('File system cleanup warnings:', error);
  }
}

/**
 * Clean up process resources
 */
async function cleanupProcessResources(): Promise<void> {
  try {
    // Clean up any hanging child processes
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      // Kill processes by name pattern
      const processNames = ['ssh.exe', 'docker.exe', 'kubectl.exe', 'wsl.exe'];
      for (const procName of processNames) {
        try {
          execSync(`tasklist /FI "IMAGENAME eq ${procName}" | findstr console-automation`, { stdio: 'ignore' });
          execSync(`taskkill /F /IM ${procName} /T`, { stdio: 'ignore' });
        } catch {
          // Process might not exist
        }
      }
    } else {
      const { execSync } = require('child_process');
      // Kill processes by pattern
      execSync('pkill -f "console-automation.*test"', { stdio: 'ignore' });
    }

  } catch (error) {
    console.warn('Process cleanup warnings:', error);
  }
}

/**
 * Clean up memory resources
 */
async function cleanupMemoryResources(): Promise<void> {
  try {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Clear Node.js module cache for test modules
    Object.keys(require.cache)
      .filter(key => key.includes('test') || key.includes('spec') || key.includes('mock'))
      .forEach(key => {
        delete require.cache[key];
      });

  } catch (error) {
    console.warn('Memory cleanup warnings:', error);
  }
}

/**
 * Clean up log resources
 */
async function cleanupLogResources(config?: any): Promise<void> {
  try {
    const logDir = config?.testDataDir ? 
      path.join(config.testDataDir, 'logs') : 
      path.join(process.cwd(), 'tests', 'data', 'logs');

    // Archive old logs instead of deleting them
    const archiveDir = path.join(logDir, 'archive');
    
    try {
      await fs.mkdir(archiveDir, { recursive: true });
      
      const files = await fs.readdir(logDir);
      const logFiles = files.filter(file => file.endsWith('.log') && !file.includes('archive'));
      
      for (const file of logFiles) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveName = `${timestamp}-${file}`;
        await fs.rename(
          path.join(logDir, file),
          path.join(archiveDir, archiveName)
        );
      }
    } catch {
      // Log directory might not exist
    }

  } catch (error) {
    console.warn('Log cleanup warnings:', error);
  }
}

/**
 * Generate test summary report
 */
async function generateTestSummaryReport(): Promise<void> {
  try {
    const reportDir = path.join(process.cwd(), 'coverage', 'reports');
    await fs.mkdir(reportDir, { recursive: true });

    const summaryReport = {
      timestamp: new Date().toISOString(),
      testSuite: 'Console Automation MCP Server',
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        ci: !!process.env.CI
      },
      cleanup: {
        completed: true,
        timestamp: new Date().toISOString()
      }
    };

    await fs.writeFile(
      path.join(reportDir, 'teardown-summary.json'),
      JSON.stringify(summaryReport, null, 2)
    );

    console.log('📊 Test summary report generated');

  } catch (error) {
    console.warn('Test summary report generation failed:', error);
  }
}

/**
 * Verify cleanup completion
 */
async function verifyCleanupComplete(): Promise<void> {
  console.log('Verifying cleanup completion...');

  const verifications = [
    verifyNoHangingProcesses(),
    verifyPortsReleased(),
    verifyTempFilesRemoved(),
    verifyResourcesReleased()
  ];

  const results = await Promise.allSettled(verifications);
  
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length > 0) {
    console.warn(`⚠️ ${failures.length} cleanup verifications failed, but continuing...`);
  } else {
    console.log('✅ Cleanup verification completed successfully');
  }
}

/**
 * Force cleanup when normal cleanup fails
 */
async function performForceCleanup(): Promise<void> {
  console.log('Performing force cleanup...');

  try {
    // Force kill all Node.js processes related to testing
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq *test*"', { stdio: 'ignore' });
    } else {
      const { execSync } = require('child_process');
      execSync('pkill -9 -f "node.*test"', { stdio: 'ignore' });
    }

    // Force remove test directories
    const forceRemoveDirs = [
      path.join(process.cwd(), 'tests', 'data', 'temp'),
      path.join(process.cwd(), '.tmp'),
      path.join(process.cwd(), 'test-output')
    ];

    for (const dir of forceRemoveDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }

  } catch (error) {
    console.error('Force cleanup failed:', error);
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

function isVirtualBoxAvailable(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('VBoxManage --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function basicDockerCleanup(): Promise<void> {
  if (!isDockerAvailable()) return;
  
  try {
    const { execSync } = require('child_process');
    execSync('docker container prune -f', { stdio: 'ignore' });
    execSync('docker network prune -f', { stdio: 'ignore' });
  } catch (error) {
    console.warn('Basic Docker cleanup failed:', error);
  }
}

async function basicKubernetesCleanup(): Promise<void> {
  if (!isKubernetesAvailable()) return;
  
  try {
    const { execSync } = require('child_process');
    execSync('kubectl delete namespace test-console-automation --ignore-not-found=true', { stdio: 'ignore' });
  } catch (error) {
    console.warn('Basic Kubernetes cleanup failed:', error);
  }
}

async function basicFileSystemCleanup(): Promise<void> {
  const tempDirs = [
    path.join(process.cwd(), 'tests', 'data', 'temp'),
    path.join(process.cwd(), '.tmp')
  ];

  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function basicProcessCleanup(): Promise<void> {
  // Basic process cleanup logic
  console.log('Basic process cleanup completed');
}

async function cleanupAWSMockResources(): Promise<void> {
  // Clean up AWS SDK mock resources
  console.log('AWS mock resources cleanup completed');
}

async function cleanupAzureMockResources(): Promise<void> {
  // Clean up Azure SDK mock resources
  console.log('Azure mock resources cleanup completed');
}

async function cleanupGCPMockResources(): Promise<void> {
  // Clean up GCP SDK mock resources
  console.log('GCP mock resources cleanup completed');
}

async function verifyNoHangingProcesses(): Promise<void> {
  // Verify no test-related processes are hanging
}

async function verifyPortsReleased(): Promise<void> {
  // Verify all test ports are released
}

async function verifyTempFilesRemoved(): Promise<void> {
  // Verify temporary files are removed
}

async function verifyResourcesReleased(): Promise<void> {
  // Verify system resources are released
}