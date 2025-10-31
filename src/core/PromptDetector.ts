import { Logger } from '../utils/logger.js';
import stripAnsi from 'strip-ansi';

/**
 * Shell prompt patterns for different environments
 */
export interface PromptPattern {
  name: string;
  pattern: RegExp;
  description: string;
  shellType?: string;
  priority: number;
  contextual?: boolean;
  multiline?: boolean;
}

/**
 * Configuration for prompt detection per session
 */
export interface PromptDetectorConfig {
  sessionId: string;
  shellType?:
    | 'bash'
    | 'zsh'
    | 'fish'
    | 'tcsh'
    | 'csh'
    | 'dash'
    | 'sh'
    | 'powershell'
    | 'cmd'
    | 'auto';
  hostname?: string;
  username?: string;
  customPrompts?: PromptPattern[];
  enableAnsiStripping?: boolean;
  enableMultilineDetection?: boolean;
  timeout?: number;
  maxOutputBuffer?: number;
  adaptiveLearning?: boolean;
}

/**
 * Result of prompt detection attempt
 */
export interface PromptDetectionResult {
  detected: boolean;
  pattern?: PromptPattern;
  matchedText: string;
  confidence: number;
  position: number;
  context: {
    beforePrompt: string;
    promptLine: string;
    afterPrompt: string;
  };
  timeTaken: number;
}

/**
 * Advanced prompt detector for SSH and local shells
 * Handles ANSI escape sequences, multiple shell types, and adaptive learning
 */
export class PromptDetector {
  private logger: Logger;
  private sessionConfigs: Map<string, PromptDetectorConfig> = new Map();
  private learnedPrompts: Map<string, PromptPattern[]> = new Map();
  private outputBuffers: Map<string, string> = new Map();

  // Pre-defined shell prompt patterns with high accuracy
  private readonly DEFAULT_PATTERNS: PromptPattern[] = [
    // Bash prompts
    {
      name: 'bash_standard',
      pattern: /(?:^|\n)([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:[~\/][^$#\n]*\$)\s*$/m,
      description: 'Standard bash prompt: user@host:path$',
      shellType: 'bash',
      priority: 10,
      contextual: true,
    },
    {
      name: 'bash_root',
      pattern: /(?:^|\n)([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:[~\/][^$#\n]*#)\s*$/m,
      description: 'Root bash prompt: user@host:path#',
      shellType: 'bash',
      priority: 10,
      contextual: true,
    },
    {
      name: 'bash_simple',
      pattern: /(?:^|\n)(\$)\s*$/m,
      description: 'Simple bash prompt: $',
      shellType: 'bash',
      priority: 5,
    },
    {
      name: 'bash_root_simple',
      pattern: /(?:^|\n)(#)\s*$/m,
      description: 'Simple root prompt: #',
      shellType: 'bash',
      priority: 5,
    },

    // Zsh prompts
    {
      name: 'zsh_standard',
      pattern:
        /(?:^|\n)([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\s+[~\/][^%#\n]*\s*[%#])\s*$/m,
      description: 'Standard zsh prompt: user@host path %',
      shellType: 'zsh',
      priority: 10,
      contextual: true,
    },
    {
      name: 'zsh_simple',
      pattern: /(?:^|\n)([%])\s*$/m,
      description: 'Simple zsh prompt: %',
      shellType: 'zsh',
      priority: 5,
    },

    // Fish shell prompts
    {
      name: 'fish_standard',
      pattern: /(?:^|\n)([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\s+[~\/][^>\n]*>)\s*$/m,
      description: 'Fish shell prompt: user@host path>',
      shellType: 'fish',
      priority: 10,
      contextual: true,
    },

    // Ubuntu-specific patterns
    {
      name: 'ubuntu_standard',
      pattern: /(?:^|\n)(ubuntu@[a-zA-Z0-9._-]+:[~\/][^$\n]*\$)\s*$/m,
      description: 'Ubuntu default prompt: ubuntu@hostname:path$',
      shellType: 'bash',
      priority: 15,
      contextual: true,
    },

    // Generic Unix prompts
    {
      name: 'unix_user_colon',
      pattern: /(?:^|\n)([a-zA-Z0-9._-]+:[~\/][^$#\n]*\$)\s*$/m,
      description: 'Unix-style user prompt: user:path$',
      priority: 7,
      contextual: true,
    },
    {
      name: 'unix_root_colon',
      pattern: /(?:^|\n)([a-zA-Z0-9._-]+:[~\/][^$#\n]*#)\s*$/m,
      description: 'Unix-style root prompt: user:path#',
      priority: 7,
      contextual: true,
    },

    // Alpine Linux prompts
    {
      name: 'alpine_standard',
      pattern: /(?:^|\n)([a-zA-Z0-9._-]+:[~\/][^#\n]*#)\s*$/m,
      description: 'Alpine Linux prompt: hostname:path#',
      priority: 8,
      contextual: true,
    },

    // Docker container prompts
    {
      name: 'docker_root',
      pattern: /(?:^|\n)(root@[a-zA-Z0-9]+:[~\/][^#\n]*#)\s*$/m,
      description: 'Docker root prompt: root@containerid:path#',
      priority: 12,
      contextual: true,
    },

    // Windows prompts (if running WSL or Windows SSH)
    {
      name: 'windows_cmd',
      pattern: /(?:^|\n)([A-Z]:[\\\/][^>]*>)\s*$/m,
      description: 'Windows CMD prompt: C:\\path>',
      shellType: 'cmd',
      priority: 8,
      contextual: true,
    },
    {
      name: 'powershell_standard',
      pattern: /(?:^|\n)(PS\s+[A-Z]:[\\\/][^>]*>)\s*$/m,
      description: 'PowerShell prompt: PS C:\\path>',
      shellType: 'powershell',
      priority: 8,
      contextual: true,
    },

    // Minimal prompts (low priority, used as fallbacks)
    {
      name: 'minimal_dollar',
      pattern: /(?:^|\n)(\$)\s*$/m,
      description: 'Minimal dollar prompt: $',
      priority: 2,
    },
    {
      name: 'minimal_hash',
      pattern: /(?:^|\n)(#)\s*$/m,
      description: 'Minimal hash prompt: #',
      priority: 2,
    },
    {
      name: 'minimal_percent',
      pattern: /(?:^|\n)(%)\s*$/m,
      description: 'Minimal percent prompt: %',
      priority: 2,
    },
    {
      name: 'minimal_gt',
      pattern: /(?:^|\n)(>)\s*$/m,
      description: 'Minimal greater-than prompt: >',
      priority: 1,
    },

    // Multi-line prompts
    {
      name: 'multiline_arrow',
      pattern: /(?:^|\n)[^\n]*\n(\s*[-=]>\s*)$/m,
      description: 'Multi-line arrow prompt',
      priority: 6,
      multiline: true,
    },

    // Colored prompts (after ANSI stripping, will look for common patterns)
    {
      name: 'colored_user_host',
      pattern:
        /(?:^|\n)([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+.*[:\s][~\/][^$#%>\n]*[$#%>])\s*$/m,
      description: 'Colored user@host prompt (ANSI stripped)',
      priority: 9,
      contextual: true,
    },
  ];

  constructor() {
    this.logger = new Logger('PromptDetector');
  }

  /**
   * Configure prompt detection for a session
   */
  configureSession(config: PromptDetectorConfig): void {
    this.sessionConfigs.set(config.sessionId, {
      enableAnsiStripping: true,
      enableMultilineDetection: true,
      timeout: 5000,
      maxOutputBuffer: 10000,
      adaptiveLearning: true,
      ...config,
    });

    this.outputBuffers.set(config.sessionId, '');
    this.learnedPrompts.set(config.sessionId, []);

    this.logger.info(
      `Configured prompt detection for session ${config.sessionId}`,
      {
        shellType: config.shellType,
        customPrompts: config.customPrompts?.length || 0,
        adaptiveLearning: config.adaptiveLearning,
      }
    );
  }

  /**
   * Remove configuration for a session
   */
  removeSession(sessionId: string): void {
    this.sessionConfigs.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.learnedPrompts.delete(sessionId);
    this.logger.debug(
      `Removed prompt detection config for session ${sessionId}`
    );
  }

  /**
   * Add new output data and detect prompts
   */
  addOutput(sessionId: string, data: string): PromptDetectionResult | null {
    const config = this.sessionConfigs.get(sessionId);
    if (!config) {
      this.logger.warn(`No configuration found for session ${sessionId}`);
      return null;
    }

    // Append to buffer
    let currentBuffer = this.outputBuffers.get(sessionId) || '';
    currentBuffer += data;

    // Limit buffer size
    if (currentBuffer.length > config.maxOutputBuffer!) {
      currentBuffer = currentBuffer.slice(-config.maxOutputBuffer!);
    }

    this.outputBuffers.set(sessionId, currentBuffer);

    // Attempt prompt detection
    return this.detectPrompt(sessionId, currentBuffer);
  }

  /**
   * Detect prompt in the given output
   */
  detectPrompt(
    sessionId: string,
    output: string
  ): PromptDetectionResult | null {
    const startTime = Date.now();
    const config = this.sessionConfigs.get(sessionId);

    if (!config) {
      return null;
    }

    // Strip ANSI escape sequences if enabled
    let cleanOutput = output;
    if (config.enableAnsiStripping) {
      cleanOutput = this.stripAnsiSequences(output);
    }

    // Get all available patterns
    const patterns = this.getAvailablePatterns(sessionId);

    let bestMatch: PromptDetectionResult | null = null;
    let highestConfidence = 0;

    // Try each pattern
    for (const pattern of patterns) {
      const result = this.tryPattern(pattern, cleanOutput, output);

      if (result.detected && result.confidence > highestConfidence) {
        highestConfidence = result.confidence;
        bestMatch = result;
      }
    }

    if (bestMatch) {
      bestMatch.timeTaken = Date.now() - startTime;

      // Learn from successful detection if adaptive learning is enabled
      if (config.adaptiveLearning && bestMatch.confidence > 0.8) {
        this.learnFromDetection(sessionId, bestMatch);
      }

      this.logger.debug(`Prompt detected for session ${sessionId}`, {
        pattern: bestMatch.pattern?.name,
        confidence: bestMatch.confidence,
        matchedText: bestMatch.matchedText.substring(0, 50),
        timeTaken: bestMatch.timeTaken,
      });
    }

    return bestMatch;
  }

  /**
   * Wait for a prompt to appear in the output
   */
  async waitForPrompt(
    sessionId: string,
    timeout?: number
  ): Promise<PromptDetectionResult> {
    const config = this.sessionConfigs.get(sessionId);
    const actualTimeout = timeout || config?.timeout || 5000;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const currentOutput = this.outputBuffers.get(sessionId) || '';
        const result = this.detectPrompt(sessionId, currentOutput);

        if (result && result.detected) {
          clearInterval(checkInterval);
          resolve(result);
          return;
        }

        if (Date.now() - startTime > actualTimeout) {
          clearInterval(checkInterval);
          reject(
            new Error(
              `Timeout waiting for prompt in session ${sessionId} after ${actualTimeout}ms`
            )
          );
          return;
        }
      }, 100);
    });
  }

  /**
   * Enhanced waitForOutput method with prompt-aware matching
   */
  async waitForOutput(
    sessionId: string,
    pattern: string | RegExp,
    options: {
      timeout?: number;
      requirePrompt?: boolean;
      stripAnsi?: boolean;
      multiline?: boolean;
    } = {}
  ): Promise<{ output: string; promptDetected?: PromptDetectionResult }> {
    const config = this.sessionConfigs.get(sessionId);
    const timeout = options.timeout || config?.timeout || 5000;
    const startTime = Date.now();

    const searchRegex =
      typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        let currentOutput = this.outputBuffers.get(sessionId) || '';

        // Strip ANSI if requested
        if (options.stripAnsi !== false) {
          currentOutput = this.stripAnsiSequences(currentOutput);
        }

        // Check if pattern matches
        const patternMatch = searchRegex.test(currentOutput);

        // Check for prompt if required
        let promptResult: PromptDetectionResult | null = null;
        if (options.requirePrompt) {
          promptResult = this.detectPrompt(sessionId, currentOutput);
        }

        // Resolve if pattern matches and prompt is found (if required)
        if (
          patternMatch &&
          (!options.requirePrompt || (promptResult && promptResult.detected))
        ) {
          clearInterval(checkInterval);
          resolve({
            output: currentOutput,
            promptDetected: promptResult || undefined,
          });
          return;
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);

          // Provide debug information on timeout
          const debugInfo = {
            sessionId,
            pattern: pattern.toString(),
            outputLength: currentOutput.length,
            lastOutput: currentOutput.slice(-200),
            promptResult: promptResult
              ? {
                  detected: promptResult.detected,
                  confidence: promptResult.confidence,
                  pattern: promptResult.pattern?.name,
                }
              : null,
          };

          reject(
            new Error(
              `Timeout waiting for pattern: ${pattern}. Debug: ${JSON.stringify(debugInfo)}`
            )
          );
          return;
        }
      }, 100);
    });
  }

  /**
   * Clear output buffer for session
   */
  clearBuffer(sessionId: string): void {
    this.outputBuffers.set(sessionId, '');
    this.logger.debug(`Cleared output buffer for session ${sessionId}`);
  }

  /**
   * Get current output buffer content
   */
  getBuffer(sessionId: string): string {
    return this.outputBuffers.get(sessionId) || '';
  }

  /**
   * Get learned patterns for a session
   */
  getLearnedPatterns(sessionId: string): PromptPattern[] {
    return this.learnedPrompts.get(sessionId) || [];
  }

  /**
   * Manually add a learned pattern
   */
  addLearnedPattern(sessionId: string, pattern: PromptPattern): void {
    const learned = this.learnedPrompts.get(sessionId) || [];
    learned.push(pattern);
    this.learnedPrompts.set(sessionId, learned);

    this.logger.info(`Added learned pattern for session ${sessionId}`, {
      patternName: pattern.name,
      description: pattern.description,
    });
  }

  /**
   * Get statistics about prompt detection
   */
  getDetectionStats(sessionId: string): {
    totalPatterns: number;
    learnedPatterns: number;
    bufferSize: number;
    shellType?: string;
  } {
    const config = this.sessionConfigs.get(sessionId);
    const learned = this.learnedPrompts.get(sessionId) || [];
    const buffer = this.outputBuffers.get(sessionId) || '';

    return {
      totalPatterns: this.getAvailablePatterns(sessionId).length,
      learnedPatterns: learned.length,
      bufferSize: buffer.length,
      shellType: config?.shellType,
    };
  }

  // Private helper methods

  private stripAnsiSequences(text: string): string {
    // Use strip-ansi for basic ANSI removal, then additional cleanup
    let cleaned = stripAnsi(text);

    // Additional ANSI sequence patterns that might be missed
    const additionalAnsiPatterns = [
      /\x1B\[[\d;]*[mK]/g, // CSI sequences
      /\x1B\][\d;]*;[^\x07]*\x07/g, // OSC sequences
      /\x1B\[\?[\d;]*[hlH]/g, // Private mode sequences
      /\x1B\[[\d;]*[ABCDEFGJKST]/g, // Cursor control
      /\x1B[=>]/g, // Application keypad
      /\r/g, // Carriage returns that might interfere
    ];

    additionalAnsiPatterns.forEach((pattern) => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Clean up excessive whitespace but preserve structure
    cleaned = cleaned.replace(/\r\n/g, '\n'); // Normalize line endings
    cleaned = cleaned.replace(/\n\n+/g, '\n\n'); // Limit consecutive newlines

    return cleaned;
  }

  private getAvailablePatterns(sessionId: string): PromptPattern[] {
    const config = this.sessionConfigs.get(sessionId);
    const learned = this.learnedPrompts.get(sessionId) || [];

    let patterns: PromptPattern[] = [...this.DEFAULT_PATTERNS];

    // Add custom patterns from config
    if (config?.customPrompts) {
      patterns = [...patterns, ...config.customPrompts];
    }

    // Add learned patterns (with higher priority)
    const boostedLearned = learned.map((p) => ({
      ...p,
      priority: p.priority + 5,
    }));
    patterns = [...patterns, ...boostedLearned];

    // Filter by shell type if specified
    if (config?.shellType && config.shellType !== 'auto') {
      patterns = patterns.filter(
        (p) => !p.shellType || p.shellType === config.shellType
      );
    }

    // Sort by priority (highest first)
    return patterns.sort((a, b) => b.priority - a.priority);
  }

  private tryPattern(
    pattern: PromptPattern,
    cleanOutput: string,
    originalOutput: string
  ): PromptDetectionResult {
    const match = pattern.pattern.exec(cleanOutput);

    if (!match) {
      return {
        detected: false,
        matchedText: '',
        confidence: 0,
        position: -1,
        context: {
          beforePrompt: '',
          promptLine: '',
          afterPrompt: '',
        },
        timeTaken: 0,
      };
    }

    const matchedText = match[1] || match[0];
    const position = match.index || 0;

    // Calculate confidence based on various factors
    let confidence = this.calculateConfidence(
      pattern,
      matchedText,
      cleanOutput,
      position
    );

    // Extract context
    const beforePrompt = cleanOutput.substring(0, position);
    const promptLine = matchedText;
    const afterPrompt = cleanOutput.substring(position + matchedText.length);

    return {
      detected: true,
      pattern,
      matchedText,
      confidence,
      position,
      context: {
        beforePrompt: beforePrompt.split('\n').slice(-2).join('\n'),
        promptLine,
        afterPrompt: afterPrompt.split('\n').slice(0, 2).join('\n'),
      },
      timeTaken: 0, // Will be set by caller
    };
  }

  private calculateConfidence(
    pattern: PromptPattern,
    matchedText: string,
    output: string,
    position: number
  ): number {
    let confidence = 0.5; // Base confidence

    // Higher confidence for contextual patterns
    if (pattern.contextual && matchedText.includes('@')) {
      confidence += 0.2;
    }

    // Higher confidence if match is at end of output
    const isAtEnd = position + matchedText.length >= output.trim().length;
    if (isAtEnd) {
      confidence += 0.2;
    }

    // Higher confidence for longer, more specific matches
    if (matchedText.length > 10) {
      confidence += 0.1;
    }

    // Higher confidence if preceded by command output
    const beforeMatch = output.substring(0, position);
    if (beforeMatch.includes('\n') && beforeMatch.trim().length > 0) {
      confidence += 0.1;
    }

    // Adjust based on pattern priority
    confidence += pattern.priority / 20;

    // Ensure confidence is between 0 and 1
    return Math.min(1, Math.max(0, confidence));
  }

  private learnFromDetection(
    sessionId: string,
    result: PromptDetectionResult
  ): void {
    if (!result.pattern || !result.detected) return;

    const learned = this.learnedPrompts.get(sessionId) || [];

    // Check if we already learned a similar pattern
    const similarExists = learned.some(
      (p) =>
        p.pattern.toString() === result.pattern!.pattern.toString() ||
        p.name === result.pattern!.name
    );

    if (!similarExists && learned.length < 10) {
      // Limit learned patterns
      const learnedPattern: PromptPattern = {
        name: `learned_${Date.now()}`,
        pattern: result.pattern.pattern,
        description: `Learned pattern from ${result.pattern.description}`,
        shellType: result.pattern.shellType,
        priority: Math.min(15, result.pattern.priority + 3), // Boost priority but cap it
        contextual: result.pattern.contextual,
      };

      learned.push(learnedPattern);
      this.learnedPrompts.set(sessionId, learned);

      this.logger.debug(`Learned new prompt pattern for session ${sessionId}`, {
        pattern: learnedPattern.name,
        confidence: result.confidence,
      });
    }
  }

  /**
   * Get debug information about current detection state
   */
  getDebugInfo(sessionId: string): any {
    const config = this.sessionConfigs.get(sessionId);
    const buffer = this.outputBuffers.get(sessionId) || '';
    const learned = this.learnedPrompts.get(sessionId) || [];
    const patterns = this.getAvailablePatterns(sessionId);

    return {
      sessionId,
      config,
      bufferLength: buffer.length,
      bufferPreview: buffer.slice(-200),
      learnedPatternCount: learned.length,
      totalPatternCount: patterns.length,
      availablePatterns: patterns.map((p) => ({
        name: p.name,
        priority: p.priority,
        shellType: p.shellType,
      })),
    };
  }
}
