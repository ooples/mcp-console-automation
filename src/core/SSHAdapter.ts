import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { platform } from 'os';
import { RetryManager } from './RetryManager.js';
import { ErrorRecovery, ErrorContext } from './ErrorRecovery.js';
import { Logger } from '../utils/logger.js';

export interface SSHOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  strictHostKeyChecking?: boolean;
  knownHostsFile?: string;
  timeout?: number;
}

export class SSHAdapter extends EventEmitter {
  private process: ChildProcess | null = null;
  private outputBuffer: string = '';
  private isConnected: boolean = false;
  private connectionOptions: SSHOptions | null = null;
  private retryManager: RetryManager;
  private errorRecovery: ErrorRecovery;
  private logger: Logger;
  private sessionId: string;

  constructor(sessionId?: string) {
    super();
    this.sessionId = sessionId || `ssh-${Date.now()}`;
    this.retryManager = new RetryManager();
    this.errorRecovery = new ErrorRecovery();
    this.logger = new Logger(`SSHAdapter-${this.sessionId}`);
    
    this.setupErrorRecoveryHandlers();
  }

  private setupErrorRecoveryHandlers(): void {
    this.errorRecovery.on('recovery-attempted', (data) => {
      this.logger.info(`SSH error recovery attempted: ${data.strategy}`);
      this.emit('recovery-attempted', data);
    });

    this.errorRecovery.on('degradation-enabled', (data) => {
      this.logger.warn(`SSH degraded mode enabled: ${data.reason}`);
      this.emit('degradation-enabled', data);
    });

    this.errorRecovery.on('require-reauth', (data) => {
      this.logger.warn('SSH re-authentication required');
      this.emit('require-reauth', data);
    });
  }

  /**
   * Create SSH connection using available SSH client with retry logic
   * Works with OpenSSH on Windows (comes with Windows 10+), Git Bash, or WSL
   */
  async connect(options: SSHOptions): Promise<void> {
    this.connectionOptions = options;
    
    return await this.retryManager.executeWithRetry(
      async () => {
        return await this.attemptConnection(options);
      },
      {
        sessionId: this.sessionId,
        operationName: 'ssh_connect',
        strategyName: 'ssh',
        context: { host: options.host, port: options.port, username: options.username },
        onRetry: (context) => {
          this.logger.info(`Retrying SSH connection to ${options.host} (attempt ${context.attemptNumber})`);
          this.cleanup();
        }
      }
    );
  }

  private async attemptConnection(options: SSHOptions): Promise<void> {
    const args = this.buildSSHArgs(options);
    
    // Try different SSH executables based on platform
    const sshCommands = this.getSSHCommands();
    
    let lastError: Error | null = null;
    
    for (const sshCmd of sshCommands) {
      try {
        this.process = spawn(sshCmd, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: {
            ...process.env,
            // Disable host key checking if requested
            ...(options.strictHostKeyChecking === false && {
              'OPENSSH_ASKPASS': 'echo',
              'DISPLAY': ':0'
            })
          }
        });

        if (this.process.pid) {
          this.setupHandlers();
          
          try {
            await this.waitForConnection(options.timeout || 10000);
            this.isConnected = true;
            this.logger.info(`SSH connection established to ${options.host} using ${sshCmd}`);
            return;
          } catch (connectionError) {
            lastError = connectionError as Error;
            
            // Try to recover from connection error
            await this.handleConnectionError(lastError, options);
            
            // If recovery didn't work, try next SSH command
            continue;
          }
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.debug(`Failed to spawn SSH with ${sshCmd}: ${error}`);
        // Try next SSH command
        continue;
      }
    }

    // If we get here, all SSH commands failed
    const finalError = lastError || new Error('No SSH client found. Please install OpenSSH or Git Bash.');
    
    // Try final error recovery
    await this.handleConnectionError(finalError, options);
    
    throw finalError;
  }

  private async handleConnectionError(error: Error, options: SSHOptions): Promise<void> {
    try {
      const errorContext: ErrorContext = {
        sessionId: this.sessionId,
        operation: 'ssh_connect',
        error,
        timestamp: Date.now(),
        metadata: { host: options.host, port: options.port, username: options.username }
      };

      const recoveryResult = await this.errorRecovery.attemptRecovery(errorContext);
      
      if (recoveryResult.recovered) {
        this.logger.info('SSH connection error recovered');
        this.emit('error-recovered', { error: error.message });
      } else {
        this.emit('error-recovery-failed', { 
          error: error.message, 
          guidance: recoveryResult.userGuidance 
        });
      }
    } catch (recoveryError) {
      this.logger.error(`SSH error recovery failed: ${recoveryError}`);
    }
  }

  private cleanup(): void {
    if (this.process && !this.process.killed) {
      try {
        this.process.kill('SIGTERM');
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
        }, 2000);
      } catch (error) {
        this.logger.debug(`Failed to cleanup SSH process: ${error}`);
      }
    }
    
    this.process = null;
    this.isConnected = false;
    this.outputBuffer = '';
  }

  private getSSHCommands(): string[] {
    const osType = platform();
    
    if (osType === 'win32') {
      return [
        'ssh.exe',           // Windows OpenSSH (built-in since Windows 10)
        'C:\\Windows\\System32\\OpenSSH\\ssh.exe', // Explicit path
        'C:\\Program Files\\Git\\usr\\bin\\ssh.exe', // Git Bash
        'wsl.exe ssh',       // WSL if available
      ];
    } else {
      return [
        'ssh',               // Standard Unix/Linux/Mac
        '/usr/bin/ssh',
        '/usr/local/bin/ssh'
      ];
    }
  }

  private buildSSHArgs(options: SSHOptions): string[] {
    const args: string[] = [];

    // Basic connection
    if (options.port && options.port !== 22) {
      args.push('-p', options.port.toString());
    }

    // Authentication
    if (options.privateKey) {
      args.push('-i', options.privateKey);
    }

    // Security options
    if (options.strictHostKeyChecking === false) {
      args.push('-o', 'StrictHostKeyChecking=no');
      args.push('-o', 'UserKnownHostsFile=/dev/null');
    }

    // Batch mode for non-interactive if using key auth
    if (options.privateKey) {
      args.push('-o', 'BatchMode=yes');
    }

    // Connection timeout
    if (options.timeout) {
      args.push('-o', `ConnectTimeout=${Math.floor(options.timeout / 1000)}`);
    }

    // Force pseudo-terminal allocation
    args.push('-tt');

    // User@host
    args.push(`${options.username}@${options.host}`);

    return args;
  }

  private setupHandlers(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.outputBuffer += text;
      this.emit('data', text);
      
      // Check for password prompt
      if (text.toLowerCase().includes('password:')) {
        this.emit('password-prompt');
      }
      
      // Check for successful connection (common shell prompts)
      if (text.match(/[$#>]\s*$/) || text.includes('@')) {
        this.emit('connected');
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.emit('error', text);
      
      // Check for common SSH errors
      if (text.includes('Permission denied')) {
        this.emit('auth-failed');
      } else if (text.includes('Connection refused')) {
        this.emit('connection-refused');
      } else if (text.includes('No route to host')) {
        this.emit('host-unreachable');
      }
    });

    this.process.on('close', (code) => {
      this.isConnected = false;
      this.emit('close', code);
    });

    this.process.on('error', (error) => {
      this.emit('error', error.message);
    });
  }

  private waitForConnection(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('SSH connection timeout'));
      }, timeout);

      const onConnected = () => {
        clearTimeout(timer);
        this.removeListener('connected', onConnected);
        this.removeListener('password-prompt', onPasswordPrompt);
        this.removeListener('error', onError);
        resolve();
      };

      const onPasswordPrompt = () => {
        // For password auth, we'll need to handle this
        this.emit('needs-password');
        clearTimeout(timer);
        this.removeListener('connected', onConnected);
        this.removeListener('password-prompt', onPasswordPrompt);
        this.removeListener('error', onError);
        resolve(); // Still resolve, let caller handle password
      };

      const onError = (error: string) => {
        clearTimeout(timer);
        this.removeListener('connected', onConnected);
        this.removeListener('password-prompt', onPasswordPrompt);
        this.removeListener('error', onError);
        reject(new Error(error));
      };

      this.once('connected', onConnected);
      this.once('password-prompt', onPasswordPrompt);
      this.once('error', onError);
    });
  }

  async sendCommand(command: string): Promise<void> {
    return await this.retryManager.executeWithRetry(
      async () => {
        if (!this.process || !this.process.stdin) {
          throw new Error('SSH not connected');
        }
        
        return new Promise<void>((resolve, reject) => {
          this.process!.stdin!.write(command + '\n', (error) => {
            if (error) {
              reject(error);
            } else {
              this.logger.debug(`Sent SSH command: ${command.substring(0, 50)}...`);
              resolve();
            }
          });
        });
      },
      {
        sessionId: this.sessionId,
        operationName: 'ssh_send_command',
        strategyName: 'ssh',
        context: { commandLength: command.length },
        onRetry: (context) => {
          this.logger.debug(`Retrying SSH command send (attempt ${context.attemptNumber})`);
        }
      }
    );
  }

  async sendPassword(password: string): Promise<void> {
    return await this.retryManager.executeWithRetry(
      async () => {
        if (!this.process || !this.process.stdin) {
          throw new Error('SSH not connected');
        }
        
        return new Promise<void>((resolve, reject) => {
          // Send password without echoing
          this.process!.stdin!.write(password + '\n', (error) => {
            if (error) {
              reject(error);
            } else {
              this.logger.debug('Sent SSH password');
              resolve();
            }
          });
        });
      },
      {
        sessionId: this.sessionId,
        operationName: 'ssh_send_password',
        strategyName: 'authentication',
        context: { hasPassword: password.length > 0 },
        onRetry: (context) => {
          this.logger.debug(`Retrying SSH password send (attempt ${context.attemptNumber})`);
        }
      }
    );
  }

  getOutput(): string {
    return this.outputBuffer;
  }

  clearOutput(): void {
    this.outputBuffer = '';
  }

  disconnect(): void {
    this.logger.info('Disconnecting SSH session');
    this.cleanup();
  }

  /**
   * Reconnect using the last known connection options
   */
  async reconnect(): Promise<void> {
    if (!this.connectionOptions) {
      throw new Error('No connection options available for reconnect');
    }

    this.logger.info(`Reconnecting SSH session to ${this.connectionOptions.host}`);
    
    // Clean up existing connection
    this.cleanup();
    
    // Attempt to reconnect
    await this.connect(this.connectionOptions);
  }

  /**
   * Check connection health and reconnect if necessary
   */
  async ensureConnected(): Promise<boolean> {
    if (this.isActive()) {
      return true;
    }

    if (!this.connectionOptions) {
      this.logger.error('Cannot reconnect - no connection options available');
      return false;
    }

    try {
      await this.reconnect();
      return true;
    } catch (error) {
      this.logger.error(`Failed to reconnect SSH: ${error}`);
      return false;
    }
  }

  isActive(): boolean {
    return this.isConnected && this.process !== null && !this.process.killed;
  }

  /**
   * Get retry and recovery statistics
   */
  getRetryStats() {
    return this.retryManager.getRetryStats();
  }

  /**
   * Get error recovery statistics
   */
  getRecoveryStats() {
    return this.errorRecovery.getRecoveryStats();
  }

  /**
   * Check if session is in degraded mode
   */
  isDegraded(): boolean {
    return this.errorRecovery.isDegraded(this.sessionId);
  }

  /**
   * Get session error history
   */
  getErrorHistory() {
    return this.errorRecovery.getErrorHistory(this.sessionId);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.logger.info('Destroying SSH adapter');
    
    this.cleanup();
    this.retryManager.destroy();
    this.errorRecovery.destroy();
    this.removeAllListeners();
    
    this.connectionOptions = null;
  }
}

// Helper function to create SSH session with retry and recovery
export function createSSHSession(options: SSHOptions, sessionId?: string): SSHAdapter {
  const adapter = new SSHAdapter(sessionId);
  return adapter;
}

// Enhanced helper function that automatically connects
export async function createAndConnectSSHSession(options: SSHOptions, sessionId?: string): Promise<SSHAdapter> {
  const adapter = new SSHAdapter(sessionId);
  await adapter.connect(options);
  return adapter;
}