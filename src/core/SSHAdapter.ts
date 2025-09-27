import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { platform } from 'os';
import { Client as SSHClient, ClientChannel, utils as ssh2Utils } from 'ssh2';
import { readFileSync } from 'fs';
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
  private sshClient: SSHClient | null = null;
  private sshChannel: ClientChannel | null = null;
  private outputBuffer: string = '';
  private isConnected: boolean = false;
  private connectionOptions: SSHOptions | null = null;
  private retryManager: RetryManager;
  private errorRecovery: ErrorRecovery;
  private logger: Logger;
  private sessionId: string;
  private healthMonitor: NodeJS.Timeout | null = null;
  private lastActivity: number = Date.now();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private useNativeSSH: boolean = false;

  constructor(sessionId?: string) {
    super();
    this.sessionId = sessionId || `ssh-${Date.now()}`;
    this.retryManager = new RetryManager();
    this.errorRecovery = new ErrorRecovery();
    this.logger = new Logger(`SSHAdapter-${this.sessionId}`);

    // CRITICAL: Add robust default error handler to prevent process crashes
    // This handler is ALWAYS present and cannot be removed by external code
    this.on('error', (error) => {
      this.logger.error(`SSH adapter error (session ${this.sessionId}):`, error);

      // Always ensure we don't crash the process, even if this is the only listener
      // This is a safety net that should never be removed
    });

    // Pre-register safe default handlers for recovery events to prevent crashes
    this.on('error-recovered', (data) => {
      this.logger.info(`SSH error recovery succeeded for session ${this.sessionId}:`, data);
    });

    this.on('error-recovery-failed', (data) => {
      this.logger.warn(`SSH error recovery failed for session ${this.sessionId}:`, data);
    });

    this.on('connection-failed', (data) => {
      this.logger.error(`SSH connection failed for session ${this.sessionId}:`, data);
    });

    this.on('connection-restored', (data) => {
      this.logger.info(`SSH connection restored for session ${this.sessionId}:`, data);
    });

    this.setupErrorRecoveryHandlers();
    this.startHealthMonitoring();
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

    // Listen for error recovery signals
    this.errorRecovery.on('retry-connection', (data) => {
      if (data.sessionId === this.sessionId) {
        this.handleRetryConnection(data.method);
      }
    });

    this.errorRecovery.on('recreate-connection', (data) => {
      if (data.sessionId === this.sessionId) {
        this.handleRecreateConnection(data.method);
      }
    });
  }

  /**
   * Start health monitoring for the SSH connection
   */
  private startHealthMonitoring(): void {
    // Check connection health every 30 seconds
    this.healthMonitor = setInterval(() => {
      this.checkConnectionHealth();
    }, 30000);

    this.logger.debug('SSH health monitoring started');
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
      this.healthMonitor = null;
      this.logger.debug('SSH health monitoring stopped');
    }
  }

  /**
   * Check the health of the SSH connection
   */
  private async checkConnectionHealth(): Promise<void> {
    if (!this.isConnected || !this.process) {
      return;
    }

    const timeSinceActivity = Date.now() - this.lastActivity;
    const maxIdleTime = 5 * 60 * 1000; // 5 minutes

    // Check if connection has been idle too long
    if (timeSinceActivity > maxIdleTime) {
      this.logger.info('SSH connection idle for too long, sending keepalive');
      try {
        // Send a simple command to test connection
        await this.sendKeepAlive();
      } catch (error) {
        this.logger.warn(`SSH keepalive failed: ${error}`);
        this.handleConnectionLoss();
      }
    }

    // Check if process is still alive
    if (this.process.killed || this.process.exitCode !== null) {
      this.logger.warn('SSH process has died, attempting reconnection');
      this.handleConnectionLoss();
    }
  }

  /**
   * Send a keepalive command to test connection
   */
  private async sendKeepAlive(): Promise<void> {
    if (this.process && this.process.stdin && this.isConnected) {
      // Send a simple echo command that should not affect anything
      this.process.stdin.write('echo "keepalive" > /dev/null\n');
      this.lastActivity = Date.now();
    }
  }

  /**
   * Handle connection loss and attempt auto-reconnection
   */
  private async handleConnectionLoss(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached, giving up');
      this.emit('connection-failed', { reason: 'Max reconnection attempts exceeded' });
      return;
    }

    this.reconnectAttempts++;
    this.logger.info(`Attempting auto-reconnection (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    try {
      await this.reconnect();
      this.reconnectAttempts = 0; // Reset on successful reconnection
      this.emit('connection-restored', { attempts: this.reconnectAttempts });
    } catch (error) {
      this.logger.error(`Auto-reconnection failed: ${error}`);

      // Wait before next attempt
      setTimeout(() => {
        this.handleConnectionLoss();
      }, 5000 * this.reconnectAttempts); // Exponential backoff
    }
  }

  /**
   * Handle retry connection request from error recovery
   */
  private async handleRetryConnection(method: string): Promise<void> {
    this.logger.info(`Handling retry connection with method: ${method}`);
    try {
      await this.reconnect();
    } catch (error) {
      this.logger.error(`Retry connection failed: ${error}`);
    }
  }

  /**
   * Handle recreate connection request from error recovery
   */
  private async handleRecreateConnection(method: string): Promise<void> {
    this.logger.info(`Handling recreate connection with method: ${method}`);

    // Clean up existing connection
    this.cleanup();

    // Wait a moment before recreating
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      if (this.connectionOptions) {
        await this.connect(this.connectionOptions);
      }
    } catch (error) {
      this.logger.error(`Recreate connection failed: ${error}`);
    }
  }

  /**
   * Create SSH connection using ssh2 library for password auth or native SSH for key auth
   */
  async connect(options: SSHOptions): Promise<void> {
    this.connectionOptions = options;

    // Use ssh2 library for password authentication (works on all platforms)
    // Use native SSH executable for key-based authentication
    this.useNativeSSH = !options.password && !!options.privateKey;

    return await this.retryManager.executeWithRetry(
      async () => {
        if (this.useNativeSSH) {
          // Use native SSH for key-based auth
          return await this.attemptNativeConnection(options);
        } else {
          // Use ssh2 library for password auth
          return await this.attemptSSH2Connection(options);
        }
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

  private async attemptSSH2Connection(options: SSHOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.sshClient = new SSHClient();

      const connectConfig: any = {
        host: options.host,
        port: options.port || 22,
        username: options.username,
        readyTimeout: options.timeout || 10000
      };

      // Add authentication
      if (options.password) {
        connectConfig.password = options.password;
      } else if (options.privateKey) {
        try {
          const keyData = readFileSync(options.privateKey, 'utf8');

          // Try to parse the key to handle different formats (OpenSSH, PEM, etc.)
          try {
            const parsedKey = ssh2Utils.parseKey(keyData);
            if (parsedKey instanceof Error) {
              throw parsedKey;
            }

            // ssh2 parseKey returns a ParsedKey object
            // We need to get the private key in a format ssh2 can use
            if (Array.isArray(parsedKey)) {
              // Multiple keys found, use the first one
              connectConfig.privateKey = parsedKey[0].getPrivatePEM();
            } else {
              connectConfig.privateKey = parsedKey.getPrivatePEM();
            }

            this.logger.debug('[SSH] Successfully parsed private key');
          } catch (parseError) {
            // If parsing fails, try using the raw key data
            // (might work for some formats)
            this.logger.warn(`[SSH] Key parsing failed, using raw key data: ${parseError}`);
            connectConfig.privateKey = keyData;
          }
        } catch (error) {
          reject(new Error(`Failed to read private key: ${error}`));
          return;
        }
      }

      // Disable strict host key checking if requested
      if (options.strictHostKeyChecking === false) {
        connectConfig.hostVerifier = () => true;
      }

      this.logger.debug(`[SSH2] Connecting to ${options.host}:${connectConfig.port} as ${options.username}`);

      // Set up timeout
      const connectionTimeout = setTimeout(() => {
        this.sshClient?.destroy();
        reject(new Error('SSH connection timeout'));
      }, connectConfig.readyTimeout);

      this.sshClient.once('ready', () => {
        clearTimeout(connectionTimeout);
        this.logger.info(`[SSH2] Connection established to ${options.host}`);

        // Create shell channel
        this.sshClient!.shell({ term: 'xterm-256color' }, (err, channel) => {
          if (err) {
            this.sshClient?.destroy();
            reject(err);
            return;
          }

          this.sshChannel = channel;
          this.setupSSH2Handlers(channel);
          this.isConnected = true;
          this.emit('connected');
          resolve();
        });
      });

      this.sshClient.once('error', (error) => {
        clearTimeout(connectionTimeout);
        this.logger.error(`[SSH2] Connection error: ${error.message}`);
        this.emit('error', error.message);
        reject(error);
      });

      this.sshClient.once('close', () => {
        this.isConnected = false;
        this.emit('close');
      });

      // Connect
      this.sshClient.connect(connectConfig);
    });
  }

  private setupSSH2Handlers(channel: ClientChannel): void {
    // Handle stdout
    channel.on('data', (data: Buffer) => {
      const text = data.toString();
      this.outputBuffer += text;
      this.lastActivity = Date.now();
      this.emit('data', text);
    });

    // Handle stderr
    channel.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      this.emit('error', text);
    });

    // Handle close
    channel.on('close', (code?: number) => {
      this.isConnected = false;
      this.emit('close', code);
    });
  }

  private async attemptNativeConnection(options: SSHOptions): Promise<void> {
    const args = this.buildSSHArgs(options);

    // Try different SSH executables based on platform
    const sshCommands = this.getSSHCommands();

    let lastError: Error | null = null;

    for (const sshCmd of sshCommands) {
      try {
        // CRITICAL: Pre-setup spawn options with error handling
        const spawnOptions: SpawnOptions = {
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
        };

        // Enhanced debug logging
        const fullCommand = `${sshCmd} ${args.join(' ')} ${options.username}@${options.host}`;
        this.logger.debug(`[SSH-ATTEMPT] Trying SSH executable: ${sshCmd}`);
        this.logger.debug(`[SSH-ATTEMPT] Full command: ${fullCommand}`);
        this.logger.debug(`[SSH-ATTEMPT] Args: ${JSON.stringify(args)}`);
        this.logger.debug(`[SSH-ATTEMPT] Stdio: ${JSON.stringify(spawnOptions.stdio)}`);
        this.logger.debug(`[SSH-ATTEMPT] Has password: ${!!options.password}`);

        // SAFE SPAWN: Enhanced spawn protection with multiple safeguards
        try {
          // Create process with immediate error capture
          this.process = spawn(sshCmd, args, spawnOptions);

          // CRITICAL: Set up error handler IMMEDIATELY after spawn, before any async operations
          // This prevents ENOENT and other spawn errors from becoming uncaught exceptions
          this.process.on('error', (spawnError) => {
            this.logger.error(`SSH spawn error for ${sshCmd}: ${spawnError.message}`);
            // Emit through our safe error handler system
            this.emit('error', `SSH spawn failed: ${spawnError.message}`);

            // Mark process as failed
            this.isConnected = false;
            this.process = null;
          });

          // Additional safeguard: Handle immediate spawn failures
          if (!this.process || this.process.exitCode !== null) {
            throw new Error(`Process spawn failed immediately for ${sshCmd}`);
          }

          // Safeguard: Set timeout for spawn validation
          const spawnValidationTimeout = setTimeout(() => {
            if (!this.process?.pid) {
              this.logger.error(`SSH spawn validation timeout - no PID after 100ms`);
              this.cleanup();
            }
          }, 100);

          // Clear timeout if PID is obtained
          if (this.process.pid) {
            clearTimeout(spawnValidationTimeout);
          }

        } catch (immediateSpawnError) {
          // Handle synchronous spawn errors (like EACCES, ENOENT)
          this.logger.error(`Immediate spawn error for ${sshCmd}: ${immediateSpawnError}`);
          this.process = null;
          lastError = immediateSpawnError as Error;
          continue;
        }

        // Validate that spawn was successful
        if (this.process.pid) {
          this.logger.debug(`SSH process spawned successfully with PID: ${this.process.pid}`);

          // Set up remaining handlers after successful spawn
          this.setupHandlers();

          try {
            // Use much shorter timeout on Windows to fail faster
            const timeout = platform() === 'win32' ? 3000 : (options.timeout || 10000);
            await this.waitForConnection(timeout);
            this.isConnected = true;
            this.logger.info(`SSH connection established to ${options.host} using ${sshCmd}`);
            return;
          } catch (connectionError) {
            lastError = connectionError as Error;
            this.logger.debug(`Connection attempt failed: ${connectionError.message}`);

            // Try to recover from connection error
            await this.handleConnectionError(lastError, options);

            // Clean up failed process before trying next command
            this.cleanup();

            // If recovery didn't work, try next SSH command
            continue;
          }
        } else {
          // Process didn't get a PID - spawn failed
          const spawnError = new Error(`Failed to spawn SSH process: ${sshCmd}`);
          this.logger.debug(`SSH spawn failed - no PID assigned for ${sshCmd}`);
          lastError = spawnError;
          continue;
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.debug(`Failed to spawn SSH with ${sshCmd}: ${error}`);

        // Ensure any partial process is cleaned up
        if (this.process && !this.process.killed) {
          try {
            this.process.kill();
          } catch (killError) {
            this.logger.debug(`Failed to kill partially spawned process: ${killError}`);
          }
        }
        this.process = null;

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
    // Clean up ssh2 client
    if (this.sshChannel) {
      try {
        this.sshChannel.close();
      } catch (error) {
        this.logger.debug(`Failed to cleanup SSH channel: ${error}`);
      }
      this.sshChannel = null;
    }

    if (this.sshClient) {
      try {
        this.sshClient.end();
      } catch (error) {
        this.logger.debug(`Failed to cleanup SSH client: ${error}`);
      }
      this.sshClient = null;
    }

    // Clean up native process
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
      // Windows SSH commands in order of preference
      const commands = [
        'ssh.exe',           // Windows OpenSSH (built-in since Windows 10) - try simple name first
        'C:\\Windows\\System32\\OpenSSH\\ssh.exe', // Explicit Windows OpenSSH path
        'C:\\Program Files\\Git\\usr\\bin\\ssh.exe', // Git Bash SSH (correct path)
        'ssh',               // Fallback to PATH search
      ];

      // Filter out any obviously invalid paths to reduce error logs
      return commands.filter(cmd => {
        // Basic validation - don't try paths that are clearly wrong
        if (cmd.includes('\\') && !cmd.match(/^[A-Z]:\\/)) {
          return false; // Invalid Windows path format
        }
        return true;
      });
    } else {
      // Unix/Linux/Mac SSH commands
      return [
        'ssh',               // Standard SSH - should be in PATH
        '/usr/bin/ssh',      // Common system location
        '/usr/local/bin/ssh', // Common local install location
        '/opt/bin/ssh',      // Alternative location
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

    // Authentication configuration to prevent hanging
    if (options.privateKey) {
      // Using key authentication - never prompt for password
      args.push('-o', 'BatchMode=yes');
      args.push('-o', 'PreferredAuthentications=publickey');
      args.push('-o', 'PasswordAuthentication=no');
      args.push('-o', 'KbdInteractiveAuthentication=no');
    } else if (options.password) {
      // Using password authentication
      args.push('-o', 'PreferredAuthentications=password,keyboard-interactive');
      args.push('-o', 'NumberOfPasswordPrompts=1');
    } else {
      // NO authentication method provided - must fail fast to prevent hanging
      args.push('-o', 'BatchMode=yes');
      args.push('-o', 'PasswordAuthentication=no');
      args.push('-o', 'KbdInteractiveAuthentication=no');
      args.push('-o', 'PubkeyAuthentication=yes'); // Try default keys only
      args.push('-o', 'PreferredAuthentications=publickey');
      args.push('-o', 'NumberOfPasswordPrompts=0');
    }

    // Connection timeout - always set to prevent hanging
    const timeoutSeconds = options.timeout ? Math.floor(options.timeout / 1000) : 10;
    args.push('-o', `ConnectTimeout=${timeoutSeconds}`);

    // Add keep-alive settings to prevent disconnections
    args.push('-o', 'ServerAliveInterval=30');  // Send keepalive every 30 seconds
    args.push('-o', 'ServerAliveCountMax=10');   // Allow up to 10 missed responses before disconnect
    args.push('-o', 'TCPKeepAlive=yes');         // Enable TCP-level keepalive

    // Force pseudo-terminal allocation
    args.push('-tt');

    // User@host
    args.push(`${options.username}@${options.host}`);

    return args;
  }

  private setupHandlers(): void {
    if (!this.process) {
      this.logger.warn('Cannot setup handlers - no process available');
      return;
    }

    // SAFE HANDLER SETUP: Wrap all handler attachments in try-catch
    // This prevents any errors during handler setup from crashing the process

    try {
      // Set up stdout handler with error protection
      if (this.process.stdout) {
        this.process.stdout.on('data', (data: Buffer) => {
          try {
            const text = data.toString();
            this.outputBuffer += text;
            this.lastActivity = Date.now(); // Track activity
            this.emit('data', text);

            // Check for password prompt
            if (text.toLowerCase().includes('password:')) {
              this.logger.debug(`[SSH-PASSWORD] Password prompt detected: "${text.substring(0, 50)}"`);
              this.emit('password-prompt');
            }

            // Check for successful connection (common shell prompts and login indicators)
            if (text.match(/[$#>]\s*$/) ||
                text.includes('Last login:') ||
                text.includes('Welcome to') ||
                text.match(/\w+@\w+/) ||
                text.includes('~') ||
                text.match(/\]\s*$/) || // bash prompt ending with ]
                text.match(/:\s*$/)     // some prompts end with :
            ) {
              this.isConnected = true;
              this.emit('connected');
            }
          } catch (handlerError) {
            this.logger.error(`Error in stdout handler: ${handlerError}`);
            // Don't re-throw - just log and continue
          }
        });
      } else {
        this.logger.warn('SSH process stdout not available for handler setup');
      }
    } catch (error) {
      this.logger.error(`Failed to setup stdout handler: ${error}`);
    }

    try {
      // Set up stderr handler with error protection
      if (this.process.stderr) {
        this.process.stderr.on('data', (data: Buffer) => {
          try {
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
          } catch (handlerError) {
            this.logger.error(`Error in stderr handler: ${handlerError}`);
            // Don't re-throw - just log and continue
          }
        });
      } else {
        this.logger.warn('SSH process stderr not available for handler setup');
      }
    } catch (error) {
      this.logger.error(`Failed to setup stderr handler: ${error}`);
    }

    try {
      // Set up close handler with error protection
      this.process.on('close', (code) => {
        try {
          this.isConnected = false;
          this.emit('close', code);
        } catch (handlerError) {
          this.logger.error(`Error in close handler: ${handlerError}`);
          // Don't re-throw - just log and continue
        }
      });
    } catch (error) {
      this.logger.error(`Failed to setup close handler: ${error}`);
    }

    // NOTE: Error handler is already set up in attemptConnection() immediately after spawn
    // This prevents the race condition that was causing crashes
    // We don't set it up again here to avoid duplicate handlers
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
        this.removeListener('auth-failed', onAuthFailed);
        resolve();
      };

      const onAuthFailed = () => {
        clearTimeout(timer);
        this.removeListener('connected', onConnected);
        this.removeListener('password-prompt', onPasswordPrompt);
        this.removeListener('error', onError);
        this.removeListener('auth-failed', onAuthFailed);
        const authError = new Error('Authentication failed - invalid username or password');
        (authError as any).nonRetryable = true;
        reject(authError);
      };

      const onPasswordPrompt = async () => {
        try {
          // Auto-send password if available
          if (this.connectionOptions?.password) {
            this.logger.debug('Auto-sending password for SSH authentication');
            await this.sendPassword(this.connectionOptions.password);

            // Don't resolve immediately - wait for either connection or auth failure
            // The auth-failed or connected event will handle resolution
            // Keep the timer active to detect timeout
          } else {
            // No password available, emit event for manual handling
            this.emit('needs-password');
            clearTimeout(timer);
            this.removeListener('connected', onConnected);
            this.removeListener('password-prompt', onPasswordPrompt);
            this.removeListener('error', onError);
            resolve(); // Still resolve, let caller handle password
          }
        } catch (error) {
          clearTimeout(timer);
          this.removeListener('connected', onConnected);
          this.removeListener('password-prompt', onPasswordPrompt);
          this.removeListener('error', onError);
          reject(new Error(`Password authentication failed: ${error}`));
        }
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
      this.once('auth-failed', onAuthFailed);
    });
  }

  async sendCommand(command: string): Promise<void> {
    return await this.retryManager.executeWithRetry(
      async () => {
        // Handle ssh2 client
        if (this.sshChannel) {
          return new Promise<void>((resolve, reject) => {
            this.sshChannel!.write(command + '\n', (error) => {
              if (error) {
                reject(error);
              } else {
                this.logger.debug(`[SSH2] Sent command: ${command.substring(0, 50)}...`);
                resolve();
              }
            });
          });
        }

        // Handle native SSH process
        if (!this.process || !this.process.stdin) {
          throw new Error('SSH not connected');
        }

        return new Promise<void>((resolve, reject) => {
          this.process!.stdin!.write(command + '\n', (error) => {
            if (error) {
              reject(error);
            } else {
              this.logger.debug(`[Native] Sent command: ${command.substring(0, 50)}...`);
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
        // ssh2 handles password auth during connection, not here
        if (this.sshChannel) {
          this.logger.debug('[SSH2] Password already handled during connection');
          return;
        }

        // Native SSH (shouldn't happen for password auth on Windows)
        if (!this.process || !this.process.stdin) {
          throw new Error('SSH not connected');
        }

        return new Promise<void>((resolve, reject) => {
          // Send password without echoing
          this.process!.stdin!.write(password + '\n', (error) => {
            if (error) {
              reject(error);
            } else {
              this.logger.debug('[Native] Sent password');
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

    this.stopHealthMonitoring();
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

/**
 * SAFE ALTERNATIVE: Create SSH session with immediate external handler setup
 * This ensures handlers are attached before any async operations can emit events
 *
 * @param options SSH connection options
 * @param sessionId Optional session ID
 * @param handlerSetup Function to set up handlers immediately after creation
 * @returns SSHAdapter with handlers already attached
 */
export function createSSHSessionWithHandlers(
  options: SSHOptions,
  sessionId: string | undefined,
  handlerSetup: (adapter: SSHAdapter) => void
): SSHAdapter {
  const adapter = new SSHAdapter(sessionId);

  // CRITICAL: Setup external handlers immediately after construction
  // This prevents any race conditions with async operations
  try {
    handlerSetup(adapter);
  } catch (error) {
    // If handler setup fails, still return adapter but log error
    // The default handlers in constructor will prevent crashes
    adapter.emit('error', `Handler setup failed: ${error}`);
  }

  return adapter;
}