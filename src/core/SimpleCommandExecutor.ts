import { spawn, execSync, exec, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { Logger } from '../utils/logger.js';
import { SessionOptions, SSHConnectionOptions } from '../types/index.js';

const execAsync = promisify(exec);

/**
 * Simple command executor that bypasses the complex session/event system
 * Provides direct command execution with minimal overhead
 */
export class SimpleCommandExecutor {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('SimpleCommandExecutor');
  }

  /**
   * Alternative 1: Direct synchronous execution using execSync
   * Best for: Simple commands that complete quickly
   * Limitations: No streaming output, blocks until completion
   */
  async executeSyncCommand(command: string, args: string[] = [], options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    encoding?: BufferEncoding;
  } = {}): Promise<{ output: string; exitCode: number }> {
    try {
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

      const output = execSync(fullCommand, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        timeout: options.timeout || 120000,
        encoding: options.encoding || 'utf8',
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      return {
        output: output.toString(),
        exitCode: 0
      };
    } catch (error: any) {
      // execSync throws on non-zero exit codes
      return {
        output: error.stdout ? error.stdout.toString() + error.stderr?.toString() : error.message,
        exitCode: error.status || 1
      };
    }
  }

  /**
   * Alternative 2: Promise-based async execution
   * Best for: Commands that may take longer but don't need streaming
   * Benefits: Non-blocking, timeout support, better error handling
   */
  async executeAsyncCommand(command: string, args: string[] = [], options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    maxBuffer?: number;
  } = {}): Promise<{ output: string; exitCode: number }> {
    try {
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

      const { stdout, stderr } = await execAsync(fullCommand, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        timeout: options.timeout || 120000,
        maxBuffer: options.maxBuffer || 1024 * 1024 * 10,
      });

      return {
        output: stdout + stderr,
        exitCode: 0
      };
    } catch (error: any) {
      return {
        output: (error.stdout || '') + (error.stderr || '') || error.message,
        exitCode: error.code || 1
      };
    }
  }

  /**
   * Alternative 3: Streaming execution with spawn
   * Best for: Long-running commands that produce output over time
   * Benefits: Real-time output, process control, streaming
   */
  async executeStreamingCommand(command: string, args: string[] = [], options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    onOutput?: (data: string, isError: boolean) => void;
  } = {}): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let output = '';
      let timeoutHandle: NodeJS.Timeout | null = null;

      const child = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Set up timeout
      if (options.timeout) {
        timeoutHandle = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timeout after ${options.timeout}ms`));
        }, options.timeout);
      }

      // Collect output
      child.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        options.onOutput?.(text, false);
      });

      child.stderr?.on('data', (data) => {
        const text = data.toString();
        output += text;
        options.onOutput?.(text, true);
      });

      child.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(error);
      });

      child.on('close', (exitCode) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({
          output,
          exitCode: exitCode || 0
        });
      });
    });
  }

  /**
   * Alternative 4: SSH execution using native SSH client
   * Best for: Simple SSH commands without persistent sessions
   * Benefits: No session management, direct execution
   */
  async executeSSHCommand(command: string, sshOptions: SSHConnectionOptions, options: {
    timeout?: number;
    args?: string[];
  } = {}): Promise<{ output: string; exitCode: number }> {
    // Build SSH command
    const sshArgs: string[] = [
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=60',
      '-o', 'ServerAliveCountMax=3',
    ];

    // Add port if specified
    if (sshOptions.port && sshOptions.port !== 22) {
      sshArgs.push('-p', sshOptions.port.toString());
    }

    // Add key authentication
    if (sshOptions.privateKeyPath) {
      sshArgs.push('-i', sshOptions.privateKeyPath);
    }

    // Add strict host key checking control
    sshArgs.push('-o', 'StrictHostKeyChecking=no');

    // Build connection string
    const connectionString = `${sshOptions.username}@${sshOptions.host}`;
    sshArgs.push(connectionString);

    // Add the command to execute
    const fullCommand = options.args && options.args.length > 0
      ? `${command} ${options.args.join(' ')}`
      : command;
    sshArgs.push(fullCommand);

    // Execute using spawn for better control
    return this.executeStreamingCommand('ssh', sshArgs, {
      timeout: options.timeout || 120000,
    });
  }

  /**
   * Alternative 5: Smart command executor that chooses the best method
   * Automatically selects the most appropriate execution method based on context
   */
  async executeSmartCommand(command: string, args: string[] = [], options: Partial<SessionOptions> = {}): Promise<{
    output: string;
    exitCode: number;
    method: string;
  }> {
    // SSH commands
    if (options.sshOptions) {
      try {
        const result = await this.executeSSHCommand(command, options.sshOptions, {
          timeout: options.timeout,
          args,
        });
        return { ...result, method: 'ssh' };
      } catch (error: any) {
        // Fallback to error result
        return {
          output: `SSH execution failed: ${error.message}`,
          exitCode: 1,
          method: 'ssh-failed'
        };
      }
    }

    // Long-running or interactive commands
    const interactiveCommands = ['docker', 'kubectl', 'npm', 'node', 'python', 'pip'];
    const isInteractive = interactiveCommands.some(cmd => command.toLowerCase().includes(cmd));

    if (isInteractive || (options.timeout && options.timeout > 30000)) {
      const result = await this.executeStreamingCommand(command, args, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
      });
      return { ...result, method: 'streaming' };
    }

    // Quick commands
    if (!options.timeout || options.timeout <= 30000) {
      const result = await this.executeAsyncCommand(command, args, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
      });
      return { ...result, method: 'async' };
    }

    // Default fallback
    const result = await this.executeAsyncCommand(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
    });
    return { ...result, method: 'async-fallback' };
  }
}