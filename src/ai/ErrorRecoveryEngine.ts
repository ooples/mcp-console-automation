import { AIConfig, RecoveryAction } from './AICore.js';
import { Logger } from '../utils/logger.js';
import { ErrorPattern } from '../types/index.js';

interface RecoveryRule {
  errorPattern: RegExp;
  errorType: string;
  recoveryActions: RecoveryAction[];
  conditions?: {
    os?: string[];
    environment?: string[];
    commandContains?: string[];
  };
}

interface ErrorContext {
  command: string;
  output: string;
  environment: Record<string, string>;
  previousCommands?: string[];
  workingDirectory?: string;
  exitCode?: number;
}

export class ErrorRecoveryEngine {
  private logger: Logger;
  private config: AIConfig;
  private recoveryRules: RecoveryRule[];
  private recoveryHistory: Map<string, Array<{ error: string; action: RecoveryAction; success: boolean; timestamp: Date }>> = new Map();

  constructor(config: AIConfig) {
    this.config = config;
    this.logger = new Logger('ErrorRecovery');
    this.initializeRecoveryRules();
  }

  private initializeRecoveryRules() {
    this.recoveryRules = [
      // Permission errors
      {
        errorPattern: /permission denied|access denied|operation not permitted/i,
        errorType: 'permission',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Try with sudo privileges',
            command: 'sudo {original_command}',
            confidence: 0.8,
            estimatedDuration: 5000
          },
          {
            type: 'change_environment',
            description: 'Check and fix file permissions',
            command: 'ls -la {target_file} && chmod +r {target_file}',
            confidence: 0.6,
            estimatedDuration: 3000
          }
        ]
      },

      // File not found errors
      {
        errorPattern: /no such file or directory|file not found|cannot find|does not exist/i,
        errorType: 'file_not_found',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Search for the file in common locations',
            command: 'find / -name "{filename}" -type f 2>/dev/null | head -5',
            confidence: 0.7,
            estimatedDuration: 10000
          },
          {
            type: 'modify_command',
            description: 'Create the missing directory structure',
            command: 'mkdir -p "{directory_path}"',
            confidence: 0.5,
            estimatedDuration: 2000
          },
          {
            type: 'modify_command',
            description: 'Use absolute path instead',
            command: 'which {command_name}',
            confidence: 0.6,
            estimatedDuration: 1000
          }
        ]
      },

      // Network connectivity errors
      {
        errorPattern: /connection refused|network unreachable|timeout|host unreachable|name resolution failed/i,
        errorType: 'network',
        recoveryActions: [
          {
            type: 'retry',
            description: 'Retry the connection with exponential backoff',
            confidence: 0.6,
            estimatedDuration: 5000
          },
          {
            type: 'modify_command',
            description: 'Check network connectivity',
            command: 'ping -c 3 8.8.8.8 && ping -c 3 {target_host}',
            confidence: 0.7,
            estimatedDuration: 8000
          },
          {
            type: 'modify_command',
            description: 'Try alternative DNS resolution',
            command: 'nslookup {target_host} 8.8.8.8',
            confidence: 0.5,
            estimatedDuration: 3000
          }
        ]
      },

      // Port already in use
      {
        errorPattern: /port.*already in use|address already in use|bind.*failed/i,
        errorType: 'port_conflict',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Find and stop the process using the port',
            command: 'lsof -ti:{port} | xargs kill -9',
            confidence: 0.8,
            estimatedDuration: 3000
          },
          {
            type: 'modify_command',
            description: 'Use an alternative port',
            command: '{original_command_with_alt_port}',
            confidence: 0.7,
            estimatedDuration: 1000
          },
          {
            type: 'modify_command',
            description: 'Check what process is using the port',
            command: 'lsof -i:{port}',
            confidence: 0.9,
            estimatedDuration: 2000
          }
        ]
      },

      // Out of memory errors
      {
        errorPattern: /out of memory|cannot allocate memory|memory allocation failed/i,
        errorType: 'memory',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Check available memory',
            command: 'free -h && ps aux --sort=-%mem | head -10',
            confidence: 0.9,
            estimatedDuration: 2000
          },
          {
            type: 'modify_command',
            description: 'Clear system caches',
            command: 'sudo sync && sudo sysctl vm.drop_caches=3',
            confidence: 0.6,
            estimatedDuration: 5000
          },
          {
            type: 'escalate',
            description: 'Memory issue requires system administrator intervention',
            confidence: 0.8,
            estimatedDuration: 0
          }
        ]
      },

      // Disk space errors
      {
        errorPattern: /no space left|disk full|insufficient disk space/i,
        errorType: 'disk_space',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Check disk usage',
            command: 'df -h && du -sh * | sort -hr | head -10',
            confidence: 0.9,
            estimatedDuration: 5000
          },
          {
            type: 'modify_command',
            description: 'Clean temporary files',
            command: 'sudo rm -rf /tmp/* /var/tmp/* ~/.cache/*',
            confidence: 0.7,
            estimatedDuration: 10000
          },
          {
            type: 'escalate',
            description: 'Disk space issue requires manual cleanup',
            confidence: 0.8,
            estimatedDuration: 0
          }
        ]
      },

      // Package/dependency errors
      {
        errorPattern: /package not found|module not found|dependency.*not satisfied|no such package/i,
        errorType: 'dependency',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Update package lists and retry',
            command: 'sudo apt update && {original_command}',
            confidence: 0.7,
            estimatedDuration: 30000,
            conditions: { os: ['ubuntu', 'debian'] }
          },
          {
            type: 'modify_command',
            description: 'Install missing dependencies',
            command: 'npm install {missing_package}',
            confidence: 0.8,
            estimatedDuration: 15000,
            conditions: { commandContains: ['npm', 'node'] }
          },
          {
            type: 'modify_command',
            description: 'Search for available packages',
            command: 'apt search {package_name}',
            confidence: 0.6,
            estimatedDuration: 5000
          }
        ]
      },

      // Git errors
      {
        errorPattern: /not a git repository|fatal.*git/i,
        errorType: 'git',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Initialize git repository',
            command: 'git init',
            confidence: 0.8,
            estimatedDuration: 1000
          },
          {
            type: 'modify_command',
            description: 'Check if in correct directory',
            command: 'pwd && ls -la',
            confidence: 0.9,
            estimatedDuration: 1000
          }
        ]
      },

      // Docker errors
      {
        errorPattern: /docker.*not found|cannot connect to docker daemon/i,
        errorType: 'docker',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Start Docker service',
            command: 'sudo systemctl start docker',
            confidence: 0.8,
            estimatedDuration: 10000
          },
          {
            type: 'modify_command',
            description: 'Check Docker installation',
            command: 'docker --version && docker info',
            confidence: 0.9,
            estimatedDuration: 3000
          }
        ]
      },

      // Syntax errors in scripts
      {
        errorPattern: /syntax error|unexpected token|invalid syntax/i,
        errorType: 'syntax',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Check script syntax',
            command: 'bash -n {script_file}',
            confidence: 0.7,
            estimatedDuration: 2000,
            conditions: { commandContains: ['bash', 'sh'] }
          },
          {
            type: 'modify_command',
            description: 'Validate JSON/YAML syntax',
            command: 'python -m json.tool {file} > /dev/null',
            confidence: 0.8,
            estimatedDuration: 2000,
            conditions: { commandContains: ['json'] }
          }
        ]
      },

      // SSL/TLS certificate errors
      {
        errorPattern: /certificate.*invalid|ssl.*error|tls.*handshake failed/i,
        errorType: 'ssl_certificate',
        recoveryActions: [
          {
            type: 'modify_command',
            description: 'Skip SSL verification (not recommended for production)',
            command: '{original_command} --insecure',
            confidence: 0.4,
            estimatedDuration: 1000
          },
          {
            type: 'modify_command',
            description: 'Update CA certificates',
            command: 'sudo apt update && sudo apt install ca-certificates',
            confidence: 0.6,
            estimatedDuration: 20000
          },
          {
            type: 'modify_command',
            description: 'Check certificate details',
            command: 'openssl s_client -connect {host}:443 -servername {host}',
            confidence: 0.8,
            estimatedDuration: 3000
          }
        ]
      }
    ];

    this.logger.info(`Loaded ${this.recoveryRules.length} error recovery rules`);
  }

  async analyzeAndRecover(
    error: string,
    sessionId: string,
    context: ErrorContext
  ): Promise<RecoveryAction[]> {
    const matchingRules = this.findMatchingRules(error, context);
    
    if (matchingRules.length === 0) {
      this.logger.warn(`No recovery rules found for error: ${error.substring(0, 100)}...`);
      return this.generateGenericRecoveryActions(error, context);
    }

    const recoveryActions: RecoveryAction[] = [];

    for (const rule of matchingRules) {
      for (const action of rule.recoveryActions) {
        // Check if conditions are met
        if (this.checkConditions(rule.conditions, context)) {
          // Customize the action based on context
          const customizedAction = this.customizeAction(action, error, context);
          
          // Adjust confidence based on history
          customizedAction.confidence = this.adjustConfidenceBasedOnHistory(
            sessionId,
            error,
            customizedAction
          );

          recoveryActions.push(customizedAction);
        }
      }
    }

    // Sort by confidence and return top actions
    const sortedActions = recoveryActions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    this.logger.info(`Generated ${sortedActions.length} recovery actions for session ${sessionId}`);
    return sortedActions;
  }

  private findMatchingRules(error: string, context: ErrorContext): RecoveryRule[] {
    return this.recoveryRules.filter(rule => rule.errorPattern.test(error));
  }

  private checkConditions(conditions: RecoveryRule['conditions'], context: ErrorContext): boolean {
    if (!conditions) return true;

    if (conditions.os && conditions.os.length > 0) {
      const currentOS = process.platform;
      if (!conditions.os.some(os => currentOS.includes(os))) {
        return false;
      }
    }

    if (conditions.commandContains && conditions.commandContains.length > 0) {
      const commandLower = context.command.toLowerCase();
      if (!conditions.commandContains.some(keyword => commandLower.includes(keyword))) {
        return false;
      }
    }

    if (conditions.environment && conditions.environment.length > 0) {
      // Check if required environment variables exist
      if (!conditions.environment.every(env => context.environment[env])) {
        return false;
      }
    }

    return true;
  }

  private customizeAction(
    action: RecoveryAction,
    error: string,
    context: ErrorContext
  ): RecoveryAction {
    const customized = { ...action };

    if (customized.command) {
      // Replace placeholders with actual values
      customized.command = customized.command
        .replace(/{original_command}/g, context.command)
        .replace(/{filename}/g, this.extractFilename(error, context))
        .replace(/{directory_path}/g, this.extractDirectoryPath(error, context))
        .replace(/{command_name}/g, this.extractCommandName(context.command))
        .replace(/{target_host}/g, this.extractHostname(error, context))
        .replace(/{target_file}/g, this.extractTargetFile(error, context))
        .replace(/{port}/g, this.extractPort(error, context))
        .replace(/{package_name}/g, this.extractPackageName(error, context))
        .replace(/{script_file}/g, this.extractScriptFile(error, context))
        .replace(/{file}/g, this.extractFile(error, context))
        .replace(/{host}/g, this.extractHostname(error, context))
        .replace(/{missing_package}/g, this.extractMissingPackage(error, context));
    }

    return customized;
  }

  private extractFilename(error: string, context: ErrorContext): string {
    // Try to extract filename from error message or command
    const filenameMatch = error.match(/['"`]([^'"`]+)['"`]/);
    if (filenameMatch) return filenameMatch[1];

    const commandMatch = context.command.match(/\S+\.(?:txt|log|json|xml|yml|yaml|conf|cfg)(?:\s|$)/);
    if (commandMatch) return commandMatch[0].trim();

    return 'unknown_file';
  }

  private extractDirectoryPath(error: string, context: ErrorContext): string {
    // Extract directory path from error or command
    const pathMatch = error.match(/(?:in|to|from)\s+['"`]?([\/\w\-\.]+)['"`]?/);
    if (pathMatch) return pathMatch[1];

    // Try to extract from command
    const cmdMatch = context.command.match(/\s([\/\w\-\.]+\/)/);
    if (cmdMatch) return cmdMatch[1];

    return './';
  }

  private extractCommandName(command: string): string {
    return command.split(' ')[0];
  }

  private extractHostname(error: string, context: ErrorContext): string {
    const hostMatch = error.match(/(?:host|server|hostname)\s+['"`]?([a-zA-Z0-9\-\.]+)['"`]?/) ||
                     context.command.match(/(?:@|\/\/)([a-zA-Z0-9\-\.]+)/);
    return hostMatch ? hostMatch[1] : 'localhost';
  }

  private extractTargetFile(error: string, context: ErrorContext): string {
    return this.extractFilename(error, context);
  }

  private extractPort(error: string, context: ErrorContext): string {
    const portMatch = error.match(/port\s+(\d+)/) || 
                     context.command.match(/:(\d+)/) ||
                     error.match(/(\d{2,5})/);
    return portMatch ? portMatch[1] : '8080';
  }

  private extractPackageName(error: string, context: ErrorContext): string {
    const packageMatch = error.match(/package\s+['"`]?([a-zA-Z0-9\-_]+)['"`]?/) ||
                        error.match(/module\s+['"`]?([a-zA-Z0-9\-_]+)['"`]?/);
    return packageMatch ? packageMatch[1] : 'unknown_package';
  }

  private extractScriptFile(error: string, context: ErrorContext): string {
    const scriptMatch = context.command.match(/\s([^\s]+\.(?:sh|bash|py|js|pl|rb))\s/) ||
                       error.match(/(?:file|script)\s+['"`]?([^\s'"`]+)['"`]?/);
    return scriptMatch ? scriptMatch[1] : 'script.sh';
  }

  private extractFile(error: string, context: ErrorContext): string {
    return this.extractFilename(error, context);
  }

  private extractMissingPackage(error: string, context: ErrorContext): string {
    return this.extractPackageName(error, context);
  }

  private adjustConfidenceBasedOnHistory(
    sessionId: string,
    error: string,
    action: RecoveryAction
  ): number {
    const history = this.recoveryHistory.get(sessionId) || [];
    const similarActions = history.filter(h => 
      h.action.type === action.type && 
      h.error.substring(0, 50) === error.substring(0, 50)
    );

    if (similarActions.length === 0) {
      return action.confidence;
    }

    // Calculate success rate
    const successCount = similarActions.filter(a => a.success).length;
    const successRate = successCount / similarActions.length;

    // Adjust confidence based on historical success
    let adjustedConfidence = action.confidence;
    if (successRate > 0.7) {
      adjustedConfidence *= 1.2;
    } else if (successRate < 0.3) {
      adjustedConfidence *= 0.7;
    }

    return Math.min(adjustedConfidence, 1.0);
  }

  private generateGenericRecoveryActions(error: string, context: ErrorContext): RecoveryAction[] {
    const actions: RecoveryAction[] = [
      {
        type: 'retry',
        description: 'Retry the same command',
        confidence: 0.3,
        estimatedDuration: 1000
      },
      {
        type: 'modify_command',
        description: 'Check command help',
        command: `${this.extractCommandName(context.command)} --help`,
        confidence: 0.5,
        estimatedDuration: 2000
      }
    ];

    // Add escalation if error seems severe
    if (error.toLowerCase().includes('critical') || 
        error.toLowerCase().includes('fatal') ||
        error.toLowerCase().includes('segmentation')) {
      actions.push({
        type: 'escalate',
        description: 'Error requires manual intervention',
        confidence: 0.8,
        estimatedDuration: 0
      });
    }

    return actions;
  }

  recordRecoveryAttempt(
    sessionId: string,
    error: string,
    action: RecoveryAction,
    success: boolean
  ): void {
    const history = this.recoveryHistory.get(sessionId) || [];
    history.push({
      error,
      action,
      success,
      timestamp: new Date()
    });

    // Keep only last 50 recovery attempts per session
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }

    this.recoveryHistory.set(sessionId, history);
    
    this.logger.info(`Recorded recovery attempt for session ${sessionId}: ${success ? 'SUCCESS' : 'FAILED'}`);
  }

  getRecoveryStatistics(sessionId?: string): any {
    if (sessionId) {
      const history = this.recoveryHistory.get(sessionId) || [];
      const total = history.length;
      const successful = history.filter(h => h.success).length;
      
      return {
        sessionId,
        totalAttempts: total,
        successfulAttempts: successful,
        successRate: total > 0 ? successful / total : 0,
        recentAttempts: history.slice(-5)
      };
    }

    // Global statistics
    let totalAttempts = 0;
    let successfulAttempts = 0;
    const actionTypeStats: Record<string, { total: number; successful: number }> = {};

    this.recoveryHistory.forEach(history => {
      history.forEach(attempt => {
        totalAttempts++;
        if (attempt.success) successfulAttempts++;

        const actionType = attempt.action.type;
        if (!actionTypeStats[actionType]) {
          actionTypeStats[actionType] = { total: 0, successful: 0 };
        }
        actionTypeStats[actionType].total++;
        if (attempt.success) {
          actionTypeStats[actionType].successful++;
        }
      });
    });

    return {
      globalStats: {
        totalAttempts,
        successfulAttempts,
        successRate: totalAttempts > 0 ? successfulAttempts / totalAttempts : 0,
        activeSessions: this.recoveryHistory.size
      },
      actionTypeStats: Object.entries(actionTypeStats).map(([type, stats]) => ({
        type,
        total: stats.total,
        successful: stats.successful,
        successRate: stats.total > 0 ? stats.successful / stats.total : 0
      }))
    };
  }

  addRecoveryRule(rule: RecoveryRule): void {
    this.recoveryRules.push(rule);
    this.logger.info(`Added new recovery rule for error type: ${rule.errorType}`);
  }

  getRecoveryRules(): RecoveryRule[] {
    return [...this.recoveryRules];
  }
}