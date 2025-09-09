import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname, sep, posix } from 'path';
import { platform, homedir, tmpdir } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';

import {
  WSLConnectionOptions,
  WSLDistribution,
  WSLSystemInfo,
  WSLAvailableDistribution,
  WSLSession,
  WSLHealthStatus,
  WSLHealthIssue,
  WSLConfig,
  PathTranslationRule,
  ConsoleSession,
  ConsoleOutput,
  SessionOptions,
  ExtendedErrorPattern,
  WSLErrorPattern
} from '../types/index.js';

const execAsync = promisify(exec);

export class WSLProtocol {
  private static instance: WSLProtocol;
  private wslSystemInfo: WSLSystemInfo | null = null;
  private lastSystemInfoUpdate: Date = new Date(0);
  private readonly systemInfoCacheTimeout = 30000; // 30 seconds
  private readonly wslConfigPath: string;
  private activeSessions: Map<string, WSLSession> = new Map();
  private pathTranslationCache: Map<string, string> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    this.wslConfigPath = join(homedir(), '.wslconfig');
  }

  public static getInstance(): WSLProtocol {
    if (!WSLProtocol.instance) {
      WSLProtocol.instance = new WSLProtocol();
    }
    return WSLProtocol.instance;
  }

  /**
   * Initialize WSL protocol and verify WSL availability
   */
  public async initialize(): Promise<boolean> {
    try {
      // Check if WSL is installed and available
      const wslAvailable = await this.checkWSLAvailability();
      if (!wslAvailable) {
        throw new Error('WSL is not installed or not available on this system');
      }

      // Get system information
      this.wslSystemInfo = await this.getSystemInfo();
      this.lastSystemInfoUpdate = new Date();

      // Initialize error patterns
      this.initializeErrorPatterns();

      return true;
    } catch (error) {
      console.error('Failed to initialize WSL protocol:', error);
      return false;
    }
  }

  /**
   * Check if WSL is available on the system
   */
  public async checkWSLAvailability(): Promise<boolean> {
    if (platform() !== 'win32') {
      return false;
    }

    try {
      const { stdout } = await execAsync('wsl --status', { timeout: 5000 });
      return stdout.includes('Default Distribution') || stdout.includes('Windows Subsystem for Linux');
    } catch (error) {
      try {
        // Try alternative check
        await execAsync('wsl --list --quiet', { timeout: 5000 });
        return true;
      } catch (fallbackError) {
        return false;
      }
    }
  }

  /**
   * Get comprehensive WSL system information
   */
  public async getSystemInfo(forceRefresh = false): Promise<WSLSystemInfo> {
    const now = new Date();
    if (!forceRefresh && this.wslSystemInfo && 
        (now.getTime() - this.lastSystemInfoUpdate.getTime()) < this.systemInfoCacheTimeout) {
      return this.wslSystemInfo;
    }

    try {
      // Get WSL version
      const wslVersion = await this.getWSLVersion();

      // Get installed distributions
      const installedDistributions = await this.getInstalledDistributions();

      // Get default distribution
      const defaultDistribution = await this.getDefaultDistribution();

      // Check system capabilities
      const systemdSupport = await this.checkSystemdSupport();
      const hyperVEnabled = await this.checkHyperVStatus();
      const virtualizationEnabled = await this.checkVirtualizationSupport();

      // Get kernel version
      const kernelVersion = await this.getKernelVersion();

      // Get available distributions
      const availableDistributions = await this.getAvailableDistributions();

      this.wslSystemInfo = {
        wslVersion,
        installedDistributions,
        defaultDistribution,
        systemdSupport,
        hyperVEnabled,
        virtualizationEnabled,
        kernelVersion,
        availableDistributions
      };

      this.lastSystemInfoUpdate = now;
      return this.wslSystemInfo;
    } catch (error) {
      throw new Error(`Failed to get WSL system information: ${error.message}`);
    }
  }

  /**
   * Get WSL version
   */
  private async getWSLVersion(): Promise<string> {
    try {
      const { stdout } = await execAsync('wsl --version', { timeout: 5000 });
      const match = stdout.match(/WSL version: ([\d.]+)/i);
      return match ? match[1] : 'unknown';
    } catch (error) {
      // Fallback for older WSL installations
      return '1.x';
    }
  }

  /**
   * Get list of installed distributions
   */
  public async getInstalledDistributions(): Promise<WSLDistribution[]> {
    try {
      const { stdout } = await execAsync('wsl --list --verbose', { timeout: 10000 });
      const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('NAME'));
      
      const distributions: WSLDistribution[] = [];
      
      for (const line of lines) {
        const parts = line.trim().replace(/\s+/g, ' ').split(' ');
        if (parts.length >= 3) {
          const name = parts[0].replace(/[*\s]/g, '');
          const state = parts[1] as WSLDistribution['state'];
          const wslVersion = parseInt(parts[2]) as 1 | 2;
          const defaultDistribution = parts[0].includes('*');

          // Get additional distribution info
          const distributionInfo = await this.getDistributionDetails(name);

          distributions.push({
            name,
            version: distributionInfo.version || 'unknown',
            wslVersion,
            state,
            defaultDistribution,
            lastUsed: distributionInfo.lastUsed,
            location: distributionInfo.location,
            size: distributionInfo.size,
            architecture: distributionInfo.architecture || 'x64',
            kernel: distributionInfo.kernel,
            memoryUsage: distributionInfo.memoryUsage,
            cpuUsage: distributionInfo.cpuUsage,
            networkAddress: distributionInfo.networkAddress
          });
        }
      }

      return distributions;
    } catch (error) {
      throw new Error(`Failed to get installed distributions: ${error.message}`);
    }
  }

  /**
   * Get detailed information about a specific distribution
   */
  private async getDistributionDetails(distributionName: string): Promise<Partial<WSLDistribution>> {
    const details: Partial<WSLDistribution> = {};

    try {
      // Get distribution version
      const { stdout: versionOutput } = await execAsync(
        `wsl -d ${distributionName} -- cat /etc/os-release 2>/dev/null || echo "VERSION_ID=unknown"`,
        { timeout: 5000 }
      );
      const versionMatch = versionOutput.match(/VERSION_ID="?([^"\n]+)"?/);
      details.version = versionMatch ? versionMatch[1] : 'unknown';

      // Get architecture
      try {
        const { stdout: archOutput } = await execAsync(
          `wsl -d ${distributionName} -- uname -m`,
          { timeout: 3000 }
        );
        details.architecture = archOutput.trim() === 'aarch64' ? 'arm64' : 'x64';
      } catch (archError) {
        details.architecture = 'x64';
      }

      // Get network address (for WSL2 only)
      try {
        const { stdout: ipOutput } = await execAsync(
          `wsl -d ${distributionName} -- hostname -I`,
          { timeout: 3000 }
        );
        const ips = ipOutput.trim().split(' ');
        details.networkAddress = ips.find(ip => ip.startsWith('172.') || ip.startsWith('192.168.')) || ips[0];
      } catch (ipError) {
        // Network address not available
      }

      // Get kernel version
      try {
        const { stdout: kernelOutput } = await execAsync(
          `wsl -d ${distributionName} -- uname -r`,
          { timeout: 3000 }
        );
        details.kernel = kernelOutput.trim();
      } catch (kernelError) {
        // Kernel version not available
      }

    } catch (error) {
      // Distribution might not be running or accessible
    }

    return details;
  }

  /**
   * Get default distribution
   */
  private async getDefaultDistribution(): Promise<string | undefined> {
    try {
      const distributions = await this.getInstalledDistributions();
      const defaultDist = distributions.find(dist => dist.defaultDistribution);
      return defaultDist?.name;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Check if systemd is supported
   */
  private async checkSystemdSupport(): Promise<boolean> {
    try {
      const wslVersion = await this.getWSLVersion();
      return parseFloat(wslVersion) >= 0.67; // WSL version that introduced systemd support
    } catch (error) {
      return false;
    }
  }

  /**
   * Check Hyper-V status
   */
  private async checkHyperVStatus(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('bcdedit /enum | findstr hypervisorlaunchtype', { timeout: 5000 });
      return stdout.toLowerCase().includes('auto');
    } catch (error) {
      return false;
    }
  }

  /**
   * Check virtualization support
   */
  private async checkVirtualizationSupport(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('systeminfo | findstr /C:"Hyper-V Requirements"', { timeout: 10000 });
      return !stdout.toLowerCase().includes('no');
    } catch (error) {
      return true; // Assume it's supported if we can't determine
    }
  }

  /**
   * Get kernel version
   */
  private async getKernelVersion(): Promise<string> {
    try {
      const distributions = await this.getInstalledDistributions();
      const runningDist = distributions.find(dist => dist.state === 'Running');
      
      if (runningDist) {
        const { stdout } = await execAsync(
          `wsl -d ${runningDist.name} -- uname -r`,
          { timeout: 5000 }
        );
        return stdout.trim();
      }

      // Fallback: try default distribution
      const { stdout } = await execAsync('wsl -- uname -r', { timeout: 5000 });
      return stdout.trim();
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get available distributions from Microsoft Store
   */
  private async getAvailableDistributions(): Promise<WSLAvailableDistribution[]> {
    try {
      const { stdout } = await execAsync('wsl --list --online', { timeout: 15000 });
      const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('NAME'));
      
      const available: WSLAvailableDistribution[] = [];
      
      for (const line of lines) {
        const parts = line.trim().split(/\s{2,}/); // Split by multiple spaces
        if (parts.length >= 2) {
          available.push({
            name: parts[0],
            friendlyName: parts[1] || parts[0],
            source: 'microsoft-store',
            architecture: 'x64',
            verified: true
          });
        }
      }

      return available;
    } catch (error) {
      // Return empty array if we can't get available distributions
      return [];
    }
  }

  /**
   * Create a new WSL session
   */
  public async createSession(options: SessionOptions): Promise<WSLSession> {
    const wslOptions = options.wslOptions || {};
    
    // Ensure WSL is available
    if (!await this.checkWSLAvailability()) {
      throw new Error('WSL is not available on this system');
    }

    // Get system info to validate distribution
    const systemInfo = await this.getSystemInfo();
    
    // Determine distribution to use
    let distribution = wslOptions.distribution;
    if (!distribution) {
      distribution = wslOptions.defaultDistribution ? 
        systemInfo.defaultDistribution : 
        systemInfo.installedDistributions[0]?.name;
    }

    if (!distribution) {
      throw new Error('No WSL distribution available');
    }

    // Validate distribution exists
    const distInfo = systemInfo.installedDistributions.find(d => d.name === distribution);
    if (!distInfo) {
      throw new Error(`Distribution '${distribution}' not found`);
    }

    // Ensure distribution is running
    if (distInfo.state !== 'Running') {
      await this.startDistribution(distribution);
    }

    // Create session ID
    const sessionId = `wsl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Prepare command and environment
    const { command, args, env } = await this.prepareSessionCommand(options, wslOptions, distribution);

    // Create the session
    const session: WSLSession = {
      id: sessionId,
      command: command,
      args: args,
      cwd: options.cwd || await this.translatePath(process.cwd(), 'windows-to-linux'),
      env: env,
      createdAt: new Date(),
      status: 'running',
      type: options.consoleType as 'wsl' | 'wsl2',
      streaming: options.streaming,
      distribution: distribution,
      wslVersion: distInfo.wslVersion,
      systemdEnabled: wslOptions.systemdEnabled,
      networkAddress: distInfo.networkAddress,
      mountedDrives: await this.getMountedDrives(distribution),
      pathTranslations: new Map(),
      environmentVariables: new Map(),
      executionState: 'idle',
      activeCommands: new Map()
    };

    // Store session
    this.activeSessions.set(sessionId, session);

    // Start health monitoring
    this.startHealthMonitoring(sessionId);

    return session;
  }

  /**
   * Prepare WSL command and environment
   */
  private async prepareSessionCommand(
    options: SessionOptions, 
    wslOptions: WSLConnectionOptions, 
    distribution: string
  ): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
    
    const args: string[] = [];
    
    // Add distribution parameter
    args.push('-d', distribution);
    
    // Add user parameter if specified
    if (wslOptions.user) {
      args.push('-u', wslOptions.user);
    }

    // Add working directory if specified
    if (options.cwd) {
      const linuxPath = await this.translatePath(options.cwd, 'windows-to-linux');
      args.push('-cd', linuxPath);
    }

    // Prepare environment variables
    const env = { ...process.env, ...options.env };
    
    // Add WSL-specific environment variables
    if (wslOptions.interopEnabled !== false) {
      env.WSLENV = this.buildWSLEnvString(env);
    }

    // Add the actual command to execute
    if (options.command) {
      args.push('--');
      args.push(options.command);
      if (options.args) {
        args.push(...options.args);
      }
    } else {
      // Interactive shell
      args.push('--');
      args.push('/bin/bash');
      args.push('-l');
    }

    return {
      command: 'wsl',
      args,
      env
    };
  }

  /**
   * Build WSLENV string for environment variable interop
   */
  private buildWSLEnvString(env: Record<string, string>): string {
    const wslEnvVars: string[] = [];
    
    // Common variables that should be passed through
    const commonVars = ['PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'PWD'];
    
    for (const [key, value] of Object.entries(env)) {
      if (commonVars.includes(key) || key.startsWith('WSL_')) {
        wslEnvVars.push(key);
      }
    }

    return wslEnvVars.join(':');
  }

  /**
   * Get mounted drives for a distribution
   */
  private async getMountedDrives(distribution: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        `wsl -d ${distribution} -- df -h | grep "/mnt/"`,
        { timeout: 5000 }
      );
      
      const lines = stdout.split('\n').filter(line => line.trim());
      const mountPoints: string[] = [];
      
      for (const line of lines) {
        const match = line.match(/\/mnt\/([a-z])/);
        if (match) {
          mountPoints.push(match[1].toUpperCase() + ':');
        }
      }

      return mountPoints;
    } catch (error) {
      return [];
    }
  }

  /**
   * Start a WSL distribution
   */
  public async startDistribution(distribution: string): Promise<void> {
    try {
      await execAsync(`wsl -d ${distribution} --exec true`, { timeout: 30000 });
    } catch (error) {
      throw new Error(`Failed to start distribution '${distribution}': ${error.message}`);
    }
  }

  /**
   * Stop a WSL distribution
   */
  public async stopDistribution(distribution: string): Promise<void> {
    try {
      await execAsync(`wsl --terminate ${distribution}`, { timeout: 10000 });
    } catch (error) {
      throw new Error(`Failed to stop distribution '${distribution}': ${error.message}`);
    }
  }

  /**
   * Restart a WSL distribution
   */
  public async restartDistribution(distribution: string): Promise<void> {
    await this.stopDistribution(distribution);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for shutdown
    await this.startDistribution(distribution);
  }

  /**
   * Set default distribution
   */
  public async setDefaultDistribution(distribution: string): Promise<void> {
    try {
      await execAsync(`wsl --set-default ${distribution}`, { timeout: 10000 });
    } catch (error) {
      throw new Error(`Failed to set default distribution: ${error.message}`);
    }
  }

  /**
   * Install a new distribution
   */
  public async installDistribution(distribution: string, installPath?: string): Promise<void> {
    try {
      let command = `wsl --install -d ${distribution}`;
      if (installPath) {
        // For sideload installations
        command = `wsl --import ${distribution} ${installPath}`;
      }
      
      await execAsync(command, { timeout: 300000 }); // 5 minutes timeout for installation
    } catch (error) {
      throw new Error(`Failed to install distribution '${distribution}': ${error.message}`);
    }
  }

  /**
   * Uninstall a distribution
   */
  public async uninstallDistribution(distribution: string): Promise<void> {
    try {
      await execAsync(`wsl --unregister ${distribution}`, { timeout: 30000 });
    } catch (error) {
      throw new Error(`Failed to uninstall distribution '${distribution}': ${error.message}`);
    }
  }

  /**
   * Path translation between Windows and Linux
   */
  public async translatePath(path: string, direction: 'windows-to-linux' | 'linux-to-windows'): Promise<string> {
    const cacheKey = `${direction}:${path}`;
    
    if (this.pathTranslationCache.has(cacheKey)) {
      return this.pathTranslationCache.get(cacheKey)!;
    }

    let translatedPath: string;

    if (direction === 'windows-to-linux') {
      translatedPath = this.translateWindowsToLinux(path);
    } else {
      translatedPath = await this.translateLinuxToWindows(path);
    }

    this.pathTranslationCache.set(cacheKey, translatedPath);
    return translatedPath;
  }

  /**
   * Translate Windows path to Linux path
   */
  private translateWindowsToLinux(windowsPath: string): string {
    // Handle UNC paths
    if (windowsPath.startsWith('\\\\')) {
      return `/mnt/${windowsPath.replace(/\\/g, '/').substring(2)}`;
    }

    // Handle drive letters
    if (windowsPath.match(/^[A-Za-z]:/)) {
      const drive = windowsPath[0].toLowerCase();
      const restOfPath = windowsPath.substring(2).replace(/\\/g, '/');
      return `/mnt/${drive}${restOfPath}`;
    }

    // Handle relative paths
    if (!windowsPath.startsWith('/')) {
      return windowsPath.replace(/\\/g, '/');
    }

    return windowsPath;
  }

  /**
   * Translate Linux path to Windows path
   */
  private async translateLinuxToWindows(linuxPath: string): Promise<string> {
    // Handle /mnt/ paths
    if (linuxPath.startsWith('/mnt/')) {
      const pathParts = linuxPath.split('/');
      if (pathParts.length >= 3) {
        const drive = pathParts[2].toUpperCase();
        const restOfPath = pathParts.slice(3).join('\\');
        return `${drive}:\\${restOfPath}`;
      }
    }

    // Handle WSL2 network shares
    if (linuxPath.startsWith('/wsl$/')) {
      return `\\\\${linuxPath.replace(/\//g, '\\')}`;
    }

    // For other paths, try to resolve using WSL
    try {
      const { stdout } = await execAsync(
        `wsl -- wslpath -w "${linuxPath}"`,
        { timeout: 3000 }
      );
      return stdout.trim();
    } catch (error) {
      // Fallback to direct conversion
      return linuxPath.replace(/\//g, '\\');
    }
  }

  /**
   * Execute a command in WSL
   */
  public async executeCommand(
    sessionId: string, 
    command: string, 
    args?: string[], 
    options?: { timeout?: number; cwd?: string }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const fullCommand = args ? `${command} ${args.join(' ')}` : command;
    
    const wslArgs = ['-d', session.distribution];
    
    if (options?.cwd) {
      const linuxCwd = await this.translatePath(options.cwd, 'windows-to-linux');
      wslArgs.push('-cd', linuxCwd);
    }
    
    wslArgs.push('--', 'bash', '-c', fullCommand);

    try {
      const { stdout, stderr } = await execAsync(
        `wsl ${wslArgs.join(' ')}`,
        { 
          timeout: options?.timeout || 30000,
          maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }
      );

      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1
      };
    }
  }

  /**
   * Get health status for a distribution
   */
  public async getHealthStatus(distribution: string): Promise<WSLHealthStatus> {
    const issues: WSLHealthIssue[] = [];
    let wslServiceRunning = false;
    let distributionResponsive = false;
    let networkConnectivity = false;
    let filesystemAccessible = false;
    let systemdStatus: WSLHealthStatus['systemdStatus'] = 'not-available';
    let memoryUsage = 0;
    let diskUsage = 0;

    try {
      // Check if WSL service is running
      try {
        await execAsync('wsl --status', { timeout: 5000 });
        wslServiceRunning = true;
      } catch (error) {
        issues.push({
          type: 'configuration',
          severity: 'critical',
          message: 'WSL service is not running',
          resolution: 'Try running "wsl --shutdown" and then restart WSL',
          autoFixAvailable: true
        });
      }

      // Check if distribution is responsive
      try {
        await execAsync(`wsl -d ${distribution} --exec echo "test"`, { timeout: 10000 });
        distributionResponsive = true;
      } catch (error) {
        issues.push({
          type: 'configuration',
          severity: 'high',
          message: `Distribution ${distribution} is not responsive`,
          resolution: `Try restarting the distribution: wsl --terminate ${distribution}`,
          autoFixAvailable: true
        });
      }

      // Check network connectivity
      if (distributionResponsive) {
        try {
          await execAsync(
            `wsl -d ${distribution} -- ping -c 1 8.8.8.8`,
            { timeout: 10000 }
          );
          networkConnectivity = true;
        } catch (error) {
          issues.push({
            type: 'network',
            severity: 'medium',
            message: 'Network connectivity issues detected',
            resolution: 'Check network configuration and DNS settings'
          });
        }

        // Check filesystem accessibility
        try {
          await execAsync(
            `wsl -d ${distribution} -- ls /tmp`,
            { timeout: 5000 }
          );
          filesystemAccessible = true;
        } catch (error) {
          issues.push({
            type: 'filesystem',
            severity: 'high',
            message: 'Filesystem access issues detected',
            resolution: 'Distribution filesystem may be corrupted'
          });
        }

        // Check systemd status
        try {
          const { stdout } = await execAsync(
            `wsl -d ${distribution} -- systemctl is-active systemd`,
            { timeout: 5000 }
          );
          systemdStatus = stdout.trim() === 'active' ? 'active' : 'inactive';
        } catch (error) {
          systemdStatus = 'not-available';
        }

        // Get memory usage
        try {
          const { stdout } = await execAsync(
            `wsl -d ${distribution} -- free -m | grep Mem:`,
            { timeout: 5000 }
          );
          const memMatch = stdout.match(/\s+(\d+)\s+(\d+)/);
          if (memMatch) {
            const total = parseInt(memMatch[1]);
            const used = parseInt(memMatch[2]);
            memoryUsage = (used / total) * 100;
          }
        } catch (error) {
          // Memory info not available
        }

        // Get disk usage
        try {
          const { stdout } = await execAsync(
            `wsl -d ${distribution} -- df -h / | tail -1`,
            { timeout: 5000 }
          );
          const diskMatch = stdout.match(/(\d+)%/);
          if (diskMatch) {
            diskUsage = parseInt(diskMatch[1]);
          }
        } catch (error) {
          // Disk info not available
        }
      }

      // Determine overall status
      let status: WSLHealthStatus['status'] = 'healthy';
      if (issues.some(issue => issue.severity === 'critical')) {
        status = 'critical';
      } else if (issues.some(issue => issue.severity === 'high')) {
        status = 'critical';
      } else if (issues.some(issue => issue.severity === 'medium')) {
        status = 'warning';
      } else if (!wslServiceRunning || !distributionResponsive) {
        status = 'unavailable';
      }

      return {
        distribution,
        status,
        wslServiceRunning,
        distributionResponsive,
        networkConnectivity,
        filesystemAccessible,
        systemdStatus,
        memoryUsage,
        diskUsage,
        lastHealthCheck: new Date(),
        issues
      };

    } catch (error) {
      return {
        distribution,
        status: 'critical',
        wslServiceRunning: false,
        distributionResponsive: false,
        networkConnectivity: false,
        filesystemAccessible: false,
        memoryUsage: 0,
        diskUsage: 0,
        lastHealthCheck: new Date(),
        issues: [{
          type: 'configuration',
          severity: 'critical',
          message: `Health check failed: ${error.message}`,
          resolution: 'Check WSL installation and configuration'
        }]
      };
    }
  }

  /**
   * Start health monitoring for a session
   */
  private startHealthMonitoring(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const interval = setInterval(async () => {
      try {
        const healthStatus = await this.getHealthStatus(session.distribution);
        
        // Handle critical issues
        if (healthStatus.status === 'critical' || healthStatus.status === 'unavailable') {
          const criticalIssues = healthStatus.issues.filter(issue => issue.severity === 'critical');
          
          for (const issue of criticalIssues) {
            if (issue.autoFixAvailable) {
              await this.attemptAutoRecovery(session, issue);
            }
          }
        }
      } catch (error) {
        console.error(`Health monitoring failed for session ${sessionId}:`, error);
      }
    }, 30000); // Check every 30 seconds

    this.healthCheckIntervals.set(sessionId, interval);
  }

  /**
   * Attempt automatic recovery for issues
   */
  private async attemptAutoRecovery(session: WSLSession, issue: WSLHealthIssue): Promise<void> {
    try {
      switch (issue.type) {
        case 'configuration':
          if (issue.message.includes('WSL service is not running')) {
            await execAsync('wsl --shutdown', { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            await this.startDistribution(session.distribution);
          } else if (issue.message.includes('not responsive')) {
            await this.restartDistribution(session.distribution);
          }
          break;

        case 'network':
          // Try to restart network
          await this.executeCommand(
            session.id,
            'sudo systemctl restart systemd-networkd',
            [],
            { timeout: 10000 }
          );
          break;

        default:
          // No automatic recovery available
          break;
      }
    } catch (error) {
      console.error(`Auto-recovery failed for ${session.id}:`, error);
    }
  }

  /**
   * Stop health monitoring for a session
   */
  private stopHealthMonitoring(sessionId: string): void {
    const interval = this.healthCheckIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(sessionId);
    }
  }

  /**
   * Close a WSL session
   */
  public async closeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Stop health monitoring
    this.stopHealthMonitoring(sessionId);

    // Update session status
    session.status = 'stopped';

    // Remove from active sessions
    this.activeSessions.delete(sessionId);
  }

  /**
   * Get WSL configuration
   */
  public async getWSLConfig(): Promise<WSLConfig> {
    const config: WSLConfig = {
      global: {},
      distributions: {}
    };

    try {
      // Read global .wslconfig file
      if (existsSync(this.wslConfigPath)) {
        const configContent = readFileSync(this.wslConfigPath, 'utf8');
        const globalConfig = this.parseWslConfig(configContent);
        config.global = globalConfig;
      }

      // Get per-distribution configurations
      const distributions = await this.getInstalledDistributions();
      for (const dist of distributions) {
        try {
          const { stdout } = await execAsync(
            `wsl -d ${dist.name} -- cat /etc/wsl.conf 2>/dev/null || echo ""`,
            { timeout: 5000 }
          );
          if (stdout.trim()) {
            config.distributions[dist.name] = this.parseDistributionConfig(stdout);
          }
        } catch (error) {
          // No wsl.conf or not accessible
        }
      }

      return config;
    } catch (error) {
      throw new Error(`Failed to get WSL configuration: ${error.message}`);
    }
  }

  /**
   * Parse .wslconfig file content
   */
  private parseWslConfig(content: string): WSLConfig['global'] {
    const config: WSLConfig['global'] = {};
    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
        currentSection = trimmedLine.slice(1, -1).toLowerCase();
      } else if (trimmedLine.includes('=') && currentSection === 'wsl2') {
        const [key, value] = trimmedLine.split('=', 2);
        const cleanKey = key.trim().toLowerCase();
        const cleanValue = value.trim();

        switch (cleanKey) {
          case 'memory':
            config.memory = cleanValue;
            break;
          case 'processors':
            config.processors = parseInt(cleanValue);
            break;
          case 'swap':
            config.swap = cleanValue;
            break;
          case 'localhostforwarding':
            config.localhostForwarding = cleanValue.toLowerCase() === 'true';
            break;
          case 'networkingmode':
            config.networkingMode = cleanValue as 'mirrored' | 'nat' | 'bridged';
            break;
          case 'firewall':
            config.firewall = cleanValue.toLowerCase() === 'true';
            break;
          case 'dnstunneling':
            config.dnsTunneling = cleanValue.toLowerCase() === 'true';
            break;
          case 'autoproxy':
            config.autoProxy = cleanValue.toLowerCase() === 'true';
            break;
        }
      }
    }

    return config;
  }

  /**
   * Parse distribution wsl.conf file content
   */
  private parseDistributionConfig(content: string): WSLConfig['distributions'][string] {
    const config: WSLConfig['distributions'][string] = {};
    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
        currentSection = trimmedLine.slice(1, -1).toLowerCase();
      } else if (trimmedLine.includes('=')) {
        const [key, value] = trimmedLine.split('=', 2);
        const cleanKey = key.trim().toLowerCase();
        const cleanValue = value.trim();

        if (currentSection === 'user') {
          if (cleanKey === 'default') {
            config.user = cleanValue;
          }
        } else if (currentSection === 'boot') {
          if (cleanKey === 'systemd') {
            config.systemd = cleanValue.toLowerCase() === 'true';
          }
        } else if (currentSection === 'interop') {
          if (cleanKey === 'enabled') {
            config.interop = cleanValue.toLowerCase() === 'true';
          } else if (cleanKey === 'appendwindowspath') {
            config.appendWindowsPath = cleanValue.toLowerCase() === 'true';
          }
        } else if (currentSection === 'network') {
          if (cleanKey === 'generatehosts') {
            config.generateHosts = cleanValue.toLowerCase() === 'true';
          } else if (cleanKey === 'generateresolvconf') {
            config.generateResolvConf = cleanValue.toLowerCase() === 'true';
          }
        } else if (currentSection === 'automount') {
          if (cleanKey === 'options') {
            config.mountOptions = cleanValue;
          }
        }
      }
    }

    return config;
  }

  /**
   * Initialize WSL-specific error patterns
   */
  private initializeErrorPatterns(): void {
    // This would be used by the error detection system
    // Implementation would add WSL-specific error patterns to the global error patterns
  }

  /**
   * Get WSL-specific error patterns
   */
  public getErrorPatterns(): WSLErrorPattern[] {
    return [
      {
        pattern: /WslRegisterDistribution failed with error: 0x80070003/,
        type: 'error',
        description: 'WSL distribution registration failed - file not found',
        severity: 'high',
        category: 'wsl-installation',
        wslVersion: 1,
        remediation: 'Check file paths and permissions for distribution installation',
        retryable: false
      },
      {
        pattern: /WslRegisterDistribution failed with error: 0x8007019e/,
        type: 'error',
        description: 'WSL feature not enabled',
        severity: 'critical',
        category: 'wsl-configuration',
        remediation: 'Enable WSL feature in Windows Features or via PowerShell',
        retryable: false
      },
      {
        pattern: /The Windows Subsystem for Linux optional component is not enabled/,
        type: 'error',
        description: 'WSL optional component not enabled',
        severity: 'critical',
        category: 'wsl-configuration',
        remediation: 'Enable WSL in Windows Features',
        retryable: false
      },
      {
        pattern: /Element not found/,
        type: 'error',
        description: 'WSL distribution not found',
        severity: 'medium',
        category: 'wsl-distribution',
        remediation: 'Check distribution name and installation status',
        retryable: true
      },
      {
        pattern: /The system cannot find the file specified/,
        type: 'error',
        description: 'WSL executable or distribution file not found',
        severity: 'high',
        category: 'wsl-filesystem',
        filesystemRelated: true,
        remediation: 'Reinstall WSL or the specific distribution',
        retryable: true
      },
      {
        pattern: /A connection with the server could not be established/,
        type: 'error',
        description: 'WSL network connectivity issue',
        severity: 'medium',
        category: 'wsl-network',
        networkRelated: true,
        wslVersion: 2,
        remediation: 'Check network configuration and restart WSL',
        retryable: true
      },
      {
        pattern: /systemd.*failed/i,
        type: 'error',
        description: 'Systemd service failure',
        severity: 'medium',
        category: 'wsl-systemd',
        systemdRelated: true,
        wslVersion: 2,
        remediation: 'Check systemd configuration and service status',
        retryable: true
      },
      {
        pattern: /mount.*failed/i,
        type: 'error',
        description: 'File system mount failure',
        severity: 'high',
        category: 'wsl-filesystem',
        filesystemRelated: true,
        remediation: 'Check mount points and file system integrity',
        retryable: true
      },
      {
        pattern: /docker.*not found/i,
        type: 'error',
        description: 'Docker not available in WSL',
        severity: 'low',
        category: 'wsl-docker',
        remediation: 'Install Docker in WSL distribution',
        retryable: false
      },
      {
        pattern: /permission denied.*\/mnt\//i,
        type: 'error',
        description: 'Permission denied accessing Windows drives',
        severity: 'medium',
        category: 'wsl-permissions',
        filesystemRelated: true,
        remediation: 'Check WSL mount permissions and Windows file permissions',
        retryable: false
      }
    ];
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    // Stop all health monitoring
    for (const [sessionId] of this.healthCheckIntervals) {
      this.stopHealthMonitoring(sessionId);
    }

    // Clear caches
    this.pathTranslationCache.clear();
    this.activeSessions.clear();
  }
}

export default WSLProtocol;