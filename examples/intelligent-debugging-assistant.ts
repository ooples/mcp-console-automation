#!/usr/bin/env node
/**
 * Intelligent Debugging Assistant Example
 * 
 * This example demonstrates an AI-powered debugging assistant that can:
 * - Analyze error messages and suggest fixes
 * - Provide contextual debugging commands
 * - Learn from successful debug sessions
 * - Automatically try common debugging steps
 */

import { AIEnhancedConsoleServer } from '../src/ai/AIEnhancedServer.js';

class IntelligentDebuggingAssistant {
  private server: AIEnhancedConsoleServer;
  private debuggingSessions: Map<string, DebuggingSession> = new Map();

  constructor() {
    this.server = new AIEnhancedConsoleServer({
      enableNLP: true,
      enableErrorRecovery: true,
      enableAnomalyDetection: true,
      enableLearning: true,
      enableContextAwareness: true,
      maxContextHistory: 300,
      learningDataPath: './data/debugging-ai'
    });
  }

  async start() {
    await this.server.start();
    console.log('🐛 Intelligent Debugging Assistant Started');
  }

  async startDebuggingSession(problem: string, context?: DebugContext): Promise<string> {
    const sessionId = this.generateSessionId();
    
    const session: DebuggingSession = {
      id: sessionId,
      problem,
      context: context || {},
      steps: [],
      startTime: new Date(),
      status: 'active'
    };

    this.debuggingSessions.set(sessionId, session);
    
    console.log(`🔍 Starting debugging session ${sessionId}`);
    console.log(`📋 Problem: ${problem}`);
    
    // Get initial debugging suggestions
    const suggestions = await this.getInitialDebuggingSuggestions(problem, context);
    
    console.log(`💡 Initial debugging suggestions:`);
    suggestions.forEach((suggestion, index) => {
      console.log(`  ${index + 1}. ${suggestion.description} (confidence: ${suggestion.confidence})`);
    });

    return sessionId;
  }

  private async getInitialDebuggingSuggestions(
    problem: string, 
    context?: DebugContext
  ): Promise<DebuggingSuggestion[]> {
    
    const suggestions: DebuggingSuggestion[] = [];
    const problemLower = problem.toLowerCase();

    // Application crash debugging
    if (problemLower.includes('crash') || problemLower.includes('segfault')) {
      suggestions.push(
        {
          type: 'investigation',
          description: 'Check for core dumps and analyze with gdb',
          commands: ['find /tmp /var/crash . -name "core*" -o -name "*.core"', 'gdb [executable] [core-file]'],
          confidence: 0.9,
          category: 'crash_analysis'
        },
        {
          type: 'investigation',
          description: 'Run application with memory debugging tools',
          commands: ['valgrind --tool=memcheck --leak-check=full [command]'],
          confidence: 0.8,
          category: 'memory_analysis'
        }
      );
    }

    // Performance issues
    if (problemLower.includes('slow') || problemLower.includes('performance') || problemLower.includes('hang')) {
      suggestions.push(
        {
          type: 'investigation',
          description: 'Profile application performance',
          commands: ['top -p [pid]', 'strace -p [pid]', 'perf record -g [command]'],
          confidence: 0.8,
          category: 'performance_analysis'
        },
        {
          type: 'investigation',
          description: 'Check for resource bottlenecks',
          commands: ['iostat -x 1', 'free -h', 'df -h'],
          confidence: 0.7,
          category: 'resource_analysis'
        }
      );
    }

    // Network issues
    if (problemLower.includes('connection') || problemLower.includes('network') || problemLower.includes('timeout')) {
      suggestions.push(
        {
          type: 'investigation',
          description: 'Diagnose network connectivity',
          commands: ['netstat -tulpn', 'ss -tulpn', 'ping [target]', 'traceroute [target]'],
          confidence: 0.85,
          category: 'network_diagnosis'
        },
        {
          type: 'investigation',
          description: 'Check firewall and routing',
          commands: ['iptables -L', 'ip route show', 'nslookup [hostname]'],
          confidence: 0.7,
          category: 'network_configuration'
        }
      );
    }

    // Database issues
    if (problemLower.includes('database') || problemLower.includes('sql') || problemLower.includes('db')) {
      suggestions.push(
        {
          type: 'investigation',
          description: 'Check database logs and connections',
          commands: ['tail -f /var/log/mysql/error.log', 'SHOW PROCESSLIST;', 'SHOW ENGINE INNODB STATUS;'],
          confidence: 0.8,
          category: 'database_analysis'
        }
      );
    }

    // Container issues
    if (problemLower.includes('docker') || problemLower.includes('container')) {
      suggestions.push(
        {
          type: 'investigation',
          description: 'Inspect container status and logs',
          commands: ['docker ps -a', 'docker logs [container]', 'docker inspect [container]'],
          confidence: 0.9,
          category: 'container_diagnosis'
        }
      );
    }

    // Service issues
    if (problemLower.includes('service') || problemLower.includes('daemon')) {
      suggestions.push(
        {
          type: 'investigation',
          description: 'Check service status and logs',
          commands: ['systemctl status [service]', 'journalctl -u [service] -f', 'systemctl --failed'],
          confidence: 0.85,
          category: 'service_diagnosis'
        }
      );
    }

    // Generic debugging steps
    suggestions.push(
      {
        type: 'investigation',
        description: 'Check system logs for errors',
        commands: ['tail -f /var/log/syslog', 'dmesg | tail', 'journalctl -n 50'],
        confidence: 0.6,
        category: 'log_analysis'
      },
      {
        type: 'investigation',
        description: 'Check system resource usage',
        commands: ['top', 'htop', 'ps aux --sort=-%mem | head', 'ps aux --sort=-%cpu | head'],
        confidence: 0.5,
        category: 'resource_monitoring'
      }
    );

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  async executeDebuggingStep(
    sessionId: string, 
    suggestion: DebuggingSuggestion,
    commandIndex: number = 0
  ): Promise<DebuggingStepResult> {
    
    const session = this.debuggingSessions.get(sessionId);
    if (!session) {
      throw new Error(`Debugging session ${sessionId} not found`);
    }

    const command = suggestion.commands[commandIndex];
    console.log(`🔧 Executing debugging step: ${command}`);

    try {
      // Execute the command using AI-enhanced server
      const startTime = Date.now();
      
      // Simulate command execution with enhanced error recovery
      const result = await this.simulateCommandExecution(command);
      
      const executionTime = Date.now() - startTime;
      
      const step: DebuggingStep = {
        suggestion,
        commandExecuted: command,
        result,
        executionTime,
        timestamp: new Date(),
        success: result.exitCode === 0
      };

      session.steps.push(step);

      // Analyze the results with AI
      const analysis = await this.analyzeStepResult(step, session);
      
      console.log(`📊 Step Result: ${step.success ? '✅ Success' : '❌ Failed'}`);
      console.log(`⏱️  Execution time: ${executionTime}ms`);
      
      if (analysis.insights.length > 0) {
        console.log(`🧠 AI Insights:`);
        analysis.insights.forEach(insight => {
          console.log(`   • ${insight}`);
        });
      }

      if (analysis.nextSuggestions.length > 0) {
        console.log(`🎯 Next suggested steps:`);
        analysis.nextSuggestions.forEach((nextSuggestion, index) => {
          console.log(`   ${index + 1}. ${nextSuggestion.description}`);
        });
      }

      return {
        step,
        analysis,
        sessionUpdated: true
      };

    } catch (error) {
      console.error(`💥 Error executing debugging step: ${error}`);
      
      const step: DebuggingStep = {
        suggestion,
        commandExecuted: command,
        result: { output: '', exitCode: 1, error: String(error) },
        executionTime: 0,
        timestamp: new Date(),
        success: false
      };

      session.steps.push(step);

      return {
        step,
        analysis: {
          insights: [`Command execution failed: ${error}`],
          nextSuggestions: await this.getErrorRecoverySuggestions(String(error)),
          problemLikelyResolved: false,
          confidence: 0.1
        },
        sessionUpdated: true
      };
    }
  }

  private async simulateCommandExecution(command: string): Promise<CommandResult> {
    // Simulate command execution - in reality this would use the AI server
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 2000));
    
    const successRate = 0.7; // 70% success rate for simulation
    const isSuccess = Math.random() < successRate;
    
    if (isSuccess) {
      return {
        output: this.generateMockOutput(command),
        exitCode: 0
      };
    } else {
      return {
        output: '',
        exitCode: 1,
        error: this.generateMockError(command)
      };
    }
  }

  private generateMockOutput(command: string): string {
    const outputs = {
      'top': 'PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ COMMAND\n1234 root 20 0 123456 45678 12345 S 25.3 5.2 1:23.45 myapp',
      'ps aux': 'USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\nroot 1234 2.5 1.2 123456 45678 ? S 10:30 0:05 /usr/bin/myapp',
      'netstat': 'Active Internet connections\nProto Recv-Q Send-Q Local Address Foreign Address State\ntcp 0 0 0.0.0.0:80 0.0.0.0:* LISTEN',
      'docker ps': 'CONTAINER ID IMAGE COMMAND CREATED STATUS PORTS NAMES\n12345abc nginx "nginx -g daemon..." 2 hours ago Up 2 hours 0.0.0.0:80->80/tcp webserver',
      'systemctl status': '● myservice.service - My Application Service\n   Loaded: loaded\n   Active: active (running) since Mon 2024-01-01 10:00:00',
    };

    for (const [key, output] of Object.entries(outputs)) {
      if (command.includes(key)) {
        return output;
      }
    }

    return `Command executed successfully: ${command}`;
  }

  private generateMockError(command: string): string {
    const errors = [
      'Permission denied',
      'Command not found',
      'No such file or directory',
      'Connection refused',
      'Operation timed out'
    ];

    return errors[Math.floor(Math.random() * errors.length)];
  }

  private async analyzeStepResult(
    step: DebuggingStep, 
    session: DebuggingSession
  ): Promise<StepAnalysis> {
    
    const insights: string[] = [];
    const nextSuggestions: DebuggingSuggestion[] = [];
    
    if (step.success) {
      // Analyze successful command output
      const output = step.result.output.toLowerCase();
      
      if (step.suggestion.category === 'resource_analysis') {
        if (output.includes('100%') || output.includes('full')) {
          insights.push('High resource usage detected - this may be the cause of the problem');
          nextSuggestions.push({
            type: 'action',
            description: 'Investigate high resource usage processes',
            commands: ['ps aux --sort=-%cpu | head -10', 'ps aux --sort=-%mem | head -10'],
            confidence: 0.8,
            category: 'resource_investigation'
          });
        }
      }

      if (step.suggestion.category === 'network_diagnosis') {
        if (output.includes('connection refused') || output.includes('timeout')) {
          insights.push('Network connectivity issues confirmed');
          nextSuggestions.push({
            type: 'action',
            description: 'Check if target service is running',
            commands: ['systemctl status [service]', 'telnet [host] [port]'],
            confidence: 0.9,
            category: 'service_verification'
          });
        }
      }

      if (step.suggestion.category === 'log_analysis') {
        if (output.includes('error') || output.includes('failed')) {
          insights.push('Error patterns found in logs - investigating specific errors');
          nextSuggestions.push({
            type: 'investigation',
            description: 'Extract and analyze specific error messages',
            commands: ['grep -i error /var/log/syslog | tail -10', 'journalctl --since "1 hour ago" | grep -i error'],
            confidence: 0.85,
            category: 'error_analysis'
          });
        }
      }

    } else {
      // Analyze failed command
      insights.push(`Command failed: ${step.result.error || 'Unknown error'}`);
      
      // Get error recovery suggestions
      const recoverySuggestions = await this.getErrorRecoverySuggestions(step.result.error || '');
      nextSuggestions.push(...recoverySuggestions);
    }

    // Check if problem might be resolved
    const problemLikelyResolved = this.assessProblemResolution(session);
    
    return {
      insights,
      nextSuggestions,
      problemLikelyResolved,
      confidence: this.calculateAnalysisConfidence(step, session)
    };
  }

  private async getErrorRecoverySuggestions(error: string): Promise<DebuggingSuggestion[]> {
    const suggestions: DebuggingSuggestion[] = [];
    const errorLower = error.toLowerCase();

    if (errorLower.includes('permission denied')) {
      suggestions.push({
        type: 'action',
        description: 'Try with elevated privileges',
        commands: ['sudo [previous_command]'],
        confidence: 0.8,
        category: 'permission_fix'
      });
    }

    if (errorLower.includes('command not found')) {
      suggestions.push({
        type: 'action',
        description: 'Install missing command or check PATH',
        commands: ['which [command]', 'echo $PATH', 'apt search [command]'],
        confidence: 0.7,
        category: 'command_availability'
      });
    }

    if (errorLower.includes('no such file')) {
      suggestions.push({
        type: 'investigation',
        description: 'Locate the missing file',
        commands: ['find / -name "[filename]" 2>/dev/null', 'locate [filename]'],
        confidence: 0.6,
        category: 'file_location'
      });
    }

    return suggestions;
  }

  private assessProblemResolution(session: DebuggingSession): boolean {
    // Simple heuristic - in reality this would use AI analysis
    const successfulSteps = session.steps.filter(s => s.success).length;
    const totalSteps = session.steps.length;
    
    if (totalSteps === 0) return false;
    
    const successRate = successfulSteps / totalSteps;
    const hasRecentSuccess = session.steps.slice(-3).some(s => s.success);
    
    return successRate > 0.6 && hasRecentSuccess;
  }

  private calculateAnalysisConfidence(step: DebuggingStep, session: DebuggingSession): number {
    let confidence = 0.5; // Base confidence
    
    if (step.success) confidence += 0.2;
    if (step.result.output.length > 50) confidence += 0.1; // More output usually means more info
    if (session.steps.length > 3) confidence += 0.1; // More context from previous steps
    
    return Math.min(confidence, 1.0);
  }

  async getSessionSummary(sessionId: string): Promise<DebuggingSessionSummary> {
    const session = this.debuggingSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const totalSteps = session.steps.length;
    const successfulSteps = session.steps.filter(s => s.success).length;
    const totalExecutionTime = session.steps.reduce((sum, s) => sum + s.executionTime, 0);

    const categoriesTried = [...new Set(session.steps.map(s => s.suggestion.category))];
    const mostEffectiveCategory = this.findMostEffectiveCategory(session.steps);

    return {
      sessionId,
      problem: session.problem,
      duration: Date.now() - session.startTime.getTime(),
      totalSteps,
      successfulSteps,
      successRate: totalSteps > 0 ? successfulSteps / totalSteps : 0,
      totalExecutionTime,
      categoriesTried,
      mostEffectiveCategory,
      problemResolved: session.status === 'resolved',
      keyFindings: this.extractKeyFindings(session)
    };
  }

  private findMostEffectiveCategory(steps: DebuggingStep[]): string {
    const categorySuccessRates: Record<string, { successful: number; total: number }> = {};
    
    for (const step of steps) {
      const category = step.suggestion.category;
      if (!categorySuccessRates[category]) {
        categorySuccessRates[category] = { successful: 0, total: 0 };
      }
      categorySuccessRates[category].total++;
      if (step.success) {
        categorySuccessRates[category].successful++;
      }
    }

    let bestCategory = 'unknown';
    let bestRate = 0;

    for (const [category, stats] of Object.entries(categorySuccessRates)) {
      const rate = stats.successful / stats.total;
      if (rate > bestRate) {
        bestRate = rate;
        bestCategory = category;
      }
    }

    return bestCategory;
  }

  private extractKeyFindings(session: DebuggingSession): string[] {
    const findings: string[] = [];
    
    // Extract insights from successful steps
    for (const step of session.steps.filter(s => s.success)) {
      const output = step.result.output.toLowerCase();
      
      if (output.includes('error') || output.includes('failed')) {
        findings.push('Error patterns identified in system logs');
      }
      if (output.includes('100%') || output.includes('full')) {
        findings.push('Resource exhaustion detected');
      }
      if (output.includes('connection refused')) {
        findings.push('Network connectivity issues confirmed');
      }
      if (output.includes('not running') || output.includes('inactive')) {
        findings.push('Critical service not running');
      }
    }

    return [...new Set(findings)]; // Remove duplicates
  }

  private generateSessionId(): string {
    return `debug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async closeSession(sessionId: string, resolved: boolean = false) {
    const session = this.debuggingSessions.get(sessionId);
    if (session) {
      session.status = resolved ? 'resolved' : 'closed';
      console.log(`📋 Debugging session ${sessionId} ${session.status}`);
      
      if (resolved) {
        console.log(`🎉 Problem resolved! Session completed in ${Date.now() - session.startTime.getTime()}ms`);
        // In real implementation, this would feed learning data to AI
      }
    }
  }
}

// Interface definitions
interface DebuggingSession {
  id: string;
  problem: string;
  context: DebugContext;
  steps: DebuggingStep[];
  startTime: Date;
  status: 'active' | 'resolved' | 'closed';
}

interface DebugContext {
  applicationName?: string;
  environment?: string;
  logFiles?: string[];
  errorMessages?: string[];
  recentChanges?: string[];
}

interface DebuggingSuggestion {
  type: 'investigation' | 'action' | 'verification';
  description: string;
  commands: string[];
  confidence: number;
  category: string;
}

interface DebuggingStep {
  suggestion: DebuggingSuggestion;
  commandExecuted: string;
  result: CommandResult;
  executionTime: number;
  timestamp: Date;
  success: boolean;
}

interface CommandResult {
  output: string;
  exitCode: number;
  error?: string;
}

interface DebuggingStepResult {
  step: DebuggingStep;
  analysis: StepAnalysis;
  sessionUpdated: boolean;
}

interface StepAnalysis {
  insights: string[];
  nextSuggestions: DebuggingSuggestion[];
  problemLikelyResolved: boolean;
  confidence: number;
}

interface DebuggingSessionSummary {
  sessionId: string;
  problem: string;
  duration: number;
  totalSteps: number;
  successfulSteps: number;
  successRate: number;
  totalExecutionTime: number;
  categoriesTried: string[];
  mostEffectiveCategory: string;
  problemResolved: boolean;
  keyFindings: string[];
}

// Example usage
async function demonstrateDebuggingAssistant() {
  const assistant = new IntelligentDebuggingAssistant();
  await assistant.start();

  // Start a debugging session for a web server issue
  const sessionId = await assistant.startDebuggingSession(
    'Web server returning 502 errors intermittently',
    {
      applicationName: 'nginx',
      environment: 'production',
      errorMessages: ['502 Bad Gateway', 'upstream timeout'],
      recentChanges: ['Updated PHP-FPM configuration', 'Deployed new code version']
    }
  );

  console.log('\n' + '='.repeat(60));
  console.log('🚀 Running automated debugging session...');
  console.log('='.repeat(60));

  // Simulate running through debugging steps
  const suggestions = await assistant['getInitialDebuggingSuggestions'](
    'Web server returning 502 errors intermittently'
  );

  // Execute a few debugging steps
  for (let i = 0; i < Math.min(3, suggestions.length); i++) {
    console.log(`\n🔍 Step ${i + 1}:`);
    const result = await assistant.executeDebuggingStep(sessionId, suggestions[i]);
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
  }

  // Get session summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Debugging Session Summary');
  console.log('='.repeat(60));
  
  const summary = await assistant.getSessionSummary(sessionId);
  console.log(`Problem: ${summary.problem}`);
  console.log(`Duration: ${(summary.duration / 1000).toFixed(1)}s`);
  console.log(`Steps executed: ${summary.totalSteps}`);
  console.log(`Success rate: ${(summary.successRate * 100).toFixed(1)}%`);
  console.log(`Categories tried: ${summary.categoriesTried.join(', ')}`);
  console.log(`Key findings: ${summary.keyFindings.join(', ') || 'None identified'}`);

  await assistant.closeSession(sessionId, summary.successRate > 0.7);
}

// Run demonstration
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateDebuggingAssistant().catch(console.error);
}

export { IntelligentDebuggingAssistant };