import { execSync, exec, spawn } from 'child_process';
import { promisify } from 'util';
import {
  TextContent,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';

const execAsync = promisify(exec);

/**
 * DIRECT REPLACEMENT METHOD
 * This is the absolute simplest working replacement for handleExecuteCommand
 * Copy this method directly into your MCP server class
 */
export async function handleExecuteCommandDirect(args: {
  sessionId?: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  consoleType?: string;
  sshOptions?: any;
}) {
  if (!args.command) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'command parameter is required'
    );
  }

  try {
    // Build the full command
    const fullCommand =
      args.args && args.args.length > 0
        ? `${args.command} ${args.args.join(' ')}`
        : args.command;

    let result: { output: string; exitCode: number };

    // Handle SSH commands
    if (args.sshOptions) {
      // Check for Windows SSH password limitation
      if (
        process.platform === 'win32' &&
        args.sshOptions.password &&
        !args.sshOptions.privateKeyPath
      ) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'SSH password authentication is not supported on Windows. Use SSH keys instead.'
        );
      }

      // Build SSH command
      const sshArgs = [
        '-o',
        'ConnectTimeout=10',
        '-o',
        'StrictHostKeyChecking=no',
      ];

      if (args.sshOptions.port && args.sshOptions.port !== 22) {
        sshArgs.push('-p', args.sshOptions.port.toString());
      }

      if (args.sshOptions.privateKeyPath) {
        sshArgs.push('-i', args.sshOptions.privateKeyPath);
      }

      sshArgs.push(`${args.sshOptions.username}@${args.sshOptions.host}`);
      sshArgs.push(fullCommand);

      // Execute SSH command
      try {
        const { stdout, stderr } = await execAsync(`ssh ${sshArgs.join(' ')}`, {
          timeout: args.timeout || 120000,
          maxBuffer: 1024 * 1024 * 10, // 10MB
        });
        result = { output: stdout + stderr, exitCode: 0 };
      } catch (error: any) {
        result = {
          output: (error.stdout || '') + (error.stderr || '') || error.message,
          exitCode: error.code || 1,
        };
      }
    } else {
      // Handle local commands
      try {
        const { stdout, stderr } = await execAsync(fullCommand, {
          cwd: args.cwd || process.cwd(),
          env: { ...process.env, ...args.env },
          timeout: args.timeout || 120000,
          maxBuffer: 1024 * 1024 * 10, // 10MB
        });
        result = { output: stdout + stderr, exitCode: 0 };
      } catch (error: any) {
        result = {
          output: (error.stdout || '') + (error.stderr || '') || error.message,
          exitCode: error.code || 1,
        };
      }
    }

    // Return MCP-compatible response
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ...(args.sessionId && { sessionId: args.sessionId }),
              command: args.command,
              args: args.args,
              output: result.output,
              outputText: result.output,
              exitCode: result.exitCode,
              success: result.exitCode === 0,
              executedAt: new Date().toISOString(),
              status: result.exitCode === 0 ? 'completed' : 'failed',
            },
            null,
            2
          ),
        } as TextContent,
      ],
    };
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Command execution failed: ${error.message}`
    );
  }
}

/**
 * EVEN SIMPLER VERSION using execSync
 * For commands that complete quickly (< 30 seconds)
 */
export async function handleExecuteCommandSync(args: {
  sessionId?: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}) {
  if (!args.command) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'command parameter is required'
    );
  }

  try {
    const fullCommand =
      args.args && args.args.length > 0
        ? `${args.command} ${args.args.join(' ')}`
        : args.command;

    let result: { output: string; exitCode: number };

    try {
      const output = execSync(fullCommand, {
        cwd: args.cwd || process.cwd(),
        env: { ...process.env, ...args.env },
        timeout: args.timeout || 30000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
      });
      result = { output: output.toString(), exitCode: 0 };
    } catch (error: any) {
      result = {
        output: error.stdout
          ? error.stdout.toString() + (error.stderr?.toString() || '')
          : error.message,
        exitCode: error.status || 1,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ...(args.sessionId && { sessionId: args.sessionId }),
              command: args.command,
              args: args.args,
              output: result.output,
              outputText: result.output,
              exitCode: result.exitCode,
              success: result.exitCode === 0,
              executedAt: new Date().toISOString(),
              method: 'synchronous',
            },
            null,
            2
          ),
        } as TextContent,
      ],
    };
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Sync command execution failed: ${error.message}`
    );
  }
}

/**
 * STREAMING VERSION using spawn
 * For long-running commands where you want real-time output
 */
export async function handleExecuteCommandStreaming(args: {
  sessionId?: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}) {
  if (!args.command) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'command parameter is required'
    );
  }

  return new Promise((resolve, reject) => {
    let output = '';
    const chunks: Array<{ data: string; timestamp: string; isError: boolean }> =
      [];

    const child = spawn(args.command, args.args || [], {
      cwd: args.cwd || process.cwd(),
      env: { ...process.env, ...args.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Set up timeout
    let timeoutHandle: NodeJS.Timeout | null = null;
    if (args.timeout) {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new McpError(
            ErrorCode.InternalError,
            `Command timeout after ${args.timeout}ms`
          )
        );
      }, args.timeout);
    }

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      chunks.push({
        data: text,
        timestamp: new Date().toISOString(),
        isError: false,
      });
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      output += text;
      chunks.push({
        data: text,
        timestamp: new Date().toISOString(),
        isError: true,
      });
    });

    child.on('error', (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(
        new McpError(ErrorCode.InternalError, `Process error: ${error.message}`)
      );
    });

    child.on('close', (exitCode) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      resolve({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...(args.sessionId && { sessionId: args.sessionId }),
                command: args.command,
                args: args.args,
                output,
                outputText: output,
                exitCode: exitCode || 0,
                success: (exitCode || 0) === 0,
                executedAt: new Date().toISOString(),
                method: 'streaming',
                chunks: chunks.length,
                streamingData: chunks.slice(0, 5), // Show first 5 chunks as example
              },
              null,
              2
            ),
          } as TextContent,
        ],
      });
    });
  });
}

/*
 * HOW TO USE THESE REPLACEMENTS:
 *
 * Option 1: Direct replacement in server.ts
 * Replace your existing handleExecuteCommand method with handleExecuteCommandDirect
 *
 * Option 2: Import and use
 * In your server.ts, add:
 * import { handleExecuteCommandDirect } from './DirectReplacementMethod.js';
 *
 * Then in your switch statement:
 * case 'console_execute_command':
 *   return await handleExecuteCommandDirect(args as any);
 *
 * Option 3: Choose the right method for your use case:
 * - handleExecuteCommandDirect: General purpose, handles SSH and local commands
 * - handleExecuteCommandSync: Fast synchronous execution for quick commands
 * - handleExecuteCommandStreaming: Real-time output for long-running commands
 */
