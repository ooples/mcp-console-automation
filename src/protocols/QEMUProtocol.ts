import { spawn, ChildProcess } from 'child_process';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput,
} from '../types/index.js';
import {
  ProtocolCapabilities,
  SessionState,
  ErrorContext,
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage,
} from '../core/IProtocol.js';

// QEMU Protocol connection options
interface QEMUConnectionOptions extends SessionOptions {
  // Basic VM Configuration
  vmName?: string;
  architecture?:
    | 'x86_64'
    | 'i386'
    | 'arm'
    | 'aarch64'
    | 'mips'
    | 'mipsel'
    | 'mips64'
    | 'mips64el'
    | 'ppc'
    | 'ppc64'
    | 'ppc64le'
    | 'riscv32'
    | 'riscv64'
    | 's390x'
    | 'sparc'
    | 'sparc64'
    | 'xtensa'
    | 'xtensaeb';
  machineType?: string;
  accelerator?: 'kvm' | 'xen' | 'hvf' | 'whpx' | 'tcg' | 'none';

  // Boot Configuration
  bootOrder?: string;
  bootMenu?: boolean;
  bootStrict?: boolean;
  kernel?: string;
  initrd?: string;
  append?: string;
  dtb?: string;

  // Memory Configuration
  memory?: string | number;
  memorySlots?: number;
  memoryMaxmem?: string | number;
  memPath?: string;
  memPrealloc?: boolean;
  memShared?: boolean;
  hugepages?: boolean;
  hugepageSize?: string;
  memoryBackingFile?: string;
  balloonDevice?: boolean;

  // CPU Configuration
  cpu?: string;
  cpuCount?: number;
  cpuSockets?: number;
  cpuCores?: number;
  cpuThreads?: number;
  cpuMaxHotplug?: number;
  cpuFeatures?: string[];
  smp?: string;

  // Storage Configuration
  drives?: Array<{
    file: string;
    format?:
      | 'raw'
      | 'qcow2'
      | 'vmdk'
      | 'vdi'
      | 'vpc'
      | 'vhdx'
      | 'qed'
      | 'parallels'
      | 'dmg'
      | 'luks'
      | 'nbd';
    interface?:
      | 'ide'
      | 'scsi'
      | 'sd'
      | 'mtd'
      | 'floppy'
      | 'pflash'
      | 'virtio'
      | 'none';
    media?: 'disk' | 'cdrom';
    index?: number;
    cache?: 'none' | 'writeback' | 'unsafe' | 'directsync' | 'writethrough';
    aio?: 'threads' | 'native' | 'io_uring';
    readonly?: boolean;
    snapshot?: boolean;
    bootindex?: number;
    serial?: string;
    werror?: 'enospc' | 'stop' | 'report' | 'ignore';
    rerror?: 'ignore' | 'stop' | 'report';
    copy_on_read?: boolean;
    discard?: 'ignore' | 'unmap';
    detect_zeroes?: 'off' | 'on' | 'unmap';
    throttling?: {
      bps?: number;
      bps_rd?: number;
      bps_wr?: number;
      iops?: number;
      iops_rd?: number;
      iops_wr?: number;
    };
  }>;

  // Network Configuration
  networkDevices?: Array<{
    type?:
      | 'user'
      | 'tap'
      | 'bridge'
      | 'socket'
      | 'stream'
      | 'dgram'
      | 'vde'
      | 'dump'
      | 'netmap'
      | 'vhost-user'
      | 'vhost-vdpa';
    model?:
      | 'e1000'
      | 'e1000e'
      | 'i82551'
      | 'i82557b'
      | 'i82559er'
      | 'ne2k_pci'
      | 'ne2k_isa'
      | 'pcnet'
      | 'rtl8139'
      | 'virtio-net-pci'
      | 'vmxnet3';
    mac?: string;
    vlan?: number;
    id?: string;
    ifname?: string;
    script?: string;
    downscript?: string;
    br?: string;
    helper?: string;
    sndbuf?: number;
    vnet_hdr?: boolean;
    vhost?: boolean;
    queues?: number;
    bootindex?: number;
    romfile?: string;
    rombar?: boolean;
  }>;

  // Display Configuration
  display?:
    | 'none'
    | 'sdl'
    | 'curses'
    | 'vnc'
    | 'gtk'
    | 'spice'
    | 'egl-headless'
    | 'dbus';
  vncDisplay?: string;
  vncPassword?: string;
  vncWebsocket?: number;
  vncTLS?: boolean;
  vncSASL?: boolean;
  spicePort?: number;
  spiceAddr?: string;
  spicePassword?: string;
  spiceDisableTicketing?: boolean;
  spiceTLS?: boolean;
  nographic?: boolean;
  curses?: boolean;

  // USB Configuration
  usbDevices?: Array<{
    hostbus?: number;
    hostaddr?: number;
    hostport?: string;
    vendorid?: string;
    productid?: string;
    id?: string;
    port?: string;
  }>;

  // Audio Configuration
  audioDriver?: 'none' | 'alsa' | 'oss' | 'pa' | 'sdl' | 'wav' | 'spice';
  audioModel?:
    | 'sb16'
    | 'es1370'
    | 'ac97'
    | 'adlib'
    | 'gus'
    | 'cs4231a'
    | 'hda'
    | 'intel-hda';

  // Graphics Configuration
  vga?: 'std' | 'cirrus' | 'vmware' | 'qxl' | 'virtio' | 'none';

  // Serial/Console Configuration
  serial?: Array<{
    type?:
      | 'vc'
      | 'pty'
      | 'none'
      | 'null'
      | 'chardev'
      | 'file'
      | 'pipe'
      | 'stdio'
      | 'udp'
      | 'tcp'
      | 'telnet'
      | 'unix'
      | 'mon'
      | 'msmouse'
      | 'wctablet'
      | 'braille'
      | 'testdev'
      | 'spicevmc'
      | 'spiceport';
    path?: string;
    server?: boolean;
    nowait?: boolean;
    host?: string;
    port?: number;
    id?: string;
  }>;
  console?: string;

  // Monitor Configuration
  monitor?: {
    type?: 'stdio' | 'vc' | 'tcp' | 'telnet' | 'unix' | 'none';
    host?: string;
    port?: number;
    path?: string;
    server?: boolean;
    nowait?: boolean;
  };
  qmp?: {
    type?: 'tcp' | 'unix' | 'stdio';
    host?: string;
    port?: number;
    path?: string;
    server?: boolean;
    nowait?: boolean;
  };

  // Snapshot Configuration
  snapshot?: boolean;
  loadvm?: string;

  // Migration Configuration
  incoming?: string;

  // Advanced Configuration
  noShutdown?: boolean;
  noReboot?: boolean;
  noDefaults?: boolean;
  noUserConfig?: boolean;

  // Security Configuration
  sandbox?: 'on' | 'off' | 'obsolete';

  // Debugging Configuration
  gdb?: string;
  gdbPort?: number;
  debugOptions?: string[];
  trace?: string[];

  // BIOS/UEFI Configuration
  bios?: string;
  L1TF?: 'off' | 'on' | 'auto';

  // NUMA Configuration
  numa?: Array<{
    nodeid?: number;
    cpus?: string;
    mem?: string;
    memdev?: string;
    policy?: 'default' | 'preferred' | 'bind' | 'interleave';
  }>;

  // Object Configuration
  objects?: Array<{
    type: string;
    id: string;
    [key: string]: any;
  }>;

  // Device Configuration
  devices?: Array<{
    driver: string;
    id?: string;
    bus?: string;
    addr?: string;
    [key: string]: any;
  }>;

  // QEMU Binary Configuration
  qemuBinary?: string;
  qemuSystem?: string;

  // Runtime Options
  runInBackground?: boolean;
  pidFile?: string;
  daemonize?: boolean;

  // Logging Configuration
  logFile?: string;
  logLevel?: 'debug' | 'info' | 'warning' | 'error';
  dTrace?: boolean;

  // Performance Options
  enableIOThread?: boolean;
  memoryPreallocation?: boolean;
  hugepageMemoryPath?: string;
  kernelIrqchip?: 'on' | 'off' | 'split';

  // Windows Specific
  windowsBootDrive?: string;

  // Custom Arguments
  customArgs?: string[];

  // Environment Variables
  environment?: Record<string, string>;
}

/**
 * QEMU Protocol Implementation
 *
 * Provides QEMU virtual machine management and console access
 * Supports full VM lifecycle, hardware configuration, monitoring, and debugging
 */
export class QEMUProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'qemu';
  public readonly capabilities: ProtocolCapabilities;

  private qemuProcesses = new Map<string, ChildProcess>();

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
        uptime: 0,
      },
      dependencies: {},
    };
  }

  constructor() {
    super('qemu');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: false,
      supportsEncryption: true,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 50, // QEMU can run multiple VMs
      defaultTimeout: 120000, // VM operations can take time
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['none'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true,
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if QEMU is available
      await this.checkQEMUAvailability();
      this.isInitialized = true;
      this.logger.info(
        'QEMU protocol initialized with production VM management features'
      );
    } catch (error: any) {
      this.logger.error('Failed to initialize QEMU protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `qemu-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const fullCommand =
      args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const qemuProcess = this.qemuProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!qemuProcess || !qemuProcess.stdin || !session) {
      throw new Error(`No active QEMU session: ${sessionId}`);
    }

    qemuProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to QEMU session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const qemuProcess = this.qemuProcesses.get(sessionId);
      if (qemuProcess) {
        // Try graceful shutdown first
        qemuProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (qemuProcess && !qemuProcess.killed) {
            qemuProcess.kill('SIGKILL');
          }
        }, 10000);

        this.qemuProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`QEMU session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing QEMU session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const qemuOptions = options as QEMUConnectionOptions;

    // Build QEMU command
    const qemuCommand = this.buildQEMUCommand(qemuOptions);

    // Spawn QEMU process
    const qemuProcess = spawn(qemuCommand[0], qemuCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(qemuOptions),
        ...options.env,
      },
    });

    // Set up output handling
    qemuProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    qemuProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    qemuProcess.on('error', (error) => {
      this.logger.error(`QEMU process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    qemuProcess.on('close', (code) => {
      this.logger.info(
        `QEMU process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.qemuProcesses.set(sessionId, qemuProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: qemuCommand[0],
      args: qemuCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(qemuOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: qemuProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `QEMU session ${sessionId} created for VM ${qemuOptions.vmName || 'unnamed'}`
    );
    this.emit('session-created', { sessionId, type: 'qemu', session });

    return session;
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    return outputs.map((output) => output.data).join('');
  }

  // Missing IProtocol methods for compatibility
  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.status === 'running'
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
      isOneShot: false, // VM sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {},
    };
  }

  async handleError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorRecoveryResult> {
    this.logger.error(
      `Error in QEMU session ${context.sessionId}: ${error.message}`
    );

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message,
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const qemuProcess = this.qemuProcesses.get(sessionId);
    return (qemuProcess && !qemuProcess.killed) || false;
  }

  getResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        used: memUsage.heapUsed,
        available: memUsage.heapTotal,
        peak: memUsage.heapTotal,
      },
      cpu: {
        usage: cpuUsage.user + cpuUsage.system,
        load: [0, 0, 0],
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.qemuProcesses.size,
      },
      storage: {
        bytesRead: 0,
        bytesWritten: 0,
      },
      sessions: {
        active: this.sessions.size,
        total: this.sessions.size,
        peak: this.sessions.size,
      },
    };
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkQEMUAvailability();
      return {
        ...baseStatus,
        dependencies: {
          qemu: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `QEMU not available: ${error}`],
        dependencies: {
          qemu: { available: false },
        },
      };
    }
  }

  private async checkQEMUAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('qemu-system-x86_64', ['--version'], {
        stdio: 'pipe',
      });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('QEMU not found. Please install QEMU.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('QEMU not found. Please install QEMU.'));
      });
    });
  }

  private buildQEMUCommand(options: QEMUConnectionOptions): string[] {
    const command = [];

    // QEMU binary
    if (options.qemuBinary) {
      command.push(options.qemuBinary);
    } else if (options.qemuSystem) {
      command.push(options.qemuSystem);
    } else {
      const arch = options.architecture || 'x86_64';
      command.push(`qemu-system-${arch}`);
    }

    // Machine type
    if (options.machineType) {
      command.push('-machine', options.machineType);
    }

    // Accelerator
    if (options.accelerator) {
      command.push('-accel', options.accelerator);
    }

    // Memory
    if (options.memory) {
      command.push(
        '-m',
        typeof options.memory === 'number'
          ? options.memory.toString()
          : options.memory
      );
    }

    // CPU
    if (options.cpu) {
      command.push('-cpu', options.cpu);
    }

    if (options.smp) {
      command.push('-smp', options.smp);
    } else if (options.cpuCount) {
      let smpConfig = options.cpuCount.toString();
      if (options.cpuSockets) smpConfig += `,sockets=${options.cpuSockets}`;
      if (options.cpuCores) smpConfig += `,cores=${options.cpuCores}`;
      if (options.cpuThreads) smpConfig += `,threads=${options.cpuThreads}`;
      command.push('-smp', smpConfig);
    }

    // Boot configuration
    if (options.bootOrder) {
      command.push('-boot', options.bootOrder);
    }

    if (options.kernel) {
      command.push('-kernel', options.kernel);
    }

    if (options.initrd) {
      command.push('-initrd', options.initrd);
    }

    if (options.append) {
      command.push('-append', options.append);
    }

    // Storage devices
    if (options.drives) {
      options.drives.forEach((drive, index) => {
        let driveConfig = `file=${drive.file}`;
        if (drive.format) driveConfig += `,format=${drive.format}`;
        if (drive.interface) driveConfig += `,if=${drive.interface}`;
        if (drive.media) driveConfig += `,media=${drive.media}`;
        if (drive.index !== undefined) driveConfig += `,index=${drive.index}`;
        if (drive.cache) driveConfig += `,cache=${drive.cache}`;
        if (drive.aio) driveConfig += `,aio=${drive.aio}`;
        if (drive.readonly) driveConfig += ',readonly=on';
        if (drive.snapshot) driveConfig += ',snapshot=on';
        if (drive.bootindex !== undefined)
          driveConfig += `,bootindex=${drive.bootindex}`;
        if (drive.serial) driveConfig += `,serial=${drive.serial}`;

        command.push('-drive', driveConfig);
      });
    }

    // Network devices
    if (options.networkDevices) {
      options.networkDevices.forEach((net) => {
        let netConfig = '';
        if (net.type) netConfig += net.type;
        if (net.id) netConfig += `,id=${net.id}`;
        if (net.ifname) netConfig += `,ifname=${net.ifname}`;
        if (net.script) netConfig += `,script=${net.script}`;
        if (net.br) netConfig += `,br=${net.br}`;

        if (netConfig) {
          command.push('-netdev', netConfig);
        }

        if (net.model) {
          let deviceConfig = net.model;
          if (net.mac) deviceConfig += `,mac=${net.mac}`;
          if (net.id) deviceConfig += `,netdev=${net.id}`;
          if (net.bootindex !== undefined)
            deviceConfig += `,bootindex=${net.bootindex}`;
          command.push('-device', deviceConfig);
        }
      });
    }

    // Display
    if (options.display) {
      command.push('-display', options.display);
    }

    if (options.nographic) {
      command.push('-nographic');
    }

    if (options.vga) {
      command.push('-vga', options.vga);
    }

    // VNC
    if (options.vncDisplay) {
      let vncConfig = options.vncDisplay;
      if (options.vncPassword) vncConfig += `,password=${options.vncPassword}`;
      if (options.vncWebsocket)
        vncConfig += `,websocket=${options.vncWebsocket}`;
      command.push('-vnc', vncConfig);
    }

    // Serial ports
    if (options.serial) {
      options.serial.forEach((serial) => {
        let serialConfig: string = serial.type || 'stdio';
        if (serial.path)
          serialConfig = `${serial.type || 'unix'}:${serial.path}`;
        command.push('-serial', serialConfig);
      });
    }

    // Monitor
    if (options.monitor) {
      let monConfig: string = options.monitor.type || 'stdio';
      if (options.monitor.host && options.monitor.port) {
        monConfig = `tcp:${options.monitor.host}:${options.monitor.port}`;
        if (options.monitor.server) monConfig += ',server';
        if (options.monitor.nowait) monConfig += ',nowait';
      } else if (options.monitor.path) {
        monConfig = `unix:${options.monitor.path}`;
        if (options.monitor.server) monConfig += ',server';
        if (options.monitor.nowait) monConfig += ',nowait';
      }
      command.push('-monitor', monConfig);
    }

    // QMP
    if (options.qmp) {
      let qmpConfig = '';
      if (options.qmp.host && options.qmp.port) {
        qmpConfig = `tcp:${options.qmp.host}:${options.qmp.port}`;
      } else if (options.qmp.path) {
        qmpConfig = `unix:${options.qmp.path}`;
      }
      if (options.qmp.server) qmpConfig += ',server';
      if (options.qmp.nowait) qmpConfig += ',nowait';
      if (qmpConfig) {
        command.push('-qmp', qmpConfig);
      }
    }

    // Snapshot
    if (options.snapshot) {
      command.push('-snapshot');
    }

    if (options.loadvm) {
      command.push('-loadvm', options.loadvm);
    }

    // Advanced options
    if (options.noShutdown) {
      command.push('-no-shutdown');
    }

    if (options.noReboot) {
      command.push('-no-reboot');
    }

    if (options.noDefaults) {
      command.push('-nodefaults');
    }

    // Debugging
    if (options.gdb) {
      command.push('-gdb', options.gdb);
    }

    if (options.debugOptions) {
      options.debugOptions.forEach((opt) => command.push('-d', opt));
    }

    // Custom arguments
    if (options.customArgs) {
      command.push(...options.customArgs);
    }

    return command;
  }

  private buildEnvironment(
    options: QEMUConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // QEMU environment variables
    if (options.logLevel) {
      env.QEMU_LOG = options.logLevel;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up QEMU protocol');

    // Close all QEMU processes
    for (const [sessionId, process] of Array.from(this.qemuProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing QEMU process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.qemuProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default QEMUProtocol;
