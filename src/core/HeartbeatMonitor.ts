import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { SessionState } from '../types/index.js';

export interface HeartbeatConfig {
  interval: number;
  timeout: number;
  maxMissedBeats: number;
  enableAdaptiveInterval: boolean;
  retryAttempts: number;
  retryDelay: number;
  gracePeriod: number;
  enablePredictiveFailure: boolean;
}

export interface HeartbeatResult {
  sessionId: string;
  timestamp: Date;
  success: boolean;
  responseTime: number;
  error?: string;
  consecutiveMissed: number;
  adaptiveInterval?: number;
}

export interface SessionHeartbeat {
  sessionId: string;
  lastBeat: Date;
  consecutiveMissed: number;
  averageResponseTime: number;
  responseTimeHistory: number[];
  isHealthy: boolean;
  adaptiveInterval: number;
  nextHeartbeat: Date;
  failurePredictionScore?: number;
}

/**
 * Heartbeat Monitor for session health verification
 * Provides continuous monitoring of session responsiveness with adaptive intervals
 * and predictive failure detection
 */
export class HeartbeatMonitor extends EventEmitter {
  private logger: Logger;
  private config: HeartbeatConfig;
  private sessionHeartbeats: Map<string, SessionHeartbeat> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeHeartbeats: Map<string, Promise<HeartbeatResult>> = new Map();
  private isRunning = false;

  // Statistics
  private stats = {
    totalHeartbeats: 0,
    successfulHeartbeats: 0,
    failedHeartbeats: 0,
    totalSessions: 0,
    activeSessions: 0,
    unhealthySessions: 0,
    averageResponseTime: 0,
    predictedFailures: 0,
    preventedFailures: 0
  };

  constructor(config?: Partial<HeartbeatConfig>) {
    super();
    this.logger = new Logger('HeartbeatMonitor');
    
    this.config = {
      interval: config?.interval || 30000, // 30 seconds
      timeout: config?.timeout || 10000, // 10 seconds
      maxMissedBeats: config?.maxMissedBeats || 3,
      enableAdaptiveInterval: config?.enableAdaptiveInterval ?? true,
      retryAttempts: config?.retryAttempts || 2,
      retryDelay: config?.retryDelay || 5000,
      gracePeriod: config?.gracePeriod || 60000, // 1 minute grace period for new sessions
      enablePredictiveFailure: config?.enablePredictiveFailure ?? true
    };

    this.logger.info('HeartbeatMonitor initialized with config:', this.config);
  }

  /**
   * Start heartbeat monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('HeartbeatMonitor is already running');
      return;
    }

    this.logger.info('Starting HeartbeatMonitor...');
    this.isRunning = true;

    this.emit('started');
    this.logger.info('HeartbeatMonitor started successfully');
  }

  /**
   * Stop heartbeat monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('HeartbeatMonitor is not running');
      return;
    }

    this.logger.info('Stopping HeartbeatMonitor...');
    this.isRunning = false;

    // Clear all timers
    for (const [sessionId, timer] of this.heartbeatTimers) {
      clearTimeout(timer);
    }
    this.heartbeatTimers.clear();

    // Wait for active heartbeats to complete
    const activePromises = Array.from(this.activeHeartbeats.values());
    if (activePromises.length > 0) {
      this.logger.info(`Waiting for ${activePromises.length} active heartbeats to complete...`);
      await Promise.allSettled(activePromises);
    }

    this.emit('stopped');
    this.logger.info('HeartbeatMonitor stopped');
  }

  /**
   * Add a session for heartbeat monitoring
   */
  addSession(sessionId: string, sessionState?: SessionState): void {
    if (this.sessionHeartbeats.has(sessionId)) {
      this.logger.warn(`Session ${sessionId} is already being monitored`);
      return;
    }

    const now = Date.now();
    const heartbeat: SessionHeartbeat = {
      sessionId,
      lastBeat: new Date(now),
      consecutiveMissed: 0,
      averageResponseTime: 0,
      responseTimeHistory: [],
      isHealthy: true,
      adaptiveInterval: this.config.interval,
      nextHeartbeat: new Date(now + this.config.gracePeriod) // Give grace period for new sessions
    };

    this.sessionHeartbeats.set(sessionId, heartbeat);
    this.stats.totalSessions++;
    this.stats.activeSessions++;

    this.logger.info(`Added session ${sessionId} for heartbeat monitoring`);

    // Schedule first heartbeat after grace period
    this.scheduleHeartbeat(sessionId, this.config.gracePeriod);

    this.emit('session-added', { sessionId, heartbeat });
  }

  /**
   * Remove a session from heartbeat monitoring
   */
  removeSession(sessionId: string): void {
    const heartbeat = this.sessionHeartbeats.get(sessionId);
    if (!heartbeat) {
      this.logger.warn(`Session ${sessionId} is not being monitored`);
      return;
    }

    // Clear timer
    const timer = this.heartbeatTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.heartbeatTimers.delete(sessionId);
    }

    // Cancel active heartbeat if running
    this.activeHeartbeats.delete(sessionId);

    this.sessionHeartbeats.delete(sessionId);
    this.stats.activeSessions--;

    if (!heartbeat.isHealthy) {
      this.stats.unhealthySessions--;
    }

    this.logger.info(`Removed session ${sessionId} from heartbeat monitoring`);
    this.emit('session-removed', { sessionId });
  }

  /**
   * Get heartbeat status for a session
   */
  getSessionHeartbeat(sessionId: string): SessionHeartbeat | null {
    return this.sessionHeartbeats.get(sessionId) || null;
  }

  /**
   * Get heartbeat status for all sessions
   */
  getAllHeartbeats(): Record<string, SessionHeartbeat> {
    const result: Record<string, SessionHeartbeat> = {};
    for (const [sessionId, heartbeat] of this.sessionHeartbeats) {
      result[sessionId] = { ...heartbeat };
    }
    return result;
  }

  /**
   * Force a heartbeat check for a specific session
   */
  async forceHeartbeat(sessionId: string): Promise<HeartbeatResult> {
    const heartbeat = this.sessionHeartbeats.get(sessionId);
    if (!heartbeat) {
      throw new Error(`Session ${sessionId} is not being monitored`);
    }

    this.logger.debug(`Forcing heartbeat for session ${sessionId}`);
    return await this.performHeartbeat(sessionId);
  }

  /**
   * Update session activity (resets heartbeat timer)
   */
  recordSessionActivity(sessionId: string): void {
    const heartbeat = this.sessionHeartbeats.get(sessionId);
    if (!heartbeat) {
      return;
    }

    heartbeat.lastBeat = new Date();
    heartbeat.consecutiveMissed = 0;

    // Reset unhealthy status if session becomes active
    if (!heartbeat.isHealthy) {
      heartbeat.isHealthy = true;
      this.stats.unhealthySessions--;
      this.logger.info(`Session ${sessionId} recovered - marked as healthy`);
      this.emit('session-recovered', { sessionId, heartbeat });
    }

    // Reschedule next heartbeat
    this.scheduleHeartbeat(sessionId);
  }

  /**
   * Schedule the next heartbeat for a session
   */
  private scheduleHeartbeat(sessionId: string, customInterval?: number): void {
    if (!this.isRunning) {
      return;
    }

    const heartbeat = this.sessionHeartbeats.get(sessionId);
    if (!heartbeat) {
      return;
    }

    // Clear existing timer
    const existingTimer = this.heartbeatTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Calculate interval (adaptive or fixed)
    const interval = customInterval || this.calculateAdaptiveInterval(heartbeat);
    heartbeat.nextHeartbeat = new Date(Date.now() + interval);

    // Schedule heartbeat
    const timer = setTimeout(async () => {
      try {
        await this.performHeartbeat(sessionId);
      } catch (error) {
        this.logger.error(`Error performing heartbeat for session ${sessionId}:`, error);
      }
    }, interval);

    this.heartbeatTimers.set(sessionId, timer);
  }

  /**
   * Calculate adaptive heartbeat interval based on session health
   */
  private calculateAdaptiveInterval(heartbeat: SessionHeartbeat): number {
    if (!this.config.enableAdaptiveInterval) {
      return this.config.interval;
    }

    let multiplier = 1.0;

    // Increase frequency for unhealthy sessions
    if (!heartbeat.isHealthy) {
      multiplier = 0.5; // Check twice as often
    } else if (heartbeat.consecutiveMissed > 0) {
      multiplier = 0.75; // Check more frequently if there are recent misses
    } else if (heartbeat.averageResponseTime > 5000) {
      multiplier = 0.8; // Check more frequently for slow sessions
    } else if (heartbeat.responseTimeHistory.length >= 10 && heartbeat.averageResponseTime < 1000) {
      // Decrease frequency for very healthy sessions
      multiplier = 1.5;
    }

    // Apply predictive failure analysis
    if (this.config.enablePredictiveFailure && heartbeat.failurePredictionScore !== undefined) {
      if (heartbeat.failurePredictionScore > 0.7) {
        multiplier *= 0.5; // High failure risk - check very frequently
      } else if (heartbeat.failurePredictionScore > 0.4) {
        multiplier *= 0.75; // Medium failure risk - check more frequently
      }
    }

    const adaptiveInterval = Math.floor(this.config.interval * multiplier);
    heartbeat.adaptiveInterval = adaptiveInterval;

    return Math.max(5000, Math.min(adaptiveInterval, 300000)); // Between 5 seconds and 5 minutes
  }

  /**
   * Perform heartbeat check for a session
   */
  private async performHeartbeat(sessionId: string): Promise<HeartbeatResult> {
    const heartbeat = this.sessionHeartbeats.get(sessionId);
    if (!heartbeat) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Check if there's already an active heartbeat for this session
    const activeHeartbeat = this.activeHeartbeats.get(sessionId);
    if (activeHeartbeat) {
      this.logger.debug(`Heartbeat already in progress for session ${sessionId}`);
      return await activeHeartbeat;
    }

    const heartbeatPromise = this.executeHeartbeat(sessionId, heartbeat);
    this.activeHeartbeats.set(sessionId, heartbeatPromise);

    try {
      const result = await heartbeatPromise;
      this.processHeartbeatResult(sessionId, result, heartbeat);
      this.scheduleHeartbeat(sessionId);
      return result;
    } finally {
      this.activeHeartbeats.delete(sessionId);
    }
  }

  /**
   * Execute the actual heartbeat check
   */
  private async executeHeartbeat(sessionId: string, heartbeat: SessionHeartbeat): Promise<HeartbeatResult> {
    const startTime = Date.now();
    let attempt = 0;
    let lastError: string | undefined;

    this.stats.totalHeartbeats++;

    // Try multiple attempts with retry delay
    while (attempt < this.config.retryAttempts) {
      attempt++;

      try {
        // Emit heartbeat attempt
        this.emit('heartbeat-attempt', { 
          sessionId, 
          attempt, 
          maxAttempts: this.config.retryAttempts,
          timestamp: new Date() 
        });

        // Simulate heartbeat check - in reality, this would ping the session
        const heartbeatResult = await this.checkSessionHealth(sessionId);
        const responseTime = Date.now() - startTime;

        this.stats.successfulHeartbeats++;

        return {
          sessionId,
          timestamp: new Date(),
          success: true,
          responseTime,
          consecutiveMissed: heartbeat.consecutiveMissed
        };

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        
        if (attempt < this.config.retryAttempts) {
          this.logger.debug(`Heartbeat attempt ${attempt} failed for session ${sessionId}, retrying in ${this.config.retryDelay}ms: ${lastError}`);
          await this.delay(this.config.retryDelay);
        }
      }
    }

    // All attempts failed
    this.stats.failedHeartbeats++;
    const responseTime = Date.now() - startTime;

    return {
      sessionId,
      timestamp: new Date(),
      success: false,
      responseTime,
      error: lastError,
      consecutiveMissed: heartbeat.consecutiveMissed + 1
    };
  }

  /**
   * Check session health (placeholder for actual implementation)
   */
  private async checkSessionHealth(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Emit request for session health check
      this.emit('heartbeat-check-request', { 
        sessionId, 
        timeout: this.config.timeout,
        timestamp: new Date(),
        callback: (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      });

      // Timeout mechanism
      setTimeout(() => {
        reject(new Error(`Heartbeat timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);
    });
  }

  /**
   * Process heartbeat result and update session state
   */
  private processHeartbeatResult(sessionId: string, result: HeartbeatResult, heartbeat: SessionHeartbeat): void {
    heartbeat.lastBeat = result.timestamp;

    if (result.success) {
      // Successful heartbeat
      heartbeat.consecutiveMissed = 0;
      
      // Update response time statistics
      heartbeat.responseTimeHistory.push(result.responseTime);
      if (heartbeat.responseTimeHistory.length > 50) {
        heartbeat.responseTimeHistory.shift(); // Keep only last 50 measurements
      }
      
      heartbeat.averageResponseTime = heartbeat.responseTimeHistory.reduce((a, b) => a + b, 0) / heartbeat.responseTimeHistory.length;
      
      // Update global average
      this.stats.averageResponseTime = 
        (this.stats.averageResponseTime * (this.stats.successfulHeartbeats - 1) + result.responseTime) / this.stats.successfulHeartbeats;

      // Mark as healthy if was unhealthy
      if (!heartbeat.isHealthy) {
        heartbeat.isHealthy = true;
        this.stats.unhealthySessions--;
        this.logger.info(`Session ${sessionId} heartbeat recovered`);
        this.emit('session-recovered', { sessionId, result, heartbeat });
      }

      // Update failure prediction score
      if (this.config.enablePredictiveFailure) {
        heartbeat.failurePredictionScore = this.calculateFailurePrediction(heartbeat);
        
        // Emit prediction warning if high risk
        if (heartbeat.failurePredictionScore > 0.7) {
          this.stats.predictedFailures++;
          this.emit('failure-prediction', { 
            sessionId, 
            score: heartbeat.failurePredictionScore,
            recommendations: this.generatePredictiveRecommendations(heartbeat),
            timestamp: new Date()
          });
        }
      }

    } else {
      // Failed heartbeat
      heartbeat.consecutiveMissed = result.consecutiveMissed;

      // Mark as unhealthy if exceeds threshold
      if (heartbeat.consecutiveMissed >= this.config.maxMissedBeats && heartbeat.isHealthy) {
        heartbeat.isHealthy = false;
        this.stats.unhealthySessions++;
        
        this.logger.warn(`Session ${sessionId} marked as unhealthy after ${heartbeat.consecutiveMissed} consecutive missed heartbeats`);
        
        this.emit('session-unhealthy', { 
          sessionId, 
          result, 
          heartbeat,
          consecutiveMissed: heartbeat.consecutiveMissed
        });
      }

      // Emit failure event if session is critically unhealthy
      if (heartbeat.consecutiveMissed >= this.config.maxMissedBeats * 2) {
        this.emit('session-critical', { 
          sessionId, 
          result, 
          heartbeat,
          message: `Session has missed ${heartbeat.consecutiveMissed} consecutive heartbeats`
        });
      }
    }

    // Emit heartbeat result
    this.emit('heartbeat-result', result);

    this.logger.debug(`Heartbeat for session ${sessionId}: ${result.success ? 'SUCCESS' : 'FAILED'} (${result.responseTime}ms)`);
  }

  /**
   * Calculate failure prediction score based on historical data
   */
  private calculateFailurePrediction(heartbeat: SessionHeartbeat): number {
    let score = 0;

    // Recent missed heartbeats increase failure risk
    if (heartbeat.consecutiveMissed > 0) {
      score += heartbeat.consecutiveMissed * 0.2;
    }

    // Degrading response times indicate potential issues
    if (heartbeat.responseTimeHistory.length >= 10) {
      const recent = heartbeat.responseTimeHistory.slice(-5);
      const older = heartbeat.responseTimeHistory.slice(-10, -5);
      
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
      
      if (recentAvg > olderAvg * 1.5) {
        score += 0.3; // Response time degradation
      }
      
      if (recentAvg > 10000) {
        score += 0.2; // Very slow responses
      }
    }

    // High variability in response times indicates instability
    if (heartbeat.responseTimeHistory.length >= 5) {
      const avg = heartbeat.averageResponseTime;
      const variance = heartbeat.responseTimeHistory
        .map(rt => Math.pow(rt - avg, 2))
        .reduce((a, b) => a + b, 0) / heartbeat.responseTimeHistory.length;
      const stdDev = Math.sqrt(variance);
      
      if (stdDev > avg * 0.5) {
        score += 0.15; // High variability
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Generate predictive recommendations based on failure analysis
   */
  private generatePredictiveRecommendations(heartbeat: SessionHeartbeat): string[] {
    const recommendations: string[] = [];

    if (heartbeat.consecutiveMissed > 0) {
      recommendations.push('Monitor session connectivity closely');
      recommendations.push('Consider preemptive session restart');
    }

    if (heartbeat.averageResponseTime > 5000) {
      recommendations.push('Investigate session performance issues');
      recommendations.push('Check system resource utilization');
    }

    if (heartbeat.responseTimeHistory.length >= 5) {
      const recentTrend = this.calculateResponseTimeTrend(heartbeat.responseTimeHistory);
      if (recentTrend > 1.2) {
        recommendations.push('Response times are degrading - investigate root cause');
        recommendations.push('Consider session optimization or restart');
      }
    }

    return recommendations;
  }

  /**
   * Calculate response time trend (1.0 = stable, >1.0 = degrading, <1.0 = improving)
   */
  private calculateResponseTimeTrend(history: number[]): number {
    if (history.length < 4) return 1.0;

    const mid = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, mid);
    const secondHalf = history.slice(mid);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    return secondAvg / firstAvg;
  }

  /**
   * Get comprehensive heartbeat statistics
   */
  getStatistics() {
    const sessionStats = Array.from(this.sessionHeartbeats.values());
    
    return {
      ...this.stats,
      healthySessions: sessionStats.filter(s => s.isHealthy).length,
      averageAdaptiveInterval: sessionStats.length > 0 ? 
        sessionStats.reduce((sum, s) => sum + s.adaptiveInterval, 0) / sessionStats.length : 0,
      sessionsWithPredictions: sessionStats.filter(s => s.failurePredictionScore !== undefined).length,
      highRiskSessions: sessionStats.filter(s => (s.failurePredictionScore || 0) > 0.7).length,
      isRunning: this.isRunning,
      configuredInterval: this.config.interval,
      adaptiveIntervalEnabled: this.config.enableAdaptiveInterval,
      predictiveFailureEnabled: this.config.enablePredictiveFailure
    };
  }

  /**
   * Get health summary for all sessions
   */
  getHealthSummary() {
    const sessions = Array.from(this.sessionHeartbeats.values());
    
    return {
      totalSessions: sessions.length,
      healthySessions: sessions.filter(s => s.isHealthy).length,
      unhealthySessions: sessions.filter(s => !s.isHealthy).length,
      averageResponseTime: this.stats.averageResponseTime,
      successRate: this.stats.totalHeartbeats > 0 ? 
        (this.stats.successfulHeartbeats / this.stats.totalHeartbeats) * 100 : 100,
      highRiskSessions: sessions.filter(s => (s.failurePredictionScore || 0) > 0.7).length,
      lastUpdate: new Date()
    };
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.sessionHeartbeats.clear();
    this.removeAllListeners();
    this.logger.info('HeartbeatMonitor destroyed');
  }
}