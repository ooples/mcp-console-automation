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
import { SessionManager } from '../core/SessionManager.js';
import { SessionOptions, ConsoleSession, BackgroundJobOptions } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { SSHBridge } from './SSHBridge.js';

export class ConsoleAutomationServer {
  private server: Server;
  private consoleManager: ConsoleManager;
  private sessionManager: SessionManager;
  private sshBridge: SSHBridge;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('MCPServer');
    this.consoleManager = new ConsoleManager();
    this.sessionManager = new SessionManager();
    this.sshBridge = new SSHBridge();

    this.logger.info('Production-ready SSH handler initialized');
    
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

          case 'console_cleanup_sessions':
            return await this.handleCleanupSessions(args as any);

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

          // Background job execution tools
          case 'console_execute_async':
            return await this.handleExecuteAsync(args as any);

          case 'console_get_job_status':
            return await this.handleGetJobStatus(args as any);

          case 'console_get_job_output':
            return await this.handleGetJobOutput(args as any);

          case 'console_cancel_job':
            return await this.handleCancelJob(args as any);

          case 'console_list_jobs':
            return await this.handleListJobs(args as any);

          case 'console_get_job_progress':
            return await this.handleGetJobProgress(args as any);

          case 'console_get_job_result':
            return await this.handleGetJobResult(args as any);

          case 'console_get_job_metrics':
            return await this.handleGetJobMetrics();

          case 'console_cleanup_jobs':
            return await this.handleCleanupJobs(args as any);

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
        description: 'Get output from a console session with server-side filtering, pagination, and search capabilities',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' },
            limit: { type: 'number', description: 'Maximum number of output lines to return' },
            grep: { type: 'string', description: 'Regex pattern for server-side filtering' },
            grepIgnoreCase: { type: 'boolean', description: 'Case-insensitive grep matching' },
            grepInvert: { type: 'boolean', description: 'Invert grep matching (exclude matches)' },
            tail: { type: 'number', description: 'Return last N lines' },
            head: { type: 'number', description: 'Return first N lines' },
            lineRange: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
              description: '[start, end] line numbers (1-indexed)'
            },
            since: { type: 'string', description: 'Filter by timestamp - ISO string or relative (5m, 1h, 2d)' },
            until: { type: 'string', description: 'Filter until timestamp - ISO string or relative' },
            multiPattern: {
              type: 'object',
              description: 'Multi-pattern search with complex logic',
              properties: {
                patterns: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of regex patterns'
                },
                logic: {
                  type: 'string',
                  enum: ['AND', 'OR'],
                  description: 'Logic for combining patterns'
                },
                ignoreCase: { type: 'boolean', description: 'Case-insensitive matching' }
              },
              required: ['patterns', 'logic']
            },
            maxLines: { type: 'number', description: 'Maximum lines to process (performance limit)' },
            offset: { type: 'number', description: 'Starting offset for pagination (default: 0)' },
            continuationToken: { type: 'string', description: 'Token for retrieving next page of results' },
            streamingMode: { type: 'boolean', description: 'Use streaming mode for large outputs' }
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
        name: 'console_cleanup_sessions',
        description: 'Clean up inactive or stuck sessions',
        inputSchema: {
          type: 'object',
          properties: {
            force: {
              type: 'boolean',
              description: 'Force cleanup all sessions (default: false)',
              default: false
            },
            olderThan: {
              type: 'number',
              description: 'Clean up sessions older than this many milliseconds'
            },
            inactive: {
              type: 'boolean',
              description: 'Clean up only inactive sessions (default: true)',
              default: true
            }
          }
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
      },

      // Background Job Execution Tools
      {
        name: 'console_execute_async',
        description: 'Execute a command in background (async mode)',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to execute command in' },
            command: { type: 'string', description: 'Command to execute' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
            background: { type: 'boolean', description: 'Execute in background mode (default: true)', default: true },
            timeout: { type: 'number', description: 'Execution timeout in milliseconds' },
            priority: { type: 'number', description: 'Job priority (1-10, 10 highest)', minimum: 1, maximum: 10 },
            captureOutput: { type: 'boolean', description: 'Capture command output', default: true },
            metadata: { type: 'object', description: 'Additional metadata for the job' }
          },
          required: ['sessionId', 'command']
        }
      },

      {
        name: 'console_get_job_status',
        description: 'Get the status of a background job',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: 'Job ID to check status for' }
          },
          required: ['jobId']
        }
      },

      {
        name: 'console_get_job_output',
        description: 'Get output from a background job',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: 'Job ID to get output from' },
            latest: { type: 'boolean', description: 'Get only the latest output (last 100 lines)', default: false }
          },
          required: ['jobId']
        }
      },

      {
        name: 'console_cancel_job',
        description: 'Cancel a running background job',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: 'Job ID to cancel' }
          },
          required: ['jobId']
        }
      },

      {
        name: 'console_list_jobs',
        description: 'List background jobs for a session or all sessions',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Optional session ID to filter jobs by' }
          }
        }
      },

      {
        name: 'console_get_job_progress',
        description: 'Get progress information for a background job',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: 'Job ID to get progress for' }
          },
          required: ['jobId']
        }
      },

      {
        name: 'console_get_job_result',
        description: 'Get the complete result of a background job',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: 'Job ID to get result for' }
          },
          required: ['jobId']
        }
      },

      {
        name: 'console_get_job_metrics',
        description: 'Get metrics and statistics about background job execution',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },

      {
        name: 'console_cleanup_jobs',
        description: 'Clean up completed background jobs',
        inputSchema: {
          type: 'object',
          properties: {
            olderThan: { type: 'number', description: 'Clean up jobs older than this many milliseconds' }
          }
        }
      }
    ];
  }

  private async handleCreateSession(args: SessionOptions) {
    // Debug logging to see what MCP is receiving
    this.logger.debug('MCP handleCreateSession received args:', JSON.stringify(args, null, 2));

    // Check if SSH options are present - use new SSH bridge for SSH sessions
    if (args.consoleType === 'ssh' || args.sshOptions) {
      this.logger.info('Using production SSH handler for SSH session');
      const sessionId = await this.sshBridge.createSession(args);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sessionId,
              message: `SSH session created`,
              consoleType: 'ssh',
              streaming: false
            }, null, 2)
          } as TextContent
        ]
      };
    }

    // Use ConsoleManager for non-SSH sessions
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
    this.logger.info(`handleSendInput called for session: ${args.sessionId}, input length: ${args.input.length}`);

    // Check if this is an SSH session
    const sshInfo = this.sshBridge.getSessionInfo(args.sessionId);

    if (sshInfo) {
      this.logger.info(`Session ${args.sessionId} is SSH - routing through SSH bridge`);
      await this.sshBridge.sendInput(args.sessionId, args.input);
    } else {
      this.logger.info(`Session ${args.sessionId} is not SSH - using ConsoleManager`);
      await this.consoleManager.sendInput(args.sessionId, args.input);
    }

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
    this.logger.info(`handleSendKey called for session: ${args.sessionId}, key: ${args.key}`);

    // Check if this is an SSH session
    const sshInfo = this.sshBridge.getSessionInfo(args.sessionId);

    if (sshInfo) {
      this.logger.info(`Session ${args.sessionId} is SSH - routing through SSH bridge for key: ${args.key}`);
      await this.sshBridge.sendKey(args.sessionId, args.key);
    } else {
      this.logger.info(`Session ${args.sessionId} is not SSH - using ConsoleManager for key: ${args.key}`);
      await this.consoleManager.sendKey(args.sessionId, args.key);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Key '${args.key}' sent to session ${args.sessionId}`
        } as TextContent
      ]
    };
  }

  private async handleGetOutput(args: any) {
    const { sessionId, limit, offset, continuationToken, ...filterOptions } = args;

    // Check if this is an SSH session
    const sshInfo = this.sshBridge.getSessionInfo(sessionId);
    if (sshInfo) {
      const output = this.sshBridge.getOutput(sessionId, limit);
      return {
        content: [
          {
            type: 'text',
            text: output
          } as TextContent
        ]
      };
    }

    // Check if any filtering options are provided
    const hasFilterOptions = Object.keys(filterOptions).length > 0;

    if (hasFilterOptions) {
      // Use the new filtered output method
      const filterResult = await this.consoleManager.getOutputFiltered(sessionId, {
        ...filterOptions,
        ...(limit && { maxLines: limit }) // Convert legacy limit to maxLines
      });

      const text = filterResult.output.map(o => o.data).join('');

      return {
        content: [
          {
            type: 'text',
            text: text || 'No output matches filter criteria'
          } as TextContent
        ],
        meta: {
          filtering: {
            applied: true,
            totalLines: filterResult.metadata.totalLines,
            filteredLines: filterResult.metadata.filteredLines,
            processingTimeMs: filterResult.metadata.processingTimeMs,
            memoryUsageBytes: filterResult.metadata.memoryUsageBytes,
            truncated: filterResult.metadata.truncated,
            filterStats: filterResult.metadata.filterStats
          },
          timestamp: new Date().toISOString()
        }
      };
    } else {
      // Check for pagination parameters
      const hasPaginationParams = offset !== undefined || continuationToken !== undefined;

      if (hasPaginationParams) {
        // Use new pagination system
        const paginatedResult = this.consoleManager.getPaginatedOutputCompat(
          sessionId,
          offset,
          limit,
          continuationToken
        );

        return {
          content: [
            {
              type: 'text',
              text: paginatedResult.output || 'No output available'
            } as TextContent
          ],
          meta: {
            pagination: {
              hasMore: paginatedResult.hasMore,
              nextToken: paginatedResult.nextToken,
              totalLines: paginatedResult.totalLines,
              currentOffset: paginatedResult.currentOffset,
              pageSize: paginatedResult.pageSize,
              returnedLines: paginatedResult.data.length
            },
            outputLength: paginatedResult.output.length,
            chunkCount: paginatedResult.data.length,
            timestamp: paginatedResult.timestamp
          }
        };
      } else {
        // Use legacy method for backward compatibility
        // Force immediate flush of any pending buffers before getting output
        const streamManager = this.consoleManager.getStream(sessionId);
        if (streamManager) {
          streamManager.forceFlush();
          // Wait a small amount to allow any async processing
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        const output = this.consoleManager.getOutput(sessionId, limit);
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
    }
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
      // Check if this is an SSH session
      const sshInfo = this.sshBridge.getSessionInfo(args.sessionId);

      if (sshInfo) {
        // For SSH sessions, get the current output and check for pattern
        const output = this.sshBridge.getOutput(args.sessionId);
        const regex = new RegExp(args.pattern);

        if (regex.test(output)) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  output: output,
                  matched: true,
                  pattern: args.pattern
                }, null, 2)
              } as TextContent
            ]
          };
        } else {
          // Pattern not found in current output
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  output: output,
                  matched: false,
                  pattern: args.pattern,
                  message: 'Pattern not found in output'
                }, null, 2)
              } as TextContent
            ]
          };
        }
      }

      // Use ConsoleManager for non-SSH sessions
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
    // Check if this is an SSH session
    const sshInfo = this.sshBridge.getSessionInfo(args.sessionId);
    if (sshInfo) {
      await this.sshBridge.stopSession(args.sessionId);
    } else {
      await this.consoleManager.stopSession(args.sessionId);
    }

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
    // Get sessions from both ConsoleManager and SSH Bridge
    const consoleSessions = this.consoleManager.getAllSessions();
    const sshSessions = this.sshBridge.listSessions();

    // Combine sessions
    const allSessions = [...consoleSessions, ...sshSessions];

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(allSessions.map(s => ({
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

  private async handleCleanupSessions(args: { force?: boolean; olderThan?: number; inactive?: boolean }) {
    const sessions = this.consoleManager.getAllSessions();
    let cleanedCount = 0;
    const errors: string[] = [];
    const cleaned: string[] = [];

    for (const session of sessions) {
      try {
        let shouldClean = false;

        // Force cleanup all sessions
        if (args.force) {
          shouldClean = true;
        }
        // Cleanup old sessions
        else if (args.olderThan) {
          const age = Date.now() - new Date(session.createdAt).getTime();
          if (age > args.olderThan) {
            shouldClean = true;
          }
        }
        // Cleanup inactive sessions (default behavior)
        else if (args.inactive !== false) {
          if (session.status !== 'running') {
            shouldClean = true;
          }
        }

        if (shouldClean) {
          try {
            await this.consoleManager.stopSession(session.id);
            cleaned.push(session.id);
            cleanedCount++;
          } catch (error: any) {
            errors.push(`Failed to clean session ${session.id}: ${error.message}`);
          }
        }
      } catch (error: any) {
        errors.push(`Error processing session ${session.id}: ${error.message}`);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Cleaned up ${cleanedCount} sessions`,
            totalSessions: sessions.length,
            cleanedSessions: cleaned,
            remainingSessions: sessions.length - cleanedCount,
            errors: errors.length > 0 ? errors : undefined,
            timestamp: new Date().toISOString()
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleExecuteCommand(args: { sessionId?: string; command: string; args?: string[]; cwd?: string; env?: Record<string, string>; timeout?: number; consoleType?: any; sshOptions?: any }) {
    // If sessionId is provided, execute command in existing session
    if (args.sessionId) {
      try {
        // Check if this is an SSH session
        const sshInfo = this.sshBridge.getSessionInfo(args.sessionId);
        if (sshInfo) {
          // Execute command in SSH session
          await this.sshBridge.executeCommand(args.sessionId, args.command, args.args);

          // Get output after a short delay to allow command to execute
          await new Promise(resolve => setTimeout(resolve, 100));
          const output = this.sshBridge.getOutput(args.sessionId);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  sessionId: args.sessionId,
                  command: args.command,
                  args: args.args,
                  output: output,
                  status: 'completed',
                  executedAt: new Date().toISOString()
                }, null, 2)
              } as TextContent
            ]
          };
        }

        // Use ConsoleManager for non-SSH sessions
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
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sessionId: args.sessionId,
                command: args.command,
                error: error.message,
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
    
    const result = await this.consoleManager.executeCommand(
      args.command,
      args.args,
      {
        cwd: args.cwd,
        env: args.env,
        timeout: args.timeout,
        consoleType: detectedConsoleType,
        sshOptions: finalSSHOptions
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
        return 'sh';
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
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Either sessionId or text must be provided' }, null, 2)
          } as TextContent
        ]
      };
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
    // Check if this is an SSH session
    const sshInfo = this.sshBridge.getSessionInfo(args.sessionId);

    if (sshInfo) {
      // Return SSH session state
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sessionId: args.sessionId,
              executionState: 'idle',
              activeCommands: 0,
              commandHistory: [],
              status: sshInfo.status || 'running',
              type: 'ssh'
            }, null, 2)
          } as TextContent
        ]
      };
    }

    // Use ConsoleManager for non-SSH sessions
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
    this.logger.info(`handleUseProfile called with profile: ${args.profileName}`);

    // Check if this is an SSH profile
    const connectionProfiles = this.consoleManager.listConnectionProfiles();
    const profile = connectionProfiles?.find((p: any) => p.name === args.profileName);

    if (profile && profile.type === 'ssh') {
      this.logger.info(`Profile ${args.profileName} is SSH type - routing through SSH bridge`);

      // Use SSH bridge for SSH profiles
      const sessionOptions = {
        command: args.command || '',
        args: args.args,
        cwd: args.cwd,
        env: args.env,
        profileName: args.profileName,
        consoleType: 'ssh' as const,
        sshOptions: profile.sshOptions
      };

      const sessionId = await this.sshBridge.createSession(sessionOptions);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sessionId,
              profileUsed: args.profileName,
              message: `Session created using profile: ${args.profileName}`,
              consoleType: 'ssh'
            }, null, 2)
          } as TextContent
        ]
      };
    } else {
      this.logger.info(`Profile ${args.profileName} is not SSH - using ConsoleManager`);

      // Use regular console manager for non-SSH profiles
      const sessionOptions: SessionOptions = {
        command: args.command || '',
        args: args.args,
        cwd: args.cwd,
        env: args.env,
        profileName: args.profileName
      } as any;

      const sessionId = await this.consoleManager.createSession(sessionOptions);
      const session = this.consoleManager.getSession(sessionId);

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
    }
  }

  // Background Job Handler Methods

  private async handleExecuteAsync(args: {
    sessionId: string;
    command: string;
    args?: string[];
    background?: boolean;
    timeout?: number;
    priority?: number;
    captureOutput?: boolean;
    metadata?: any;
  }) {
    try {
      const result = await this.sessionManager.executeBackgroundJob({
        sessionId: args.sessionId,
        command: args.command,
        args: args.args,
        timeout: args.timeout,
        priority: args.priority
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              jobId: result,
              message: `Background job started: ${args.command}`,
              sessionId: args.sessionId
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              command: args.command,
              sessionId: args.sessionId
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private async handleGetJobStatus(args: { jobId: string }) {
    try {
      const job = this.sessionManager.getJobStatus(args.jobId);

      const response = {
        jobId: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        exitCode: job.exitCode,
        error: job.error,
        command: job.command,
        args: job.args,
        sessionId: job.sessionId,
        progress: job.progress,
        duration: job.startedAt && job.completedAt
          ? job.completedAt.getTime() - job.startedAt.getTime()
          : undefined,
        outputLines: job.output.length
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              jobId: args.jobId
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private async handleGetJobOutput(args: { jobId: string; latest?: boolean }) {
    try {
      const output = await this.sessionManager.getJobOutput(args.jobId, args.latest);

      const response = {
        jobId: args.jobId,
        output: output.map(o => ({
          type: o.type,
          data: o.data,
          timestamp: o.timestamp,
          sequence: o.sequence
        })),
        totalLines: output.length,
        latest: args.latest || false
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              jobId: args.jobId
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private async handleCancelJob(args: { jobId: string }) {
    try {
      await this.sessionManager.cancelJob(args.jobId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Job cancelled: ${args.jobId}`,
              jobId: args.jobId
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              jobId: args.jobId
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private async handleListJobs(args: { sessionId?: string }) {
    try {
      const jobs = await this.sessionManager.listJobs(args.sessionId);

      const jobSummaries = jobs.map(job => ({
        jobId: job.id,
        sessionId: job.sessionId,
        command: job.command,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        exitCode: job.exitCode,
        priority: job.priority,
        duration: job.startedAt && job.completedAt
          ? job.completedAt.getTime() - job.startedAt.getTime()
          : undefined,
        outputLines: job.output.length,
        hasError: !!job.error
      }));

      const response = {
        jobs: jobSummaries,
        totalJobs: jobSummaries.length,
        sessionId: args.sessionId || 'all sessions',
        timestamp: new Date().toISOString()
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              sessionId: args.sessionId
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private async handleGetJobProgress(args: { jobId: string }) {
    try {
      const progress = await this.sessionManager.getJobProgress(args.jobId);

      const response = {
        jobId: args.jobId,
        progress: progress || { message: 'No progress information available' },
        timestamp: new Date().toISOString()
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              jobId: args.jobId
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private async handleGetJobResult(args: { jobId: string }) {
    try {
      const result = await this.sessionManager.getJobResult(args.jobId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              jobId: args.jobId
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private async handleGetJobMetrics() {
    try {
      const metrics = this.sessionManager.getMetrics();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              metrics,
              timestamp: new Date().toISOString()
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private async handleCleanupJobs(args: { olderThan?: number }) {
    try {
      const cutoffDate = args.olderThan ? new Date(Date.now() - args.olderThan) : undefined;
      const cleanedCount = await this.sessionManager.cleanupCompletedJobs(cutoffDate);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Cleaned up ${cleanedCount} completed jobs`,
              cleanedCount,
              timestamp: new Date().toISOString()
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          } as TextContent
        ]
      };
    }
  }

  private setupCleanup() {
    process.on('SIGINT', async () => {
      this.logger.info('Shutting down...');
      await this.sshBridge.destroy();
      await this.consoleManager.destroy();
      this.sessionManager.destroy();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Shutting down...');
      await this.sshBridge.destroy();
      await this.consoleManager.destroy();
      this.sessionManager.destroy();
      process.exit(0);
    });

    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception:', error);
      await this.sshBridge.destroy();
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