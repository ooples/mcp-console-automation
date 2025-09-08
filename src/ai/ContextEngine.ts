import { AIConfig } from './AICore.js';
import { Logger } from '../utils/logger.js';

interface ExecutionContext {
  command: string;
  success: boolean;
  output: string;
  duration: number;
  timestamp: Date;
  workingDirectory?: string;
  environment?: Record<string, string>;
  previousCommand?: string;
}

interface ContextualSuggestion {
  command: string;
  relevance: number;
  reasoning: string;
  category: 'followup' | 'alternative' | 'correction' | 'enhancement' | 'related';
}

interface WorkingContext {
  sessionId: string;
  currentDirectory: string;
  environment: Record<string, string>;
  recentCommands: string[];
  workflowState: 'idle' | 'development' | 'debugging' | 'deployment' | 'maintenance';
  projectType?: 'nodejs' | 'python' | 'docker' | 'git' | 'system' | 'database' | 'web';
  lastActivity: Date;
  commandHistory: ExecutionContext[];
}

interface ContextPattern {
  name: string;
  description: string;
  trigger: (context: WorkingContext) => boolean;
  suggestions: (context: WorkingContext) => ContextualSuggestion[];
  confidence: number;
}

export class ContextEngine {
  private logger: Logger;
  private config: AIConfig;
  private contexts: Map<string, WorkingContext> = new Map();
  private contextPatterns: ContextPattern[];

  constructor(config: AIConfig) {
    this.config = config;
    this.logger = new Logger('ContextEngine');
    this.initializeContextPatterns();
  }

  private initializeContextPatterns() {
    this.contextPatterns = [
      // Git workflow patterns
      {
        name: 'git_workflow',
        description: 'Git repository operations',
        confidence: 0.9,
        trigger: (context) => {
          const recent = context.recentCommands.slice(-3).join(' ').toLowerCase();
          return recent.includes('git') || context.projectType === 'git';
        },
        suggestions: (context) => {
          const recent = context.recentCommands.slice(-5);
          const suggestions: ContextualSuggestion[] = [];

          if (recent.some(cmd => cmd.includes('git add'))) {
            suggestions.push({
              command: 'git commit -m "Update changes"',
              relevance: 0.8,
              reasoning: 'Files staged, ready to commit',
              category: 'followup'
            });
          }

          if (recent.some(cmd => cmd.includes('git commit'))) {
            suggestions.push({
              command: 'git push',
              relevance: 0.9,
              reasoning: 'Changes committed, ready to push',
              category: 'followup'
            });
          }

          if (recent.some(cmd => cmd.includes('git status'))) {
            suggestions.push(
              {
                command: 'git diff',
                relevance: 0.7,
                reasoning: 'Check detailed changes',
                category: 'related'
              },
              {
                command: 'git add .',
                relevance: 0.6,
                reasoning: 'Stage all changes',
                category: 'followup'
              }
            );
          }

          return suggestions;
        }
      },

      // Node.js development patterns
      {
        name: 'nodejs_development',
        description: 'Node.js project development workflow',
        confidence: 0.8,
        trigger: (context) => {
          const recent = context.recentCommands.join(' ').toLowerCase();
          return recent.includes('npm') || recent.includes('node') || 
                 recent.includes('package.json') || context.projectType === 'nodejs';
        },
        suggestions: (context) => {
          const recent = context.recentCommands.slice(-5);
          const suggestions: ContextualSuggestion[] = [];

          if (recent.some(cmd => cmd.includes('npm install'))) {
            suggestions.push({
              command: 'npm start',
              relevance: 0.8,
              reasoning: 'Dependencies installed, ready to start',
              category: 'followup'
            });
          }

          if (recent.some(cmd => cmd.includes('npm test') && !context.commandHistory.slice(-1)[0]?.success)) {
            suggestions.push({
              command: 'npm run test:debug',
              relevance: 0.7,
              reasoning: 'Tests failed, try debugging mode',
              category: 'alternative'
            });
          }

          if (recent.some(cmd => cmd.includes('node'))) {
            suggestions.push(
              {
                command: 'npm run lint',
                relevance: 0.5,
                reasoning: 'Check code quality',
                category: 'related'
              },
              {
                command: 'npm audit',
                relevance: 0.4,
                reasoning: 'Check for security vulnerabilities',
                category: 'related'
              }
            );
          }

          return suggestions;
        }
      },

      // Docker workflow patterns
      {
        name: 'docker_operations',
        description: 'Docker container management',
        confidence: 0.8,
        trigger: (context) => {
          const recent = context.recentCommands.join(' ').toLowerCase();
          return recent.includes('docker') || context.projectType === 'docker';
        },
        suggestions: (context) => {
          const recent = context.recentCommands.slice(-5);
          const suggestions: ContextualSuggestion[] = [];

          if (recent.some(cmd => cmd.includes('docker build'))) {
            suggestions.push({
              command: 'docker run -d --name myapp [image_name]',
              relevance: 0.8,
              reasoning: 'Image built, ready to run container',
              category: 'followup'
            });
          }

          if (recent.some(cmd => cmd.includes('docker run'))) {
            suggestions.push(
              {
                command: 'docker ps',
                relevance: 0.9,
                reasoning: 'Check running containers',
                category: 'followup'
              },
              {
                command: 'docker logs [container_name]',
                relevance: 0.7,
                reasoning: 'Check container logs',
                category: 'related'
              }
            );
          }

          if (recent.some(cmd => cmd.includes('docker ps'))) {
            suggestions.push({
              command: 'docker exec -it [container_name] /bin/bash',
              relevance: 0.6,
              reasoning: 'Access running container shell',
              category: 'related'
            });
          }

          return suggestions;
        }
      },

      // Python development patterns
      {
        name: 'python_development',
        description: 'Python project development workflow',
        confidence: 0.8,
        trigger: (context) => {
          const recent = context.recentCommands.join(' ').toLowerCase();
          return recent.includes('python') || recent.includes('pip') || 
                 recent.includes('.py') || context.projectType === 'python';
        },
        suggestions: (context) => {
          const recent = context.recentCommands.slice(-5);
          const suggestions: ContextualSuggestion[] = [];

          if (recent.some(cmd => cmd.includes('pip install'))) {
            suggestions.push({
              command: 'pip freeze > requirements.txt',
              relevance: 0.6,
              reasoning: 'Save installed dependencies',
              category: 'related'
            });
          }

          if (recent.some(cmd => cmd.includes('python') && cmd.includes('.py'))) {
            const lastCmd = context.commandHistory[context.commandHistory.length - 1];
            if (!lastCmd?.success) {
              suggestions.push({
                command: 'python -m pdb [script.py]',
                relevance: 0.7,
                reasoning: 'Script failed, try debugging',
                category: 'alternative'
              });
            } else {
              suggestions.push({
                command: 'python -m pytest',
                relevance: 0.5,
                reasoning: 'Run tests after script execution',
                category: 'related'
              });
            }
          }

          return suggestions;
        }
      },

      // System administration patterns
      {
        name: 'system_administration',
        description: 'System maintenance and troubleshooting',
        confidence: 0.7,
        trigger: (context) => {
          const recent = context.recentCommands.join(' ').toLowerCase();
          return recent.includes('systemctl') || recent.includes('service') ||
                 recent.includes('ps aux') || recent.includes('top') ||
                 context.workflowState === 'maintenance';
        },
        suggestions: (context) => {
          const recent = context.recentCommands.slice(-5);
          const suggestions: ContextualSuggestion[] = [];

          if (recent.some(cmd => cmd.includes('systemctl start'))) {
            suggestions.push({
              command: 'systemctl status [service_name]',
              relevance: 0.9,
              reasoning: 'Check if service started successfully',
              category: 'followup'
            });
          }

          if (recent.some(cmd => cmd.includes('ps aux') || cmd.includes('top'))) {
            suggestions.push(
              {
                command: 'free -h',
                relevance: 0.6,
                reasoning: 'Check memory usage',
                category: 'related'
              },
              {
                command: 'df -h',
                relevance: 0.6,
                reasoning: 'Check disk usage',
                category: 'related'
              }
            );
          }

          return suggestions;
        }
      },

      // Error recovery patterns
      {
        name: 'error_recovery',
        description: 'Command failed, suggest recovery actions',
        confidence: 0.6,
        trigger: (context) => {
          const lastExecution = context.commandHistory[context.commandHistory.length - 1];
          return lastExecution && !lastExecution.success;
        },
        suggestions: (context) => {
          const lastExecution = context.commandHistory[context.commandHistory.length - 1];
          if (!lastExecution) return [];

          const suggestions: ContextualSuggestion[] = [];
          const command = lastExecution.command.toLowerCase();
          const output = lastExecution.output.toLowerCase();

          // Permission errors
          if (output.includes('permission denied') || output.includes('access denied')) {
            suggestions.push({
              command: `sudo ${lastExecution.command}`,
              relevance: 0.8,
              reasoning: 'Permission denied, try with sudo',
              category: 'correction'
            });
          }

          // File not found errors
          if (output.includes('no such file') || output.includes('not found')) {
            suggestions.push(
              {
                command: `ls -la`,
                relevance: 0.7,
                reasoning: 'Check current directory contents',
                category: 'correction'
              },
              {
                command: `find . -name "*${this.extractFilename(command)}*"`,
                relevance: 0.6,
                reasoning: 'Search for the file',
                category: 'correction'
              }
            );
          }

          // Network errors
          if (output.includes('connection refused') || output.includes('timeout')) {
            suggestions.push({
              command: 'ping google.com',
              relevance: 0.5,
              reasoning: 'Test network connectivity',
              category: 'correction'
            });
          }

          return suggestions;
        }
      },

      // File operations patterns
      {
        name: 'file_operations',
        description: 'File and directory manipulation workflow',
        confidence: 0.7,
        trigger: (context) => {
          const recent = context.recentCommands.join(' ').toLowerCase();
          return recent.match(/\b(ls|cd|cp|mv|rm|mkdir|chmod|find)\b/);
        },
        suggestions: (context) => {
          const recent = context.recentCommands.slice(-3);
          const suggestions: ContextualSuggestion[] = [];

          if (recent.some(cmd => cmd.includes('mkdir'))) {
            suggestions.push({
              command: 'cd [directory_name]',
              relevance: 0.7,
              reasoning: 'Directory created, navigate into it',
              category: 'followup'
            });
          }

          if (recent.some(cmd => cmd.includes('cp ') || cmd.includes('mv '))) {
            suggestions.push({
              command: 'ls -la',
              relevance: 0.6,
              reasoning: 'Verify file operation completed',
              category: 'followup'
            });
          }

          if (recent.some(cmd => cmd.includes('find'))) {
            const lastFind = recent.find(cmd => cmd.includes('find'));
            if (lastFind && lastFind.includes('-name')) {
              suggestions.push({
                command: lastFind.replace(' -name ', ' -type f -exec ls -la {} \\;'),
                relevance: 0.5,
                reasoning: 'Show detailed info for found files',
                category: 'enhancement'
              });
            }
          }

          return suggestions;
        }
      }
    ];

    this.logger.info(`Initialized ${this.contextPatterns.length} context patterns`);
  }

  async updateContext(sessionId: string, execution: ExecutionContext): Promise<void> {
    let context = this.contexts.get(sessionId);

    if (!context) {
      context = {
        sessionId,
        currentDirectory: process.cwd(),
        environment: process.env as Record<string, string>,
        recentCommands: [],
        workflowState: 'idle',
        lastActivity: new Date(),
        commandHistory: []
      };
      this.contexts.set(sessionId, context);
    }

    // Update command history
    context.commandHistory.push(execution);
    if (context.commandHistory.length > this.config.maxContextHistory) {
      context.commandHistory.shift();
    }

    // Update recent commands (keep last 10)
    context.recentCommands.push(execution.command);
    if (context.recentCommands.length > 10) {
      context.recentCommands.shift();
    }

    // Update working directory if command was cd
    if (execution.command.startsWith('cd ') && execution.success) {
      const newDir = execution.command.split(' ')[1];
      if (newDir) {
        context.currentDirectory = newDir;
      }
    }

    // Update project type based on recent activity
    context.projectType = this.inferProjectType(context);

    // Update workflow state
    context.workflowState = this.inferWorkflowState(context);

    // Update last activity
    context.lastActivity = execution.timestamp;

    this.logger.debug(`Updated context for session ${sessionId}: ${context.projectType}, ${context.workflowState}`);
  }

  private inferProjectType(context: WorkingContext): WorkingContext['projectType'] {
    const recentCommands = context.recentCommands.slice(-10).join(' ').toLowerCase();
    
    if (recentCommands.includes('git')) return 'git';
    if (recentCommands.includes('npm') || recentCommands.includes('node')) return 'nodejs';
    if (recentCommands.includes('python') || recentCommands.includes('pip')) return 'python';
    if (recentCommands.includes('docker')) return 'docker';
    if (recentCommands.includes('mysql') || recentCommands.includes('postgres')) return 'database';
    if (recentCommands.includes('systemctl') || recentCommands.includes('service')) return 'system';
    if (recentCommands.includes('curl') || recentCommands.includes('wget')) return 'web';

    return undefined;
  }

  private inferWorkflowState(context: WorkingContext): WorkingContext['workflowState'] {
    const recentCommands = context.recentCommands.slice(-5).join(' ').toLowerCase();
    const recentFailures = context.commandHistory.slice(-5).filter(c => !c.success).length;

    if (recentFailures >= 2) return 'debugging';
    if (recentCommands.includes('deploy') || recentCommands.includes('build')) return 'deployment';
    if (recentCommands.includes('systemctl') || recentCommands.includes('service')) return 'maintenance';
    if (recentCommands.includes('git') || recentCommands.includes('npm') || recentCommands.includes('python')) return 'development';

    return 'idle';
  }

  async getSuggestions(sessionId: string, currentCommand?: string): Promise<string[]> {
    const context = this.contexts.get(sessionId);
    if (!context) return [];

    const allSuggestions: ContextualSuggestion[] = [];

    // Apply all applicable context patterns
    for (const pattern of this.contextPatterns) {
      if (pattern.trigger(context)) {
        const suggestions = pattern.suggestions(context);
        // Weight suggestions by pattern confidence
        for (const suggestion of suggestions) {
          suggestion.relevance *= pattern.confidence;
          allSuggestions.push(suggestion);
        }
      }
    }

    // If we have a current partial command, filter and boost relevant suggestions
    if (currentCommand) {
      const partial = currentCommand.toLowerCase();
      for (const suggestion of allSuggestions) {
        if (suggestion.command.toLowerCase().startsWith(partial)) {
          suggestion.relevance *= 1.5; // Boost exact matches
        } else if (suggestion.command.toLowerCase().includes(partial)) {
          suggestion.relevance *= 1.2; // Boost partial matches
        }
      }
    }

    // Sort by relevance and remove duplicates
    const uniqueSuggestions = new Map<string, ContextualSuggestion>();
    for (const suggestion of allSuggestions) {
      const existing = uniqueSuggestions.get(suggestion.command);
      if (!existing || suggestion.relevance > existing.relevance) {
        uniqueSuggestions.set(suggestion.command, suggestion);
      }
    }

    return Array.from(uniqueSuggestions.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 8)
      .map(s => s.command);
  }

  async getCompletions(sessionId: string, partialCommand: string): Promise<string[]> {
    const context = this.contexts.get(sessionId);
    if (!context) return [];

    const completions: string[] = [];
    const partial = partialCommand.toLowerCase().trim();

    // Get command history completions
    const historyCompletions = context.commandHistory
      .map(c => c.command)
      .filter(cmd => cmd.toLowerCase().startsWith(partial))
      .slice(-10); // Last 10 matching commands

    completions.push(...historyCompletions);

    // Get contextual completions
    const suggestions = await this.getSuggestions(sessionId, partialCommand);
    const contextualCompletions = suggestions.filter(cmd => 
      cmd.toLowerCase().startsWith(partial)
    );

    completions.push(...contextualCompletions);

    // Remove duplicates and return
    return [...new Set(completions)].slice(0, 10);
  }

  getDetailedSuggestions(sessionId: string, limit: number = 5): ContextualSuggestion[] {
    const context = this.contexts.get(sessionId);
    if (!context) return [];

    const allSuggestions: ContextualSuggestion[] = [];

    for (const pattern of this.contextPatterns) {
      if (pattern.trigger(context)) {
        const suggestions = pattern.suggestions(context);
        for (const suggestion of suggestions) {
          suggestion.relevance *= pattern.confidence;
          allSuggestions.push(suggestion);
        }
      }
    }

    // Remove duplicates and sort
    const uniqueSuggestions = new Map<string, ContextualSuggestion>();
    for (const suggestion of allSuggestions) {
      const existing = uniqueSuggestions.get(suggestion.command);
      if (!existing || suggestion.relevance > existing.relevance) {
        uniqueSuggestions.set(suggestion.command, suggestion);
      }
    }

    return Array.from(uniqueSuggestions.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  getContext(sessionId: string): WorkingContext | undefined {
    return this.contexts.get(sessionId);
  }

  getContextSummary(sessionId: string): any {
    const context = this.contexts.get(sessionId);
    if (!context) return null;

    return {
      sessionId: context.sessionId,
      currentDirectory: context.currentDirectory,
      projectType: context.projectType,
      workflowState: context.workflowState,
      recentCommands: context.recentCommands.slice(-5),
      lastActivity: context.lastActivity,
      totalCommands: context.commandHistory.length,
      successRate: context.commandHistory.length > 0 
        ? context.commandHistory.filter(c => c.success).length / context.commandHistory.length 
        : 0
    };
  }

  private extractFilename(command: string): string {
    // Simple filename extraction - could be enhanced
    const parts = command.split(' ');
    for (const part of parts) {
      if (part.includes('.') && !part.startsWith('-')) {
        return part;
      }
    }
    return '';
  }

  clearContext(sessionId: string): void {
    this.contexts.delete(sessionId);
    this.logger.info(`Cleared context for session ${sessionId}`);
  }

  getActiveContexts(): string[] {
    return Array.from(this.contexts.keys());
  }

  getContextStatistics(): any {
    const contexts = Array.from(this.contexts.values());
    
    const projectTypes = contexts.reduce((acc, ctx) => {
      const type = ctx.projectType || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const workflowStates = contexts.reduce((acc, ctx) => {
      acc[ctx.workflowState] = (acc[ctx.workflowState] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgCommandsPerSession = contexts.length > 0 
      ? contexts.reduce((sum, ctx) => sum + ctx.commandHistory.length, 0) / contexts.length 
      : 0;

    return {
      totalContexts: contexts.length,
      projectTypeDistribution: projectTypes,
      workflowStateDistribution: workflowStates,
      averageCommandsPerSession: avgCommandsPerSession,
      patternsActive: this.contextPatterns.length
    };
  }

  addContextPattern(pattern: ContextPattern): void {
    this.contextPatterns.push(pattern);
    this.logger.info(`Added new context pattern: ${pattern.name}`);
  }
}