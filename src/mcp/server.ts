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
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';

// Debug logging to file
const DEBUG_LOG_FILE = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\mcp-debug.log';
function debugLog(...args: any[]) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`;
  fs.appendFileSync(DEBUG_LOG_FILE, message, 'utf8');
}

// Error classification for intelligent recovery
interface ErrorClassification {
  severity: 'critical' | 'recoverable' | 'warning';
  category: 'ssh' | 'network' | 'resource' | 'protocol' | 'unknown';
  canRecover: boolean;
  suggestedAction: string;
}

export class ConsoleAutomationServer {
  private server: Server;
  private consoleManager: ConsoleManager;
  private logger: Logger;
  private keepAliveInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private connectionState: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 100;
  private reconnectDelay = 1000;
  private transport?: StdioServerTransport;
  private isShuttingDown = false;
  private sessionRecoveryMap = new Map<string, any>();
  private errorCount = 0;
  private lastErrorTime = 0;

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
    this.setupPersistence();
    this.setupErrorIsolation();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        // CRITICAL DEBUG: Log ALL tool calls
        debugLog(`[CRITICAL] Tool called: ${name}`);
        debugLog(`[CRITICAL] Tool args:`, args);

        // Special debug for use_profile
        if (name === 'console_use_profile') {
          debugLog('[CRITICAL] *** console_use_profile RECEIVED ***');
          // Try direct file write to ensure message is saved
          fs.appendFileSync(
            'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\urgent.log',
            `[${new Date().toISOString()}] console_use_profile called with: ${JSON.stringify(args)}\n`,
            'utf8'
          );
        }

        // Enable MCP server mode to prevent stdio corruption
        process.env.MCP_SERVER_MODE = 'true';

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
          
          case 'console_get_session_state':
            return await this.handleGetSessionState(args as any);
          
          case 'console_get_command_history':
            return await this.handleGetCommandHistory(args as any);
          
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
          
          // Profile management tools
          case 'console_save_profile':
            return await this.handleSaveProfile(args as any);
          
          case 'console_list_profiles':
            return await this.handleListProfiles();
          
          case 'console_remove_profile':
            return await this.handleRemoveProfile(args as any);
          
          case 'console_use_profile':
            return await this.handleUseProfile(args as any);
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error: any) {
        // CRITICAL: Never log errors in MCP mode - only return properly formatted MCP errors
        // Logging would corrupt the stdio transport channel

        // Classify error types for proper MCP error codes
        if (error instanceof McpError) {
          // Re-throw MCP errors as-is
          throw error;
        }

        if (error.code === 'ENOENT' || error.code === 'EACCES') {
          throw new McpError(ErrorCode.InvalidParams, `File system error: ${error.message}`);
        }

        if (error.name === 'ValidationError' || error.name === 'TypeError') {
          throw new McpError(ErrorCode.InvalidParams, `Validation error: ${error.message}`);
        }

        if (error.code === 'TIMEOUT' || error.message.includes('timeout')) {
          throw new McpError(ErrorCode.InternalError, `Operation timeout: ${error.message}`);
        }

        // Default to internal error for unclassified errors
        throw new McpError(
          ErrorCode.InternalError,
          process.env.NODE_ENV === 'development'
            ? `Internal error: ${error.message}`
            : 'An internal error occurred'
        );
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
        description: 'Execute a command in an existing session or create a new one-off session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Optional: Session ID to execute command in' },
            command: { type: 'string', description: 'Command to execute' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments (for new sessions)' },
            cwd: { type: 'string', description: 'Working directory (for new sessions)' },
            env: { type: 'object', description: 'Environment variables (for new sessions)' },
            timeout: { type: 'number', description: 'Execution timeout in milliseconds' },
            consoleType: { 
              type: 'string', 
              enum: ['cmd', 'powershell', 'pwsh', 'bash', 'zsh', 'sh', 'ssh', 'auto'],
              description: 'Type of console to use (for new sessions)' 
            },
            sshOptions: {
              type: 'object',
              description: 'SSH connection options (for SSH sessions)',
              properties: {
                host: { type: 'string', description: 'SSH host' },
                port: { type: 'number', description: 'SSH port (default: 22)' },
                username: { type: 'string', description: 'SSH username' },
                password: { type: 'string', description: 'SSH password' },
                privateKey: { type: 'string', description: 'Private key content' },
                privateKeyPath: { type: 'string', description: 'Path to private key file' },
                passphrase: { type: 'string', description: 'Private key passphrase' }
              }
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
        name: 'console_get_session_state',
        description: 'Get the execution state of a console session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'console_get_command_history',
        description: 'Get the command execution history for a session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            limit: { type: 'number', description: 'Maximum number of commands to return' }
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
      },
      {
        name: 'console_save_profile',
        description: 'Save a connection or application profile for reuse',
        inputSchema: {
          type: 'object',
          properties: {
            profileType: { 
              type: 'string', 
              enum: ['connection', 'application'],
              description: 'Type of profile to save' 
            },
            name: { type: 'string', description: 'Profile name' },
            connectionType: { 
              type: 'string', 
              enum: ['ssh', 'docker', 'wsl', 'azure', 'aws', 'gcp', 'kubernetes'],
              description: 'Connection type (for connection profiles)' 
            },
            applicationType: {
              type: 'string',
              enum: ['node', 'python', 'dotnet', 'java', 'go', 'rust', 'custom'],
              description: 'Application type (for application profiles)'
            },
            sshOptions: {
              type: 'object',
              description: 'SSH connection options',
              properties: {
                host: { type: 'string' },
                port: { type: 'number' },
                username: { type: 'string' },
                password: { type: 'string' },
                privateKey: { type: 'string' },
                privateKeyPath: { type: 'string' },
                passphrase: { type: 'string' }
              }
            },
            dockerOptions: {
              type: 'object',
              properties: {
                containerName: { type: 'string' },
                imageName: { type: 'string' }
              }
            },
            command: { type: 'string', description: 'Command for application profile' },
            args: { type: 'array', items: { type: 'string' }, description: 'Arguments for application profile' },
            workingDirectory: { type: 'string', description: 'Working directory for application profile' },
            environmentVariables: { type: 'object', description: 'Environment variables' },
            dotnetOptions: {
              type: 'object',
              description: '.NET specific options',
              properties: {
                enabled: { type: 'boolean' },
                sdkPath: { type: 'string' },
                defaultFramework: { 
                  type: 'string',
                  enum: ['net6.0', 'net7.0', 'net8.0', 'net9.0', 'netcoreapp3.1']
                },
                buildConfiguration: { 
                  type: 'string',
                  enum: ['Debug', 'Release']
                },
                enableHotReload: { type: 'boolean' }
              }
            },
            isDefault: { type: 'boolean', description: 'Set as default profile' }
          },
          required: ['profileType', 'name']
        }
      },
      {
        name: 'console_list_profiles',
        description: 'List all saved connection and application profiles',
        inputSchema: {
          type: 'object',
          properties: {
            profileType: { 
              type: 'string', 
              enum: ['connection', 'application', 'all'],
              description: 'Type of profiles to list (default: all)' 
            }
          }
        }
      },
      {
        name: 'console_remove_profile',
        description: 'Remove a saved profile',
        inputSchema: {
          type: 'object',
          properties: {
            profileType: { 
              type: 'string', 
              enum: ['connection', 'application'],
              description: 'Type of profile to remove' 
            },
            name: { type: 'string', description: 'Profile name to remove' }
          },
          required: ['profileType', 'name']
        }
      },
      {
        name: 'console_use_profile',
        description: 'Create a session using a saved profile',
        inputSchema: {
          type: 'object',
          properties: {
            profileName: { type: 'string', description: 'Name of the profile to use' },
            command: { type: 'string', description: 'Override command (optional)' },
            args: { type: 'array', items: { type: 'string' }, description: 'Override arguments (optional)' },
            cwd: { type: 'string', description: 'Override working directory (optional)' },
            env: { type: 'object', description: 'Additional environment variables (optional)' }
          },
          required: ['profileName']
        }
      }
    ];
  }

  private async handleCreateSession(args: SessionOptions) {
    debugLog('[DEBUG] === handleCreateSession START ===');
    debugLog('[DEBUG] Args:', args);
    debugLog('[DEBUG] Current error count:', this.errorCount);
    debugLog('[DEBUG] Connection state:', this.connectionState);

    try {
      // Validate required parameters
      if (!args.command) {
        debugLog('[DEBUG] Missing command parameter');
        throw new McpError(ErrorCode.InvalidParams, 'command parameter is required');
      }

      debugLog('[DEBUG] Calling consoleManager.createSession...');
      const sessionId = await this.consoleManager.createSession(args);
      debugLog('[DEBUG] Session created with ID:', sessionId);
      const session = this.consoleManager.getSession(sessionId);

      // Store session options for potential recovery
      if (sessionId) {
        this.sessionRecoveryMap.set(sessionId, args);
      }

      if (!session) {
        throw new McpError(ErrorCode.InternalError, 'Failed to retrieve created session');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sessionId,
              message: `Session created for command: ${args.command}`,
              pid: session.pid,
              consoleType: session.type,
              streaming: session.streaming || false
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      debugLog('[DEBUG] === ERROR in handleCreateSession ===');
      debugLog('[DEBUG] Error message:', error.message);
      debugLog('[DEBUG] Error type:', error.constructor.name);
      debugLog('[DEBUG] Error code:', (error as any).code);
      debugLog('[DEBUG] Error stack:', error.stack);
      debugLog('[DEBUG] Full error:', error);

      // Track errors
      this.errorCount++;
      this.lastErrorTime = Date.now();
      debugLog('[DEBUG] Total error count:', this.errorCount);

      // Try to recover from the error
      const classification = this.classifyError(error);
      debugLog('[DEBUG] Error classification:', classification);

      if (classification.canRecover) {
        debugLog('[DEBUG] Attempting recovery...');
        this.handleRecoverableError(error);
      }

      if (error instanceof McpError) {
        debugLog('[DEBUG] Re-throwing McpError');
        throw error;
      }
      debugLog('[DEBUG] Throwing new McpError');
      throw new McpError(ErrorCode.InternalError, `Session creation failed: ${error.message}`);
    }
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
    // Force immediate flush of any pending buffers before getting output
    const streamManager = this.consoleManager.getStream(args.sessionId);
    if (streamManager) {
      streamManager.forceFlush();
      // Wait a small amount to allow any async processing
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    const output = this.consoleManager.getOutput(args.sessionId, args.limit);
    const text = output.map(o => o.data).join('');
    
    // Include buffer statistics for debugging
    const bufferStats = streamManager ? streamManager.getBufferStats() : null;
    
    return {
      content: [
        {
          type: 'text',
          text: text || 'No output available'
        } as TextContent
      ],
      ...(bufferStats && { 
        meta: { 
          bufferStats,
          outputLength: text.length,
          chunkCount: output.length,
          timestamp: new Date().toISOString()
        } 
      })
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
        {
          timeout: args.timeout || 5000
        }
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  private async handleStopSession(args: { sessionId: string }) {
    await this.consoleManager.stopSession(args.sessionId);
    this.sessionRecoveryMap.delete(args.sessionId);
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

  private async handleExecuteCommand(args: { sessionId?: string; command: string; args?: string[]; cwd?: string; env?: Record<string, string>; timeout?: number; consoleType?: any; sshOptions?: any }) {
    // If sessionId is provided, execute command in existing session with proper isolation
    if (args.sessionId) {
      try {
        const result = await this.consoleManager.executeCommandInSession(
          args.sessionId,
          args.command,
          args.args,
          args.timeout || 120000
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sessionId: args.sessionId,
                commandId: result.commandId,
                command: args.command,
                args: args.args,
                output: result.output.map(o => ({
                  type: o.type,
                  data: o.data,
                  timestamp: o.timestamp,
                  commandId: o.commandId,
                  isCommandBoundary: o.isCommandBoundary,
                  boundaryType: o.boundaryType
                })),
                outputText: result.output.map(o => o.data).join(''),
                exitCode: result.exitCode,
                duration: result.duration,
                status: result.status,
                executedAt: new Date().toISOString()
              }, null, 2)
            } as TextContent
          ]
        };
      } catch (error: any) {
        // Check if it's a timeout error and provide helpful guidance
        let errorMessage = error.message;
        let suggestion = '';
        
        if (error.message.includes('timeout') || error.message.includes('timed out')) {
          suggestion = '\n\nTip: This command timed out. For long-running commands, use console_create_session to create a persistent session, then use console_send_input and console_wait_for_output instead of console_execute_command. This allows better control over long-running processes.';
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sessionId: args.sessionId,
                command: args.command,
                error: errorMessage + suggestion,
                timestamp: new Date().toISOString()
              }, null, 2)
            } as TextContent
          ]
        };
      }
    }
    
    // Otherwise create new session for one-off command
    // Detect console type based on command and SSH options
    let detectedConsoleType = args.consoleType;
    let finalSSHOptions = args.sshOptions;
    
    // If SSH options are provided, force SSH console type
    if (args.sshOptions && !detectedConsoleType) {
      detectedConsoleType = 'ssh';
    }
    
    // Auto-detect console type from command patterns if not specified
    if (!detectedConsoleType || detectedConsoleType === 'auto') {
      detectedConsoleType = this.detectConsoleTypeFromCommand(args.command, args.sshOptions);
    }
    
    this.logger.debug(`Console type detection for command "${args.command}": ${detectedConsoleType}`, {
      originalType: args.consoleType,
      hasSSHOptions: !!args.sshOptions,
      detectedType: detectedConsoleType
    });
    
    let result;
    try {
      result = await this.consoleManager.executeCommand(
        args.command,
        args.args,
        {
          cwd: args.cwd,
          env: args.env,
          timeout: args.timeout || 120000,
          consoleType: detectedConsoleType,
          sshOptions: finalSSHOptions
        }
      );
    } catch (error: any) {
      // Check if it's a timeout error and provide helpful guidance
      let errorMessage = error.message;
      let suggestion = '';
      
      if (error.message.includes('timeout') || error.message.includes('timed out')) {
        suggestion = '\n\nTip: This command timed out. For long-running commands, use console_create_session to create a persistent session, then use console_send_input and console_wait_for_output instead of console_execute_command. This allows better control over long-running processes.';
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        errorMessage + suggestion
      );
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        } as TextContent
      ]
    };
  }

  /**
   * Detect console type from command patterns and options
   */
  private detectConsoleTypeFromCommand(command: string, sshOptions?: any): 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'zsh' | 'sh' | 'ssh' | 'auto' {
    // If SSH options are provided, it's definitely an SSH session
    if (sshOptions) {
      return 'ssh';
    }
    
    // Check for Unix/Linux commands that indicate bash/sh
    const unixCommands = ['ls', 'grep', 'awk', 'sed', 'cat', 'tail', 'head', 'find', 'ps', 'top', 'df', 'du', 'chmod', 'chown', 'sudo', 'which', 'whereis', 'man', 'curl', 'wget', 'tar', 'gzip', 'gunzip', 'ssh', 'scp', 'rsync', 'git'];
    const cmdTokens = command.toLowerCase().split(/\s+/);
    const firstCommand = cmdTokens[0];
    
    // Check if it's a Unix command
    if (unixCommands.includes(firstCommand)) {
      // On Windows, if we see Unix commands, we likely need bash (WSL or Git Bash)
      if (process.platform === 'win32') {
        return 'bash';
      } else {
        return 'bash'; // Default to bash on Unix systems
      }
    }
    
    // Check for Windows-specific commands
    const windowsCommands = ['dir', 'copy', 'move', 'del', 'type', 'cls', 'ipconfig', 'ping', 'tracert', 'netstat', 'tasklist', 'taskkill'];
    if (windowsCommands.includes(firstCommand)) {
      return 'cmd';
    }
    
    // Check for PowerShell patterns
    const powershellPatterns = [
      /^Get-/i, /^Set-/i, /^New-/i, /^Remove-/i, /^Add-/i, /^Invoke-/i, /^Test-/i, /^Start-/i, /^Stop-/i,
      /\$\w+/, // PowerShell variables
      /\|\s*Where-Object/i, /\|\s*Select-Object/i, /\|\s*ForEach-Object/i,
      /-\w+\s+\w+/ // PowerShell parameters like -Path, -Name, etc.
    ];
    
    if (powershellPatterns.some(pattern => pattern.test(command))) {
      return process.platform === 'win32' ? 'powershell' : 'pwsh';
    }
    
    // Check for SSH command patterns
    if (/^ssh\s+/.test(command)) {
      return 'ssh';
    }
    
    // Default based on platform
    if (process.platform === 'win32') {
      return 'cmd';
    } else {
      return 'bash';
    }
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

  private async handleGetSessionState(args: { sessionId: string }) {
    const state = this.consoleManager.getSessionExecutionState(args.sessionId);
    
    if (!state) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `Session ${args.sessionId} not found`,
              timestamp: new Date().toISOString()
            }, null, 2)
          } as TextContent
        ]
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(state, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleGetCommandHistory(args: { sessionId: string; limit?: number }) {
    const history = this.consoleManager.getSessionCommandHistory(args.sessionId);
    
    if (history.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sessionId: args.sessionId,
              commands: [],
              message: 'No command history found for this session',
              timestamp: new Date().toISOString()
            }, null, 2)
          } as TextContent
        ]
      };
    }

    const limitedHistory = args.limit ? history.slice(-args.limit) : history;
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            sessionId: args.sessionId,
            totalCommands: history.length,
            returnedCommands: limitedHistory.length,
            commands: limitedHistory.map(cmd => ({
              id: cmd.id,
              command: cmd.command,
              args: cmd.args,
              startedAt: cmd.startedAt,
              completedAt: cmd.completedAt,
              status: cmd.status,
              duration: cmd.duration,
              exitCode: cmd.exitCode,
              outputLines: cmd.totalOutputLines
            })),
            timestamp: new Date().toISOString()
          }, null, 2)
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

  private async handleSaveProfile(args: any) {
    const { profileType, name, ...profileData } = args;
    
    if (profileType === 'connection') {
      const connectionProfile: any = {
        name,
        type: args.connectionType,
        isDefault: args.isDefault || false
      };
      
      // Add connection-specific options based on type
      if (args.connectionType === 'ssh' && args.sshOptions) {
        connectionProfile.sshOptions = args.sshOptions;
      } else if (args.connectionType === 'docker' && args.dockerOptions) {
        connectionProfile.dockerOptions = args.dockerOptions;
      }
      // Add other connection types as needed
      
      this.consoleManager.saveConnectionProfile(connectionProfile);
      
      return {
        content: [
          {
            type: 'text',
            text: `Connection profile '${name}' saved successfully`
          } as TextContent
        ]
      };
    } else if (profileType === 'application') {
      const applicationProfile: any = {
        name,
        type: args.applicationType || 'custom',
        command: args.command,
        args: args.args,
        workingDirectory: args.workingDirectory,
        environmentVariables: args.environmentVariables,
        dotnetOptions: args.dotnetOptions
      };
      
      this.consoleManager.saveApplicationProfile(applicationProfile);
      
      return {
        content: [
          {
            type: 'text',
            text: `Application profile '${name}' saved successfully`
          } as TextContent
        ]
      };
    }
    
    throw new Error(`Invalid profile type: ${profileType}`);
  }
  
  private async handleListProfiles() {
    const connectionProfiles = this.consoleManager.listConnectionProfiles();
    const configManager = (this.consoleManager as any).configManager;
    const applicationProfiles = configManager.config.applicationProfiles;
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            connectionProfiles,
            applicationProfiles,
            defaultProfile: configManager.config.defaultConnectionProfile
          }, null, 2)
        } as TextContent
      ]
    };
  }
  
  private async handleRemoveProfile(args: { profileType: string; name: string }) {
    const configManager = (this.consoleManager as any).configManager;
    
    if (args.profileType === 'connection') {
      const removed = configManager.removeConnectionProfile(args.name);
      return {
        content: [
          {
            type: 'text',
            text: removed ? `Connection profile '${args.name}' removed` : `Profile '${args.name}' not found`
          } as TextContent
        ]
      };
    }
    
    // For application profiles, we'd need to add a removeApplicationProfile method
    throw new Error('Removing application profiles not yet implemented');
  }
  
  private async handleUseProfile(args: { profileName: string; command?: string; args?: string[]; cwd?: string; env?: any }) {
    try {
      console.error('[URGENT] handleUseProfile called with:', args);
      debugLog('[DEBUG] handleUseProfile called with:', args);

      // Load and validate the profile BEFORE creating the session
      const profile = this.consoleManager.getConfigManager().getConnectionProfile(args.profileName);
      debugLog('[DEBUG] Profile loaded:', profile);

      if (!profile) {
        debugLog('[DEBUG] Profile not found, throwing error');
        throw new McpError(ErrorCode.InvalidParams, `Profile not found: ${args.profileName}`);
      }

      // Check for Windows SSH password authentication early
      if (profile.type === 'ssh' && profile.sshOptions) {
        const platform = require('os').platform();
        console.error('[URGENT] Server-side Windows check - Platform detected:', platform);
        debugLog('[DEBUG] Platform detected:', platform);
        debugLog('[DEBUG] SSH options:', {
          hasPassword: !!profile.sshOptions.password,
          hasPrivateKey: !!profile.sshOptions.privateKey
        });

        if (platform === 'win32' && profile.sshOptions.password && !profile.sshOptions.privateKey) {
          console.error('[URGENT] SERVER: Windows SSH password detected - throwing immediate error');
          debugLog('[DEBUG] Windows SSH password detected - throwing immediate error');
          // Fail immediately with clear error
          throw new McpError(
            ErrorCode.InvalidParams,
            'SSH password authentication is not supported on Windows. ' +
            'Windows OpenSSH requires interactive terminal input for passwords. ' +
            'Please use SSH key-based authentication instead:\n' +
            '1. Generate an SSH key: ssh-keygen -t rsa -b 4096\n' +
            '2. Copy the public key to the server: ssh-copy-id ubuntu@github-runner-server\n' +
            '3. Update your profile to use the private key path instead of password'
          );
        }
      }

      debugLog('[DEBUG] Profile validation passed, proceeding with session creation');

      // Create session with profile
      const sessionOptions: SessionOptions = {
        command: args.command || '',
        args: args.args,
        cwd: args.cwd,
        env: args.env,
        profileName: args.profileName
      } as any;

      debugLog('[DEBUG] Creating session with options:', sessionOptions);

      const sessionId = await this.consoleManager.createSession(sessionOptions);
      const session = this.consoleManager.getSession(sessionId);

      debugLog('[DEBUG] Session created successfully:', sessionId);

      // Store for recovery if needed
      if (sessionId) {
        this.sessionRecoveryMap.set(sessionId, {
          profileName: args.profileName,
          type: 'profile'
        } as any);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sessionId,
              profileUsed: args.profileName,
              message: `Session created using profile: ${args.profileName}`,
              consoleType: session?.type
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      debugLog('[DEBUG] Error in handleUseProfile:', error);
      debugLog('[DEBUG] Error stack:', error.stack);

      // Re-throw as McpError for proper error handling
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to use profile ${args.profileName}: ${error.message}`
      );
    }
  }

  private setupCleanup() {
    process.on('SIGINT', async () => {
      this.logger.info('Shutting down...');
      await this.gracefulShutdown();
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Shutting down...');
      await this.gracefulShutdown();
    });
  }

  /**
   * Setup STDIO protection to prevent SSH and subprocess output from corrupting MCP transport
   */
  private setupStdioProtection() {
    // Save original stdout/stderr write methods
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    // Override stdout.write to filter out non-MCP content
    process.stdout.write = function(chunk: any, encoding?: any, callback?: any): boolean {
      // Convert chunk to string for inspection
      const str = chunk?.toString ? chunk.toString() : String(chunk);

      // Only allow JSON-RPC messages through stdout
      // MCP messages are JSON objects with jsonrpc field
      if (str.includes('"jsonrpc"') || str.includes('Content-Length:')) {
        // This looks like an MCP message, let it through
        return originalStdoutWrite(chunk, encoding, callback);
      }

      // Block all non-MCP stdout (like SSH output, debug messages)
      // Log to file instead
      debugLog('[STDIO-BLOCKED] Stdout:', str);

      // Call callback if provided to prevent blocking
      if (typeof encoding === 'function') {
        encoding();
      } else if (typeof callback === 'function') {
        callback();
      }

      return true; // Pretend write succeeded
    };

    // Override stderr.write to redirect all errors to file
    process.stderr.write = function(chunk: any, encoding?: any, callback?: any): boolean {
      // Convert chunk to string for logging
      const str = chunk?.toString ? chunk.toString() : String(chunk);

      // Never write errors to stderr in MCP mode - log to file instead
      debugLog('[STDERR-REDIRECTED]:', str);

      // Call callback if provided
      if (typeof encoding === 'function') {
        encoding();
      } else if (typeof callback === 'function') {
        callback();
      }

      return true; // Pretend write succeeded
    };

    debugLog('[DEBUG] STDIO protection enabled - stdout/stderr isolated from MCP transport');
  }

  private setupErrorIsolation() {
    // Remove any existing listeners to ensure we're the only handler
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');

    // STDIO ISOLATION: Protect MCP transport from corruption
    this.setupStdioProtection();

    // Catch and isolate uncaught exceptions
    process.on('uncaughtException', (error) => {
      debugLog('[DEBUG] ============================================');
      debugLog('[DEBUG] UNCAUGHT EXCEPTION CAUGHT!');
      debugLog('[DEBUG] Error message:', error.message);
      debugLog('[DEBUG] Error stack:', error.stack);
      debugLog('[DEBUG] Error code:', (error as any).code);
      debugLog('[DEBUG] Error details:', error);
      debugLog('[DEBUG] ============================================');

      const classification = this.classifyError(error);
      debugLog('[DEBUG] Error classification:', classification);

      // NEVER terminate for SSH or network errors
      if (classification.category === 'ssh' || classification.category === 'network') {
        debugLog('[DEBUG] *** SSH/Network error - Server MUST continue ***');
        this.logger.warn('SSH/Network error isolated, continuing:', error.message);
        this.handleRecoverableError(error);
        return; // Explicitly return to prevent any default behavior
      }

      if (classification.severity === 'critical') {
        // Only truly critical errors terminate the server
        debugLog('[DEBUG] *** CRITICAL ERROR - Server will shutdown ***');
        this.logger.error('Critical error detected:', error);
        // Don't use async here - it can cause issues with error handling
        this.gracefulShutdown().catch(() => {});
        setTimeout(() => process.exit(1), 2000);
      } else {
        // Recover from non-critical errors
        debugLog('[DEBUG] *** RECOVERABLE ERROR - Server will continue ***');
        this.logger.warn('Recoverable error isolated:', error);
        this.handleRecoverableError(error);
      }
    });

    process.on('unhandledRejection', (reason) => {
      debugLog('[DEBUG] ============================================');
      debugLog('[DEBUG] UNHANDLED REJECTION CAUGHT!');
      debugLog('[DEBUG] Reason:', reason);
      debugLog('[DEBUG] Stack:', (reason as any)?.stack);
      debugLog('[DEBUG] ============================================');
      this.logger.warn('Unhandled rejection isolated:', reason);
      this.handleRecoverableError(new Error(String(reason)));
      // Prevent default termination behavior
    });

    // Ensure error isolation is maintained
    process.setMaxListeners(100); // Increase max listeners to prevent warnings
  }

  private setupPersistence() {
    // Keep process alive with health checks
    this.healthCheckInterval = setInterval(() => {
      if (this.connectionState === 'connected') {
        this.performHealthCheck();
      }
    }, 30000); // Health check every 30 seconds

    // Start keepalive heartbeat
    this.startKeepAlive();
  }

  private startKeepAlive() {
    this.stopKeepAlive();

    this.keepAliveInterval = setInterval(() => {
      if (this.connectionState === 'connected') {
        try {
          // Lightweight ping to maintain connection
          // This is a no-op but keeps the connection active
        } catch (error) {
          this.logger.error('Keepalive failed:', error);
          this.handleDisconnection();
        }
      }
    }, 15000); // Send keepalive every 15 seconds
  }

  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = undefined;
    }
  }

  private async performHealthCheck() {
    try {
      const health = await this.consoleManager.getSystemHealth();

      if (health.status === 'unhealthy') {
        this.logger.warn('System unhealthy, attempting recovery');
        await this.attemptRecovery();
      }
    } catch (error) {
      this.logger.error('Health check error:', error);
    }
  }

  private async attemptRecovery() {
    try {
      // Clear stuck sessions
      const sessions = this.consoleManager.getAllSessions();
      for (const session of sessions) {
        if (session.status === 'failed' || session.status === 'crashed' || session.status === 'terminated' || session.status === 'closed') {
          try {
            await this.consoleManager.stopSession(session.id);
          } catch (e) {
            // Session already stopped
          }
        }
      }
      this.logger.info('Recovery attempt completed');
    } catch (error) {
      this.logger.error('Recovery failed:', error);
    }
  }

  private handleDisconnection() {
    if (this.isShuttingDown) {
      return;
    }

    if (this.connectionState === 'disconnected') {
      return;
    }

    this.connectionState = 'disconnected';
    this.logger.info('Connection lost, attempting to reconnect...');
    this.attemptReconnection();
  }

  private async attemptReconnection() {
    if (this.connectionState === 'reconnecting' || this.isShuttingDown) {
      return;
    }

    this.connectionState = 'reconnecting';

    while (this.reconnectAttempts < this.maxReconnectAttempts && !this.isShuttingDown) {
      this.reconnectAttempts++;

      this.logger.info(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

      try {
        await this.reconnect();

        // Success! Reset counters
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.connectionState = 'connected';

        this.logger.info('Successfully reconnected');
        this.startKeepAlive();

        return;
      } catch (error) {
        this.logger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);

        // Exponential backoff with max delay of 30 seconds
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);

        await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
      }
    }

    this.logger.error('Failed to reconnect after maximum attempts');
    // Don't exit - wait for manual intervention
  }

  private async reconnect() {
    // Create new transport
    this.transport = new StdioServerTransport();

    // Reconnect the server
    await this.server.connect(this.transport);
  }

  private async gracefulShutdown() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Initiating graceful shutdown...');

    try {
      this.stopKeepAlive();

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      await this.consoleManager.destroy();
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
    }

    process.exit(0);
  }

  private classifyError(error: any): ErrorClassification {
    // SSH authentication errors
    if (error.message?.includes('All configured authentication methods failed') ||
        error.message?.includes('Authentication failed') ||
        error.message?.includes('Permission denied') ||
        error.message?.includes('Host key verification failed') ||
        error.message?.includes('ssh') ||
        error.message?.includes('SSH')) {
      return {
        severity: 'recoverable',
        category: 'ssh',
        canRecover: true,
        suggestedAction: 'Check SSH credentials and try again'
      };
    }

    // File/spawn errors (like SSH executable not found)
    if (error.code === 'ENOENT' ||
        error.syscall === 'spawn' ||
        error.message?.includes('spawn') ||
        error.message?.includes('ENOENT') ||
        error.path?.includes('ssh') ||
        error.spawnargs?.some((arg: string) => arg?.includes('ssh'))) {
      return {
        severity: 'recoverable',
        category: 'ssh',
        canRecover: true,
        suggestedAction: 'SSH client not found, trying alternative'
      };
    }

    // SSH connection timeout
    if (error.message?.includes('connection timeout') ||
        error.message?.includes('SSH connection timeout') ||
        error.message?.includes('Operation timed out')) {
      return {
        severity: 'recoverable',
        category: 'ssh',
        canRecover: true,
        suggestedAction: 'SSH connection timeout, will retry'
      };
    }

    // Network errors
    if (error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'EHOSTUNREACH' ||
        error.code === 'ENETUNREACH' ||
        error.code === 'ECONNRESET' ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('Connection refused') ||
        error.message?.includes('No route to host')) {
      return {
        severity: 'recoverable',
        category: 'network',
        canRecover: true,
        suggestedAction: 'Network issue detected, will retry'
      };
    }

    // Resource exhaustion (critical)
    if (error.message?.includes('out of memory') ||
        error.message?.includes('EMFILE') ||
        error.message?.includes('ENOMEM')) {
      return {
        severity: 'critical',
        category: 'resource',
        canRecover: false,
        suggestedAction: 'Resource exhaustion, restart required'
      };
    }

    // Protocol errors
    if (error instanceof McpError) {
      return {
        severity: 'recoverable',
        category: 'protocol',
        canRecover: true,
        suggestedAction: 'MCP protocol error, operation can be retried'
      };
    }

    // Unknown errors default to recoverable
    return {
      severity: 'recoverable',
      category: 'unknown',
      canRecover: true,
      suggestedAction: 'Unknown error, attempting to continue'
    };
  }

  private handleRecoverableError(error: Error) {
    this.errorCount++;
    const now = Date.now();

    // Track error rate
    if (now - this.lastErrorTime < 1000) {
      // Multiple errors within 1 second
      if (this.errorCount > 10) {
        this.logger.error('Error rate too high, initiating recovery');
        this.attemptRecovery();
        this.errorCount = 0;
      }
    } else {
      // Reset counter if errors are spread out
      this.errorCount = 1;
    }

    this.lastErrorTime = now;
  }

  private async attemptSessionRecovery(sessionId: string) {
    try {
      const recoveryInfo = this.sessionRecoveryMap.get(sessionId);
      if (recoveryInfo) {
        // Try to recreate the session with stored options
        const newSessionId = await this.consoleManager.createSession(recoveryInfo);
        this.logger.info(`Session ${sessionId} recovered as ${newSessionId}`);
        return newSessionId;
      }
    } catch (error) {
      this.logger.error(`Failed to recover session ${sessionId}:`, error);
    }
    return null;
  }

  async start() {
    debugLog('[DEBUG] === SERVER START ===');
    debugLog('[DEBUG] Process argv:', process.argv);
    debugLog('[DEBUG] Process env MCP_SERVER_MODE:', process.env.MCP_SERVER_MODE);

    try {
      // Enable MCP server mode before any operations
      process.env.MCP_SERVER_MODE = 'true';
      debugLog('[DEBUG] Set MCP_SERVER_MODE to true');

      debugLog('[DEBUG] Creating StdioServerTransport...');
      this.transport = new StdioServerTransport();
      debugLog('[DEBUG] Connecting server to transport...');
      await this.server.connect(this.transport);
      debugLog('[DEBUG] Server connected successfully');

      this.connectionState = 'connected';
      debugLog('[DEBUG] Connection state set to:', this.connectionState);
      this.logger.info('MCP server started successfully with persistence enabled');
      this.logger.info('Connection monitoring and auto-reconnection active');
      this.logger.info('Keepalive heartbeat active (15s interval)');
      debugLog('[DEBUG] Server initialization complete');

    } catch (error: any) {
      this.logger.error('Failed to start server:', error);

      // Try to recover from startup errors
      await this.attemptRecovery();

      // If still failing, schedule reconnection
      if (this.connectionState !== 'connected') {
        this.handleDisconnection();
      }
    }
  }
}

// Fix Windows path comparison
const currentFilePath = path.normalize(fileURLToPath(import.meta.url));
const executedFilePath = process.argv[1] ? path.normalize(process.argv[1]) : '';

debugLog('[DEBUG] === MODULE EXECUTION CHECK ===');
debugLog('[DEBUG] Current file path:', currentFilePath);
debugLog('[DEBUG] Executed file path:', executedFilePath);

// Check if we're being run directly OR imported from index.js
const isMainModule = currentFilePath === executedFilePath;
const isFromIndex = executedFilePath.endsWith('index.js');

debugLog('[DEBUG] Is main module:', isMainModule);
debugLog('[DEBUG] Is from index.js:', isFromIndex);

if (isMainModule || isFromIndex) {
  debugLog('[DEBUG] Starting server...');
  // Enable MCP mode immediately when started
  process.env.MCP_SERVER_MODE = 'true';

  const server = new ConsoleAutomationServer();
  server.start().catch((error) => {
    debugLog('[DEBUG] Server start failed:', error);
    // CRITICAL: Never use console.error in MCP mode
    // Silent exit to avoid stdio corruption
    setTimeout(() => process.exit(1), 2000);
  });
} else {
  debugLog('[DEBUG] Not starting - imported as module');
}