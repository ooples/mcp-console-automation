#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { ConsoleManager } from '../core/ConsoleManager.js';
import { SessionOptions } from '../types/index.js';
import { Logger } from '../utils/logger.js';

export class ConsoleAutomationServer {
  private server: Server;
  private consoleManager: ConsoleManager;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('MCPServer');
    this.consoleManager = new ConsoleManager();
    
    this.server = new Server(
      {
        name: 'console-automation',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupCleanup();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        
        switch (name) {
          case 'console_create_session':
            return await this.handleCreateSession(args as any);
          
          case 'console_send_input':
            return await this.handleSendInput(args as any);
          
          case 'console_send_key':
            return await this.handleSendKey(args as any);
          
          case 'console_get_output':
            return await this.handleGetOutput(args as any);
          
          case 'console_get_stream':
            return await this.handleGetStream(args as any);
          
          case 'console_wait_for_output':
            return await this.handleWaitForOutput(args as any);
          
          case 'console_stop_session':
            return await this.handleStopSession(args as any);
          
          case 'console_list_sessions':
            return await this.handleListSessions();
          
          case 'console_execute_command':
            return await this.handleExecuteCommand(args as any);
          
          case 'console_detect_errors':
            return await this.handleDetectErrors(args as any);
          
          case 'console_get_resource_usage':
            return await this.handleGetResourceUsage();
          
          case 'console_clear_output':
            return await this.handleClearOutput(args as any);
          
          // Monitoring tools
          case 'console_get_system_metrics':
            return await this.handleGetSystemMetrics();
          
          case 'console_get_session_metrics':
            return await this.handleGetSessionMetrics(args as any);
          
          case 'console_get_alerts':
            return await this.handleGetAlerts();
          
          case 'console_get_monitoring_dashboard':
            return await this.handleGetMonitoringDashboard();
          
          case 'console_start_monitoring':
            return await this.handleStartMonitoring(args as any);
          
          case 'console_stop_monitoring':
            return await this.handleStopMonitoring(args as any);
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error: any) {
        this.logger.error(`Tool execution error: ${error.message}`);
        throw new McpError(ErrorCode.InternalError, error.message);
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'console_create_session',
        description: 'Create a new console session for running a command',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The command to execute' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
            cwd: { type: 'string', description: 'Working directory' },
            env: { type: 'object', description: 'Environment variables' },
            detectErrors: { type: 'boolean', description: 'Enable automatic error detection' },
            timeout: { type: 'number', description: 'Session timeout in milliseconds' },
            consoleType: { 
              type: 'string', 
              enum: ['cmd', 'powershell', 'pwsh', 'bash', 'zsh', 'sh', 'ssh', 'auto'],
              description: 'Type of console to use' 
            },
            sshOptions: {
              type: 'object',
              description: 'SSH connection options',
              properties: {
                host: { type: 'string', description: 'SSH host' },
                port: { type: 'number', description: 'SSH port (default: 22)' },
                username: { type: 'string', description: 'SSH username' },
                password: { type: 'string', description: 'SSH password' },
                privateKey: { type: 'string', description: 'Private key content' },
                privateKeyPath: { type: 'string', description: 'Path to private key file' },
                passphrase: { type: 'string', description: 'Private key passphrase' }
              }
            },
            streaming: { type: 'boolean', description: 'Enable streaming for long-running processes' },
            monitoring: {
              type: 'object',
              description: 'Monitoring options for the session',
              properties: {
                enableMetrics: { type: 'boolean', description: 'Enable metrics collection' },
                enableTracing: { type: 'boolean', description: 'Enable distributed tracing' },
                enableProfiling: { type: 'boolean', description: 'Enable performance profiling' },
                enableAuditing: { type: 'boolean', description: 'Enable audit logging' },
                enableAnomalyDetection: { type: 'boolean', description: 'Enable anomaly detection' },
                customTags: { type: 'object', description: 'Custom tags for monitoring' },
                slaConfig: {
                  type: 'object',
                  description: 'SLA configuration',
                  properties: {
                    responseTime: { type: 'number', description: 'Response time threshold in ms' },
                    availabilityThreshold: { type: 'number', description: 'Availability threshold percentage' },
                    errorRateThreshold: { type: 'number', description: 'Error rate threshold percentage' }
                  }
                }
              }
            }
          },
          required: ['command']
        }
      },
      {
        name: 'console_send_input',
        description: 'Send text input to a console session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            input: { type: 'string', description: 'Text to send to the console' }
          },
          required: ['sessionId', 'input']
        }
      },
      {
        name: 'console_send_key',
        description: 'Send special key sequences to a console session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            key: { 
              type: 'string', 
              description: 'Key to send (e.g., enter, tab, up, down, ctrl+c, escape)',
              enum: ['enter', 'tab', 'up', 'down', 'left', 'right', 'escape', 'backspace', 'delete', 'ctrl+c', 'ctrl+d', 'ctrl+z', 'ctrl+l', 'ctrl+break']
            }
          },
          required: ['sessionId', 'key']
        }
      },
      {
        name: 'console_get_output',
        description: 'Get output from a console session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            limit: { type: 'number', description: 'Maximum number of output lines to return' }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'console_get_stream',
        description: 'Get streaming output from a long-running console session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            since: { type: 'string', description: 'ISO timestamp to get output since' }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'console_wait_for_output',
        description: 'Wait for specific output pattern in console',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            pattern: { type: 'string', description: 'Regex pattern to wait for' },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default: 5000)' }
          },
          required: ['sessionId', 'pattern']
        }
      },
      {
        name: 'console_stop_session',
        description: 'Stop a console session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to stop' }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'console_list_sessions',
        description: 'List all active console sessions',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'console_execute_command',
        description: 'Execute a command and wait for completion',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
            cwd: { type: 'string', description: 'Working directory' },
            env: { type: 'object', description: 'Environment variables' },
            timeout: { type: 'number', description: 'Execution timeout in milliseconds' },
            consoleType: { 
              type: 'string', 
              enum: ['cmd', 'powershell', 'pwsh', 'bash', 'zsh', 'sh', 'auto'],
              description: 'Type of console to use' 
            }
          },
          required: ['command']
        }
      },
      {
        name: 'console_detect_errors',
        description: 'Analyze console output for errors and exceptions',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            text: { type: 'string', description: 'Text to analyze (if not using session)' }
          }
        }
      },
      {
        name: 'console_get_resource_usage',
        description: 'Get resource usage statistics for all sessions',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'console_clear_output',
        description: 'Clear the output buffer for a session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'console_get_system_metrics',
        description: 'Get comprehensive system monitoring metrics including CPU, memory, disk, and network usage',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'console_get_session_metrics',
        description: 'Get detailed metrics for a specific console session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'console_get_alerts',
        description: 'Get current monitoring alerts including performance, error, security, and anomaly alerts',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'console_get_monitoring_dashboard',
        description: 'Get real-time monitoring dashboard data with metrics, alerts, and system status',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'console_start_monitoring',
        description: 'Start monitoring for a specific session with custom monitoring options',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            enableMetrics: { type: 'boolean', description: 'Enable metrics collection' },
            enableTracing: { type: 'boolean', description: 'Enable distributed tracing' },
            enableProfiling: { type: 'boolean', description: 'Enable performance profiling' },
            enableAuditing: { type: 'boolean', description: 'Enable audit logging' },
            enableAnomalyDetection: { type: 'boolean', description: 'Enable anomaly detection' },
            customTags: { type: 'object', description: 'Custom tags for monitoring' }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'console_stop_monitoring',
        description: 'Stop monitoring for a specific session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' }
          },
          required: ['sessionId']
        }
      }
    ];
  }

  private async handleCreateSession(args: SessionOptions) {
    const sessionId = await this.consoleManager.createSession(args);
    const session = this.consoleManager.getSession(sessionId);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            sessionId,
            message: `Session created for command: ${args.command}`,
            pid: session?.pid,
            consoleType: session?.type,
            streaming: session?.streaming
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleSendInput(args: { sessionId: string; input: string }) {
    await this.consoleManager.sendInput(args.sessionId, args.input);
    return {
      content: [
        {
          type: 'text',
          text: `Input sent to session ${args.sessionId}`
        } as TextContent
      ]
    };
  }

  private async handleSendKey(args: { sessionId: string; key: string }) {
    await this.consoleManager.sendKey(args.sessionId, args.key);
    return {
      content: [
        {
          type: 'text',
          text: `Key '${args.key}' sent to session ${args.sessionId}`
        } as TextContent
      ]
    };
  }

  private async handleGetOutput(args: { sessionId: string; limit?: number }) {
    const output = this.consoleManager.getOutput(args.sessionId, args.limit);
    const text = output.map(o => o.data).join('');
    return {
      content: [
        {
          type: 'text',
          text: text || 'No output available'
        } as TextContent
      ]
    };
  }

  private async handleGetStream(args: { sessionId: string; since?: string }) {
    const streamManager = this.consoleManager.getStream(args.sessionId);
    
    if (!streamManager) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Streaming not enabled for this session',
              hint: 'Create session with streaming: true'
            }, null, 2)
          } as TextContent
        ]
      };
    }

    const since = args.since ? new Date(args.since) : undefined;
    const chunks = streamManager.getChunks(since);
    const stats = streamManager.getStats();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            chunks: chunks.map(c => ({
              data: c.data,
              timestamp: c.timestamp,
              isError: c.isError
            })),
            stats,
            fullOutput: chunks.map(c => c.data).join('')
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleWaitForOutput(args: { sessionId: string; pattern: string; timeout?: number }) {
    try {
      const output = await this.consoleManager.waitForOutput(
        args.sessionId,
        args.pattern,
        args.timeout || 5000
      );
      return {
        content: [
          {
            type: 'text',
            text: output
          } as TextContent
        ]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  private async handleStopSession(args: { sessionId: string }) {
    await this.consoleManager.stopSession(args.sessionId);
    return {
      content: [
        {
          type: 'text',
          text: `Session ${args.sessionId} stopped`
        } as TextContent
      ]
    };
  }

  private async handleListSessions() {
    const sessions = this.consoleManager.getAllSessions();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(sessions.map(s => ({
            id: s.id,
            command: s.command,
            status: s.status,
            pid: s.pid,
            type: s.type,
            streaming: s.streaming,
            createdAt: s.createdAt
          })), null, 2)
        } as TextContent
      ]
    };
  }

  private async handleExecuteCommand(args: { command: string; args?: string[]; cwd?: string; env?: Record<string, string>; timeout?: number; consoleType?: any }) {
    const result = await this.consoleManager.executeCommand(
      args.command,
      args.args,
      {
        cwd: args.cwd,
        env: args.env,
        timeout: args.timeout,
        consoleType: args.consoleType
      }
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleDetectErrors(args: { sessionId?: string; text?: string }) {
    const errorDetector = new (await import('../core/ErrorDetector.js')).ErrorDetector();
    
    let textToAnalyze: string;
    if (args.sessionId) {
      const output = this.consoleManager.getLastOutput(args.sessionId, 100);
      textToAnalyze = output;
    } else if (args.text) {
      textToAnalyze = args.text;
    } else {
      throw new McpError(ErrorCode.InvalidParams, 'Either sessionId or text must be provided');
    }

    const errors = errorDetector.detect(textToAnalyze);
    const stackTrace = errorDetector.analyzeStackTrace(textToAnalyze);
    const severityScore = errorDetector.getSeverityScore(errors);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            errors,
            stackTrace,
            severityScore,
            hasErrors: errors.length > 0
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleGetResourceUsage() {
    const usage = this.consoleManager.getResourceUsage();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(usage, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleClearOutput(args: { sessionId: string }) {
    this.consoleManager.clearOutput(args.sessionId);
    return {
      content: [
        {
          type: 'text',
          text: `Output buffer cleared for session ${args.sessionId}`
        } as TextContent
      ]
    };
  }

  // Monitoring tool handlers
  private async handleGetSystemMetrics() {
    const metrics = await this.consoleManager.getSystemMetrics();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(metrics, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleGetSessionMetrics(args: { sessionId: string }) {
    const metrics = await this.consoleManager.getSessionMetrics(args.sessionId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(metrics, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleGetAlerts() {
    const alerts = await this.consoleManager.getAlerts();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(alerts, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleGetMonitoringDashboard() {
    const dashboard = await this.consoleManager.getDashboard();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(dashboard, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleStartMonitoring(args: { 
    sessionId: string; 
    enableMetrics?: boolean; 
    enableTracing?: boolean; 
    enableProfiling?: boolean; 
    enableAuditing?: boolean; 
    enableAnomalyDetection?: boolean; 
    customTags?: Record<string, string> 
  }) {
    const monitoringSystem = this.consoleManager.getMonitoringSystem();
    const session = this.consoleManager.getSession(args.sessionId);
    
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, `Session ${args.sessionId} not found`);
    }

    await monitoringSystem.startSessionMonitoring(args.sessionId, {
      command: session.command,
      args: session.args,
      pid: session.pid!,
      enableMetrics: args.enableMetrics,
      enableTracing: args.enableTracing,
      enableProfiling: args.enableProfiling,
      enableAuditing: args.enableAuditing,
      enableAnomalyDetection: args.enableAnomalyDetection,
      customTags: args.customTags
    });

    return {
      content: [
        {
          type: 'text',
          text: `Monitoring started for session ${args.sessionId}`
        } as TextContent
      ]
    };
  }

  private async handleStopMonitoring(args: { sessionId: string }) {
    const monitoringSystem = this.consoleManager.getMonitoringSystem();
    await monitoringSystem.stopSessionMonitoring(args.sessionId);
    
    return {
      content: [
        {
          type: 'text',
          text: `Monitoring stopped for session ${args.sessionId}`
        } as TextContent
      ]
    };
  }

  private setupCleanup() {
    process.on('SIGINT', async () => {
      this.logger.info('Shutting down...');
      await this.consoleManager.destroy();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Shutting down...');
      await this.consoleManager.destroy();
      process.exit(0);
    });

    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception:', error);
      await this.consoleManager.destroy();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error(`Unhandled rejection: ${reason}`);
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('MCP Console Automation Server started');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new ConsoleAutomationServer();
  server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}