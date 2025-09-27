import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { platform } from 'os';
import { Logger } from '../utils/logger.js';
import { SSHOptions } from './SSHAdapter.js';

/**
 * Windows-specific SSH adapter that handles password authentication
 * using alternative methods since Windows OpenSSH doesn't accept passwords via stdin
 */
export class WindowsSSHAdapter extends EventEmitter {
  private process: ChildProcess | null = null;
  private outputBuffer: string = '';
  private isConnected: boolean = false;
  private logger: Logger;
  private sessionId: string;

  constructor(sessionId?: string) {
    super();
    this.sessionId = sessionId || `win-ssh-${Date.now()}`;
    this.logger = new Logger(`WindowsSSHAdapter-${this.sessionId}`);
  }

  /**
   * Connect using PowerShell with Expect-like functionality for password auth
   */
  async connectWithPowerShell(options: SSHOptions): Promise<void> {
    const psScript = `
$ErrorActionPreference = "Stop"
$password = "${options.password?.replace(/"/g, '`"')}"
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential ("${options.username}", $securePassword)

# Create SSH process info
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "ssh"
$psi.Arguments = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${options.username}@${options.host}"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$process = [System.Diagnostics.Process]::Start($psi)

# Handle password prompt
$reader = $process.StandardOutput
$writer = $process.StandardInput
$errorReader = $process.StandardError

# Wait for password prompt and send password
Start-Sleep -Milliseconds 500
$writer.WriteLine($password)
$writer.Flush()

# Read output
while (!$process.HasExited) {
    if ($reader.Peek() -ge 0) {
        $line = $reader.ReadLine()
        Write-Host $line
    }
    Start-Sleep -Milliseconds 100
}
    `.trim();

    try {
      this.process = spawn('powershell', ['-NoProfile', '-Command', psScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      this.setupHandlers();
      await this.waitForConnection(5000);
      this.isConnected = true;
      this.logger.info(`PowerShell SSH connection established to ${options.host}`);
    } catch (error) {
      throw new Error(`PowerShell SSH connection failed: ${error}`);
    }
  }

  /**
   * Use plink (PuTTY) as an alternative that handles passwords better
   */
  async connectWithPlink(options: SSHOptions): Promise<void> {
    const args = [
      '-ssh',
      `-l`, options.username,
      `-P`, (options.port || 22).toString()
    ];

    if (options.password) {
      args.push('-pw', options.password);
    }

    if (options.strictHostKeyChecking === false) {
      args.push('-batch'); // Don't ask for host key confirmation
    }

    args.push(options.host);

    try {
      // Try to find plink
      const plinkPaths = [
        'plink.exe',
        'C:\\Program Files\\PuTTY\\plink.exe',
        'C:\\Program Files (x86)\\PuTTY\\plink.exe'
      ];

      let plinkFound = false;
      for (const plinkPath of plinkPaths) {
        try {
          this.process = spawn(plinkPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
          });

          this.setupHandlers();
          await this.waitForConnection(5000);
          this.isConnected = true;
          this.logger.info(`Plink SSH connection established to ${options.host}`);
          plinkFound = true;
          break;
        } catch (e) {
          continue;
        }
      }

      if (!plinkFound) {
        throw new Error('Plink (PuTTY) not found. Please install PuTTY for password authentication on Windows.');
      }
    } catch (error) {
      throw new Error(`Plink SSH connection failed: ${error}`);
    }
  }

  /**
   * Main connect method that tries different approaches
   */
  async connect(options: SSHOptions): Promise<void> {
    if (platform() !== 'win32') {
      throw new Error('WindowsSSHAdapter is only for Windows platform');
    }

    // If using key auth, just use regular SSH
    if (options.privateKey || !options.password) {
      return this.connectWithRegularSSH(options);
    }

    // Try different methods for password auth
    const errors: Error[] = [];

    // Try plink first (most reliable for passwords)
    try {
      await this.connectWithPlink(options);
      return;
    } catch (error) {
      errors.push(error as Error);
      this.logger.debug(`Plink failed: ${error}`);
    }

    // Try PowerShell approach
    try {
      await this.connectWithPowerShell(options);
      return;
    } catch (error) {
      errors.push(error as Error);
      this.logger.debug(`PowerShell SSH failed: ${error}`);
    }

    // All methods failed
    throw new Error(
      'SSH password authentication failed on Windows. ' +
      'Please install PuTTY (plink) or use SSH key authentication instead.\n' +
      'Errors: ' + errors.map(e => e.message).join('; ')
    );
  }

  /**
   * Use regular SSH for key-based auth
   */
  private async connectWithRegularSSH(options: SSHOptions): Promise<void> {
    const args: string[] = [];

    if (options.port && options.port !== 22) {
      args.push('-p', options.port.toString());
    }

    if (options.privateKey) {
      args.push('-i', options.privateKey);
    }

    if (options.strictHostKeyChecking === false) {
      args.push('-o', 'StrictHostKeyChecking=no');
      args.push('-o', 'UserKnownHostsFile=/dev/null');
    }

    args.push('-o', 'BatchMode=yes');
    args.push('-o', 'PreferredAuthentications=publickey');
    args.push('-o', 'ConnectTimeout=10');

    args.push(`${options.username}@${options.host}`);

    try {
      this.process = spawn('ssh', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      this.setupHandlers();
      await this.waitForConnection(5000);
      this.isConnected = true;
      this.logger.info(`SSH key connection established to ${options.host}`);
    } catch (error) {
      throw new Error(`SSH key connection failed: ${error}`);
    }
  }

  private setupHandlers(): void {
    if (!this.process) return;

    if (this.process.stdout) {
      this.process.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        this.outputBuffer += text;
        this.emit('data', text);

        // Check for successful connection
        if (text.match(/[$#>]\s*$/) || text.includes('Last login:')) {
          this.isConnected = true;
          this.emit('connected');
        }
      });
    }

    if (this.process.stderr) {
      this.process.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        this.emit('error', text);
      });
    }

    this.process.on('close', (code) => {
      this.isConnected = false;
      this.emit('close', code);
    });

    this.process.on('error', (error) => {
      this.emit('error', `Process error: ${error.message}`);
    });
  }

  private waitForConnection(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, timeout);

      const onConnected = () => {
        clearTimeout(timer);
        this.removeListener('connected', onConnected);
        this.removeListener('error', onError);
        resolve();
      };

      const onError = (error: string) => {
        clearTimeout(timer);
        this.removeListener('connected', onConnected);
        this.removeListener('error', onError);
        reject(new Error(error));
      };

      this.once('connected', onConnected);
      this.once('error', onError);
    });
  }

  async sendCommand(command: string): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      this.process!.stdin!.write(command + '\n', (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  isActive(): boolean {
    return this.isConnected && this.process !== null && !this.process.killed;
  }

  destroy(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.isConnected = false;
    this.removeAllListeners();
  }
}