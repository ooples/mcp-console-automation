#!/usr/bin/env node
/**
 * Self-Healing Infrastructure Example
 * 
 * This example demonstrates how the AI-enhanced console automation can be used
 * to create self-healing infrastructure that automatically detects and resolves
 * common system issues.
 */

import { AIEnhancedConsoleServer } from '../src/ai/AIEnhancedServer.js';

class SelfHealingInfrastructure {
  private server: AIEnhancedConsoleServer;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Initialize with specific AI configuration for infrastructure monitoring
    this.server = new AIEnhancedConsoleServer({
      enableNLP: true,
      enableErrorRecovery: true,
      enableAnomalyDetection: true,
      enableLearning: true,
      enableResourceOptimization: true,
      enableContextAwareness: true,
      maxContextHistory: 200,
      learningDataPath: './data/infrastructure-ai'
    });
  }

  async start() {
    await this.server.start();
    console.log('🏥 Self-Healing Infrastructure System Started');
    
    // Start continuous monitoring
    this.startMonitoring();
  }

  private startMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 30000); // Check every 30 seconds
  }

  private async performHealthChecks() {
    const healthChecks = [
      'Check disk space',
      'Check memory usage', 
      'Check CPU usage',
      'Check running services',
      'Check network connectivity',
      'Check log errors'
    ];

    console.log('🔍 Performing automated health checks...');

    for (const check of healthChecks) {
      try {
        // Use natural language processing to convert check to commands
        const result = await this.executeHealthCheck(check);
        
        if (!result.success) {
          console.log(`⚠️  Health check failed: ${check}`);
          await this.attemptSelfHealing(check, result.error);
        } else {
          console.log(`✅ Health check passed: ${check}`);
        }
      } catch (error) {
        console.error(`❌ Health check error for "${check}": ${error}`);
      }
    }
  }

  private async executeHealthCheck(naturalLanguageCheck: string): Promise<{ success: boolean; error?: string }> {
    try {
      // This would use the AI-enhanced server's natural language processing
      // For demonstration, we'll simulate the checks
      
      switch (naturalLanguageCheck.toLowerCase()) {
        case 'check disk space':
          return await this.checkDiskSpace();
        
        case 'check memory usage':
          return await this.checkMemoryUsage();
          
        case 'check cpu usage':
          return await this.checkCPUUsage();
          
        case 'check running services':
          return await this.checkServices();
          
        case 'check network connectivity':
          return await this.checkNetworkConnectivity();
          
        case 'check log errors':
          return await this.checkLogErrors();
          
        default:
          return { success: true };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async checkDiskSpace(): Promise<{ success: boolean; error?: string }> {
    // Simulate disk space check
    const usage = Math.random() * 100;
    if (usage > 90) {
      return { 
        success: false, 
        error: `Disk usage critically high: ${usage.toFixed(1)}%` 
      };
    }
    return { success: true };
  }

  private async checkMemoryUsage(): Promise<{ success: boolean; error?: string }> {
    // Simulate memory check
    const memoryUsage = process.memoryUsage();
    const usagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    if (usagePercent > 85) {
      return { 
        success: false, 
        error: `Memory usage high: ${usagePercent.toFixed(1)}%` 
      };
    }
    return { success: true };
  }

  private async checkCPUUsage(): Promise<{ success: boolean; error?: string }> {
    // Simulate CPU check
    const cpuUsage = Math.random() * 100;
    if (cpuUsage > 80) {
      return { 
        success: false, 
        error: `CPU usage high: ${cpuUsage.toFixed(1)}%` 
      };
    }
    return { success: true };
  }

  private async checkServices(): Promise<{ success: boolean; error?: string }> {
    // Simulate service check
    const criticalServices = ['nginx', 'docker', 'ssh'];
    const failedService = Math.random() < 0.1 ? criticalServices[0] : null;
    
    if (failedService) {
      return { 
        success: false, 
        error: `Critical service down: ${failedService}` 
      };
    }
    return { success: true };
  }

  private async checkNetworkConnectivity(): Promise<{ success: boolean; error?: string }> {
    // Simulate network check
    const isConnected = Math.random() > 0.05; // 95% success rate
    
    if (!isConnected) {
      return { 
        success: false, 
        error: 'Network connectivity issues detected' 
      };
    }
    return { success: true };
  }

  private async checkLogErrors(): Promise<{ success: boolean; error?: string }> {
    // Simulate log error check
    const errorCount = Math.floor(Math.random() * 20);
    
    if (errorCount > 10) {
      return { 
        success: false, 
        error: `High error count in logs: ${errorCount} errors in last 5 minutes` 
      };
    }
    return { success: true };
  }

  private async attemptSelfHealing(failedCheck: string, error: string) {
    console.log(`🔧 Attempting self-healing for: ${failedCheck}`);
    console.log(`📝 Error details: ${error}`);

    // Use AI to determine healing actions
    const healingActions = await this.getHealingActions(failedCheck, error);
    
    for (const action of healingActions) {
      console.log(`⚡ Executing healing action: ${action.description}`);
      
      try {
        const result = await this.executeHealingAction(action);
        
        if (result.success) {
          console.log(`✅ Healing action successful: ${action.description}`);
          
          // Learn from successful healing
          await this.recordHealingSuccess(failedCheck, action);
          break; // Stop trying other actions if one succeeds
        } else {
          console.log(`❌ Healing action failed: ${action.description} - ${result.error}`);
        }
      } catch (error) {
        console.error(`💥 Healing action exception: ${error}`);
      }
    }
  }

  private async getHealingActions(failedCheck: string, error: string): Promise<HealingAction[]> {
    // This would use the AI system to determine appropriate healing actions
    // For demonstration, we'll provide predefined actions
    
    const actions: HealingAction[] = [];
    
    switch (failedCheck.toLowerCase()) {
      case 'check disk space':
        actions.push(
          {
            description: 'Clean temporary files',
            command: 'find /tmp -type f -atime +7 -delete',
            priority: 'high',
            riskLevel: 'low'
          },
          {
            description: 'Clear old log files',
            command: 'find /var/log -name "*.log" -mtime +30 -delete',
            priority: 'medium',
            riskLevel: 'medium'
          },
          {
            description: 'Clean package cache',
            command: 'apt-get clean',
            priority: 'low',
            riskLevel: 'low'
          }
        );
        break;
        
      case 'check memory usage':
        actions.push(
          {
            description: 'Restart memory-intensive processes',
            command: 'systemctl restart high-memory-service',
            priority: 'high',
            riskLevel: 'medium'
          },
          {
            description: 'Clear system caches',
            command: 'sync && echo 3 > /proc/sys/vm/drop_caches',
            priority: 'medium',
            riskLevel: 'low'
          }
        );
        break;
        
      case 'check running services':
        if (error.includes('nginx')) {
          actions.push({
            description: 'Restart nginx service',
            command: 'systemctl restart nginx',
            priority: 'critical',
            riskLevel: 'low'
          });
        }
        if (error.includes('docker')) {
          actions.push({
            description: 'Restart docker service',
            command: 'systemctl restart docker',
            priority: 'critical',
            riskLevel: 'medium'
          });
        }
        break;
        
      case 'check network connectivity':
        actions.push(
          {
            description: 'Restart network interface',
            command: 'systemctl restart networking',
            priority: 'high',
            riskLevel: 'high'
          },
          {
            description: 'Flush DNS cache',
            command: 'systemctl restart systemd-resolved',
            priority: 'medium',
            riskLevel: 'low'
          }
        );
        break;
        
      default:
        actions.push({
          description: 'Generic system health check',
          command: 'systemctl --failed',
          priority: 'low',
          riskLevel: 'low'
        });
    }
    
    return actions.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
    });
  }

  private async executeHealingAction(action: HealingAction): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔨 Executing: ${action.command}`);
      
      // In a real implementation, this would use the AI-enhanced console server
      // For demonstration, we'll simulate execution
      
      // Simulate execution time
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      // Simulate success/failure based on risk level
      const successRate = action.riskLevel === 'low' ? 0.9 : 
                         action.riskLevel === 'medium' ? 0.7 : 0.5;
      
      if (Math.random() < successRate) {
        return { success: true };
      } else {
        return { success: false, error: 'Simulated execution failure' };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async recordHealingSuccess(failedCheck: string, action: HealingAction) {
    // This would feed data back to the AI learning system
    console.log(`📚 Recording successful healing: ${failedCheck} -> ${action.description}`);
    
    // In the actual implementation, this would call:
    // await this.server.enhancedConsoleManager.aiCore.learnFromExecution(...)
  }

  async stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    console.log('🛑 Self-Healing Infrastructure System Stopped');
  }
}

interface HealingAction {
  description: string;
  command: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  riskLevel: 'low' | 'medium' | 'high';
}

// Example usage
async function main() {
  const infrastructure = new SelfHealingInfrastructure();
  
  try {
    await infrastructure.start();
    
    // Run for demonstration
    console.log('Running self-healing infrastructure for 2 minutes...');
    await new Promise(resolve => setTimeout(resolve, 120000));
    
  } catch (error) {
    console.error('Infrastructure error:', error);
  } finally {
    await infrastructure.stop();
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { SelfHealingInfrastructure };