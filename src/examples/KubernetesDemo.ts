import { ConsoleManager } from '../core/ConsoleManager.js';
import { KubernetesConnectionOptions } from '../types/index.js';

/**
 * Kubernetes functionality demonstration
 * 
 * This example shows how to:
 * 1. Create Kubernetes exec sessions for pod access
 * 2. Stream logs from pods
 * 3. Set up port forwarding
 * 4. Handle multiple Kubernetes contexts
 * 5. Monitor Kubernetes session health
 */
export class KubernetesDemo {
  private consoleManager: ConsoleManager;

  constructor() {
    this.consoleManager = new ConsoleManager({
      connectionPooling: {
        maxConnectionsPerHost: 10,
        connectionIdleTimeout: 300000,
        keepAliveInterval: 30000,
        enableHealthChecks: true
      },
      sessionManager: {
        maxSessions: 10,
        sessionTimeout: 300000,
        cleanupInterval: 60000,
        persistenceEnabled: false,
        enableMetrics: true,
        enableLogging: true,
        heartbeatInterval: 30000,
        recoveryOptions: {
          enableAutoRecovery: true,
          maxRecoveryAttempts: 3,
          recoveryDelay: 5000,
          backoffMultiplier: 2,
          persistSessionData: false,
          healthCheckInterval: 30000
        }
      }
    });
  }

  /**
   * Demonstrate basic kubectl exec functionality
   */
  async demonstrateKubectlExec(): Promise<void> {
    console.log('=== Kubernetes Exec Session Demo ===');

    try {
      // Configure Kubernetes connection
      const kubernetesOptions: KubernetesConnectionOptions = {
        // Use default kubeconfig from ~/.kube/config
        context: 'minikube', // or your cluster context
        namespace: 'default'
      };

      // Create exec session to a specific pod
      const sessionId = await this.consoleManager.createSession({
        command: 'kubectl',
        args: ['exec', '-it', 'my-pod', '--', '/bin/bash'],
        consoleType: 'k8s-exec',
        kubernetesOptions,
        streaming: true
      });

      console.log(`Created Kubernetes exec session: ${sessionId}`);

      // Set up event listeners
      this.consoleManager.on('output', (output) => {
        if (output.sessionId === sessionId) {
          console.log(`Pod Output: ${output.data}`);
        }
      });

      this.consoleManager.on('session-error', (error) => {
        if (error.sessionId === sessionId) {
          console.error(`Pod Error: ${error.error}`);
        }
      });

      // Send commands to the pod
      await this.consoleManager.sendInput(sessionId, 'ls -la\n');
      await this.consoleManager.sendInput(sessionId, 'ps aux\n');
      await this.consoleManager.sendInput(sessionId, 'echo "Hello from Kubernetes pod!"\n');

      // Wait a bit for commands to complete
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Get session output
      const output = this.consoleManager.getOutput(sessionId);
      console.log('\n=== Session Output ===');
      if (output && output.length > 0) {
        output.forEach(line => console.log(line.data));
      } else {
        console.log('No output captured');
      }

      // Clean up
      await this.consoleManager.stopSession(sessionId);
      console.log('Kubernetes exec session completed');

    } catch (error) {
      console.error('Kubernetes exec demo failed:', error);
    }
  }

  /**
   * Demonstrate pod selection by deployment
   */
  async demonstratePodSelection(): Promise<void> {
    console.log('\n=== Pod Selection Demo ===');

    try {
      const kubernetesOptions: KubernetesConnectionOptions = {
        context: 'minikube',
        namespace: 'default'
      };

      // Create session using deployment selector
      const sessionId = await this.consoleManager.createSession({
        command: 'kubectl',
        args: ['exec', '-it', '--deployment=nginx-deployment', '--', '/bin/bash'],
        consoleType: 'k8s-exec',
        kubernetesOptions,
        streaming: true
      });

      console.log(`Created session for nginx deployment: ${sessionId}`);

      // Send some commands
      await this.consoleManager.sendInput(sessionId, 'nginx -v\n');
      await this.consoleManager.sendInput(sessionId, 'cat /etc/nginx/nginx.conf | head -20\n');

      await new Promise(resolve => setTimeout(resolve, 3000));
      await this.consoleManager.stopSession(sessionId);

    } catch (error) {
      console.error('Pod selection demo failed:', error);
    }
  }

  /**
   * Demonstrate log streaming from multiple pods
   */
  async demonstrateLogStreaming(): Promise<void> {
    console.log('\n=== Log Streaming Demo ===');

    try {
      const kubernetesOptions: KubernetesConnectionOptions = {
        context: 'minikube',
        namespace: 'default'
      };

      // Stream logs from all pods with app=nginx label
      const logSessionId = await this.consoleManager.createSession({
        command: 'kubectl',
        args: ['logs', '-f', '-l', 'app=nginx', '--tail=50'],
        consoleType: 'kubectl',
        kubernetesOptions,
        streaming: true
      });

      console.log(`Started log streaming session: ${logSessionId}`);

      // Set up log event handler
      this.consoleManager.on('output', (output) => {
        if (output.sessionId === logSessionId) {
          console.log(`[LOGS] ${output.data}`);
        }
      });

      // Let logs stream for a while
      console.log('Streaming logs for 10 seconds...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      await this.consoleManager.stopSession(logSessionId);
      console.log('Log streaming completed');

    } catch (error) {
      console.error('Log streaming demo failed:', error);
    }
  }

  /**
   * Demonstrate port forwarding
   */
  async demonstratePortForwarding(): Promise<void> {
    console.log('\n=== Port Forwarding Demo ===');

    try {
      const kubernetesOptions: KubernetesConnectionOptions = {
        context: 'minikube',
        namespace: 'default'
      };

      // Set up port forwarding from local port 8080 to pod port 80
      const portForwardId = await this.consoleManager.createSession({
        command: 'kubectl',
        args: ['port-forward', 'pod/nginx-pod', '8080:80'],
        consoleType: 'kubectl',
        kubernetesOptions
      });

      console.log(`Started port forwarding: localhost:8080 -> nginx-pod:80`);
      console.log(`Session ID: ${portForwardId}`);

      // Port forward will remain active
      console.log('Port forwarding active for 15 seconds...');
      console.log('You can test it with: curl http://localhost:8080');
      
      await new Promise(resolve => setTimeout(resolve, 15000));

      await this.consoleManager.stopSession(portForwardId);
      console.log('Port forwarding stopped');

    } catch (error) {
      console.error('Port forwarding demo failed:', error);
    }
  }

  /**
   * Demonstrate multi-context operations
   */
  async demonstrateMultiContext(): Promise<void> {
    console.log('\n=== Multi-Context Demo ===');

    try {
      // Create sessions in different contexts
      const contexts = ['minikube', 'docker-desktop', 'kind-cluster'];
      const sessionIds: string[] = [];

      for (const context of contexts) {
        try {
          const kubernetesOptions: KubernetesConnectionOptions = {
            context: context,
            namespace: 'kube-system'
          };

          const sessionId = await this.consoleManager.createSession({
            command: 'kubectl',
            args: ['get', 'pods', '--no-headers'],
            consoleType: 'kubectl',
            kubernetesOptions
          });

          sessionIds.push(sessionId);
          console.log(`Created session for context '${context}': ${sessionId}`);
        } catch (error) {
          console.warn(`Failed to create session for context '${context}':`, error instanceof Error ? error.message : String(error));
        }
      }

      // Wait for all commands to complete
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Show results from each context
      for (const sessionId of sessionIds) {
        const output = this.consoleManager.getOutput(sessionId);
        const session = this.consoleManager.getSession(sessionId);
        console.log(`\nResults from context '${session?.kubernetesOptions?.context || 'unknown'}':`);
        if (output && output.length > 0) {
          output.forEach(line => console.log(`  ${line.data}`));
        } else {
          console.log('  No output captured');
        }
        await this.consoleManager.stopSession(sessionId);
      }

    } catch (error) {
      console.error('Multi-context demo failed:', error);
    }
  }

  /**
   * Demonstrate health monitoring
   */
  async demonstrateHealthMonitoring(): Promise<void> {
    console.log('\n=== Health Monitoring Demo ===');

    try {
      const kubernetesOptions: KubernetesConnectionOptions = {
        context: 'minikube',
        namespace: 'default'
      };

      // Create a session with health monitoring enabled
      const sessionId = await this.consoleManager.createSession({
        command: 'kubectl',
        args: ['exec', '-it', 'my-pod', '--', 'tail', '-f', '/dev/null'],
        consoleType: 'k8s-exec',
        kubernetesOptions,
        streaming: true,
        monitoring: {
          enableMetrics: true,
          enableAuditing: true
        }
      });

      console.log(`Created monitored session: ${sessionId}`);

      // Get health status
      const healthStatus = await this.consoleManager.getHealthStatus();
      console.log('\n=== System Health Status ===');
      console.log(`Active Sessions: ${healthStatus.sessionHealth.size}`);
      console.log(`Connection Health: ${healthStatus.connectionHealth.size} connections`);

      // Show Kubernetes-specific health
      const k8sHealth = healthStatus.connectionHealth.get('kubernetes');
      if (k8sHealth) {
        console.log('\n=== Kubernetes Health ===');
        console.log(`Status: ${k8sHealth.status}`);
        console.log(`Overall Score: ${k8sHealth.overallScore}`);
        console.log(`Context: ${k8sHealth.context.context}/${k8sHealth.context.namespace}`);
        console.log(`Active Sessions: ${k8sHealth.activeSessions}`);
        console.log('Health Checks:');
        for (const [check, result] of Object.entries(k8sHealth.checks)) {
          const resultObj = result as any;
          console.log(`  ${check}: ${resultObj.checkStatus || 'unknown'} - ${resultObj.message || resultObj.value || 'OK'}`);
        }
      }

      // Monitor session for a while
      console.log('\nMonitoring session health for 10 seconds...');
      const healthCheckInterval = setInterval(async () => {
        try {
          const currentHealth = await this.consoleManager.getHealthStatus();
          const sessionHealth = currentHealth.sessionHealth.get(sessionId);
          if (sessionHealth) {
            console.log(`Session ${sessionId} health score: ${sessionHealth.healthScore || 'N/A'}`);
          }
        } catch (error) {
          console.warn('Health check failed:', error instanceof Error ? error.message : String(error));
        }
      }, 2000);

      await new Promise(resolve => setTimeout(resolve, 10000));
      clearInterval(healthCheckInterval);

      await this.consoleManager.stopSession(sessionId);
      console.log('Health monitoring demo completed');

    } catch (error) {
      console.error('Health monitoring demo failed:', error);
    }
  }

  /**
   * Run all demonstrations
   */
  async runAllDemos(): Promise<void> {
    console.log('Starting Kubernetes Console Automation Demos\n');
    
    try {
      await this.demonstrateKubectlExec();
      await this.demonstratePodSelection();
      await this.demonstrateLogStreaming();
      await this.demonstratePortForwarding();
      await this.demonstrateMultiContext();
      await this.demonstrateHealthMonitoring();
      
      console.log('\nAll Kubernetes demos completed successfully!');
    } catch (error) {
      console.error('Demo suite failed:', error);
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    try {
      // Stop all active sessions
      const sessions = this.consoleManager.getAllSessions();
      for (const session of sessions) {
        await this.consoleManager.stopSession(session.id);
      }
      console.log('Cleanup completed');
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }
}

// Export for usage as module
export default KubernetesDemo;

// If run directly, execute all demos
if (require.main === module || (typeof __filename !== 'undefined' && process.argv[1] === __filename)) {
  const demo = new KubernetesDemo();
  
  // Handle cleanup on exit
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down demos...');
    await demo.cleanup();
    process.exit(0);
  });

  // Run demos
  demo.runAllDemos().then(() => {
    console.log('\nDemos completed. Press Ctrl+C to exit.');
  }).catch((error) => {
    console.error('Demo execution failed:', error);
    process.exit(1);
  });
}