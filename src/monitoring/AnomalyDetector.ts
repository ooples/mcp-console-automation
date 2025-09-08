import { EventEmitter } from 'events';
import { 
  mean, 
  standardDeviation, 
  quantileRankSorted, 
  linearRegression, 
  linearRegressionLine
} from 'simple-statistics';
import { Anomaly, SystemMetrics, ProcessMetrics } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

interface MetricSeries {
  timestamp: Date;
  value: number;
  sessionId?: string;
}

interface AnomalyDetectionConfig {
  enabled: boolean;
  thresholds: {
    cpu: { warning: number; critical: number };
    memory: { warning: number; critical: number };
    disk: { warning: number; critical: number };
    network: { warning: number; critical: number };
  };
  statisticalConfig: {
    windowSize: number;
    confidenceLevel: number;
    seasonalityPeriod: number;
  };
  patterns: {
    enablePatternDetection: boolean;
    minPatternLength: number;
    patternSimilarityThreshold: number;
  };
}

export class AnomalyDetector extends EventEmitter {
  private logger: Logger;
  private config: AnomalyDetectionConfig;
  private metricHistory: Map<string, MetricSeries[]> = new Map();
  private detectedAnomalies: Map<string, Anomaly> = new Map();
  private baselines: Map<string, { mean: number; stdDev: number; trend: number }> = new Map();
  private patterns: Map<string, number[]> = new Map();
  private isRunning: boolean = false;
  private detectionInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<AnomalyDetectionConfig>) {
    super();
    this.logger = new Logger('AnomalyDetector');
    
    this.config = {
      enabled: true,
      thresholds: {
        cpu: { warning: 75, critical: 90 },
        memory: { warning: 80, critical: 95 },
        disk: { warning: 85, critical: 95 },
        network: { warning: 1000000000, critical: 10000000000 } // 1GB/10GB
      },
      statisticalConfig: {
        windowSize: 100,
        confidenceLevel: 0.95,
        seasonalityPeriod: 24 // 24 data points for hourly seasonality
      },
      patterns: {
        enablePatternDetection: true,
        minPatternLength: 5,
        patternSimilarityThreshold: 0.8
      },
      ...config
    };
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting anomaly detection');

    // Run detection every 30 seconds
    this.detectionInterval = setInterval(() => {
      this.runDetection();
    }, 30000);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }

    this.logger.info('Stopped anomaly detection');
  }

  // Add new metrics data point
  addMetricData(metricName: string, value: number, sessionId?: string): void {
    if (!this.config.enabled) {
      return;
    }

    const series = this.metricHistory.get(metricName) || [];
    series.push({
      timestamp: new Date(),
      value,
      sessionId
    });

    // Keep only recent data to prevent memory leaks
    if (series.length > this.config.statisticalConfig.windowSize * 2) {
      series.splice(0, series.length - this.config.statisticalConfig.windowSize * 2);
    }

    this.metricHistory.set(metricName, series);

    // Update baseline if we have enough data
    if (series.length >= this.config.statisticalConfig.windowSize) {
      this.updateBaseline(metricName);
    }
  }

  // Process system metrics for anomaly detection
  processSystemMetrics(metrics: SystemMetrics): void {
    if (!this.config.enabled) {
      return;
    }

    // Add CPU metrics
    this.addMetricData('cpu_usage', metrics.cpu.usage);
    
    // Add memory metrics
    this.addMetricData('memory_usage', metrics.memory.percentage);
    
    // Add disk metrics
    this.addMetricData('disk_usage', metrics.disk.percentage);
    
    // Add network metrics
    const totalNetworkIO = metrics.network.bytesIn + metrics.network.bytesOut;
    this.addMetricData('network_io', totalNetworkIO);

    // Process individual processes for anomalies
    metrics.processes.forEach(process => {
      if (process.sessionId) {
        this.addMetricData(`process_cpu_${process.sessionId}`, process.cpu, process.sessionId);
        this.addMetricData(`process_memory_${process.sessionId}`, process.memory, process.sessionId);
      }
    });
  }

  // Run anomaly detection algorithms
  private async runDetection(): Promise<void> {
    const metricNames = Array.from(this.metricHistory.keys());
    
    for (const metricName of metricNames) {
      try {
        await this.detectAnomalies(metricName);
      } catch (error) {
        this.logger.error(`Error detecting anomalies for ${metricName}: ${error}`);
      }
    }
  }

  // Detect anomalies for a specific metric
  private async detectAnomalies(metricName: string): Promise<void> {
    const series = this.metricHistory.get(metricName);
    if (!series || series.length < this.config.statisticalConfig.windowSize) {
      return;
    }

    const values = series.map(s => s.value);
    const timestamps = series.map(s => s.timestamp);
    const currentValue = values[values.length - 1];
    const currentTime = timestamps[timestamps.length - 1];

    // 1. Threshold-based detection
    const thresholdAnomaly = this.detectThresholdAnomaly(metricName, currentValue, currentTime);
    if (thresholdAnomaly) {
      this.reportAnomaly(thresholdAnomaly);
    }

    // 2. Statistical anomaly detection (Z-score)
    const statisticalAnomaly = this.detectStatisticalAnomaly(metricName, values, currentValue, currentTime);
    if (statisticalAnomaly) {
      this.reportAnomaly(statisticalAnomaly);
    }

    // 3. Pattern-based anomaly detection
    if (this.config.patterns.enablePatternDetection) {
      const patternAnomaly = this.detectPatternAnomaly(metricName, values, currentValue, currentTime);
      if (patternAnomaly) {
        this.reportAnomaly(patternAnomaly);
      }
    }

    // 4. Trend-based anomaly detection
    const trendAnomaly = this.detectTrendAnomaly(metricName, values, timestamps, currentValue, currentTime);
    if (trendAnomaly) {
      this.reportAnomaly(trendAnomaly);
    }
  }

  // Threshold-based anomaly detection
  private detectThresholdAnomaly(metricName: string, value: number, timestamp: Date): Anomaly | null {
    const thresholds = this.getThresholdsForMetric(metricName);
    if (!thresholds) {
      return null;
    }

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let description = '';

    if (value >= thresholds.critical) {
      severity = 'critical';
      description = `${metricName} exceeded critical threshold: ${value.toFixed(2)} >= ${thresholds.critical}`;
    } else if (value >= thresholds.warning) {
      severity = 'high';
      description = `${metricName} exceeded warning threshold: ${value.toFixed(2)} >= ${thresholds.warning}`;
    } else {
      return null;
    }

    return {
      id: uuidv4(),
      timestamp,
      type: 'threshold',
      metric: metricName,
      value,
      expectedValue: thresholds.warning,
      deviation: value - thresholds.warning,
      confidence: 1.0,
      description,
      severity
    };
  }

  // Statistical anomaly detection using Z-score
  private detectStatisticalAnomaly(metricName: string, values: number[], currentValue: number, timestamp: Date): Anomaly | null {
    if (values.length < 10) {
      return null;
    }

    const recentValues = values.slice(-this.config.statisticalConfig.windowSize);
    const meanValue = mean(recentValues);
    const stdDev = standardDeviation(recentValues);

    if (stdDev === 0) {
      return null; // No variation, no anomaly
    }

    const zScore = Math.abs((currentValue - meanValue) / stdDev);
    const confidenceThreshold = this.getZScoreThreshold(this.config.statisticalConfig.confidenceLevel);

    if (zScore > confidenceThreshold) {
      let severity: 'low' | 'medium' | 'high' | 'critical';
      if (zScore > 4) severity = 'critical';
      else if (zScore > 3) severity = 'high';
      else if (zScore > 2) severity = 'medium';
      else severity = 'low';

      return {
        id: uuidv4(),
        timestamp,
        type: 'statistical',
        metric: metricName,
        value: currentValue,
        expectedValue: meanValue,
        deviation: Math.abs(currentValue - meanValue),
        confidence: Math.min(zScore / 4, 1.0),
        description: `${metricName} shows statistical anomaly: Z-score=${zScore.toFixed(2)}, value=${currentValue.toFixed(2)}, expected=${meanValue.toFixed(2)}±${stdDev.toFixed(2)}`,
        severity
      };
    }

    return null;
  }

  // Pattern-based anomaly detection
  private detectPatternAnomaly(metricName: string, values: number[], currentValue: number, timestamp: Date): Anomaly | null {
    const minLength = this.config.patterns.minPatternLength;
    if (values.length < minLength * 3) {
      return null;
    }

    // Extract recent pattern
    const recentPattern = values.slice(-minLength);
    const historicalPatterns = this.extractPatterns(values.slice(0, -minLength), minLength);

    if (historicalPatterns.length === 0) {
      return null;
    }

    // Find most similar historical pattern
    let maxSimilarity = 0;
    let mostSimilarPattern: number[] = [];

    historicalPatterns.forEach(pattern => {
      const similarity = this.calculatePatternSimilarity(recentPattern, pattern);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        mostSimilarPattern = pattern;
      }
    });

    // Check if current pattern deviates significantly from historical patterns
    if (maxSimilarity < this.config.patterns.patternSimilarityThreshold) {
      const expectedValue = mean(mostSimilarPattern);
      
      return {
        id: uuidv4(),
        timestamp,
        type: 'pattern',
        metric: metricName,
        value: currentValue,
        expectedValue,
        deviation: Math.abs(currentValue - expectedValue),
        confidence: 1 - maxSimilarity,
        description: `${metricName} shows unusual pattern: similarity=${maxSimilarity.toFixed(2)} below threshold=${this.config.patterns.patternSimilarityThreshold}`,
        severity: maxSimilarity < 0.5 ? 'high' : 'medium'
      };
    }

    return null;
  }

  // Trend-based anomaly detection
  private detectTrendAnomaly(metricName: string, values: number[], timestamps: Date[], currentValue: number, currentTimestamp: Date): Anomaly | null {
    if (values.length < 20) {
      return null;
    }

    // Convert timestamps to numeric values for regression
    const timePoints = timestamps.map(t => t.getTime());
    const dataPoints = timePoints.map((t, i) => [t, values[i]] as [number, number]);

    try {
      const regression = linearRegression(dataPoints);
      const regressionLine = linearRegressionLine(regression);
      
      const expectedValue = regressionLine(currentTimestamp.getTime());
      const deviation = Math.abs(currentValue - expectedValue);
      const meanDeviation = mean(values.slice(-10).map((v, i) => Math.abs(v - regressionLine(timePoints.slice(-10)[i]))));

      // Check if current deviation is significantly larger than recent deviations
      if (deviation > meanDeviation * 3) {
        return {
          id: uuidv4(),
          timestamp: currentTimestamp,
          type: 'statistical',
          metric: metricName,
          value: currentValue,
          expectedValue,
          deviation,
          confidence: Math.min(deviation / (meanDeviation * 3), 1.0),
          description: `${metricName} deviates from trend: expected=${expectedValue.toFixed(2)}, actual=${currentValue.toFixed(2)}, deviation=${deviation.toFixed(2)}`,
          severity: deviation > meanDeviation * 5 ? 'high' : 'medium'
        };
      }
    } catch (error) {
      this.logger.debug(`Trend analysis failed for ${metricName}: ${error}`);
    }

    return null;
  }

  // Extract patterns from time series data
  private extractPatterns(data: number[], patternLength: number): number[][] {
    const patterns: number[][] = [];
    for (let i = 0; i <= data.length - patternLength; i++) {
      patterns.push(data.slice(i, i + patternLength));
    }
    return patterns;
  }

  // Calculate similarity between two patterns using correlation
  private calculatePatternSimilarity(pattern1: number[], pattern2: number[]): number {
    if (pattern1.length !== pattern2.length) {
      return 0;
    }

    const n = pattern1.length;
    const mean1 = mean(pattern1);
    const mean2 = mean(pattern2);

    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;

    for (let i = 0; i < n; i++) {
      const diff1 = pattern1[i] - mean1;
      const diff2 = pattern2[i] - mean2;
      
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }

    if (denominator1 === 0 || denominator2 === 0) {
      return 0;
    }

    return Math.abs(numerator / Math.sqrt(denominator1 * denominator2));
  }

  // Update baseline statistics for a metric
  private updateBaseline(metricName: string): void {
    const series = this.metricHistory.get(metricName);
    if (!series || series.length < this.config.statisticalConfig.windowSize) {
      return;
    }

    const values = series.slice(-this.config.statisticalConfig.windowSize).map(s => s.value);
    const timestamps = series.slice(-this.config.statisticalConfig.windowSize).map(s => s.timestamp.getTime());
    
    const meanValue = mean(values);
    const stdDev = standardDeviation(values);
    
    // Calculate trend using linear regression
    let trend = 0;
    try {
      const dataPoints = timestamps.map((t, i) => [t, values[i]] as [number, number]);
      const regression = linearRegression(dataPoints);
      trend = regression.m; // slope
    } catch (error) {
      // Keep trend as 0 if regression fails
    }

    this.baselines.set(metricName, { mean: meanValue, stdDev, trend });
  }

  // Get appropriate thresholds for a metric
  private getThresholdsForMetric(metricName: string): { warning: number; critical: number } | null {
    if (metricName.includes('cpu')) {
      return this.config.thresholds.cpu;
    } else if (metricName.includes('memory')) {
      return this.config.thresholds.memory;
    } else if (metricName.includes('disk')) {
      return this.config.thresholds.disk;
    } else if (metricName.includes('network')) {
      return this.config.thresholds.network;
    }
    return null;
  }

  // Get Z-score threshold for confidence level
  private getZScoreThreshold(confidenceLevel: number): number {
    // Approximate Z-score thresholds for common confidence levels
    if (confidenceLevel >= 0.99) return 2.576;
    if (confidenceLevel >= 0.95) return 1.96;
    if (confidenceLevel >= 0.90) return 1.645;
    if (confidenceLevel >= 0.80) return 1.282;
    return 1.0;
  }

  // Report detected anomaly
  private reportAnomaly(anomaly: Anomaly): void {
    // Check if we already reported this anomaly recently (within 5 minutes)
    const recentAnomalies = Array.from(this.detectedAnomalies.values()).filter(
      a => a.metric === anomaly.metric && 
           a.timestamp.getTime() > Date.now() - 300000 &&
           a.type === anomaly.type
    );

    if (recentAnomalies.length > 0) {
      return; // Don't spam the same anomaly
    }

    this.detectedAnomalies.set(anomaly.id, anomaly);
    this.emit('anomaly-detected', anomaly);
    this.logger.warn(`Anomaly detected: ${anomaly.description}`);
  }

  // Get all detected anomalies
  getAnomalies(): Anomaly[] {
    return Array.from(this.detectedAnomalies.values());
  }

  // Get recent anomalies
  getRecentAnomalies(hours: number = 24): Anomaly[] {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return Array.from(this.detectedAnomalies.values())
      .filter(anomaly => anomaly.timestamp.getTime() > cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Get anomalies by severity
  getAnomaliesBySeverity(severity: 'low' | 'medium' | 'high' | 'critical'): Anomaly[] {
    return Array.from(this.detectedAnomalies.values())
      .filter(anomaly => anomaly.severity === severity);
  }

  // Get anomalies for a specific session
  getSessionAnomalies(sessionId: string): Anomaly[] {
    return Array.from(this.detectedAnomalies.values())
      .filter(anomaly => anomaly.sessionId === sessionId);
  }

  // Clear old anomalies to prevent memory leaks
  cleanupOldAnomalies(maxAge: number = 86400000): void { // 24 hours default
    const cutoff = Date.now() - maxAge;
    
    Array.from(this.detectedAnomalies.entries()).forEach(([id, anomaly]) => {
      if (anomaly.timestamp.getTime() < cutoff) {
        this.detectedAnomalies.delete(id);
      }
    });
  }

  // Get detection statistics
  getStats(): {
    enabled: boolean;
    metricsTracked: number;
    totalAnomalies: number;
    recentAnomalies: number;
    anomaliesBySeverity: Record<string, number>;
  } {
    const recentAnomalies = this.getRecentAnomalies();
    const anomaliesBySeverity = {
      low: this.getAnomaliesBySeverity('low').length,
      medium: this.getAnomaliesBySeverity('medium').length,
      high: this.getAnomaliesBySeverity('high').length,
      critical: this.getAnomaliesBySeverity('critical').length
    };

    return {
      enabled: this.config.enabled,
      metricsTracked: this.metricHistory.size,
      totalAnomalies: this.detectedAnomalies.size,
      recentAnomalies: recentAnomalies.length,
      anomaliesBySeverity
    };
  }

  // Update configuration
  updateConfig(newConfig: Partial<AnomalyDetectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Anomaly detection configuration updated');
  }

  destroy(): void {
    this.stop();
    this.metricHistory.clear();
    this.detectedAnomalies.clear();
    this.baselines.clear();
    this.patterns.clear();
    this.removeAllListeners();
  }
}