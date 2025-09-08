import { ConsoleManager } from '../core/ConsoleManager.js';
import { SessionOptions, ConsoleOutput } from '../types/index.js';
import { AICore, AIConfig, RecoveryAction, AnomalyReport } from './AICore.js';
import { Logger } from '../utils/logger.js';

export class EnhancedConsoleManager extends ConsoleManager {
  private aiCore: AICore;
  private logger: Logger;

  constructor(aiConfig: AIConfig) {
    super();
    this.logger = new Logger('EnhancedConsoleManager');
    this.aiCore = new AICore(aiConfig);
    
    this.setupAIIntegration();
  }

  private setupAIIntegration() {
    // Listen to console events and feed them to AI
    this.on('console-event', async (event) => {
      try {
        await this.handleEventWithAI(event);
      } catch (error) {
        this.logger.error(`AI integration error: ${error}`);
      }
    });

    // Listen to AI insights
    this.aiCore.on('insight', (insight) => {
      this.logger.info(`AI Insight [${insight.type}]: ${insight.message} (confidence: ${insight.confidence})`);
    });
  }

  private async handleEventWithAI(event: any) {
    const sessionId = event.sessionId;

    if (event.type === 'output') {
      const session = this.getSession(sessionId);
      if (!session) return;

      const outputData = event.data as ConsoleOutput;
      const outputs = this.getOutput(sessionId, 50);

      // Detect anomalies
      const metrics = {
        executionTime: Date.now() - session.createdAt.getTime(),
        outputLength: outputs.length,
        cpuUsage: 0, // Would be measured in real implementation
        memoryUsage: process.memoryUsage().heapUsed,
        errorOccurred: outputData.type === 'stderr'
      };

      const anomalies = await this.aiCore.detectAnomalies(sessionId, outputs, metrics);
      if (anomalies.length > 0) {
        this.logger.warn(`Anomalies detected in session ${sessionId}:`, anomalies);
      }

      // Check for errors and suggest recovery
      if (outputData.type === 'stderr' || /error|exception|failed/i.test(outputData.data)) {
        const recoveryActions = await this.aiCore.analyzeError(
          outputData.data,
          sessionId,
          {
            command: session.command,
            output: outputData.data,
            environment: session.env
          }
        );

        if (recoveryActions.length > 0) {
          this.logger.info(`Recovery suggestions for session ${sessionId}:`, recoveryActions);
        }
      }
    }

    if (event.type === 'stopped') {
      const session = this.getSession(sessionId);
      if (session) {
        const duration = Date.now() - session.createdAt.getTime();
        const success = event.data.exitCode === 0;
        const output = this.getOutput(sessionId).map(o => o.data).join('\n');

        // Learn from this execution
        await this.aiCore.learnFromExecution(
          sessionId,
          session.command,
          success,
          output,
          duration,
          {
            cwd: session.cwd,
            env: session.env,
            exitCode: event.data.exitCode
          }
        );
      }
    }
  }

  // Enhanced session creation with AI integration
  async createSessionWithAI(options: SessionOptions, naturalLanguageQuery?: string): Promise<string> {
    let processedOptions = { ...options };

    // If natural language query provided, interpret it
    if (naturalLanguageQuery) {
      try {
        const interpretation = await this.aiCore.interpretNaturalLanguage(
          naturalLanguageQuery,
          {
            cwd: options.cwd || process.cwd(),
            env: options.env,
            recentCommands: [] // Could be enhanced with session history
          }
        );

        processedOptions.command = interpretation.interpretedCommand;
        this.logger.info(`NL interpretation: "${naturalLanguageQuery}" -> "${interpretation.interpretedCommand}"`);
      } catch (error) {
        this.logger.warn(`NL interpretation failed: ${error}`);
        // Fall back to original command
      }
    }

    return this.createSession(processedOptions);
  }

  // Get AI-powered command suggestions
  async getSmartSuggestions(sessionId: string, partialCommand?: string): Promise<string[]> {
    return this.aiCore.getSmartCompletion(sessionId, partialCommand || '');
  }

  // Get contextual suggestions
  async getContextualSuggestions(sessionId: string): Promise<string[]> {
    return this.aiCore.getContextualSuggestions(sessionId);
  }

  // Predict next likely commands
  async predictNextCommands(sessionId: string): Promise<string[]> {
    const session = this.getSession(sessionId);
    if (!session) return [];

    const outputs = this.getOutput(sessionId, 20);
    const commandHistory = outputs
      .filter(o => o.type === 'stdout')
      .map(o => o.data)
      .filter(data => data.trim().length > 0)
      .slice(-10);

    return this.aiCore.predictNextCommand(sessionId, commandHistory);
  }

  // Auto-recover from errors
  async attemptAutoRecovery(sessionId: string): Promise<{ success: boolean; action?: RecoveryAction; newSessionId?: string }> {
    const session = this.getSession(sessionId);
    if (!session) {
      return { success: false };
    }

    const outputs = this.getOutput(sessionId);
    const errorOutput = outputs.filter(o => o.type === 'stderr').map(o => o.data).join('\n');
    
    if (!errorOutput) {
      return { success: false };
    }

    const recoveryActions = await this.aiCore.analyzeError(
      errorOutput,
      sessionId,
      {
        command: session.command,
        output: errorOutput,
        environment: session.env
      }
    );

    if (recoveryActions.length === 0) {
      return { success: false };
    }

    const bestAction = recoveryActions[0];
    
    try {
      let newSessionId: string | undefined;

      switch (bestAction.type) {
        case 'retry':
          newSessionId = await this.createSession({
            command: session.command,
            args: session.args,
            cwd: session.cwd,
            env: session.env,
            consoleType: session.type
          });
          break;

        case 'modify_command':
          if (bestAction.command) {
            newSessionId = await this.createSession({
              command: bestAction.command,
              cwd: session.cwd,
              env: session.env,
              consoleType: session.type
            });
          }
          break;

        case 'change_environment':
          const newEnv = { ...session.env, ...bestAction.parameters };
          newSessionId = await this.createSession({
            command: session.command,
            args: session.args,
            cwd: session.cwd,
            env: newEnv,
            consoleType: session.type
          });
          break;
      }

      this.logger.info(`Auto-recovery attempted for session ${sessionId}: ${bestAction.description}`);
      
      return {
        success: true,
        action: bestAction,
        newSessionId
      };

    } catch (error) {
      this.logger.error(`Auto-recovery failed: ${error}`);
      return { success: false, action: bestAction };
    }
  }

  // Optimize resources using AI
  async optimizeResources(): Promise<{ optimized: boolean; description?: string }> {
    const sessions = this.getAllSessions();
    const usage = this.getResourceUsage();

    const optimization = await this.aiCore.optimizeResources(sessions, usage);
    
    if (!optimization) {
      return { optimized: false };
    }

    this.logger.info(`Resource optimization suggestion: ${optimization.description}`);
    
    // For now, just return the suggestion. In a full implementation, 
    // this would actually apply the optimization
    return {
      optimized: true,
      description: optimization.description
    };
  }

  // Get AI insights for a session
  getAIInsights(sessionId: string, limit: number = 10): any[] {
    return this.aiCore.getInsights(sessionId, limit);
  }

  // Generate AI summary of session
  async generateSessionSummary(sessionId: string): Promise<string> {
    return this.aiCore.generateSummary(sessionId);
  }

  // Get AI health report
  async getAIHealthReport(): Promise<any> {
    return this.aiCore.getHealthReport();
  }

  // Enhanced execute command with AI monitoring
  async executeCommandWithAI(
    command: string, 
    args?: string[], 
    options?: Partial<SessionOptions>,
    enableRecovery: boolean = true
  ): Promise<{ output: string; exitCode?: number; recoveryAttempted?: boolean; originalError?: string }> {
    
    let sessionId: string;
    
    // Try natural language interpretation if the command seems like natural language
    if (this.looksLikeNaturalLanguage(command)) {
      try {
        const interpretation = await this.aiCore.interpretNaturalLanguage(command);
        sessionId = await this.createSession({
          command: interpretation.interpretedCommand,
          args,
          ...options
        });
      } catch (error) {
        // Fall back to original command
        sessionId = await this.createSession({ command, args, ...options });
      }
    } else {
      sessionId = await this.createSession({ command, args, ...options });
    }

    return new Promise((resolve) => {
      const outputs: string[] = [];
      let exitCode: number | undefined;
      let originalError: string | undefined;
      
      const handleEvent = async (event: any) => {
        if (event.sessionId !== sessionId) return;
        
        if (event.type === 'output') {
          outputs.push(event.data.data);
          
          // Capture error output
          if (event.data.type === 'stderr') {
            originalError = (originalError || '') + event.data.data;
          }
        } else if (event.type === 'stopped') {
          this.removeListener('console-event', handleEvent);
          exitCode = event.data.exitCode;
          
          // If command failed and recovery is enabled, attempt auto-recovery
          if (exitCode !== 0 && enableRecovery) {
            setTimeout(async () => {
              const recoveryResult = await this.attemptAutoRecovery(sessionId);
              this.cleanupSession(sessionId);
              
              if (recoveryResult.success && recoveryResult.newSessionId) {
                // Wait for recovery session to complete
                this.waitForSessionCompletion(recoveryResult.newSessionId).then(recoveryOutput => {
                  resolve({
                    output: recoveryOutput.output,
                    exitCode: recoveryOutput.exitCode,
                    recoveryAttempted: true,
                    originalError
                  });
                });
              } else {
                resolve({
                  output: outputs.join(''),
                  exitCode,
                  recoveryAttempted: true,
                  originalError
                });
              }
            }, 1000); // Small delay to ensure all output is captured
          } else {
            this.cleanupSession(sessionId);
            resolve({
              output: outputs.join(''),
              exitCode,
              recoveryAttempted: false
            });
          }
        }
      };

      this.on('console-event', handleEvent);
    });
  }

  private async waitForSessionCompletion(sessionId: string): Promise<{ output: string; exitCode?: number }> {
    return new Promise((resolve) => {
      const outputs: string[] = [];
      
      const handleEvent = (event: any) => {
        if (event.sessionId !== sessionId) return;
        
        if (event.type === 'output') {
          outputs.push(event.data.data);
        } else if (event.type === 'stopped') {
          this.removeListener('console-event', handleEvent);
          this.cleanupSession(sessionId);
          resolve({
            output: outputs.join(''),
            exitCode: event.data.exitCode
          });
        }
      };

      this.on('console-event', handleEvent);
    });
  }

  private looksLikeNaturalLanguage(command: string): boolean {
    // Simple heuristic to detect natural language
    const naturalWords = ['show', 'list', 'find', 'create', 'delete', 'install', 'start', 'stop', 'check', 'test'];
    const words = command.toLowerCase().split(' ');
    
    // If it contains natural language words and is longer than typical commands
    return words.length > 2 && naturalWords.some(word => words.includes(word)) && 
           !command.startsWith('/') && !command.includes('|') && !command.includes('&&');
  }

  private cleanupSession(sessionId: string) {
    // Clean up session data after a delay
    setTimeout(() => {
      const session = this.getSession(sessionId);
      if (session && session.status !== 'running') {
        // Remove from internal maps (implementation would depend on ConsoleManager internals)
        this.logger.debug(`Cleaned up session ${sessionId}`);
      }
    }, 5000);
  }

  // Shutdown AI components
  async shutdown(): Promise<void> {
    await this.aiCore.shutdown();
    this.destroy();
  }
}