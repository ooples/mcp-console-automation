#!/usr/bin/env node

/**
 * Comprehensive Monitoring Examples for Console Automation MCP
 * 
 * This file demonstrates the complete monitoring and observability capabilities
 * including real-time metrics, alerting, anomaly detection, and performance profiling.
 */

import { ConsoleManager } from '../src/core/ConsoleManager.js';
import { Logger } from '../src/utils/logger.js';

const logger = new Logger('MonitoringExamples');
const consoleManager = new ConsoleManager();

async function basicMonitoringExample() {
  logger.info('=== Basic Monitoring Example ===');
  
  // Create a session with monitoring enabled
  const sessionId = await consoleManager.createSession({
    command: 'node',
    args: ['-e', 'console.log("Hello World"); setTimeout(() => console.log("Done"), 2000);'],
    monitoring: {
      enableMetrics: true,
      enableTracing: true,
      enableAuditing: true,
      customTags: {
        'environment': 'development',
        'application': 'example'
      }
    }
  });

  // Wait for the session to complete
  await new Promise(resolve => {
    const cleanup = () => {
      consoleManager.removeListener('console-event', handleEvent);
      resolve(void 0);
    };
    
    const handleEvent = (event: any) => {
      if (event.sessionId === sessionId && event.type === 'stopped') {
        cleanup();
      }
    };
    
    consoleManager.on('console-event', handleEvent);
    setTimeout(cleanup, 5000);
  });

  // Get session metrics
  const metrics = await consoleManager.getSessionMetrics(sessionId);
  logger.info('Session metrics:', JSON.stringify(metrics, null, 2));

  // Get system metrics
  const systemMetrics = await consoleManager.getSystemMetrics();
  logger.info('System metrics sample:', {
    cpu: systemMetrics?.cpu,
    memory: systemMetrics?.memory
  });
}

async function advancedMonitoringExample() {
  logger.info('=== Advanced Monitoring with SLA Example ===');

  // Create a session with comprehensive monitoring and SLA configuration
  const sessionId = await consoleManager.createSession({
    command: 'python3',
    args: ['-c', `
import time
import random
import sys

# Simulate a data processing pipeline
for i in range(10):
    processing_time = random.uniform(0.1, 0.5)
    time.sleep(processing_time)
    
    # Simulate occasional errors
    if random.random() < 0.1:
        print(f"ERROR: Processing failed at step {i}", file=sys.stderr)
        continue
    
    print(f"Processed item {i} in {processing_time:.2f}s")

print("Pipeline completed successfully")
    `],
    monitoring: {
      enableMetrics: true,
      enableTracing: true,
      enableProfiling: true,
      enableAuditing: true,
      enableAnomalyDetection: true,
      customTags: {
        'pipeline': 'data-processing',
        'version': '1.0.0'
      },
      slaConfig: {
        responseTime: 1000, // 1 second max response time
        availabilityThreshold: 95, // 95% availability
        errorRateThreshold: 5 // 5% max error rate
      }
    }
  });

  // Monitor the session in real-time
  const monitoringInterval = setInterval(async () => {
    try {
      const metrics = await consoleManager.getSessionMetrics(sessionId);
      const alerts = await consoleManager.getAlerts();
      
      if (metrics) {
        logger.info(`Session ${sessionId} metrics:`, {
          status: metrics.status,
          duration: metrics.duration,
          errorCount: metrics.errorCount
        });
      }
      
      if (alerts && alerts.length > 0) {
        logger.warn('Active alerts:', alerts.map(a => ({
          type: a.type,
          severity: a.severity,
          title: a.title
        })));
      }
    } catch (error) {
      logger.debug('Monitoring check failed:', error);
    }
  }, 1000);

  // Wait for completion
  await new Promise(resolve => {
    const cleanup = () => {
      clearInterval(monitoringInterval);
      consoleManager.removeListener('console-event', handleEvent);
      resolve(void 0);
    };
    
    const handleEvent = (event: any) => {
      if (event.sessionId === sessionId && event.type === 'stopped') {
        cleanup();
      }
    };
    
    consoleManager.on('console-event', handleEvent);
    setTimeout(cleanup, 15000);
  });

  // Final metrics and alerts
  const finalMetrics = await consoleManager.getSessionMetrics(sessionId);
  const finalAlerts = await consoleManager.getAlerts();
  
  logger.info('=== Final Results ===');
  logger.info('Session completed. Final metrics:', JSON.stringify(finalMetrics, null, 2));
  logger.info('Final alerts:', JSON.stringify(finalAlerts, null, 2));
}

async function multiSessionMonitoringExample() {
  logger.info('=== Multi-Session Monitoring Example ===');

  const sessions: string[] = [];
  
  // Create multiple sessions with different workloads
  const workloads = [
    {
      name: 'CPU Intensive',
      command: 'node',
      args: ['-e', `
        const start = Date.now();
        let result = 0;
        while (Date.now() - start < 3000) {
          result += Math.random();
        }
        console.log('CPU work completed:', result);
      `]
    },
    {
      name: 'Memory Intensive',
      command: 'node',
      args: ['-e', `
        const arrays = [];
        for (let i = 0; i < 100; i++) {
          arrays.push(new Array(10000).fill(Math.random()));
          if (i % 20 === 0) console.log('Memory allocated:', i);
        }
        console.log('Memory work completed');
      `]
    },
    {
      name: 'I/O Intensive',
      command: 'node',
      args: ['-e', `
        const fs = require('fs');
        const path = require('path');
        
        for (let i = 0; i < 10; i++) {
          const filename = path.join(process.cwd(), \`temp_\${i}.txt\`);
          fs.writeFileSync(filename, 'test data '.repeat(1000));
          const data = fs.readFileSync(filename, 'utf8');
          fs.unlinkSync(filename);
          console.log('I/O operation', i, 'completed');
        }
      `]
    }
  ];

  // Start all sessions
  for (const workload of workloads) {
    const sessionId = await consoleManager.createSession({
      command: workload.command,
      args: workload.args,
      monitoring: {
        enableMetrics: true,
        enableProfiling: true,
        enableAnomalyDetection: true,
        customTags: {
          'workload': workload.name.toLowerCase().replace(' ', '-'),
          'category': 'performance-test'
        }
      }
    });
    sessions.push(sessionId);
    logger.info(`Started ${workload.name} session: ${sessionId}`);
  }

  // Monitor all sessions
  const monitoringInterval = setInterval(async () => {
    try {
      const systemMetrics = await consoleManager.getSystemMetrics();
      const dashboard = await consoleManager.getDashboard();
      
      if (systemMetrics) {
        logger.info('System load:', {
          cpuUsage: systemMetrics.cpu?.usage,
          memoryUsage: systemMetrics.memory?.percentage,
          activeSessions: sessions.filter(id => consoleManager.isSessionRunning(id)).length
        });
      }
      
      if (dashboard) {
        logger.info('Dashboard summary:', {
          totalSessions: dashboard.totalSessions,
          activeAlerts: dashboard.alerts?.filter(a => !a.resolved).length || 0
        });
      }
    } catch (error) {
      logger.debug('Dashboard check failed:', error);
    }
  }, 2000);

  // Wait for all sessions to complete
  await new Promise(resolve => {
    let completedCount = 0;
    const cleanup = () => {
      clearInterval(monitoringInterval);
      consoleManager.removeListener('console-event', handleEvent);
      resolve(void 0);
    };
    
    const handleEvent = (event: any) => {
      if (sessions.includes(event.sessionId) && event.type === 'stopped') {
        completedCount++;
        logger.info(`Session completed: ${event.sessionId} (${completedCount}/${sessions.length})`);
        
        if (completedCount === sessions.length) {
          cleanup();
        }
      }
    };
    
    consoleManager.on('console-event', handleEvent);
    setTimeout(cleanup, 30000); // Timeout after 30 seconds
  });

  logger.info('=== All Sessions Completed ===');
  
  // Get final system state
  const finalSystemMetrics = await consoleManager.getSystemMetrics();
  const finalAlerts = await consoleManager.getAlerts();
  
  logger.info('Final system metrics:', {
    cpu: finalSystemMetrics?.cpu,
    memory: finalSystemMetrics?.memory
  });
  
  logger.info('Final alerts:', finalAlerts?.map(a => ({
    type: a.type,
    severity: a.severity,
    title: a.title,
    resolved: a.resolved
  })));
}

async function alertingAndAnomalyExample() {
  logger.info('=== Alerting and Anomaly Detection Example ===');

  // Create a session that will generate various patterns and anomalies
  const sessionId = await consoleManager.createSession({
    command: 'node',
    args: ['-e', `
      // Simulate a service with varying load patterns
      let requestCount = 0;
      let errorCount = 0;
      
      const patterns = [
        { name: 'normal', duration: 5000, errorRate: 0.02, responseTime: 100 },
        { name: 'spike', duration: 2000, errorRate: 0.15, responseTime: 500 },
        { name: 'degraded', duration: 3000, errorRate: 0.08, responseTime: 300 }
      ];
      
      async function simulatePattern(pattern) {
        console.log(\`Starting \${pattern.name} pattern\`);
        const startTime = Date.now();
        
        while (Date.now() - startTime < pattern.duration) {
          requestCount++;
          
          // Simulate response time
          await new Promise(resolve => setTimeout(resolve, pattern.responseTime * Math.random()));
          
          // Simulate errors
          if (Math.random() < pattern.errorRate) {
            errorCount++;
            console.error(\`ERROR: Request \${requestCount} failed\`);
          } else {
            console.log(\`Request \${requestCount} completed successfully\`);
          }
          
          // Report metrics every 10 requests
          if (requestCount % 10 === 0) {
            const errorRate = (errorCount / requestCount * 100).toFixed(2);
            console.log(\`METRICS: Total=\${requestCount}, Errors=\${errorCount}, ErrorRate=\${errorRate}%\`);
          }
        }
      }
      
      async function main() {
        for (const pattern of patterns) {
          await simulatePattern(pattern);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Rest between patterns
        }
        console.log('Simulation completed');
      }
      
      main().catch(console.error);
    `],
    monitoring: {
      enableMetrics: true,
      enableTracing: true,
      enableAnomalyDetection: true,
      enableAuditing: true,
      customTags: {
        'service': 'web-api',
        'simulation': 'load-test'
      },
      slaConfig: {
        responseTime: 200,
        availabilityThreshold: 98,
        errorRateThreshold: 5
      }
    }
  });

  // Monitor for alerts and anomalies
  const alertMonitor = setInterval(async () => {
    try {
      const alerts = await consoleManager.getAlerts();
      const metrics = await consoleManager.getSessionMetrics(sessionId);
      
      // Check for new alerts
      const criticalAlerts = alerts?.filter(a => !a.resolved && a.severity === 'critical');
      if (criticalAlerts && criticalAlerts.length > 0) {
        logger.warn('🚨 CRITICAL ALERTS DETECTED:', criticalAlerts.map(a => a.title));
      }
      
      // Check for anomalies
      const highSeverityAlerts = alerts?.filter(a => !a.resolved && ['high', 'critical'].includes(a.severity));
      if (highSeverityAlerts && highSeverityAlerts.length > 0) {
        logger.warn('⚠️  High severity alerts:', highSeverityAlerts.length);
      }
      
      // Log current session status
      if (metrics && consoleManager.isSessionRunning(sessionId)) {
        logger.info('📊 Session status:', {
          sessionId: sessionId.substring(0, 8),
          duration: metrics.duration,
          status: metrics.status
        });
      }
    } catch (error) {
      logger.debug('Alert monitoring failed:', error);
    }
  }, 1500);

  // Wait for completion
  await new Promise(resolve => {
    const cleanup = () => {
      clearInterval(alertMonitor);
      consoleManager.removeListener('console-event', handleEvent);
      resolve(void 0);
    };
    
    const handleEvent = (event: any) => {
      if (event.sessionId === sessionId) {
        if (event.type === 'error') {
          logger.warn('Session error detected:', event.data);
        } else if (event.type === 'stopped') {
          cleanup();
        }
      }
    };
    
    consoleManager.on('console-event', handleEvent);
    setTimeout(cleanup, 20000);
  });

  // Final analysis
  const finalAlerts = await consoleManager.getAlerts();
  const finalMetrics = await consoleManager.getSessionMetrics(sessionId);
  
  logger.info('=== Alerting Analysis Complete ===');
  logger.info('Total alerts generated:', finalAlerts?.length || 0);
  logger.info('Alert breakdown:', finalAlerts?.reduce((acc: any, alert) => {
    acc[alert.severity] = (acc[alert.severity] || 0) + 1;
    return acc;
  }, {}));
  logger.info('Session final metrics:', JSON.stringify(finalMetrics, null, 2));
}

async function runAllExamples() {
  try {
    logger.info('🚀 Starting Comprehensive Monitoring Examples');
    logger.info('============================================');

    await basicMonitoringExample();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await advancedMonitoringExample();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await multiSessionMonitoringExample();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await alertingAndAnomalyExample();

    logger.info('✅ All monitoring examples completed successfully');
  } catch (error) {
    logger.error('❌ Example execution failed:', error);
  } finally {
    await consoleManager.destroy();
    process.exit(0);
  }
}

// Real-world scenario examples
export const scenarios = {
  productionSystemMonitoring: async () => {
    logger.info('=== Production System Monitoring Scenario ===');
    // Simulate monitoring a production deployment
    const sessionId = await consoleManager.createSession({
      command: 'docker',
      args: ['stats', '--format', 'table {{.Container}}\\t{{.CPUPerc}}\\t{{.MemUsage}}'],
      monitoring: {
        enableMetrics: true,
        enableTracing: true,
        enableAuditing: true,
        enableAnomalyDetection: true,
        customTags: {
          'environment': 'production',
          'service': 'container-monitor'
        },
        slaConfig: {
          responseTime: 500,
          availabilityThreshold: 99.9,
          errorRateThreshold: 0.1
        }
      }
    });
    return sessionId;
  },

  cicdPipelineObservability: async () => {
    logger.info('=== CI/CD Pipeline Observability Scenario ===');
    // Simulate monitoring a build pipeline
    const sessionId = await consoleManager.createSession({
      command: 'npm',
      args: ['run', 'build'],
      monitoring: {
        enableMetrics: true,
        enableTracing: true,
        enableProfiling: true,
        enableAuditing: true,
        customTags: {
          'pipeline': 'build',
          'branch': 'main',
          'commit': 'abc123'
        }
      }
    });
    return sessionId;
  },

  securityEventMonitoring: async () => {
    logger.info('=== Security Event Monitoring Scenario ===');
    // Simulate security monitoring
    const sessionId = await consoleManager.createSession({
      command: 'tail',
      args: ['-f', '/var/log/auth.log'],
      monitoring: {
        enableMetrics: true,
        enableAuditing: true,
        enableAnomalyDetection: true,
        customTags: {
          'component': 'security-monitor',
          'log-type': 'authentication'
        }
      }
    });
    return sessionId;
  }
};

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

export { runAllExamples };