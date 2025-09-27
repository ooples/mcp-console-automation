import { SimpleCommandExecutor } from '../core/SimpleCommandExecutor.js';
import { TextContent, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Drop-in replacement for the broken handleExecuteCommand method
 * This can be directly substituted into the existing MCP server
 */
export function createFixedHandleExecuteCommand() {
  const executor = new SimpleCommandExecutor();

  return async function handleExecuteCommand(args: {
    sessionId?: string;
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

      // If sessionId is provided, we ignore it and treat as one-shot
      // (This maintains API compatibility while simplifying implementation)

      const startTime = Date.now();

      // Execute the command using the smart executor
      const result = await executor.executeSmartCommand(
        args.command,
        args.args || [],
        {
          command: args.command,
          args: args.args || [],
          cwd: args.cwd,
          env: args.env,
          timeout: args.timeout || 120000,
          consoleType: args.consoleType as any,
          sshOptions: args.sshOptions,
        }
      );

      const duration = Date.now() - startTime;

      // Return in the format expected by MCP
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              // Include sessionId if it was provided for compatibility
              ...(args.sessionId && { sessionId: args.sessionId }),
              command: args.command,
              args: args.args,
              output: result.output,
              outputText: result.output, // Alternative field name for compatibility
              exitCode: result.exitCode,
              success: result.exitCode === 0,
              method: result.method,
              duration,
              executedAt: new Date().toISOString(),
              status: result.exitCode === 0 ? 'completed' : 'failed',
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      // Handle different types of errors appropriately
      if (error instanceof McpError) {
        throw error;
      }

      // SSH-specific error handling
      if (error.message?.includes('ssh') || error.message?.includes('SSH')) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `SSH execution failed: ${error.message}`
        );
      }

      // Timeout errors
      if (error.message?.includes('timeout')) {
        throw new McpError(
          ErrorCode.InternalError,
          `Command timeout: ${error.message}`
        );
      }

      // Generic error
      throw new McpError(
        ErrorCode.InternalError,
        `Command execution failed: ${error.message}`
      );
    }
  };
}

/**
 * Alternative simplified handler that's even more basic
 * For cases where you just want the simplest possible implementation
 */
export function createBasicHandleExecuteCommand() {
  const executor = new SimpleCommandExecutor();

  return async function handleExecuteCommandBasic(args: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }) {
    if (!args.command) {
      throw new McpError(ErrorCode.InvalidParams, 'command parameter is required');
    }

    try {
      const result = await executor.executeAsyncCommand(
        args.command,
        args.args || [],
        {
          cwd: args.cwd,
          env: args.env,
          timeout: args.timeout || 120000,
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              command: args.command,
              output: result.output,
              exitCode: result.exitCode,
              success: result.exitCode === 0,
            }, null, 2)
          } as TextContent
        ]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  };
}

/**
 * Instructions for integrating the fix:
 *
 * In your existing ConsoleAutomationServer class, replace the handleExecuteCommand method:
 *
 * 1. Import this module:
 *    import { createFixedHandleExecuteCommand } from './ExecuteCommandFix.js';
 *
 * 2. In your constructor, create the fixed handler:
 *    private handleExecuteCommandFixed = createFixedHandleExecuteCommand();
 *
 * 3. In your CallToolRequestSchema handler, replace:
 *    case 'console_execute_command':
 *      return await this.handleExecuteCommand(args as any);
 *
 *    With:
 *    case 'console_execute_command':
 *      return await this.handleExecuteCommandFixed(args as any);
 *
 * That's it! The complex session management and event system is bypassed entirely.
 */