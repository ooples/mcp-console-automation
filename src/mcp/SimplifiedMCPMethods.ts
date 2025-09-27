import { SimpleCommandExecutor } from '../core/SimpleCommandExecutor.js';
import { SessionOptions } from '../types/index.js';
import { TextContent, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Simplified MCP method implementations that bypass complex session management
 * These can be dropped into the existing MCP server as alternatives
 */
export class SimplifiedMCPMethods {
  private executor: SimpleCommandExecutor;

  constructor() {
    this.executor = new SimpleCommandExecutor();
  }

  /**
   * Alternative 1: Direct command execution without sessions
   * Replaces the complex console_execute_command with a simple approach
   */
  async handleExecuteCommandDirect(args: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    consoleType?: string;
    sshOptions?: any;
  }) {
    try {
      // Validate required parameters
      if (!args.command) {
        throw new McpError(ErrorCode.InvalidParams, 'command parameter is required');
      }

      // Create session options
      const options: SessionOptions = {
        command: args.command,
        args: args.args || [],
        cwd: args.cwd,
        env: args.env,
        timeout: args.timeout || 120000,
        consoleType: args.consoleType as any,
        sshOptions: args.sshOptions,
      };

      // Execute using smart method selection
      const result = await this.executor.executeSmartCommand(
        args.command,
        args.args || [],
        options
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              command: args.command,
              args: args.args,
              method: result.method,
              output: result.output,
              exitCode: result.exitCode,
              success: result.exitCode === 0,
              executedAt: new Date().toISOString(),
              duration: 'N/A', // Could be tracked if needed
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, `Command execution failed: ${error.message}`);
    }
  }

  /**
   * Alternative 2: Fast synchronous execution for quick commands
   * Best for simple commands like 'dir', 'ls', 'pwd', etc.
   */
  async handleExecuteCommandSync(args: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }) {
    try {
      if (!args.command) {
        throw new McpError(ErrorCode.InvalidParams, 'command parameter is required');
      }

      const result = await this.executor.executeSyncCommand(
        args.command,
        args.args || [],
        {
          cwd: args.cwd,
          env: args.env,
          timeout: args.timeout || 30000, // Shorter timeout for sync
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              command: args.command,
              args: args.args,
              method: 'synchronous',
              output: result.output,
              exitCode: result.exitCode,
              success: result.exitCode === 0,
              executedAt: new Date().toISOString(),
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, `Sync command execution failed: ${error.message}`);
    }
  }

  /**
   * Alternative 3: Streaming execution with real-time output
   * Best for long-running commands where you want to see output as it happens
   */
  async handleExecuteCommandStreaming(args: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }) {
    try {
      if (!args.command) {
        throw new McpError(ErrorCode.InvalidParams, 'command parameter is required');
      }

      let streamingOutput = '';
      const outputChunks: Array<{ data: string; isError: boolean; timestamp: string }> = [];

      const result = await this.executor.executeStreamingCommand(
        args.command,
        args.args || [],
        {
          cwd: args.cwd,
          env: args.env,
          timeout: args.timeout || 300000, // Longer timeout for streaming
          onOutput: (data: string, isError: boolean) => {
            streamingOutput += data;
            outputChunks.push({
              data,
              isError,
              timestamp: new Date().toISOString()
            });
          }
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              command: args.command,
              args: args.args,
              method: 'streaming',
              output: result.output,
              exitCode: result.exitCode,
              success: result.exitCode === 0,
              executedAt: new Date().toISOString(),
              streamingChunks: outputChunks.length,
              realTimeOutput: outputChunks.slice(0, 10), // First 10 chunks as example
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, `Streaming command execution failed: ${error.message}`);
    }
  }

  /**
   * Alternative 4: SSH-specific execution
   * Handles SSH commands without the complex session management
   */
  async handleExecuteSSHCommand(args: {
    command: string;
    args?: string[];
    timeout?: number;
    sshOptions: {
      host: string;
      port?: number;
      username: string;
      password?: string;
      privateKeyPath?: string;
      passphrase?: string;
    };
  }) {
    try {
      if (!args.command) {
        throw new McpError(ErrorCode.InvalidParams, 'command parameter is required');
      }

      if (!args.sshOptions) {
        throw new McpError(ErrorCode.InvalidParams, 'sshOptions parameter is required for SSH execution');
      }

      // Check for Windows SSH password limitation
      if (process.platform === 'win32' && args.sshOptions.password && !args.sshOptions.privateKeyPath) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'SSH password authentication is not supported on Windows. Please use SSH key-based authentication instead.'
        );
      }

      const result = await this.executor.executeSSHCommand(
        args.command,
        args.sshOptions,
        {
          timeout: args.timeout || 120000,
          args: args.args,
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              command: args.command,
              args: args.args,
              method: 'ssh',
              host: args.sshOptions.host,
              username: args.sshOptions.username,
              output: result.output,
              exitCode: result.exitCode,
              success: result.exitCode === 0,
              executedAt: new Date().toISOString(),
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, `SSH command execution failed: ${error.message}`);
    }
  }

  /**
   * Alternative 5: One-shot session creation and execution
   * Creates a temporary session, executes command, and immediately cleans up
   * This mimics the original behavior but with simpler implementation
   */
  async handleExecuteCommandOneShot(args: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    consoleType?: string;
    sshOptions?: any;
  }) {
    const sessionId = `oneshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      if (!args.command) {
        throw new McpError(ErrorCode.InvalidParams, 'command parameter is required');
      }

      const startTime = Date.now();

      // Choose execution method based on console type and options
      let result: { output: string; exitCode: number; method?: string };

      if (args.sshOptions) {
        result = await this.executor.executeSSHCommand(args.command, args.sshOptions, {
          timeout: args.timeout,
          args: args.args,
        });
        result.method = 'ssh';
      } else {
        // Use smart execution for local commands
        const smartResult = await this.executor.executeSmartCommand(
          args.command,
          args.args || [],
          {
            command: args.command,
            args: args.args || [],
            cwd: args.cwd,
            env: args.env,
            timeout: args.timeout,
            consoleType: args.consoleType as any,
          }
        );
        result = smartResult;
      }

      const duration = Date.now() - startTime;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sessionId, // Fake session ID for compatibility
              command: args.command,
              args: args.args,
              method: result.method || 'oneshot',
              output: result.output,
              exitCode: result.exitCode,
              success: result.exitCode === 0,
              duration,
              executedAt: new Date().toISOString(),
              sessionType: 'one-shot',
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, `One-shot execution failed: ${error.message}`);
    }
  }
}