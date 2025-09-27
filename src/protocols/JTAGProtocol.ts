import { spawn, ChildProcess } from 'child_process';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput
} from '../types/index.js';
import {
  ProtocolCapabilities,
  SessionState,
  ErrorContext,
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage
} from '../core/IProtocol.js';

// JTAG Protocol connection options
interface JTAGConnectionOptions extends SessionOptions {
  jtagAdapter: 'openocd' | 'jlink' | 'stlink' | 'ftdi' | 'cmsis-dap' | 'black-magic' | 'buspirate' | 'custom';
  target?: string;
  interface?: 'jtag' | 'swd' | 'icsp' | 'pdi' | 'updi';
  speed?: number;
  voltage?: number;
  resetType?: 'system' | 'core' | 'adaptive' | 'hard' | 'soft' | 'none';
  endian?: 'little' | 'big';
  operation?: 'debug' | 'program' | 'erase' | 'test' | 'boundary-scan' | 'telnet' | 'gdb';
  configFile?: string;
  scriptFile?: string;
  enableGDB?: boolean;
  gdbPort?: number;
  enableTelnet?: boolean;
  telnetPort?: number;
  enableTCL?: boolean;
  tclPort?: number;
  enableLog?: boolean;
  logLevel?: 'error' | 'warning' | 'info' | 'debug' | 'debug_1' | 'debug_2' | 'debug_3';
  logFile?: string;
  workArea?: number;
  flashBank?: {
    name: string;
    driver: string;
    base: number;
    size: number;
  }[];
  cpu?: {
    name: string;
    type: string;
    endian: 'little' | 'big';
    variant?: string;
  };
  enableSWO?: boolean;
  swoPin?: number;
  swoFreq?: number;
  enableETM?: boolean;
  enableITM?: boolean;
  enableDWT?: boolean;
  enableFPB?: boolean;
  halting?: boolean;
  polling?: boolean;
  enableSemihosting?: boolean;
  enableRTT?: boolean;
  rttAddress?: number;
  rttSearchDepth?: number;
  enableProfiling?: boolean;
  enableCoverage?: boolean;
  enableTrace?: boolean;
  boardConfig?: string;
  targetConfig?: string;
  interfaceConfig?: string;
  transport?: 'jtag' | 'swd' | 'hla_jtag' | 'hla_swd' | 'dapdirect_jtag' | 'dapdirect_swd';
  adapterSerial?: string;
  adapterVid?: string;
  adapterPid?: string;
  adapterDriver?: string;
  customAdapterConfig?: Record<string, any>;
  enableBoundaryScan?: boolean;
  bsdlFile?: string;
  svfFile?: string;
  enableChainPosition?: boolean;
  chainPosition?: number;
  irLength?: number;
  expectedId?: number;
  enableMultiTarget?: boolean;
  enableDaisyChain?: boolean;
  tapName?: string;
  environment?: Record<string, string>;
}

/**
 * JTAG Protocol Implementation
 *
 * Provides JTAG debugging interface console access through OpenOCD, J-Link, ST-Link and other JTAG adapters
 * Supports hardware debugging, boundary scan testing, flash programming, SWO trace, RTT, and embedded development
 */
export class JTAGProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'jtag';
  public readonly capabilities: ProtocolCapabilities;

  private jtagProcesses = new Map<string, ChildProcess>();

  // Compatibility property for old ProtocolFactory interface
  public get healthStatus(): ProtocolHealthStatus {
    return {
      isHealthy: this.isInitialized,
      lastChecked: new Date(),
      errors: [],
      warnings: [],
      metrics: {
        activeSessions: this.sessions.size,
        totalSessions: this.sessions.size,
        averageLatency: 0,
        successRate: 100,
        uptime: 0
      },
      dependencies: {}
    };
  }

  constructor() {
    super('jtag');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: false,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 4, // Most JTAG adapters support limited concurrent sessions
      defaultTimeout: 60000, // Hardware operations can take time
      supportedEncodings: ['utf-8', 'binary'],
      supportedAuthMethods: [],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if JTAG tools are available
      await this.checkJTAGAvailability();
      this.isInitialized = true;
      this.logger.info('JTAG protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize JTAG protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `jtag-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const jtagProcess = this.jtagProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!jtagProcess || !jtagProcess.stdin || !session) {
      throw new Error(`No active JTAG session: ${sessionId}`);
    }

    jtagProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to JTAG session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const jtagProcess = this.jtagProcesses.get(sessionId);
      if (jtagProcess) {
        // Try graceful shutdown first
        jtagProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (jtagProcess && !jtagProcess.killed) {
            jtagProcess.kill('SIGKILL');
          }
        }, 10000);

        this.jtagProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`JTAG session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing JTAG session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const jtagOptions = options as JTAGConnectionOptions;

    // Validate required JTAG parameters
    if (!jtagOptions.jtagAdapter) {
      throw new Error('JTAG adapter is required for JTAG protocol');
    }

    // Build JTAG command
    const jtagCommand = this.buildJTAGCommand(jtagOptions);

    // Spawn JTAG process
    const jtagProcess = spawn(jtagCommand[0], jtagCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(jtagOptions), ...options.env }
    });

    // Set up output handling
    jtagProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    jtagProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    jtagProcess.on('error', (error) => {
      this.logger.error(`JTAG process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    jtagProcess.on('close', (code) => {
      this.logger.info(`JTAG process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.jtagProcesses.set(sessionId, jtagProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: jtagCommand[0],
      args: jtagCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(jtagOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: jtagProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`JTAG session ${sessionId} created for adapter ${jtagOptions.jtagAdapter} target ${jtagOptions.target || 'auto'}`);
    this.emit('session-created', { sessionId, type: 'jtag', session });

    return session;
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    return outputs.map(output => output.data).join('');
  }

  // Missing IProtocol methods for compatibility
  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values()).filter(session =>
      session.status === 'running'
    );
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  async getSessionState(sessionId: string): Promise<SessionState> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      sessionId,
      status: session.status,
      isOneShot: false, // JTAG sessions are typically persistent for debugging
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in JTAG session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const jtagProcess = this.jtagProcesses.get(sessionId);
    return jtagProcess && !jtagProcess.killed || false;
  }

  getResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        used: memUsage.heapUsed,
        available: memUsage.heapTotal,
        peak: memUsage.heapTotal
      },
      cpu: {
        usage: cpuUsage.user + cpuUsage.system,
        load: [0, 0, 0]
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.jtagProcesses.size
      },
      storage: {
        bytesRead: 0,
        bytesWritten: 0
      },
      sessions: {
        active: this.sessions.size,
        total: this.sessions.size,
        peak: this.sessions.size
      }
    };
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkJTAGAvailability();
      return {
        ...baseStatus,
        dependencies: {
          jtag: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `JTAG tools not available: ${error}`],
        dependencies: {
          jtag: { available: false }
        }
      };
    }
  }

  private async checkJTAGAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try to check for OpenOCD first as it's most common
      const testProcess = spawn('openocd', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('JTAG tools not found. Please install OpenOCD, J-Link, or other JTAG adapter software.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('JTAG tools not found. Please install OpenOCD, J-Link, or other JTAG adapter software.'));
      });
    });
  }

  private buildJTAGCommand(options: JTAGConnectionOptions): string[] {
    const command = [];

    // JTAG adapter specific commands
    switch (options.jtagAdapter) {
      case 'openocd':
        command.push('openocd');

        // Configuration files
        if (options.interfaceConfig) {
          command.push('-f', options.interfaceConfig);
        } else if (options.interface) {
          command.push('-f', `interface/${options.interface}.cfg`);
        }

        if (options.boardConfig) {
          command.push('-f', options.boardConfig);
        } else if (options.targetConfig) {
          command.push('-f', options.targetConfig);
        } else if (options.target) {
          command.push('-f', `target/${options.target}.cfg`);
        }

        // Custom config file
        if (options.configFile) {
          command.push('-f', options.configFile);
        }

        // Adapter settings
        if (options.adapterSerial) {
          command.push('-c', `adapter serial ${options.adapterSerial}`);
        }

        if (options.speed) {
          command.push('-c', `adapter speed ${options.speed}`);
        }

        // Transport
        if (options.transport) {
          command.push('-c', `transport select ${options.transport}`);
        }

        // GDB server
        if (options.enableGDB) {
          command.push('-c', `gdb_port ${options.gdbPort || 3333}`);
        }

        // Telnet server
        if (options.enableTelnet) {
          command.push('-c', `telnet_port ${options.telnetPort || 4444}`);
        }

        // TCL server
        if (options.enableTCL) {
          command.push('-c', `tcl_port ${options.tclPort || 6666}`);
        }

        // Logging
        if (options.enableLog && options.logLevel) {
          command.push('-d', options.logLevel === 'debug' ? '3' : '0');
        }

        if (options.logFile) {
          command.push('-l', options.logFile);
        }

        // Script execution
        if (options.scriptFile) {
          command.push('-f', options.scriptFile);
        }

        break;

      case 'jlink':
        command.push('JLinkExe');

        // J-Link specific options
        if (options.target) {
          command.push('-device', options.target);
        }

        if (options.interface) {
          command.push('-if', options.interface.toUpperCase());
        }

        if (options.speed) {
          command.push('-speed', options.speed.toString());
        }

        if (options.adapterSerial) {
          command.push('-SelectEmuBySN', options.adapterSerial);
        }

        if (options.scriptFile) {
          command.push('-CommanderScript', options.scriptFile);
        }

        break;

      case 'stlink':
        command.push('st-util');

        if (options.gdbPort) {
          command.push('-p', options.gdbPort.toString());
        }

        if (options.enableLog) {
          command.push('-v');
        }

        break;

      case 'black-magic':
        command.push('arm-none-eabi-gdb');

        if (options.target) {
          command.push('-ex', `target extended-remote ${options.target}`);
        }

        break;

      case 'buspirate':
        command.push('openocd');
        command.push('-f', 'interface/buspirate.cfg');

        if (options.target) {
          command.push('-f', `target/${options.target}.cfg`);
        }

        break;

      case 'custom':
        if (options.command) {
          command.push(options.command);
        } else {
          throw new Error('Custom JTAG adapter requires command to be specified');
        }
        break;

      default:
        throw new Error(`Unsupported JTAG adapter: ${options.jtagAdapter}`);
    }

    // Common arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: JTAGConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // OpenOCD environment variables
    if (options.jtagAdapter === 'openocd') {
      if (options.enableLog) {
        env.OPENOCD_LOG_LEVEL = options.logLevel || 'info';
      }

      if (options.configFile) {
        env.OPENOCD_CONFIG = options.configFile;
      }
    }

    // J-Link environment variables
    if (options.jtagAdapter === 'jlink') {
      if (options.adapterSerial) {
        env.JLINK_SERIAL = options.adapterSerial;
      }

      if (options.logFile) {
        env.JLINK_LOG_FILE = options.logFile;
      }
    }

    // JTAG adapter paths
    if (options.adapterDriver) {
      env.JTAG_ADAPTER_DRIVER = options.adapterDriver;
    }

    if (options.adapterVid) {
      env.JTAG_ADAPTER_VID = options.adapterVid;
    }

    if (options.adapterPid) {
      env.JTAG_ADAPTER_PID = options.adapterPid;
    }

    // Target configuration
    if (options.target) {
      env.JTAG_TARGET = options.target;
    }

    if (options.interface) {
      env.JTAG_INTERFACE = options.interface;
    }

    // Debugging features
    if (options.enableSWO) {
      env.JTAG_SWO_ENABLED = '1';
      if (options.swoPin) env.JTAG_SWO_PIN = options.swoPin.toString();
      if (options.swoFreq) env.JTAG_SWO_FREQ = options.swoFreq.toString();
    }

    if (options.enableRTT) {
      env.JTAG_RTT_ENABLED = '1';
      if (options.rttAddress) env.JTAG_RTT_ADDRESS = `0x${options.rttAddress.toString(16)}`;
    }

    if (options.enableSemihosting) {
      env.JTAG_SEMIHOSTING_ENABLED = '1';
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up JTAG protocol');

    // Close all JTAG processes
    for (const [sessionId, process] of Array.from(this.jtagProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing JTAG process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.jtagProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default JTAGProtocol;