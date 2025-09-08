import { AIConfig } from './AICore.js';
import { ConsoleSession } from '../types/index.js';
import { Logger } from '../utils/logger.js';

interface ResourceMetrics {
  cpu: number;
  memory: number;
  sessions: number;
  activeProcesses: number;
  diskIO: number;
  networkIO: number;
  timestamp: Date;
}

interface OptimizationRecommendation {
  type: 'kill_session' | 'reduce_concurrency' | 'cleanup_resources' | 'adjust_limits' | 'scale_resources';
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  expectedImpact: string;
  confidence: number;
  actions: Array<{
    action: string;
    parameters: Record<string, any>;
    risklevel: 'low' | 'medium' | 'high';
  }>;
}

interface ResourceThresholds {
  memory: { warning: number; critical: number };
  cpu: { warning: number; critical: number };
  sessions: { warning: number; critical: number };
  diskIO: { warning: number; critical: number };
}

export class ResourceOptimizer {
  private logger: Logger;
  private config: AIConfig;
  private resourceHistory: ResourceMetrics[] = [];
  private thresholds: ResourceThresholds;
  private optimizationHistory: Array<{
    recommendation: OptimizationRecommendation;
    applied: boolean;
    result: 'success' | 'failed' | 'partial';
    timestamp: Date;
  }> = [];

  constructor(config: AIConfig) {
    this.config = config;
    this.logger = new Logger('ResourceOptimizer');
    
    // Default thresholds (can be configured)
    this.thresholds = {
      memory: { warning: 1024 * 1024 * 1024, critical: 2 * 1024 * 1024 * 1024 }, // 1GB, 2GB
      cpu: { warning: 70, critical: 90 }, // Percentage
      sessions: { warning: 20, critical: 40 },
      diskIO: { warning: 100 * 1024 * 1024, critical: 500 * 1024 * 1024 } // 100MB/s, 500MB/s
    };

    this.startResourceMonitoring();
  }

  private startResourceMonitoring(): void {
    // Monitor resources every 30 seconds
    setInterval(async () => {
      const metrics = await this.collectResourceMetrics();
      this.resourceHistory.push(metrics);
      
      // Keep only last hour of data
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      this.resourceHistory = this.resourceHistory.filter(m => m.timestamp.getTime() > oneHourAgo);
      
      // Check for immediate optimization needs
      await this.checkForImmediateOptimization(metrics);
    }, 30000);
  }

  private async collectResourceMetrics(): Promise<ResourceMetrics> {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      // Estimate CPU percentage (this is approximate)
      const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000) / (process.uptime() || 1) * 100;
      
      return {
        cpu: Math.min(cpuPercent, 100),
        memory: memUsage.heapUsed,
        sessions: 0, // Will be set by calling code
        activeProcesses: 0, // Will be set by calling code
        diskIO: 0, // Placeholder - would need platform-specific implementation
        networkIO: 0, // Placeholder - would need platform-specific implementation
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error(`Error collecting resource metrics: ${error}`);
      return {
        cpu: 0,
        memory: 0,
        sessions: 0,
        activeProcesses: 0,
        diskIO: 0,
        networkIO: 0,
        timestamp: new Date()
      };
    }
  }

  async analyze(sessions: ConsoleSession[], currentUsage: any): Promise<OptimizationRecommendation | null> {
    // Update current metrics with session data
    const currentMetrics = await this.collectResourceMetrics();
    currentMetrics.sessions = sessions.length;
    currentMetrics.activeProcesses = sessions.filter(s => s.status === 'running').length;
    
    const recommendations: OptimizationRecommendation[] = [];

    // Memory optimization
    if (currentMetrics.memory > this.thresholds.memory.warning) {
      const memoryRec = this.analyzeMemoryUsage(sessions, currentMetrics);
      if (memoryRec) recommendations.push(memoryRec);
    }

    // Session optimization
    if (currentMetrics.sessions > this.thresholds.sessions.warning) {
      const sessionRec = this.analyzeSessionUsage(sessions, currentMetrics);
      if (sessionRec) recommendations.push(sessionRec);
    }

    // CPU optimization
    if (currentMetrics.cpu > this.thresholds.cpu.warning) {
      const cpuRec = this.analyzeCPUUsage(sessions, currentMetrics);
      if (cpuRec) recommendations.push(cpuRec);
    }

    // Performance trend analysis
    const trendRec = this.analyzePerformanceTrends(currentMetrics);
    if (trendRec) recommendations.push(trendRec);

    // Resource leak detection
    const leakRec = this.detectResourceLeaks(currentMetrics);
    if (leakRec) recommendations.push(leakRec);

    if (recommendations.length === 0) return null;

    // Return highest priority recommendation
    recommendations.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    return recommendations[0];
  }

  private analyzeMemoryUsage(sessions: ConsoleSession[], metrics: ResourceMetrics): OptimizationRecommendation | null {
    const memoryMB = metrics.memory / (1024 * 1024);
    const severity = metrics.memory > this.thresholds.memory.critical ? 'critical' : 'high';

    // Find sessions that might be consuming excessive memory
    const oldSessions = sessions.filter(s => {
      const ageHours = (Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60);
      return ageHours > 2 && s.status !== 'running'; // Stopped sessions older than 2 hours
    });

    const actions = [];
    
    if (oldSessions.length > 0) {
      actions.push({
        action: 'cleanup_old_sessions',
        parameters: { sessionIds: oldSessions.map(s => s.id), maxAge: 2 },
        risklevel: 'low' as const
      });
    }

    // Add memory cleanup action
    actions.push({
      action: 'force_garbage_collection',
      parameters: {},
      risklevel: 'low' as const
    });

    if (severity === 'critical') {
      actions.push({
        action: 'kill_inactive_sessions',
        parameters: { 
          priority: 'memory_usage',
          maxSessions: Math.floor(sessions.length * 0.7)
        },
        risklevel: 'medium' as const
      });
    }

    return {
      type: 'cleanup_resources',
      priority: severity,
      description: `High memory usage detected (${memoryMB.toFixed(1)}MB). ${oldSessions.length} old sessions found.`,
      expectedImpact: `Could free up to ${(oldSessions.length * 10).toFixed(1)}MB of memory`,
      confidence: 0.8,
      actions
    };
  }

  private analyzeSessionUsage(sessions: ConsoleSession[], metrics: ResourceMetrics): OptimizationRecommendation | null {
    const runningSessions = sessions.filter(s => s.status === 'running');
    const stoppedSessions = sessions.filter(s => s.status !== 'running');
    
    const severity = metrics.sessions > this.thresholds.sessions.critical ? 'critical' : 'medium';
    
    // Find sessions to clean up
    const oldStoppedSessions = stoppedSessions.filter(s => {
      const ageHours = (Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60);
      return ageHours > 1; // Stopped sessions older than 1 hour
    });

    const longRunningSessions = runningSessions.filter(s => {
      const ageHours = (Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60);
      return ageHours > 6; // Running for more than 6 hours
    });

    const actions = [];

    if (oldStoppedSessions.length > 0) {
      actions.push({
        action: 'cleanup_stopped_sessions',
        parameters: { sessionIds: oldStoppedSessions.map(s => s.id) },
        risklevel: 'low' as const
      });
    }

    if (longRunningSessions.length > 0 && severity === 'critical') {
      actions.push({
        action: 'review_long_running_sessions',
        parameters: { 
          sessionIds: longRunningSessions.map(s => s.id),
          requireConfirmation: true
        },
        risklevel: 'high' as const
      });
    }

    if (actions.length === 0) return null;

    return {
      type: 'cleanup_resources',
      priority: severity,
      description: `Too many sessions (${metrics.sessions}). ${oldStoppedSessions.length} old stopped sessions, ${longRunningSessions.length} long-running sessions.`,
      expectedImpact: `Reduce session count by ${oldStoppedSessions.length + (severity === 'critical' ? longRunningSessions.length : 0)}`,
      confidence: 0.7,
      actions
    };
  }

  private analyzeCPUUsage(sessions: ConsoleSession[], metrics: ResourceMetrics): OptimizationRecommendation | null {
    const severity = metrics.cpu > this.thresholds.cpu.critical ? 'critical' : 'high';
    
    // In a real implementation, we would track which sessions are consuming CPU
    // For now, we'll provide general recommendations
    
    const actions = [
      {
        action: 'reduce_concurrent_sessions',
        parameters: { maxConcurrent: Math.max(5, Math.floor(sessions.length * 0.6)) },
        risklevel: 'medium' as const
      }
    ];

    if (severity === 'critical') {
      actions.push({
        action: 'pause_non_essential_sessions',
        parameters: { preserveRecent: true },
        risklevel: 'high' as const
      });
    }

    return {
      type: 'reduce_concurrency',
      priority: severity,
      description: `High CPU usage detected (${metrics.cpu.toFixed(1)}%). Consider reducing concurrent operations.`,
      expectedImpact: `Reduce CPU usage by limiting concurrent sessions`,
      confidence: 0.6,
      actions
    };
  }

  private analyzePerformanceTrends(currentMetrics: ResourceMetrics): OptimizationRecommendation | null {
    if (this.resourceHistory.length < 10) return null; // Need history for trend analysis

    const recentHistory = this.resourceHistory.slice(-10);
    const memoryTrend = this.calculateTrend(recentHistory.map(h => h.memory));
    const cpuTrend = this.calculateTrend(recentHistory.map(h => h.cpu));

    // Check for rapidly increasing trends
    if (memoryTrend > 0.1 && currentMetrics.memory > this.thresholds.memory.warning * 0.7) {
      return {
        type: 'cleanup_resources',
        priority: 'medium',
        description: `Memory usage is trending upward (${(memoryTrend * 100).toFixed(1)}% increase rate). Potential memory leak detected.`,
        expectedImpact: 'Prevent future memory exhaustion',
        confidence: 0.7,
        actions: [
          {
            action: 'monitor_memory_growth',
            parameters: { alertThreshold: this.thresholds.memory.warning },
            risklevel: 'low'
          },
          {
            action: 'schedule_periodic_cleanup',
            parameters: { interval: 300000 }, // 5 minutes
            risklevel: 'low'
          }
        ]
      };
    }

    if (cpuTrend > 0.15 && currentMetrics.cpu > this.thresholds.cpu.warning * 0.8) {
      return {
        type: 'reduce_concurrency',
        priority: 'medium',
        description: `CPU usage is trending upward (${(cpuTrend * 100).toFixed(1)}% increase rate). System may be overloaded.`,
        expectedImpact: 'Prevent CPU exhaustion and system slowdown',
        confidence: 0.6,
        actions: [
          {
            action: 'implement_throttling',
            parameters: { maxConcurrentCommands: 3 },
            risklevel: 'low'
          }
        ]
      };
    }

    return null;
  }

  private detectResourceLeaks(currentMetrics: ResourceMetrics): OptimizationRecommendation | null {
    if (this.resourceHistory.length < 30) return null;

    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    const oldHistory = this.resourceHistory.filter(h => h.timestamp.getTime() < thirtyMinutesAgo);
    
    if (oldHistory.length === 0) return null;

    const avgOldMemory = oldHistory.reduce((sum, h) => sum + h.memory, 0) / oldHistory.length;
    const memoryIncrease = (currentMetrics.memory - avgOldMemory) / avgOldMemory;

    // If memory has increased by more than 50% in 30 minutes without corresponding session increase
    if (memoryIncrease > 0.5) {
      const avgOldSessions = oldHistory.reduce((sum, h) => sum + h.sessions, 0) / oldHistory.length;
      const sessionIncrease = (currentMetrics.sessions - avgOldSessions) / Math.max(avgOldSessions, 1);

      if (sessionIncrease < 0.2) { // Sessions haven't increased proportionally
        return {
          type: 'cleanup_resources',
          priority: 'high',
          description: `Potential memory leak detected. Memory increased ${(memoryIncrease * 100).toFixed(1)}% without proportional session increase.`,
          expectedImpact: 'Prevent memory exhaustion and system instability',
          confidence: 0.8,
          actions: [
            {
              action: 'force_comprehensive_cleanup',
              parameters: { includeBuffers: true, forceStopped: true },
              risklevel: 'medium'
            },
            {
              action: 'restart_if_critical',
              parameters: { memoryThreshold: this.thresholds.memory.critical },
              risklevel: 'high'
            }
          ]
        };
      }
    }

    return null;
  }

  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;

    // Simple linear regression to calculate trend
    const n = values.length;
    const sumX = (n * (n - 1)) / 2; // 0 + 1 + 2 + ... + (n-1)
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + (i * val), 0);
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6; // 0² + 1² + 2² + ... + (n-1)²

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const avgY = sumY / n;
    
    // Return slope as a percentage of the average value
    return avgY !== 0 ? slope / avgY : 0;
  }

  private async checkForImmediateOptimization(metrics: ResourceMetrics): Promise<void> {
    // Check for critical conditions that require immediate action
    if (metrics.memory > this.thresholds.memory.critical) {
      this.logger.warn(`Critical memory usage detected: ${(metrics.memory / 1024 / 1024).toFixed(1)}MB`);
      // In a real implementation, this would trigger immediate cleanup
    }

    if (metrics.cpu > this.thresholds.cpu.critical) {
      this.logger.warn(`Critical CPU usage detected: ${metrics.cpu.toFixed(1)}%`);
      // In a real implementation, this would trigger immediate throttling
    }
  }

  recordOptimizationResult(
    recommendation: OptimizationRecommendation,
    applied: boolean,
    result: 'success' | 'failed' | 'partial'
  ): void {
    this.optimizationHistory.push({
      recommendation,
      applied,
      result,
      timestamp: new Date()
    });

    // Keep only last 100 optimization records
    if (this.optimizationHistory.length > 100) {
      this.optimizationHistory.shift();
    }

    this.logger.info(`Optimization ${recommendation.type} ${applied ? 'applied' : 'not applied'}: ${result}`);
  }

  getOptimizationStatistics(): any {
    const totalOptimizations = this.optimizationHistory.length;
    const appliedOptimizations = this.optimizationHistory.filter(h => h.applied);
    const successfulOptimizations = appliedOptimizations.filter(h => h.result === 'success');

    const typeStats = this.optimizationHistory.reduce((acc, h) => {
      const type = h.recommendation.type;
      acc[type] = acc[type] || { total: 0, applied: 0, successful: 0 };
      acc[type].total++;
      if (h.applied) acc[type].applied++;
      if (h.applied && h.result === 'success') acc[type].successful++;
      return acc;
    }, {} as Record<string, any>);

    return {
      totalRecommendations: totalOptimizations,
      appliedRecommendations: appliedOptimizations.length,
      successfulRecommendations: successfulOptimizations.length,
      successRate: appliedOptimizations.length > 0 ? successfulOptimizations.length / appliedOptimizations.length : 0,
      typeBreakdown: typeStats,
      currentThresholds: this.thresholds,
      recentMetrics: this.resourceHistory.slice(-5)
    };
  }

  updateThresholds(newThresholds: Partial<ResourceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.logger.info('Resource thresholds updated');
  }

  getResourceHistory(minutes: number = 30): ResourceMetrics[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.resourceHistory.filter(h => h.timestamp.getTime() > cutoff);
  }

  async performOptimization(recommendation: OptimizationRecommendation): Promise<{ success: boolean; details: string }> {
    // This would implement the actual optimization actions
    // For now, it's a placeholder that simulates the actions
    
    try {
      for (const action of recommendation.actions) {
        this.logger.info(`Performing optimization action: ${action.action}`);
        
        switch (action.action) {
          case 'cleanup_old_sessions':
            // Would cleanup specified sessions
            break;
          case 'force_garbage_collection':
            if (global.gc) {
              global.gc();
            }
            break;
          case 'kill_inactive_sessions':
            // Would kill inactive sessions based on parameters
            break;
          case 'reduce_concurrent_sessions':
            // Would implement session throttling
            break;
          default:
            this.logger.warn(`Unknown optimization action: ${action.action}`);
        }
      }

      this.recordOptimizationResult(recommendation, true, 'success');
      return { success: true, details: 'All optimization actions completed successfully' };
      
    } catch (error) {
      this.logger.error(`Optimization failed: ${error}`);
      this.recordOptimizationResult(recommendation, true, 'failed');
      return { success: false, details: `Optimization failed: ${error}` };
    }
  }
}