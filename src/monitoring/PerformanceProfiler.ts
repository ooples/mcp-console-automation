import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { cpuUsage, memoryUsage } from 'process';
import * as si from 'systeminformation';
import { PerformanceProfile, Bottleneck, SLAConfig } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

interface ProfilerConfig {
  enabled: boolean;
  samplingInterval: number; // milliseconds
  profileDuration: number; // seconds
  enableCpuProfiling: boolean;
  enableMemoryProfiling: boolean;
  enableIOProfiling: boolean;
  enableNetworkProfiling: boolean;
  bottleneckThresholds: {
    cpu: number; // percentage
    memory: number; // percentage
    diskIO: number; // MB/s
    networkIO: number; // MB/s
  };
  retentionDays: number;
}

interface ProfileSession {
  id: string;
  sessionId?: string;
  command?: string;
  startTime: Date;
  endTime?: Date;
  samples: PerformanceSample[];
  bottlenecks: Bottleneck[];
  isActive: boolean;
}

interface PerformanceSample {
  timestamp: Date;
  cpu: {
    usage: number;
    user: number;
    system: number;
  };
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  disk: {
    readRate: number;
    writeRate: number;
    totalRead: number;
    totalWrite: number;
  };
  network: {
    inRate: number;
    outRate: number;
    totalIn: number;
    totalOut: number;
  };
}

interface SLAMetrics {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  responseTime?: number;
  availability: number;
  errorRate: number;
  throughput: number;
  slaBreaches: SLABreach[];
}

interface SLABreach {
  id: string;
  timestamp: Date;
  type: 'response_time' | 'availability' | 'error_rate';
  metric: string;
  threshold: number;
  actual: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  duration?: number;
}

export class PerformanceProfiler extends EventEmitter {
  private logger: Logger;
  private config: ProfilerConfig;
  private profileSessions: Map<string, ProfileSession> = new Map();
  private slaMetrics: Map<string, SLAMetrics> = new Map();
  private lastSystemStats?: si.Systeminformation.CurrentLoadData & si.Systeminformation.MemData & si.Systeminformation.FsStatsData;
  private samplingTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config?: Partial<ProfilerConfig>) {
    super();
    this.logger = new Logger('PerformanceProfiler');
    
    this.config = {
      enabled: true,
      samplingInterval: 1000, // 1 second
      profileDuration: 300, // 5 minutes
      enableCpuProfiling: true,
      enableMemoryProfiling: true,
      enableIOProfiling: true,
      enableNetworkProfiling: true,
      bottleneckThresholds: {
        cpu: 80,
        memory: 85,
        diskIO: 100, // MB/s
        networkIO: 50 // MB/s
      },
      retentionDays: 7,
      ...config
    };
  }

  // Start performance profiling
  start(): void {
    if (!this.config.enabled || this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting performance profiler');

    // Start sampling timer
    this.samplingTimer = setInterval(() => {
      this.collectPerformanceSample();
    }, this.config.samplingInterval);

    // Start cleanup timer
    setInterval(() => {
      this.cleanupOldProfiles();
    }, 60 * 60 * 1000); // Cleanup every hour
  }

  // Stop performance profiling
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.samplingTimer) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = null;
    }

    // Finalize all active profile sessions
    this.profileSessions.forEach(session => {
      if (session.isActive) {
        this.stopProfiling(session.id);
      }
    });

    this.logger.info('Stopped performance profiler');
  }

  // Start profiling a specific session
  startProfiling(sessionId?: string, command?: string): string {
    const profileId = uuidv4();
    const profileSession: ProfileSession = {
      id: profileId,
      sessionId,
      command,
      startTime: new Date(),
      samples: [],
      bottlenecks: [],
      isActive: true
    };

    this.profileSessions.set(profileId, profileSession);
    this.emit('profile-started', profileSession);

    // Start SLA monitoring if sessionId provided
    if (sessionId) {
      this.startSLAMonitoring(sessionId);
    }

    this.logger.info(`Started profiling session: ${profileId}${sessionId ? ` (${sessionId})` : ''}`);
    return profileId;
  }

  // Stop profiling a specific session
  stopProfiling(profileId: string): PerformanceProfile | null {
    const session = this.profileSessions.get(profileId);
    if (!session || !session.isActive) {
      return null;
    }

    session.endTime = new Date();
    session.isActive = false;

    // Calculate performance metrics
    const performanceProfile = this.generatePerformanceProfile(session);

    // Stop SLA monitoring if applicable
    if (session.sessionId) {
      this.stopSLAMonitoring(session.sessionId);
    }

    this.emit('profile-completed', performanceProfile);
    this.logger.info(`Completed profiling session: ${profileId}`);

    return performanceProfile;
  }

  // Collect a performance sample
  private async collectPerformanceSample(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Collect system metrics
      const [cpuData, memData, fsData, networkData] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsStats(),
        si.networkStats()
      ]);

      // Get Node.js process metrics
      const processMemory = memoryUsage();
      const processCpu = cpuUsage();

      // Calculate rates if we have previous data
      let diskReadRate = 0, diskWriteRate = 0;
      let networkInRate = 0, networkOutRate = 0;

      if (this.lastSystemStats) {
        const timeDiff = (Date.now() - (this.lastSystemStats as any).timestamp) / 1000;
        
        // Calculate disk I/O rates
        if (fsData && this.lastSystemStats.rx_bytes !== undefined) {
          diskReadRate = ((fsData.rx_bytes || 0) - (this.lastSystemStats.rx_bytes || 0)) / timeDiff / 1024 / 1024; // MB/s
          diskWriteRate = ((fsData.tx_bytes || 0) - (this.lastSystemStats.tx_bytes || 0)) / timeDiff / 1024 / 1024; // MB/s
        }

        // Calculate network I/O rates
        if (networkData && networkData.length > 0 && this.lastSystemStats.iface) {
          const totalIn = networkData.reduce((sum, iface) => sum + iface.rx_bytes, 0);
          const totalOut = networkData.reduce((sum, iface) => sum + iface.tx_bytes, 0);
          const lastTotalIn = (this.lastSystemStats as any).totalNetworkIn || 0;
          const lastTotalOut = (this.lastSystemStats as any).totalNetworkOut || 0;

          networkInRate = (totalIn - lastTotalIn) / timeDiff / 1024 / 1024; // MB/s
          networkOutRate = (totalOut - lastTotalOut) / timeDiff / 1024 / 1024; // MB/s
        }
      }

      // Create performance sample
      const sample: PerformanceSample = {
        timestamp: new Date(),
        cpu: {
          usage: cpuData.currentLoad,
          user: cpuData.currentLoadUser || 0,
          system: cpuData.currentLoadSystem || 0
        },
        memory: {
          rss: processMemory.rss,
          heapUsed: processMemory.heapUsed,
          heapTotal: processMemory.heapTotal,
          external: processMemory.external
        },
        disk: {
          readRate: Math.max(0, diskReadRate),
          writeRate: Math.max(0, diskWriteRate),
          totalRead: fsData?.rx_bytes || 0,
          totalWrite: fsData?.tx_bytes || 0
        },
        network: {
          inRate: Math.max(0, networkInRate),
          outRate: Math.max(0, networkOutRate),
          totalIn: networkData?.reduce((sum, iface) => sum + iface.rx_bytes, 0) || 0,
          totalOut: networkData?.reduce((sum, iface) => sum + iface.tx_bytes, 0) || 0
        }
      };

      // Add sample to all active profile sessions
      this.profileSessions.forEach(session => {
        if (session.isActive) {
          session.samples.push(sample);

          // Detect bottlenecks
          this.detectBottlenecks(session, sample);

          // Limit sample history to prevent memory issues
          if (session.samples.length > 1000) {
            session.samples.shift();
          }
        }
      });

      // Store current stats for rate calculations
      this.lastSystemStats = {
        ...cpuData,
        ...memData,
        ...fsData,
        timestamp: Date.now(),
        totalNetworkIn: networkData?.reduce((sum, iface) => sum + iface.rx_bytes, 0) || 0,
        totalNetworkOut: networkData?.reduce((sum, iface) => sum + iface.tx_bytes, 0) || 0
      } as any;

    } catch (error) {
      this.logger.error(`Failed to collect performance sample: ${error}`);
    }
  }

  // Detect performance bottlenecks
  private detectBottlenecks(session: ProfileSession, sample: PerformanceSample): void {
    const bottlenecks: Bottleneck[] = [];

    // CPU bottleneck
    if (this.config.enableCpuProfiling && sample.cpu.usage > this.config.bottleneckThresholds.cpu) {
      bottlenecks.push({
        type: 'cpu',
        severity: sample.cpu.usage > 95 ? 'critical' : sample.cpu.usage > 90 ? 'high' : 'medium',
        description: `High CPU usage: ${sample.cpu.usage.toFixed(1)}%`,
        timestamp: sample.timestamp,
        duration: 0, // Will be calculated when bottleneck ends
        impact: sample.cpu.usage / 100
      });
    }

    // Memory bottleneck
    if (this.config.enableMemoryProfiling) {
      const memoryUsagePercent = (sample.memory.rss / (1024 * 1024 * 1024)); // Convert to GB
      if (memoryUsagePercent > this.config.bottleneckThresholds.memory / 100) {
        bottlenecks.push({
          type: 'memory',
          severity: memoryUsagePercent > 0.95 ? 'critical' : memoryUsagePercent > 0.90 ? 'high' : 'medium',
          description: `High memory usage: ${(memoryUsagePercent * 100).toFixed(1)}%`,
          timestamp: sample.timestamp,
          duration: 0,
          impact: memoryUsagePercent
        });
      }
    }

    // Disk I/O bottleneck
    if (this.config.enableIOProfiling) {
      const totalDiskIO = sample.disk.readRate + sample.disk.writeRate;
      if (totalDiskIO > this.config.bottleneckThresholds.diskIO) {
        bottlenecks.push({
          type: 'disk',
          severity: totalDiskIO > 200 ? 'critical' : totalDiskIO > 150 ? 'high' : 'medium',
          description: `High disk I/O: ${totalDiskIO.toFixed(1)} MB/s`,
          timestamp: sample.timestamp,
          duration: 0,
          impact: Math.min(totalDiskIO / 1000, 1) // Normalize to 0-1
        });
      }
    }

    // Network I/O bottleneck
    if (this.config.enableNetworkProfiling) {
      const totalNetworkIO = sample.network.inRate + sample.network.outRate;
      if (totalNetworkIO > this.config.bottleneckThresholds.networkIO) {
        bottlenecks.push({
          type: 'network',
          severity: totalNetworkIO > 100 ? 'critical' : totalNetworkIO > 75 ? 'high' : 'medium',
          description: `High network I/O: ${totalNetworkIO.toFixed(1)} MB/s`,
          timestamp: sample.timestamp,
          duration: 0,
          impact: Math.min(totalNetworkIO / 100, 1) // Normalize to 0-1
        });
      }
    }

    // Add new bottlenecks and emit events
    bottlenecks.forEach(bottleneck => {
      session.bottlenecks.push(bottleneck);
      this.emit('bottleneck-detected', bottleneck, session.sessionId);
    });
  }

  // Generate performance profile from session
  private generatePerformanceProfile(session: ProfileSession): PerformanceProfile {
    if (session.samples.length === 0) {
      return {
        sessionId: session.sessionId || session.id,
        command: session.command || '',
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.endTime ? session.endTime.getTime() - session.startTime.getTime() : 0,
        metrics: {
          avgCpuUsage: 0,
          peakMemoryUsage: 0,
          totalDiskIO: 0,
          totalNetworkIO: 0
        },
        bottlenecks: session.bottlenecks
      };
    }

    // Calculate metrics
    const avgCpuUsage = session.samples.reduce((sum, s) => sum + s.cpu.usage, 0) / session.samples.length;
    const peakMemoryUsage = Math.max(...session.samples.map(s => s.memory.rss));
    const totalDiskIO = session.samples[session.samples.length - 1].disk.totalRead + 
                       session.samples[session.samples.length - 1].disk.totalWrite;
    const totalNetworkIO = session.samples[session.samples.length - 1].network.totalIn + 
                          session.samples[session.samples.length - 1].network.totalOut;

    return {
      sessionId: session.sessionId || session.id,
      command: session.command || '',
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.endTime ? session.endTime.getTime() - session.startTime.getTime() : 0,
      metrics: {
        avgCpuUsage,
        peakMemoryUsage,
        totalDiskIO,
        totalNetworkIO
      },
      bottlenecks: session.bottlenecks
    };
  }

  // Start SLA monitoring for a session
  private startSLAMonitoring(sessionId: string): void {
    const slaMetrics: SLAMetrics = {
      sessionId,
      startTime: new Date(),
      availability: 100,
      errorRate: 0,
      throughput: 0,
      slaBreaches: []
    };

    this.slaMetrics.set(sessionId, slaMetrics);
    this.logger.debug(`Started SLA monitoring for session: ${sessionId}`);
  }

  // Stop SLA monitoring for a session
  private stopSLAMonitoring(sessionId: string): void {
    const metrics = this.slaMetrics.get(sessionId);
    if (metrics && !metrics.endTime) {
      metrics.endTime = new Date();
      metrics.responseTime = metrics.endTime.getTime() - metrics.startTime.getTime();
      
      this.emit('sla-metrics', metrics);
      this.logger.debug(`Stopped SLA monitoring for session: ${sessionId}`);
    }
  }

  // Check SLA compliance
  checkSLACompliance(sessionId: string, slaConfig: SLAConfig): boolean {
    const metrics = this.slaMetrics.get(sessionId);
    if (!metrics || !metrics.endTime) {
      return true; // Cannot assess incomplete sessions
    }

    let compliant = true;

    // Check response time SLA
    if (slaConfig.responseTime && metrics.responseTime && metrics.responseTime > slaConfig.responseTime) {
      const breach: SLABreach = {
        id: uuidv4(),
        timestamp: metrics.endTime,
        type: 'response_time',
        metric: 'response_time',
        threshold: slaConfig.responseTime,
        actual: metrics.responseTime,
        severity: metrics.responseTime > slaConfig.responseTime * 2 ? 'critical' : 'high'
      };

      metrics.slaBreaches.push(breach);
      this.emit('sla-breach', breach, sessionId);
      compliant = false;
    }

    // Check availability SLA
    if (slaConfig.availabilityThreshold && metrics.availability < slaConfig.availabilityThreshold) {
      const breach: SLABreach = {
        id: uuidv4(),
        timestamp: metrics.endTime,
        type: 'availability',
        metric: 'availability',
        threshold: slaConfig.availabilityThreshold,
        actual: metrics.availability,
        severity: metrics.availability < 90 ? 'critical' : 'high'
      };

      metrics.slaBreaches.push(breach);
      this.emit('sla-breach', breach, sessionId);
      compliant = false;
    }

    // Check error rate SLA
    if (slaConfig.errorRateThreshold && metrics.errorRate > slaConfig.errorRateThreshold) {
      const breach: SLABreach = {
        id: uuidv4(),
        timestamp: metrics.endTime,
        type: 'error_rate',
        metric: 'error_rate',
        threshold: slaConfig.errorRateThreshold,
        actual: metrics.errorRate,
        severity: metrics.errorRate > slaConfig.errorRateThreshold * 2 ? 'critical' : 'high'
      };

      metrics.slaBreaches.push(breach);
      this.emit('sla-breach', breach, sessionId);
      compliant = false;
    }

    return compliant;
  }

  // Update SLA metrics
  updateSLAMetrics(sessionId: string, updates: Partial<SLAMetrics>): void {
    const metrics = this.slaMetrics.get(sessionId);
    if (metrics) {
      Object.assign(metrics, updates);
    }
  }

  // Get performance profile
  getPerformanceProfile(profileId: string): PerformanceProfile | null {
    const session = this.profileSessions.get(profileId);
    if (!session) {
      return null;
    }

    return this.generatePerformanceProfile(session);
  }

  // Get all performance profiles
  getPerformanceProfiles(): PerformanceProfile[] {
    return Array.from(this.profileSessions.values()).map(session => 
      this.generatePerformanceProfile(session)
    );
  }

  // Get SLA metrics
  getSLAMetrics(sessionId: string): SLAMetrics | null {
    return this.slaMetrics.get(sessionId) || null;
  }

  // Get all SLA metrics
  getAllSLAMetrics(): SLAMetrics[] {
    return Array.from(this.slaMetrics.values());
  }

  // Get performance statistics
  getPerformanceStats(): {
    activeProfiles: number;
    totalProfiles: number;
    totalBottlenecks: number;
    bottlenecksBySeverity: Record<string, number>;
    avgProfileDuration: number;
    slaMetrics: number;
    slaBreaches: number;
  } {
    const profiles = Array.from(this.profileSessions.values());
    const allBottlenecks = profiles.flatMap(p => p.bottlenecks);
    const completedProfiles = profiles.filter(p => !p.isActive);
    
    const bottlenecksBySeverity = {
      low: allBottlenecks.filter(b => b.severity === 'low').length,
      medium: allBottlenecks.filter(b => b.severity === 'medium').length,
      high: allBottlenecks.filter(b => b.severity === 'high').length,
      critical: allBottlenecks.filter(b => b.severity === 'critical').length
    };

    const avgProfileDuration = completedProfiles.length > 0 ?
      completedProfiles.reduce((sum, p) => 
        sum + (p.endTime ? p.endTime.getTime() - p.startTime.getTime() : 0), 0
      ) / completedProfiles.length : 0;

    const allSLABreaches = Array.from(this.slaMetrics.values()).flatMap(m => m.slaBreaches);

    return {
      activeProfiles: profiles.filter(p => p.isActive).length,
      totalProfiles: profiles.length,
      totalBottlenecks: allBottlenecks.length,
      bottlenecksBySeverity,
      avgProfileDuration,
      slaMetrics: this.slaMetrics.size,
      slaBreaches: allSLABreaches.length
    };
  }

  // Clean up old profiles
  private cleanupOldProfiles(): void {
    const cutoffTime = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
    
    // Clean up profile sessions
    for (const [id, session] of this.profileSessions) {
      if (!session.isActive && session.startTime < cutoffTime) {
        this.profileSessions.delete(id);
      }
    }

    // Clean up SLA metrics
    for (const [sessionId, metrics] of this.slaMetrics) {
      if (metrics.endTime && metrics.endTime < cutoffTime) {
        this.slaMetrics.delete(sessionId);
      }
    }

    this.logger.debug('Cleaned up old performance profiles and SLA metrics');
  }

  // Get current system performance
  async getCurrentPerformance(): Promise<PerformanceSample | null> {
    if (!this.isRunning) {
      return null;
    }

    try {
      const [cpuData, memData] = await Promise.all([
        si.currentLoad(),
        si.mem()
      ]);

      const processMemory = memoryUsage();

      return {
        timestamp: new Date(),
        cpu: {
          usage: cpuData.currentLoad,
          user: cpuData.currentLoadUser || 0,
          system: cpuData.currentLoadSystem || 0
        },
        memory: {
          rss: processMemory.rss,
          heapUsed: processMemory.heapUsed,
          heapTotal: processMemory.heapTotal,
          external: processMemory.external
        },
        disk: {
          readRate: 0,
          writeRate: 0,
          totalRead: 0,
          totalWrite: 0
        },
        network: {
          inRate: 0,
          outRate: 0,
          totalIn: 0,
          totalOut: 0
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get current performance: ${error}`);
      return null;
    }
  }

  destroy(): void {
    this.stop();
    this.profileSessions.clear();
    this.slaMetrics.clear();
    this.removeAllListeners();
  }
}