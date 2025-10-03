import { ConsoleManager } from './ConsoleManager.js';
import type { ConsoleOutput, BackgroundJob } from '../types/index.js';

interface CommandAnalysis {
  isLongRunner: boolean;
  isQuick: boolean;
  isStreaming: boolean;
  estimatedDuration?: number;
}

interface ExecuteOptions {
  sessionId: string;
  args?: string[];
  timeout?: number;
  env?: Record<string, string>;
}

interface UnifiedResult {
  success: boolean;
  output: string;
  exitCode?: number;
  duration?: number;
  strategyUsed: 'fast' | 'streaming' | 'background';
  switched: boolean;
  switchReason?: string;
}

class OutputMonitor {
  private _outputSize: number = 0;
  private _lastActivity: number = Date.now();
  private _isStillRunning: boolean = true;

  get outputSize(): number {
    return this._outputSize;
  }

  get isStillRunning(): boolean {
    return this._isStillRunning;
  }

  recordOutput(size: number): void {
    this._outputSize += size;
    this._lastActivity = Date.now();
  }

  markCompleted(): void {
    this._isStillRunning = false;
  }

  getIdleTime(): number {
    return Date.now() - this._lastActivity;
  }
}

class CommandAnalyzer {
  private commandHistory: Map<string, { duration: number; outputSize: number }> = new Map();

  analyze(command: string): CommandAnalysis {
    const longRunners = [
      /npm\s+(install|ci|update)/,
      /pip\s+install/,
      /cargo\s+build/,
      /mvn\s+clean\s+install/,
      /gradle\s+build/,
      /(train|build|compile|bundle|webpack)/i,
    ];

    const quickCommands = [
      /^(ls|pwd|echo|cat|head|tail|grep|find)/,
      /^git\s+(status|log|diff|branch)/,
      /^(cd|mkdir|rm|mv|cp|touch)\s+/,
    ];

    const streamingCommands = [
      /tail\s+-f/,
      /watch\s+/,
      /journalctl\s+-f/,
      /kubectl\s+(logs|get|describe).*(-f|--follow)/,
    ];

    const isLongRunner = longRunners.some((r) => r.test(command));
    const isQuick = quickCommands.some((r) => r.test(command));
    const isStreaming = streamingCommands.some((r) => r.test(command));

    const estimatedDuration = this.estimateFromHistory(command);

    return {
      isLongRunner,
      isQuick,
      isStreaming,
      estimatedDuration,
    };
  }

  private estimateFromHistory(command: string): number | undefined {
    const normalizedCommand = this.normalizeCommand(command);
    const history = this.commandHistory.get(normalizedCommand);
    return history?.duration;
  }

  private normalizeCommand(command: string): string {
    return command.split(/\s+/)[0].toLowerCase();
  }

  recordExecution(command: string, duration: number, outputSize: number): void {
    const normalizedCommand = this.normalizeCommand(command);
    this.commandHistory.set(normalizedCommand, { duration, outputSize });
  }
}

class StrategySelector {
  select(analysis: CommandAnalysis): 'fast' | 'streaming' | 'background' {
    if (analysis.isStreaming) return 'streaming';
    if (analysis.isLongRunner) return 'background';
    if (analysis.isQuick) return 'fast';

    if (analysis.estimatedDuration) {
      if (analysis.estimatedDuration > 60000) return 'background';
      if (analysis.estimatedDuration > 10000) return 'streaming';
    }

    return 'fast';
  }
}

class ResultAggregator {
  aggregate(
    output: ConsoleOutput[] | string,
    exitCode: number | undefined,
    duration: number | undefined,
    strategy: 'fast' | 'streaming' | 'background',
    switched: boolean,
    switchReason?: string
  ): UnifiedResult {
    const outputText = Array.isArray(output)
      ? output.map((chunk) => chunk.data).join('')
      : output;

    return {
      success: exitCode === 0 || exitCode === undefined,
      output: outputText,
      exitCode,
      duration,
      strategyUsed: strategy,
      switched,
      switchReason,
    };
  }
}

export class SmartExecutor {
  private consoleManager: ConsoleManager;
  private analyzer: CommandAnalyzer;
  private selector: StrategySelector;
  private aggregator: ResultAggregator;

  constructor(consoleManager: ConsoleManager) {
    this.consoleManager = consoleManager;
    this.analyzer = new CommandAnalyzer();
    this.selector = new StrategySelector();
    this.aggregator = new ResultAggregator();
  }

  async execute(command: string, options: ExecuteOptions): Promise<UnifiedResult> {
    const analysis = this.analyzer.analyze(command);
    const strategy = this.selector.select(analysis);

    const startTime = Date.now();

    try {
      let result: UnifiedResult;

      if (strategy === 'fast') {
        result = await this.executeFastPath(command, options);
      } else if (strategy === 'streaming') {
        result = await this.executeStreaming(command, options);
      } else {
        result = await this.executeBackground(command, options);
      }

      const duration = Date.now() - startTime;
      const outputSize = result.output.length;

      this.analyzer.recordExecution(command, duration, outputSize);

      return result;
    } catch (error: any) {
      throw new Error(`Smart execution failed: ${error.message}`);
    }
  }

  private async executeFastPath(command: string, options: ExecuteOptions): Promise<UnifiedResult> {
    const monitor = new OutputMonitor();

    try {
      const result = await this.consoleManager.executeCommandInSession(
        options.sessionId,
        command,
        options.args || [],
        options.timeout || 30000
      );

      monitor.markCompleted();

      return this.aggregator.aggregate(
        result.output,
        result.exitCode,
        result.duration,
        'fast',
        false
      );
    } catch (error: any) {
      if (error.message.includes('timeout')) {
        return await this.switchToBackground(command, options, monitor);
      }

      throw error;
    }
  }

  private async executeStreaming(command: string, options: ExecuteOptions): Promise<UnifiedResult> {
    const sessionId = options.sessionId;
    const chunks: string[] = [];

    await this.consoleManager.sendInput(sessionId, command + '\n');

    let sequenceId = 0;
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const output = await this.consoleManager.getOutputImmediate(sessionId, 50);

      if (output.length > sequenceId) {
        const newChunks = output.slice(sequenceId);
        chunks.push(...newChunks.map((c) => c.data));
        sequenceId = output.length;
      }

      const lastChunk = output[output.length - 1];
      if (lastChunk && this.isPromptLine(lastChunk.data)) {
        break;
      }

      attempts++;
      await this.sleep(200);
    }

    return this.aggregator.aggregate(chunks.join(''), 0, undefined, 'streaming', false);
  }

  private async executeBackground(command: string, options: ExecuteOptions): Promise<UnifiedResult> {
    const jobId = await this.consoleManager.startBackgroundJob(
      command,
      options.args || [],
      {
        command,
        args: options.args || [],
        sessionId: options.sessionId,
        timeout: options.timeout || 600000,
      }
    );

    let status: BackgroundJob | null;
    let pollAttempts = 0;
    const maxPollAttempts = 600;

    do {
      await this.sleep(1000);
      status = await this.consoleManager.getBackgroundJobStatus(jobId);
      pollAttempts++;

      if (pollAttempts >= maxPollAttempts) {
        throw new Error('Background job polling exceeded maximum attempts');
      }
    } while (status && status.status === 'running');

    const outputArray = await this.consoleManager.getBackgroundJobOutput(jobId);

    const duration = status?.startedAt && status?.finishedAt
      ? new Date(status.finishedAt).getTime() - new Date(status.startedAt).getTime()
      : undefined;

    return this.aggregator.aggregate(
      outputArray.map((o) => o.data).join(''),
      status?.exitCode,
      duration,
      'background',
      false
    );
  }

  private async switchToBackground(
    command: string,
    options: ExecuteOptions,
    _monitor: OutputMonitor
  ): Promise<UnifiedResult> {
    try {
      const jobId = await this.consoleManager.startBackgroundJob(
        command,
        options.args || [],
        {
          command,
          args: options.args || [],
          sessionId: options.sessionId,
          timeout: 600000,
        }
      );

      let status: BackgroundJob | null;
      do {
        await this.sleep(1000);
        status = await this.consoleManager.getBackgroundJobStatus(jobId);
      } while (status && status.status === 'running');

      const outputArray = await this.consoleManager.getBackgroundJobOutput(jobId);

      const duration = status?.startedAt && status?.finishedAt
        ? new Date(status.finishedAt).getTime() - new Date(status.startedAt).getTime()
        : undefined;

      return this.aggregator.aggregate(
        outputArray.map((o) => o.data).join(''),
        status?.exitCode,
        duration,
        'background',
        true,
        'Command exceeded timeout, switched to background execution'
      );
    } catch (error: any) {
      throw new Error(`Strategy switch to background failed: ${error.message}`);
    }
  }

  private isPromptLine(line: string): boolean {
    const promptPatterns = [
      /[$#>]\s*$/,
      /PS\s+[A-Z]:\\.*>\s*$/,
      /^\s*~\s*[$#>]\s*$/,
    ];

    return promptPatterns.some((pattern) => pattern.test(line.trim()));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}