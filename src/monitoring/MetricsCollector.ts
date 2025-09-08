import { EventEmitter } from 'events';
import { register, Gauge, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import * as si from 'systeminformation';
import { SystemMetrics, ProcessMetrics } from '../types/index.js';
import { Logger } from '../utils/logger.js';

export class MetricsCollector extends EventEmitter {
  private logger: Logger;
  private isCollecting: boolean = false;
  private interval: NodeJS.Timeout | null = null;
  private collectionInterval: number = 5000; // 5 seconds

  // Prometheus metrics
  private cpuUsageGauge: Gauge<string>;
  private memoryUsageGauge: Gauge<string>;
  private diskUsageGauge: Gauge<string>;
  private networkIOGauge: Gauge<string>;
  private processCountGauge: Gauge<string>;
  private sessionDurationHistogram: Histogram<string>;
  private sessionErrorCounter: Counter<string>;
  private commandExecutionCounter: Counter<string>;

  constructor(collectionInterval: number = 5000) {
    super();
    this.logger = new Logger('MetricsCollector');
    this.collectionInterval = collectionInterval;

    // Initialize Prometheus metrics
    this.initializeMetrics();
    
    // Collect default Node.js metrics
    collectDefaultMetrics({ register });

    this.logger.info('MetricsCollector initialized');
  }

  private initializeMetrics() {
    this.cpuUsageGauge = new Gauge({
      name: 'console_automation_cpu_usage_percent',
      help: 'CPU usage percentage',
      labelNames: ['instance', 'core']
    });

    this.memoryUsageGauge = new Gauge({
      name: 'console_automation_memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['instance', 'type']
    });

    this.diskUsageGauge = new Gauge({
      name: 'console_automation_disk_usage_bytes',
      help: 'Disk usage in bytes',
      labelNames: ['instance', 'device', 'type']
    });

    this.networkIOGauge = new Gauge({
      name: 'console_automation_network_io_bytes',
      help: 'Network I/O in bytes',
      labelNames: ['instance', 'interface', 'direction']
    });

    this.processCountGauge = new Gauge({
      name: 'console_automation_processes_total',
      help: 'Total number of processes',
      labelNames: ['instance', 'status']
    });

    this.sessionDurationHistogram = new Histogram({
      name: 'console_automation_session_duration_seconds',
      help: 'Session duration in seconds',
      labelNames: ['session_id', 'command', 'status'],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600]
    });

    this.sessionErrorCounter = new Counter({
      name: 'console_automation_session_errors_total',
      help: 'Total number of session errors',
      labelNames: ['session_id', 'error_type', 'severity']
    });

    this.commandExecutionCounter = new Counter({
      name: 'console_automation_commands_executed_total',
      help: 'Total number of commands executed',
      labelNames: ['command', 'status', 'console_type']
    });
  }

  async startCollection(): Promise<void> {
    if (this.isCollecting) {
      this.logger.warn('Metrics collection already started');
      return;
    }

    this.isCollecting = true;
    this.logger.info(`Starting metrics collection with interval: ${this.collectionInterval}ms`);

    this.interval = setInterval(async () => {
      try {
        await this.collectSystemMetrics();
      } catch (error) {
        this.logger.error(`Error collecting metrics: ${error}`);
      }
    }, this.collectionInterval);
  }

  stopCollection(): void {
    if (!this.isCollecting) {
      return;
    }

    this.isCollecting = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    this.logger.info('Stopped metrics collection');
  }

  private async collectSystemMetrics(): Promise<SystemMetrics> {
    const timestamp = new Date();

    try {
      // Collect CPU metrics
      const cpuData = await si.currentLoad();
      const cpuMetrics = {
        usage: cpuData.currentLoad,
        cores: cpuData.cpus?.length || 0,
        load: [cpuData.avgLoad || 0]
      };

      // Update Prometheus metrics
      this.cpuUsageGauge.set({ instance: 'main', core: 'all' }, cpuData.currentLoad);

      // Collect memory metrics
      const memData = await si.mem();
      const memoryMetrics = {
        total: memData.total,
        used: memData.used,
        free: memData.free,
        percentage: (memData.used / memData.total) * 100
      };

      this.memoryUsageGauge.set({ instance: 'main', type: 'total' }, memData.total);
      this.memoryUsageGauge.set({ instance: 'main', type: 'used' }, memData.used);
      this.memoryUsageGauge.set({ instance: 'main', type: 'free' }, memData.free);

      // Collect disk metrics
      const diskData = await si.fsSize();
      const diskMetrics = {
        total: diskData.reduce((sum, disk) => sum + disk.size, 0),
        used: diskData.reduce((sum, disk) => sum + disk.used, 0),
        free: diskData.reduce((sum, disk) => sum + disk.available, 0),
        percentage: diskData.reduce((sum, disk) => sum + disk.use, 0) / diskData.length
      };

      diskData.forEach(disk => {
        this.diskUsageGauge.set({ instance: 'main', device: disk.fs, type: 'total' }, disk.size);
        this.diskUsageGauge.set({ instance: 'main', device: disk.fs, type: 'used' }, disk.used);
        this.diskUsageGauge.set({ instance: 'main', device: disk.fs, type: 'free' }, disk.available);
      });

      // Collect network metrics
      const networkData = await si.networkStats();
      const networkMetrics = {
        bytesIn: networkData.reduce((sum, iface) => sum + iface.rx_bytes, 0),
        bytesOut: networkData.reduce((sum, iface) => sum + iface.tx_bytes, 0),
        packetsIn: networkData.reduce((sum, iface) => sum + iface.rx_sec, 0),
        packetsOut: networkData.reduce((sum, iface) => sum + iface.tx_sec, 0)
      };

      networkData.forEach(iface => {
        this.networkIOGauge.set({ instance: 'main', interface: iface.iface, direction: 'rx' }, iface.rx_bytes);
        this.networkIOGauge.set({ instance: 'main', interface: iface.iface, direction: 'tx' }, iface.tx_bytes);
      });

      // Collect process metrics
      const processData = await si.processes();
      const processMetrics: ProcessMetrics[] = processData.list
        .filter(proc => proc.pid > 0)
        .map(proc => ({
          pid: proc.pid,
          name: proc.name,
          cpu: proc.cpu,
          memory: proc.memRss || 0,
          disk: {
            read: 0,
            write: 0
          },
          network: {
            bytesIn: 0,
            bytesOut: 0
          },
          uptime: proc.started ? Date.now() - new Date(proc.started).getTime() : 0,
          status: proc.state
        }));

      this.processCountGauge.set({ instance: 'main', status: 'running' }, processMetrics.filter(p => p.status === 'running').length);
      this.processCountGauge.set({ instance: 'main', status: 'sleeping' }, processMetrics.filter(p => p.status === 'sleeping').length);

      const systemMetrics: SystemMetrics = {
        timestamp,
        cpu: cpuMetrics,
        memory: memoryMetrics,
        disk: diskMetrics,
        network: networkMetrics,
        processes: processMetrics
      };

      // Emit the collected metrics
      this.emit('metrics', systemMetrics);
      
      return systemMetrics;
    } catch (error) {
      this.logger.error(`Failed to collect system metrics: ${error}`);
      throw error;
    }
  }

  // Custom metric recording methods
  recordSessionDuration(sessionId: string, command: string, status: string, durationSeconds: number): void {
    this.sessionDurationHistogram
      .labels(sessionId, command, status)
      .observe(durationSeconds);
  }

  recordSessionError(sessionId: string, errorType: string, severity: string): void {
    this.sessionErrorCounter
      .labels(sessionId, errorType, severity)
      .inc();
  }

  recordCommandExecution(command: string, status: string, consoleType: string): void {
    this.commandExecutionCounter
      .labels(command, status, consoleType)
      .inc();
  }

  // Get specific metrics for external use
  async getCurrentCpuUsage(): Promise<number> {
    const cpuData = await si.currentLoad();
    return cpuData.currentLoad;
  }

  async getCurrentMemoryUsage(): Promise<{ used: number; total: number; percentage: number }> {
    const memData = await si.mem();
    return {
      used: memData.used,
      total: memData.total,
      percentage: (memData.used / memData.total) * 100
    };
  }

  async getCurrentDiskUsage(): Promise<{ used: number; total: number; percentage: number }> {
    const diskData = await si.fsSize();
    const total = diskData.reduce((sum, disk) => sum + disk.size, 0);
    const used = diskData.reduce((sum, disk) => sum + disk.used, 0);
    return {
      used,
      total,
      percentage: (used / total) * 100
    };
  }

  // Get Prometheus metrics endpoint data
  getMetrics(): string {
    return register.metrics();
  }

  // Clear all metrics
  clearMetrics(): void {
    register.clear();
    this.initializeMetrics();
  }

  destroy(): void {
    this.stopCollection();
    this.removeAllListeners();
    register.clear();
  }
}