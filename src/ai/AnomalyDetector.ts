import { AIConfig, AnomalyReport } from './AICore.js';
import { ConsoleOutput } from '../types/index.js';
import { Logger } from '../utils/logger.js';

interface Baseline {
  executionTime: { mean: number; std: number; samples: number };
  outputLength: { mean: number; std: number; samples: number };
  errorRate: number;
  commonPatterns: Array<{ pattern: string; frequency: number }>;
  resourceUsage: { cpu: number; memory: number };
  lastUpdated: Date;
}

interface PerformanceMetrics {
  executionTime: number;
  outputLength: number;
  cpuUsage: number;
  memoryUsage: number;
  errorOccurred: boolean;
}

interface AnomalyRule {
  name: string;
  description: string;
  detector: (baseline: Baseline, current: PerformanceMetrics, output: ConsoleOutput[]) => AnomalyReport | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'performance' | 'security' | 'resource' | 'behavior' | 'error_pattern';
}

export class AnomalyDetector {
  private logger: Logger;
  private config: AIConfig;
  private baselines: Map<string, Baseline> = new Map();
  private anomalyRules: AnomalyRule[];
  private detectionHistory: Map<string, AnomalyReport[]> = new Map();

  constructor(config: AIConfig) {
    this.config = config;
    this.logger = new Logger('AnomalyDetector');
    this.initializeAnomalyRules();
  }

  private initializeAnomalyRules() {
    this.anomalyRules = [
      // Performance anomalies
      {
        name: 'execution_time_spike',
        description: 'Command execution time significantly higher than baseline',
        severity: 'medium',
        category: 'performance',
        detector: (baseline, current, output) => {
          if (baseline.executionTime.samples < 5) return null;
          
          const threshold = baseline.executionTime.mean + (3 * baseline.executionTime.std);
          if (current.executionTime > threshold && current.executionTime > 5000) {
            return {
              severity: current.executionTime > threshold * 2 ? 'high' : 'medium',
              type: 'performance',
              description: `Execution time (${current.executionTime}ms) is ${((current.executionTime / baseline.executionTime.mean) * 100).toFixed(1)}% higher than baseline`,
              evidence: [
                `Current: ${current.executionTime}ms`,
                `Baseline mean: ${baseline.executionTime.mean.toFixed(1)}ms`,
                `Threshold: ${threshold.toFixed(1)}ms`
              ],
              suggestedActions: [
                'Check system resource usage',
                'Review recent system changes',
                'Monitor for resource bottlenecks',
                'Consider command optimization'
              ],
              timestamp: new Date(),
              sessionId: ''
            };
          }
          return null;
        }
      },

      // Resource usage anomalies
      {
        name: 'memory_consumption_spike',
        description: 'Unusual memory consumption detected',
        severity: 'high',
        category: 'resource',
        detector: (baseline, current, output) => {
          const memoryThreshold = baseline.resourceUsage.memory * 2;
          if (current.memoryUsage > memoryThreshold && current.memoryUsage > 100 * 1024 * 1024) { // > 100MB
            return {
              severity: current.memoryUsage > memoryThreshold * 2 ? 'critical' : 'high',
              type: 'resource',
              description: `Memory usage (${(current.memoryUsage / 1024 / 1024).toFixed(1)}MB) is abnormally high`,
              evidence: [
                `Current memory: ${(current.memoryUsage / 1024 / 1024).toFixed(1)}MB`,
                `Baseline memory: ${(baseline.resourceUsage.memory / 1024 / 1024).toFixed(1)}MB`,
                `Threshold: ${(memoryThreshold / 1024 / 1024).toFixed(1)}MB`
              ],
              suggestedActions: [
                'Check for memory leaks',
                'Monitor running processes',
                'Review command for memory-intensive operations',
                'Consider system resources cleanup'
              ],
              timestamp: new Date(),
              sessionId: ''
            };
          }
          return null;
        }
      },

      // Security anomalies
      {
        name: 'suspicious_command_pattern',
        description: 'Potentially malicious command patterns detected',
        severity: 'critical',
        category: 'security',
        detector: (baseline, current, output) => {
          const suspiciousPatterns = [
            /rm\s+-rf\s+\/(?!tmp|var\/tmp)/,  // Dangerous deletion outside safe dirs
            /chmod\s+777/,  // Overly permissive permissions
            /wget|curl.*sh\s*$/,  // Downloading and executing scripts
            /nc\s+-l.*-e/,  // Netcat reverse shells
            /\/dev\/tcp\/.*\/.*exec/,  // TCP backdoors
            /base64\s+-d.*bash/,  // Obfuscated commands
            /python.*-c.*exec|eval/,  // Python code execution
            /\.\.\/\.\.\/\.\./,  // Path traversal attempts
            /passwd.*root/,  // Password changes for root
            /sudo\s+su\s+-/  // Privilege escalation
          ];

          const outputText = output.map(o => o.data).join('\n');
          
          for (const pattern of suspiciousPatterns) {
            if (pattern.test(outputText)) {
              return {
                severity: 'critical',
                type: 'security',
                description: 'Suspicious command pattern detected that may indicate malicious activity',
                evidence: [
                  `Pattern detected: ${pattern.toString()}`,
                  `Command output: ${outputText.substring(0, 200)}...`,
                  'This pattern is associated with potential security risks'
                ],
                suggestedActions: [
                  'Review the command for legitimacy',
                  'Check if this was intentional',
                  'Audit recent system access',
                  'Consider additional security monitoring',
                  'Verify system integrity'
                ],
                timestamp: new Date(),
                sessionId: ''
              };
            }
          }
          return null;
        }
      },

      // Behavioral anomalies
      {
        name: 'unusual_error_rate',
        description: 'Error rate significantly higher than baseline',
        severity: 'medium',
        category: 'behavior',
        detector: (baseline, current, output) => {
          if (baseline.errorRate < 0.1) return null; // Not enough data
          
          const currentErrors = output.filter(o => o.type === 'stderr' || 
            /error|exception|failed|fatal/i.test(o.data)).length;
          const currentErrorRate = currentErrors / Math.max(output.length, 1);
          
          if (currentErrorRate > baseline.errorRate * 3 && currentErrorRate > 0.3) {
            return {
              severity: currentErrorRate > 0.7 ? 'high' : 'medium',
              type: 'behavior',
              description: `Error rate (${(currentErrorRate * 100).toFixed(1)}%) is significantly higher than baseline`,
              evidence: [
                `Current error rate: ${(currentErrorRate * 100).toFixed(1)}%`,
                `Baseline error rate: ${(baseline.errorRate * 100).toFixed(1)}%`,
                `Errors in output: ${currentErrors}/${output.length} lines`
              ],
              suggestedActions: [
                'Review recent changes to the command or environment',
                'Check system logs for related issues',
                'Validate input parameters and environment setup',
                'Consider reverting recent changes'
              ],
              timestamp: new Date(),
              sessionId: ''
            };
          }
          return null;
        }
      },

      // Output pattern anomalies
      {
        name: 'unexpected_output_pattern',
        description: 'Output contains patterns not seen in baseline behavior',
        severity: 'medium',
        category: 'behavior',
        detector: (baseline, current, output) => {
          const outputText = output.map(o => o.data).join('\n').toLowerCase();
          
          // Check for new critical patterns
          const criticalPatterns = [
            /core dumped/,
            /segmentation fault/,
            /stack smashing detected/,
            /heap corruption/,
            /double free/,
            /use after free/,
            /buffer overflow/,
            /access violation/
          ];

          for (const pattern of criticalPatterns) {
            if (pattern.test(outputText)) {
              return {
                severity: 'critical',
                type: 'error_pattern',
                description: 'Critical system error pattern detected in output',
                evidence: [
                  `Pattern: ${pattern.toString()}`,
                  `Output sample: ${outputText.substring(outputText.search(pattern) - 50, outputText.search(pattern) + 100)}`
                ],
                suggestedActions: [
                  'Stop the current process immediately',
                  'Check system stability',
                  'Review memory usage and system resources',
                  'Consider system restart if problems persist',
                  'Check for corrupted files or hardware issues'
                ],
                timestamp: new Date(),
                sessionId: ''
              };
            }
          }

          // Check for unusual output volume
          if (baseline.outputLength.samples > 5) {
            const threshold = baseline.outputLength.mean + (2 * baseline.outputLength.std);
            if (current.outputLength > threshold * 3) {
              return {
                severity: 'medium',
                type: 'behavior',
                description: 'Output volume is significantly higher than baseline',
                evidence: [
                  `Current output length: ${current.outputLength} lines`,
                  `Baseline mean: ${baseline.outputLength.mean.toFixed(1)} lines`,
                  `This may indicate infinite loops or verbose error messages`
                ],
                suggestedActions: [
                  'Check for infinite loops in the command',
                  'Review command parameters',
                  'Monitor system resources',
                  'Consider adding output limits'
                ],
                timestamp: new Date(),
                sessionId: ''
              };
            }
          }

          return null;
        }
      },

      // Network behavior anomalies
      {
        name: 'unusual_network_activity',
        description: 'Unusual network-related patterns detected',
        severity: 'high',
        category: 'security',
        detector: (baseline, current, output) => {
          const outputText = output.map(o => o.data).join('\n');
          
          // Look for signs of network scanning or suspicious connections
          const networkPatterns = [
            /port.*scan/i,
            /nmap/i,
            /connecting to.*on port/i,
            /connection established.*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
            /downloading.*from.*http/i,
            /uploading.*to.*http/i
          ];

          let networkActivity = 0;
          const detectedPatterns: string[] = [];

          for (const pattern of networkPatterns) {
            if (pattern.test(outputText)) {
              networkActivity++;
              detectedPatterns.push(pattern.toString());
            }
          }

          if (networkActivity >= 2) {
            return {
              severity: networkActivity >= 3 ? 'critical' : 'high',
              type: 'security',
              description: 'Multiple network activity patterns detected',
              evidence: [
                `Detected ${networkActivity} network patterns`,
                `Patterns: ${detectedPatterns.join(', ')}`,
                `Output sample: ${outputText.substring(0, 300)}...`
              ],
              suggestedActions: [
                'Review network activity for legitimacy',
                'Check firewall logs',
                'Monitor network connections',
                'Verify the command purpose and authorization',
                'Consider network security audit'
              ],
              timestamp: new Date(),
              sessionId: ''
            };
          }

          return null;
        }
      }
    ];

    this.logger.info(`Initialized ${this.anomalyRules.length} anomaly detection rules`);
  }

  async analyze(
    sessionId: string,
    output: ConsoleOutput[],
    metrics: PerformanceMetrics
  ): Promise<AnomalyReport[]> {
    const baseline = this.getBaseline(sessionId);
    const anomalies: AnomalyReport[] = [];

    // Run all anomaly detection rules
    for (const rule of this.anomalyRules) {
      try {
        const anomaly = rule.detector(baseline, metrics, output);
        if (anomaly) {
          anomaly.sessionId = sessionId;
          anomalies.push(anomaly);
          
          this.logger.warn(`Anomaly detected [${rule.name}]: ${anomaly.description}`);
        }
      } catch (error) {
        this.logger.error(`Error in anomaly rule ${rule.name}: ${error}`);
      }
    }

    // Update baseline with current metrics
    this.updateBaseline(sessionId, metrics, output);

    // Record anomalies in history
    if (anomalies.length > 0) {
      const history = this.detectionHistory.get(sessionId) || [];
      history.push(...anomalies);
      
      // Keep only last 100 anomalies per session
      if (history.length > 100) {
        history.splice(0, history.length - 100);
      }
      
      this.detectionHistory.set(sessionId, history);
    }

    return anomalies;
  }

  private getBaseline(sessionId: string): Baseline {
    if (!this.baselines.has(sessionId)) {
      // Initialize baseline with default values
      this.baselines.set(sessionId, {
        executionTime: { mean: 1000, std: 500, samples: 0 },
        outputLength: { mean: 10, std: 5, samples: 0 },
        errorRate: 0.05,
        commonPatterns: [],
        resourceUsage: { cpu: 10, memory: 50 * 1024 * 1024 }, // 50MB default
        lastUpdated: new Date()
      });
    }
    
    return this.baselines.get(sessionId)!;
  }

  private updateBaseline(sessionId: string, metrics: PerformanceMetrics, output: ConsoleOutput[]): void {
    const baseline = this.getBaseline(sessionId);
    
    // Update execution time statistics using moving average
    this.updateStatistic(baseline.executionTime, metrics.executionTime);
    
    // Update output length statistics
    this.updateStatistic(baseline.outputLength, metrics.outputLength);
    
    // Update error rate using exponential moving average
    const currentErrorRate = output.filter(o => 
      o.type === 'stderr' || /error|exception|failed/i.test(o.data)
    ).length / Math.max(output.length, 1);
    
    baseline.errorRate = baseline.errorRate * 0.9 + currentErrorRate * 0.1;
    
    // Update resource usage
    baseline.resourceUsage.memory = baseline.resourceUsage.memory * 0.8 + metrics.memoryUsage * 0.2;
    baseline.resourceUsage.cpu = baseline.resourceUsage.cpu * 0.8 + metrics.cpuUsage * 0.2;
    
    // Update common patterns
    this.updateCommonPatterns(baseline, output);
    
    baseline.lastUpdated = new Date();
  }

  private updateStatistic(stat: { mean: number; std: number; samples: number }, newValue: number): void {
    stat.samples++;
    
    if (stat.samples === 1) {
      stat.mean = newValue;
      stat.std = 0;
    } else {
      // Online algorithm for mean and standard deviation
      const oldMean = stat.mean;
      stat.mean = oldMean + (newValue - oldMean) / stat.samples;
      stat.std = Math.sqrt(
        ((stat.samples - 1) * Math.pow(stat.std, 2) + (newValue - oldMean) * (newValue - stat.mean)) / stat.samples
      );
    }
  }

  private updateCommonPatterns(baseline: Baseline, output: ConsoleOutput[]): void {
    const outputText = output.map(o => o.data).join('\n');
    
    // Extract patterns (simple word-based for now)
    const words = outputText.toLowerCase().match(/\w+/g) || [];
    const wordCounts: Record<string, number> = {};
    
    for (const word of words) {
      if (word.length > 3) { // Ignore very short words
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    }
    
    // Update pattern frequencies
    for (const [pattern, count] of Object.entries(wordCounts)) {
      const existingPattern = baseline.commonPatterns.find(p => p.pattern === pattern);
      if (existingPattern) {
        existingPattern.frequency = existingPattern.frequency * 0.9 + count * 0.1;
      } else if (count > 2) {
        baseline.commonPatterns.push({ pattern, frequency: count });
      }
    }
    
    // Keep only top 50 patterns
    baseline.commonPatterns.sort((a, b) => b.frequency - a.frequency);
    baseline.commonPatterns = baseline.commonPatterns.slice(0, 50);
  }

  getAnomalyHistory(sessionId: string, limit: number = 20): AnomalyReport[] {
    return (this.detectionHistory.get(sessionId) || []).slice(-limit);
  }

  getAnomalyStatistics(sessionId?: string): any {
    if (sessionId) {
      const history = this.detectionHistory.get(sessionId) || [];
      const severityCount = {
        low: history.filter(a => a.severity === 'low').length,
        medium: history.filter(a => a.severity === 'medium').length,
        high: history.filter(a => a.severity === 'high').length,
        critical: history.filter(a => a.severity === 'critical').length
      };
      
      const typeCount = history.reduce((acc, anomaly) => {
        acc[anomaly.type] = (acc[anomaly.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        sessionId,
        totalAnomalies: history.length,
        severityBreakdown: severityCount,
        typeBreakdown: typeCount,
        recentAnomalies: history.slice(-5).map(a => ({
          type: a.type,
          severity: a.severity,
          description: a.description,
          timestamp: a.timestamp
        }))
      };
    }

    // Global statistics
    let totalAnomalies = 0;
    const globalSeverityCount = { low: 0, medium: 0, high: 0, critical: 0 };
    const globalTypeCount: Record<string, number> = {};

    this.detectionHistory.forEach(history => {
      totalAnomalies += history.length;
      history.forEach(anomaly => {
        globalSeverityCount[anomaly.severity]++;
        globalTypeCount[anomaly.type] = (globalTypeCount[anomaly.type] || 0) + 1;
      });
    });

    return {
      globalStats: {
        totalAnomalies,
        activeSessions: this.detectionHistory.size,
        totalBaselines: this.baselines.size,
        averageAnomaliesPerSession: this.detectionHistory.size > 0 ? totalAnomalies / this.detectionHistory.size : 0
      },
      severityBreakdown: globalSeverityCount,
      typeBreakdown: globalTypeCount,
      rulesActive: this.anomalyRules.length
    };
  }

  getBaselines(): Map<string, Baseline> {
    return new Map(this.baselines);
  }

  clearBaseline(sessionId: string): void {
    this.baselines.delete(sessionId);
    this.detectionHistory.delete(sessionId);
    this.logger.info(`Cleared baseline and history for session ${sessionId}`);
  }

  addCustomRule(rule: AnomalyRule): void {
    this.anomalyRules.push(rule);
    this.logger.info(`Added custom anomaly rule: ${rule.name}`);
  }

  getActiveRules(): AnomalyRule[] {
    return [...this.anomalyRules];
  }

  // Method to get performance metrics from system
  async getSystemMetrics(): Promise<Partial<PerformanceMetrics>> {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      return {
        memoryUsage: memUsage.heapUsed,
        cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000 // Convert to percentage approximation
      };
    } catch (error) {
      this.logger.warn(`Failed to get system metrics: ${error}`);
      return {};
    }
  }
}