import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { ConsoleSession, ConsoleOutput, ErrorPattern } from '../types/index.js';
import { NaturalLanguageProcessor } from './NaturalLanguageProcessor.js';
import { ErrorRecoveryEngine } from './ErrorRecoveryEngine.js';
import { AnomalyDetector } from './AnomalyDetector.js';
import { LearningEngine } from './LearningEngine.js';
import { ResourceOptimizer } from './ResourceOptimizer.js';
import { ContextEngine } from './ContextEngine.js';

export interface AIConfig {
  enableNLP: boolean;
  enableErrorRecovery: boolean;
  enableAnomalyDetection: boolean;
  enableLearning: boolean;
  enableResourceOptimization: boolean;
  enableContextAwareness: boolean;
  aiModelEndpoint?: string;
  aiModelKey?: string;
  learningDataPath?: string;
  maxContextHistory: number;
}

export interface AIInsight {
  type: 'command_suggestion' | 'error_prediction' | 'anomaly_detected' | 'optimization_suggestion' | 'recovery_recommendation';
  confidence: number;
  message: string;
  data: any;
  timestamp: Date;
  sessionId?: string;
}

export interface CommandInterpretation {
  originalQuery: string;
  interpretedCommand: string;
  confidence: number;
  alternatives: Array<{ command: string; confidence: number }>;
  parameters: Record<string, any>;
  reasoning: string;
}

export interface RecoveryAction {
  type: 'retry' | 'modify_command' | 'change_environment' | 'escalate' | 'ignore';
  description: string;
  command?: string;
  parameters?: Record<string, any>;
  confidence: number;
  estimatedDuration?: number;
}

export interface AnomalyReport {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'performance' | 'security' | 'resource' | 'behavior' | 'error_pattern';
  description: string;
  evidence: string[];
  suggestedActions: string[];
  timestamp: Date;
  sessionId: string;
}

export class AICore extends EventEmitter {
  private config: AIConfig;
  private logger: Logger;
  private nlp?: NaturalLanguageProcessor;
  private errorRecovery?: ErrorRecoveryEngine;
  private anomalyDetector?: AnomalyDetector;
  private learningEngine?: LearningEngine;
  private resourceOptimizer?: ResourceOptimizer;
  private contextEngine?: ContextEngine;
  private insights: Map<string, AIInsight[]> = new Map();

  constructor(config: AIConfig) {
    super();
    this.config = config;
    this.logger = new Logger('AICore');
    
    this.initializeComponents();
  }

  private initializeComponents() {
    if (this.config.enableNLP) {
      this.nlp = new NaturalLanguageProcessor(this.config);
      this.logger.info('Natural Language Processor initialized');
    }

    if (this.config.enableErrorRecovery) {
      this.errorRecovery = new ErrorRecoveryEngine(this.config);
      this.logger.info('Error Recovery Engine initialized');
    }

    if (this.config.enableAnomalyDetection) {
      this.anomalyDetector = new AnomalyDetector(this.config);
      this.logger.info('Anomaly Detector initialized');
    }

    if (this.config.enableLearning) {
      this.learningEngine = new LearningEngine(this.config);
      this.logger.info('Learning Engine initialized');
    }

    if (this.config.enableResourceOptimization) {
      this.resourceOptimizer = new ResourceOptimizer(this.config);
      this.logger.info('Resource Optimizer initialized');
    }

    if (this.config.enableContextAwareness) {
      this.contextEngine = new ContextEngine(this.config);
      this.logger.info('Context Engine initialized');
    }
  }

  async interpretNaturalLanguage(query: string, context?: any): Promise<CommandInterpretation> {
    if (!this.nlp) {
      throw new Error('Natural Language Processing is not enabled');
    }

    const interpretation = await this.nlp.interpret(query, context);
    
    this.addInsight({
      type: 'command_suggestion',
      confidence: interpretation.confidence,
      message: `Interpreted "${query}" as "${interpretation.interpretedCommand}"`,
      data: interpretation,
      timestamp: new Date()
    });

    return interpretation;
  }

  async analyzeError(
    error: string, 
    sessionId: string, 
    context: { command: string; output: string; environment: Record<string, string> }
  ): Promise<RecoveryAction[]> {
    if (!this.errorRecovery) {
      return [];
    }

    const actions = await this.errorRecovery.analyzeAndRecover(error, sessionId, context);
    
    if (actions.length > 0) {
      this.addInsight({
        type: 'recovery_recommendation',
        confidence: Math.max(...actions.map(a => a.confidence)),
        message: `Found ${actions.length} recovery options for error in session ${sessionId}`,
        data: { error, actions },
        timestamp: new Date(),
        sessionId
      });
    }

    return actions;
  }

  async detectAnomalies(sessionId: string, output: ConsoleOutput[], metrics: any): Promise<AnomalyReport[]> {
    if (!this.anomalyDetector) {
      return [];
    }

    const anomalies = await this.anomalyDetector.analyze(sessionId, output, metrics);
    
    if (anomalies.length > 0) {
      for (const anomaly of anomalies) {
        this.addInsight({
          type: 'anomaly_detected',
          confidence: 0.8, // Based on anomaly severity
          message: `${anomaly.severity.toUpperCase()}: ${anomaly.description}`,
          data: anomaly,
          timestamp: new Date(),
          sessionId
        });
      }
    }

    return anomalies;
  }

  async optimizeResources(sessions: ConsoleSession[], currentUsage: any): Promise<any> {
    if (!this.resourceOptimizer) {
      return null;
    }

    const optimization = await this.resourceOptimizer.analyze(sessions, currentUsage);
    
    if (optimization) {
      this.addInsight({
        type: 'optimization_suggestion',
        confidence: optimization.confidence,
        message: optimization.description,
        data: optimization,
        timestamp: new Date()
      });
    }

    return optimization;
  }

  async predictNextCommand(sessionId: string, commandHistory: string[]): Promise<string[]> {
    if (!this.learningEngine) {
      return [];
    }

    const predictions = await this.learningEngine.predictNext(sessionId, commandHistory);
    return predictions;
  }

  async learnFromExecution(
    sessionId: string, 
    command: string, 
    success: boolean, 
    output: string, 
    duration: number,
    context: any
  ): Promise<void> {
    if (this.learningEngine) {
      await this.learningEngine.recordExecution({
        sessionId,
        command,
        success,
        output,
        duration,
        context,
        timestamp: new Date()
      });
    }

    // Update context if available
    if (this.contextEngine) {
      await this.contextEngine.updateContext(sessionId, {
        command,
        success,
        output,
        duration,
        timestamp: new Date()
      });
    }
  }

  async getContextualSuggestions(sessionId: string, currentCommand?: string): Promise<string[]> {
    if (!this.contextEngine) {
      return [];
    }

    return await this.contextEngine.getSuggestions(sessionId, currentCommand);
  }

  async getSmartCompletion(sessionId: string, partialCommand: string): Promise<string[]> {
    const suggestions: string[] = [];

    // Get context-aware suggestions
    if (this.contextEngine) {
      const contextual = await this.contextEngine.getCompletions(sessionId, partialCommand);
      suggestions.push(...contextual);
    }

    // Get learning-based predictions
    if (this.learningEngine) {
      const predictions = await this.learningEngine.getCompletions(partialCommand);
      suggestions.push(...predictions);
    }

    // Remove duplicates and sort by relevance
    return [...new Set(suggestions)].slice(0, 10);
  }

  getInsights(sessionId?: string, limit: number = 20): AIInsight[] {
    if (sessionId) {
      return (this.insights.get(sessionId) || []).slice(-limit);
    }

    // Get global insights
    const allInsights: AIInsight[] = [];
    for (const insights of this.insights.values()) {
      allInsights.push(...insights);
    }

    return allInsights
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  private addInsight(insight: AIInsight) {
    const key = insight.sessionId || 'global';
    const insights = this.insights.get(key) || [];
    
    insights.push(insight);
    
    // Keep only last 100 insights per session
    if (insights.length > 100) {
      insights.splice(0, insights.length - 100);
    }
    
    this.insights.set(key, insights);
    this.emit('insight', insight);
  }

  async generateSummary(sessionId: string): Promise<string> {
    const insights = this.getInsights(sessionId, 50);
    const summary = {
      totalInsights: insights.length,
      errorRecoveries: insights.filter(i => i.type === 'recovery_recommendation').length,
      anomaliesDetected: insights.filter(i => i.type === 'anomaly_detected').length,
      commandSuggestions: insights.filter(i => i.type === 'command_suggestion').length,
      optimizations: insights.filter(i => i.type === 'optimization_suggestion').length,
      recentActivity: insights.slice(-5).map(i => ({
        type: i.type,
        message: i.message,
        confidence: i.confidence,
        timestamp: i.timestamp
      }))
    };

    return JSON.stringify(summary, null, 2);
  }

  async getHealthReport(): Promise<any> {
    const components = {
      nlp: !!this.nlp,
      errorRecovery: !!this.errorRecovery,
      anomalyDetection: !!this.anomalyDetector,
      learning: !!this.learningEngine,
      resourceOptimization: !!this.resourceOptimizer,
      contextAwareness: !!this.contextEngine
    };

    const totalInsights = Array.from(this.insights.values())
      .reduce((sum, insights) => sum + insights.length, 0);

    return {
      components,
      config: this.config,
      statistics: {
        totalInsights,
        activeSessions: this.insights.size,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      },
      lastActivity: this.getInsights(undefined, 1)[0]?.timestamp
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down AI Core...');
    
    if (this.learningEngine) {
      await this.learningEngine.save();
    }

    this.removeAllListeners();
    this.insights.clear();
  }
}