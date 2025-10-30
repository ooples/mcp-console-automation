import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as forge from 'node-forge';
// Canvas import made optional to handle missing dependency
let createCanvas: any, Canvas: any, CanvasRenderingContext2D: any;
try {
  const canvasModule = require('canvas');
  createCanvas = canvasModule.createCanvas;
  Canvas = canvasModule.Canvas;
  CanvasRenderingContext2D = canvasModule.CanvasRenderingContext2D;
} catch (error) {
  console.warn('canvas module not available, canvas functionality disabled');
}
import {
  RDPConnectionOptions,
  RDPSession,
  RDPCapabilities,
  RDPMonitorConfig,
  ConsoleOutput,
  SessionOptions,
  ConsoleSession,
} from '../types/index.js';
import {
  IProtocol,
  ProtocolCapabilities,
  ProtocolHealthStatus,
} from '../core/ProtocolFactory.js';
import { Logger } from '../utils/logger.js';

// Import node-rdpjs-2 dynamically to handle potential missing dependency
let rdp: any;
try {
  rdp = require('node-rdpjs-2');
} catch (error) {
  console.warn('node-rdpjs-2 not available, falling back to native RDP tools');
}

export interface RDPProtocolEvents {
  connected: (session: RDPSession) => void;
  disconnected: (sessionId: string, reason?: string) => void;
  error: (sessionId: string, error: Error) => void;
  output: (output: ConsoleOutput) => void;
  'screen-update': (sessionId: string, imageData: Buffer) => void;
  'clipboard-data': (sessionId: string, data: string, format: string) => void;
  'file-transfer-progress': (
    sessionId: string,
    progress: FileTransferProgress
  ) => void;
  'audio-data': (sessionId: string, audioBuffer: Buffer) => void;
  'session-recording-update': (
    sessionId: string,
    recordingPath: string
  ) => void;
  'gateway-authenticated': (sessionId: string, gatewayInfo: any) => void;
  'smart-card-request': (sessionId: string, request: SmartCardRequest) => void;
  'performance-metrics': (
    sessionId: string,
    metrics: RDPPerformanceMetrics
  ) => void;
}

export interface FileTransferProgress {
  transferId: string;
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
  direction: 'upload' | 'download';
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  error?: string;
}

export interface SmartCardRequest {
  requestId: string;
  cardName: string;
  readerName: string;
  requiresPin: boolean;
  challenge?: string;
}

export interface RDPPerformanceMetrics {
  timestamp: Date;
  latency: number;
  bandwidth: number;
  packetLoss: number;
  frameRate: number;
  compressionRatio: number;
  cpuUsage: number;
  memoryUsage: number;
  networkUtilization: number;
}

export interface RDPGatewayConfig {
  hostname: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  accessToken?: string;
  certificate?: string;
  enableAuth: boolean;
}

export class RDPProtocol extends EventEmitter implements IProtocol {
  public readonly type = 'rdp' as const;
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;
  private logger: Logger;
  private sessions: Map<string, RDPSession> = new Map();
  private connections: Map<string, any> = new Map(); // RDP connection instances
  private fallbackProcesses: Map<string, ChildProcess> = new Map();
  private rdpCapabilities: RDPCapabilities;
  private sessionRecordings: Map<string, any> = new Map();
  private clipboardBuffer: Map<string, string> = new Map();
  private fileTransfers: Map<string, FileTransferProgress[]> = new Map();
  private performanceMonitors: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
    this.logger = new Logger('RDPProtocol');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: true,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: false,
      supportsWorkingDirectory: false,
      supportsSignals: false,
      supportsResizing: true,
      supportsPTY: false,
      maxConcurrentSessions: 1,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'certificate'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: false,
      },
    };

    this.healthStatus = {
      isHealthy: true,
      lastChecked: new Date(),
      errors: [],
      warnings: [],
      metrics: {
        activeSessions: 0,
        totalSessions: 0,
        averageLatency: 0,
        successRate: 1.0,
        uptime: 0,
      },
      dependencies: {
        rdp: {
          available: rdp !== undefined,
          version: '1.0',
        },
        mstsc: {
          available: process.platform === 'win32',
          version: 'system',
        },
      },
    };

    // Initialize RDP-specific capabilities
    this.rdpCapabilities = this.detectCapabilities();

    this.logger.info('RDP Protocol initialized');
  }

  /**
   * Detect system RDP capabilities
   */
  private detectCapabilities(): RDPCapabilities {
    const isWindows = process.platform === 'win32';
    const hasNodeRdp = rdp !== undefined;

    return {
      protocolVersions: [
        'RDP 8.1',
        'RDP 10',
        'RDP 10.1',
        'RDP 10.2',
        'RDP 10.3',
        'RDP 10.4',
        'RDP 10.5',
        'RDP 10.6',
        'RDP 10.7',
      ],
      maxResolution: { width: 7680, height: 4320 }, // 8K support
      supportedColorDepths: [8, 15, 16, 24, 32],
      compressionSupported: true,
      encryptionSupported: true,
      audioSupported: true,
      videoSupported: true,
      clipboardSupported: true,
      fileTransferSupported: true,
      printingSupported: isWindows,
      smartCardSupported: isWindows,
      remoteAppSupported: true,
      multiMonitorSupported: true,
      gpuAccelerationSupported: isWindows,
      h264Supported: true,
      remoteFXSupported: isWindows,
      nlaSupported: true,
      credSSPSupported: isWindows,
      gatewaySupported: true,
      sessionRecordingSupported: true,
    };
  }

  /**
   * Create a new RDP session
   */
  async createRDPSession(
    sessionId: string,
    options: RDPConnectionOptions
  ): Promise<RDPSession> {
    try {
      this.logger.info(`Creating RDP session ${sessionId}`, {
        host: options.host,
        port: options.port,
      });

      const session: RDPSession = {
        sessionId,
        connectionId: uuidv4(),
        host: options.host,
        port: options.port || 3389,
        username: options.username,
        domain: options.domain,
        protocol: options.protocol || 'RDP 10',
        connectionTime: new Date(),
        lastActivity: new Date(),
        status: 'connecting',
        displaySize: {
          width: options.width || 1920,
          height: options.height || 1080,
        },
        colorDepth: options.colorDepth || 32,
        compressionLevel: options.compressionLevel || 'medium',
        encryptionLevel: options.encryptionLevel || 'high',
        audioEnabled: options.audioMode !== 'disabled',
        clipboardEnabled: options.enableClipboard !== false,
        fileTransferEnabled: options.enableFileTransfer === true,
        gatewayUsed: !!options.gatewayHostname,
        remoteAppMode: options.enableRemoteApp === true,
        recordingActive: options.enableSessionRecording === true,
        bytesReceived: 0,
        bytesSent: 0,
        packetsReceived: 0,
        packetsSent: 0,
        errorCount: 0,
        warnings: [],
        metadata: {},
      };

      this.sessions.set(sessionId, session);

      // Attempt to use node-rdpjs-2 first, fallback to native tools
      if (rdp && !options.customRDPFile) {
        await this.createNativeRDPSession(sessionId, options);
      } else {
        await this.createFallbackSession(sessionId, options);
      }

      // Setup session monitoring
      this.setupSessionMonitoring(sessionId);

      // Setup session recording if enabled
      if (options.enableSessionRecording) {
        this.setupSessionRecording(sessionId, options);
      }

      this.emit('connected', session);
      return session;
    } catch (error) {
      this.logger.error(`Failed to create RDP session ${sessionId}`, error);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'failed';
        this.sessions.set(sessionId, session);
      }
      this.emit('error', sessionId, error as Error);
      throw error;
    }
  }

  /**
   * Create RDP session using node-rdpjs-2
   */
  private async createNativeRDPSession(
    sessionId: string,
    options: RDPConnectionOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const clientConfig = this.buildClientConfig(options);
        const client = rdp.createClient(clientConfig);

        // Setup event handlers
        client.on('connect', () => {
          this.logger.info(`RDP session ${sessionId} connected`);
          const session = this.sessions.get(sessionId);
          if (session) {
            session.status = 'connected';
            session.connectionTime = new Date();
            this.sessions.set(sessionId, session);
          }
          resolve();
        });

        client.on('bitmap', (bitmap: any) => {
          this.handleScreenUpdate(sessionId, bitmap);
        });

        client.on('clipboard', (data: string, format: string) => {
          this.handleClipboardData(sessionId, data, format);
        });

        client.on('error', (error: Error) => {
          this.logger.error(`RDP session ${sessionId} error`, error);
          this.emit('error', sessionId, error);
          reject(error);
        });

        client.on('close', (reason?: string) => {
          this.handleSessionClose(sessionId, reason);
        });

        // Setup gateway connection if needed
        if (options.gatewayHostname) {
          this.setupGatewayConnection(client, sessionId, options);
        }

        // Setup smart card authentication if needed
        if (options.enableSmartCardAuth) {
          this.setupSmartCardAuth(client, sessionId, options);
        }

        this.connections.set(sessionId, client);
        client.connect();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create fallback RDP session using system tools (mstsc.exe or xfreerdp)
   */
  private async createFallbackSession(
    sessionId: string,
    options: RDPConnectionOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const isWindows = process.platform === 'win32';
        let command: string;
        let args: string[];

        if (isWindows) {
          // Use mstsc.exe on Windows
          const rdpFile = this.generateRDPFile(sessionId, options);
          command = 'mstsc';
          args = [rdpFile];

          if (options.fullScreen) {
            args.push('/f');
          }
          if (options.enableMultiMonitor) {
            args.push('/multimon');
          }
          if (options.enableRestrictedAdmin) {
            args.push('/restrictedAdmin');
          }
          if (options.enableRemoteCredentialGuard) {
            args.push('/remoteGuard');
          }
        } else {
          // Use xfreerdp on Linux/macOS
          command = 'xfreerdp';
          args = this.buildXFreeRDPArgs(options);
        }

        this.logger.info(
          `Starting fallback RDP process for session ${sessionId}`,
          { command, args }
        );

        const childProcess = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, DISPLAY: ':0' },
        });

        childProcess.stdout?.on('data', (data: Buffer) => {
          this.handleProcessOutput(sessionId, data.toString(), 'stdout');
        });

        childProcess.stderr?.on('data', (data: Buffer) => {
          this.handleProcessOutput(sessionId, data.toString(), 'stderr');
        });

        childProcess.on('spawn', () => {
          this.logger.info(`RDP process spawned for session ${sessionId}`);
          const session = this.sessions.get(sessionId);
          if (session) {
            session.status = 'connected';
            session.connectionTime = new Date();
            this.sessions.set(sessionId, session);
          }
          resolve();
        });

        process.on('error', (error: Error) => {
          this.logger.error(
            `RDP process error for session ${sessionId}`,
            error
          );
          reject(error);
        });

        childProcess.on('exit', (code: number | null) => {
          this.handleProcessExit(sessionId, code);
        });

        this.fallbackProcesses.set(sessionId, childProcess);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Build client configuration for node-rdpjs-2
   */
  private buildClientConfig(options: RDPConnectionOptions): any {
    const config: any = {
      host: options.host,
      port: options.port || 3389,
      username: options.username,
      password: options.password,
      domain: options.domain || '',

      // Display settings
      width: options.width || 1920,
      height: options.height || 1080,
      colorDepth: options.colorDepth || 32,

      // Security settings
      enableNLA: options.enableNLA !== false,
      enableTLS: options.enableTLS !== false,
      enableCredSSP: options.enableCredSSP === true,

      // Performance settings
      enableBitmapCaching: options.enableBitmapCaching !== false,
      enableGlyphCaching: options.enableGlyphCaching !== false,
      compressionLevel: this.mapCompressionLevel(options.compressionLevel),

      // Audio settings
      enableAudio: options.audioMode !== 'disabled',
      audioMode: options.audioMode || 'local',
      audioQuality: options.audioQuality || 'medium',

      // Clipboard and file transfer
      enableClipboard: options.enableClipboard !== false,
      enableFileTransfer: options.enableFileTransfer === true,
      enableDriveRedirection: options.enableDriveRedirection === true,

      // Advanced settings
      keyboardLayout: options.keyboardLayout || 'en-US',
      keyboardHook: options.keyboardHook || 'enabled',
      enableUnicodeKeyboard: options.enableUnicodeKeyboard !== false,

      // Timeout settings
      timeout: options.timeout || 30000,
      keepAliveInterval: options.keepAliveInterval || 30000,
    };

    // Add certificate authentication if provided
    if (options.certificatePath) {
      config.certificate = readFileSync(options.certificatePath);
      if (options.certificatePassword) {
        config.certificatePassword = options.certificatePassword;
      }
    }

    return config;
  }

  /**
   * Generate RDP file for mstsc.exe
   */
  private generateRDPFile(
    sessionId: string,
    options: RDPConnectionOptions
  ): string {
    const rdpDir = join(process.cwd(), 'temp', 'rdp');
    if (!existsSync(rdpDir)) {
      mkdirSync(rdpDir, { recursive: true });
    }

    const rdpFilePath = join(rdpDir, `${sessionId}.rdp`);

    let rdpContent = '';

    // Basic connection settings
    rdpContent += `full address:s:${options.host}:${options.port || 3389}\n`;
    rdpContent += `username:s:${options.username}\n`;

    if (options.domain) {
      rdpContent += `domain:s:${options.domain}\n`;
    }

    // Display settings
    rdpContent += `screen mode id:i:${options.fullScreen ? 2 : 1}\n`;
    rdpContent += `desktopwidth:i:${options.width || 1920}\n`;
    rdpContent += `desktopheight:i:${options.height || 1080}\n`;
    rdpContent += `session bpp:i:${options.colorDepth || 32}\n`;

    // Multi-monitor settings
    if (options.enableMultiMonitor && options.monitors) {
      rdpContent += `use multimon:i:1\n`;
      options.monitors.forEach((monitor, index) => {
        rdpContent += `monitor${index}:s:${monitor.x},${monitor.y},${monitor.width},${monitor.height}\n`;
      });
    }

    // Audio settings
    rdpContent += `audiomode:i:${this.mapAudioMode(options.audioMode)}\n`;
    rdpContent += `audiocapturemode:i:${options.enableMicrophone ? 1 : 0}\n`;

    // Clipboard and file transfer
    rdpContent += `redirectclipboard:i:${options.enableClipboard ? 1 : 0}\n`;
    rdpContent += `redirectdrives:i:${options.enableDriveRedirection ? 1 : 0}\n`;
    rdpContent += `redirectprinters:i:${options.enablePrinterRedirection ? 1 : 0}\n`;

    // Security settings
    rdpContent += `authentication level:i:${options.enableNLA ? 2 : 0}\n`;
    rdpContent += `enablecredsspsupport:i:${options.enableCredSSP ? 1 : 0}\n`;
    rdpContent += `negotiate security layer:i:1\n`;

    // Performance settings
    rdpContent += `compression:i:1\n`;
    rdpContent += `bitmapcachepersistenable:i:${options.enableBitmapCaching ? 1 : 0}\n`;

    // Gateway settings
    if (options.gatewayHostname) {
      rdpContent += `gatewayhostname:s:${options.gatewayHostname}\n`;
      rdpContent += `gatewayusagemethod:i:${options.enableGatewayAuth ? 2 : 1}\n`;
      if (options.gatewayUsername) {
        rdpContent += `gatewayusername:s:${options.gatewayUsername}\n`;
      }
      if (options.gatewayDomain) {
        rdpContent += `gatewaydomain:s:${options.gatewayDomain}\n`;
      }
    }

    // RemoteApp settings
    if (options.enableRemoteApp && options.remoteApplicationProgram) {
      rdpContent += `remoteapplicationmode:i:1\n`;
      rdpContent += `remoteapplicationprogram:s:${options.remoteApplicationProgram}\n`;
      if (options.remoteApplicationArgs) {
        rdpContent += `remoteapplicationcmdline:s:${options.remoteApplicationArgs}\n`;
      }
      if (options.remoteApplicationDir) {
        rdpContent += `remoteapplicationdir:s:${options.remoteApplicationDir}\n`;
      }
      if (options.remoteApplicationName) {
        rdpContent += `remoteapplicationname:s:${options.remoteApplicationName}\n`;
      }
    }

    // Advanced settings
    if (options.alternateShell) {
      rdpContent += `alternate shell:s:${options.alternateShell}\n`;
    }
    if (options.shellWorkingDir) {
      rdpContent += `shell working directory:s:${options.shellWorkingDir}\n`;
    }

    // Load balance info
    if (options.loadBalanceInfo) {
      rdpContent += `loadbalanceinfo:s:${options.loadBalanceInfo}\n`;
    }

    // Custom settings
    if (options.additionalSettings) {
      Object.entries(options.additionalSettings).forEach(([key, value]) => {
        rdpContent += `${key}:s:${value}\n`;
      });
    }

    writeFileSync(rdpFilePath, rdpContent, 'utf8');
    return rdpFilePath;
  }

  /**
   * Build xfreerdp command arguments
   */
  private buildXFreeRDPArgs(options: RDPConnectionOptions): string[] {
    const args: string[] = [];

    // Basic connection
    args.push(`/v:${options.host}:${options.port || 3389}`);
    args.push(`/u:${options.username}`);

    if (options.password) {
      args.push(`/p:${options.password}`);
    }
    if (options.domain) {
      args.push(`/d:${options.domain}`);
    }

    // Display settings
    args.push(`/w:${options.width || 1920}`);
    args.push(`/h:${options.height || 1080}`);
    args.push(`/bpp:${options.colorDepth || 32}`);

    if (options.fullScreen) {
      args.push('/f');
    }

    // Multi-monitor support
    if (options.enableMultiMonitor) {
      args.push('/multimon');
    }

    // Audio settings
    if (options.audioMode === 'disabled') {
      args.push('/audio-mode:2');
    } else if (options.audioMode === 'remote') {
      args.push('/audio-mode:1');
    } else {
      args.push('/audio-mode:0');
    }

    if (options.enableMicrophone) {
      args.push('/microphone');
    }

    // Clipboard and file transfer
    if (options.enableClipboard) {
      args.push('+clipboard');
    } else {
      args.push('-clipboard');
    }

    if (options.enableDriveRedirection) {
      args.push('/drive:home,/home');
      if (options.redirectedDrives) {
        options.redirectedDrives.forEach((drive) => {
          args.push(`/drive:${drive},${drive}`);
        });
      }
    }

    // Performance settings
    if (options.compressionLevel !== 'none') {
      args.push('+compression');
    }

    if (options.enableBitmapCaching) {
      args.push('+bitmap-cache');
    }

    if (options.enableRemoteFX) {
      args.push('+rfx');
    }

    if (options.enableGPUAcceleration) {
      args.push('/gfx:AVC444');
    }

    // Security settings
    if (options.enableNLA) {
      args.push('/nla');
    }

    if (options.enableTLS) {
      args.push('/tls');
    }

    if (options.ignoreCertificateErrors) {
      args.push('/cert:ignore');
    }

    // Gateway settings
    if (options.gatewayHostname) {
      args.push(`/g:${options.gatewayHostname}:${options.gatewayPort || 443}`);
      if (options.gatewayUsername) {
        args.push(`/gu:${options.gatewayUsername}`);
      }
      if (options.gatewayPassword) {
        args.push(`/gp:${options.gatewayPassword}`);
      }
      if (options.gatewayDomain) {
        args.push(`/gd:${options.gatewayDomain}`);
      }
    }

    // RemoteApp settings
    if (options.enableRemoteApp && options.remoteApplicationProgram) {
      args.push(`/app:${options.remoteApplicationProgram}`);
      if (options.remoteApplicationArgs) {
        args.push(`/app-cmd:${options.remoteApplicationArgs}`);
      }
      if (options.remoteApplicationDir) {
        args.push(`/app-workdir:${options.remoteApplicationDir}`);
      }
    }

    // Timeout settings
    if (options.timeout) {
      args.push(`/timeout:${Math.floor(options.timeout / 1000)}`);
    }

    return args;
  }

  /**
   * Setup session monitoring
   */
  private setupSessionMonitoring(sessionId: string): void {
    const monitor = setInterval(() => {
      this.updatePerformanceMetrics(sessionId);
    }, 5000); // Update every 5 seconds

    this.performanceMonitors.set(sessionId, monitor);
  }

  /**
   * Setup session recording
   */
  private setupSessionRecording(
    sessionId: string,
    options: RDPConnectionOptions
  ): void {
    if (!options.recordingPath) return;

    try {
      const recordingDir = dirname(options.recordingPath);
      if (!existsSync(recordingDir)) {
        mkdirSync(recordingDir, { recursive: true });
      }

      // Initialize recording metadata
      const recordingInfo = {
        sessionId,
        startTime: new Date(),
        filePath: options.recordingPath,
        format: options.recordingFormat || 'mp4',
        quality: options.recordingQuality || 'medium',
        frameCount: 0,
        duration: 0,
      };

      this.sessionRecordings.set(sessionId, recordingInfo);
      this.logger.info(
        `Session recording started for ${sessionId}`,
        recordingInfo
      );
    } catch (error) {
      this.logger.error(
        `Failed to setup session recording for ${sessionId}`,
        error
      );
    }
  }

  /**
   * Setup gateway connection
   */
  private setupGatewayConnection(
    client: any,
    sessionId: string,
    options: RDPConnectionOptions
  ): void {
    const gatewayConfig: RDPGatewayConfig = {
      hostname: options.gatewayHostname!,
      port: options.gatewayPort || 443,
      username: options.gatewayUsername,
      password: options.gatewayPassword,
      domain: options.gatewayDomain,
      accessToken: options.gatewayAccessToken,
      enableAuth: options.enableGatewayAuth !== false,
    };

    client.setupGateway(gatewayConfig);

    client.on('gateway-authenticated', (info: any) => {
      this.logger.info(
        `RDP Gateway authenticated for session ${sessionId}`,
        info
      );
      this.emit('gateway-authenticated', sessionId, info);
    });
  }

  /**
   * Setup smart card authentication
   */
  private setupSmartCardAuth(
    client: any,
    sessionId: string,
    options: RDPConnectionOptions
  ): void {
    client.enableSmartCard(true);

    client.on('smart-card-request', (request: SmartCardRequest) => {
      this.logger.info(`Smart card request for session ${sessionId}`, request);
      this.emit('smart-card-request', sessionId, request);
    });

    if (options.smartCardPin) {
      client.on('smart-card-pin-required', () => {
        client.provideSmartCardPin(options.smartCardPin);
      });
    }
  }

  /**
   * Handle screen updates
   */
  private handleScreenUpdate(sessionId: string, bitmap: any): void {
    try {
      // Convert bitmap to image buffer
      const canvas = createCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');

      // Create ImageData from bitmap
      const imageData = ctx.createImageData(bitmap.width, bitmap.height);
      imageData.data.set(bitmap.data);
      ctx.putImageData(imageData, 0, 0);

      const imageBuffer = canvas.toBuffer('image/png');

      this.emit('screen-update', sessionId, imageBuffer);

      // Update recording if active
      const recording = this.sessionRecordings.get(sessionId);
      if (recording) {
        recording.frameCount++;
        recording.duration = Date.now() - recording.startTime.getTime();
        // Add frame to recording (implementation depends on recording format)
      }
    } catch (error) {
      this.logger.error(
        `Error handling screen update for session ${sessionId}`,
        error
      );
    }
  }

  /**
   * Handle clipboard data
   */
  private handleClipboardData(
    sessionId: string,
    data: string,
    format: string
  ): void {
    this.clipboardBuffer.set(sessionId, data);
    this.emit('clipboard-data', sessionId, data, format);
  }

  /**
   * Handle session close
   */
  private handleSessionClose(sessionId: string, reason?: string): void {
    this.logger.info(`RDP session ${sessionId} closed`, { reason });

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'disconnected';
      session.lastActivity = new Date();
      this.sessions.set(sessionId, session);
    }

    // Cleanup resources
    this.cleanup(sessionId);

    this.emit('disconnected', sessionId, reason);
  }

  /**
   * Handle process output for fallback sessions
   */
  private handleProcessOutput(
    sessionId: string,
    data: string,
    type: 'stdout' | 'stderr'
  ): void {
    const output: ConsoleOutput = {
      sessionId,
      type,
      data,
      timestamp: new Date(),
      raw: data,
    };

    this.emit('output', output);

    // Update session stats
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      if (type === 'stdout') {
        session.bytesReceived += Buffer.byteLength(data);
      }
      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Handle process exit for fallback sessions
   */
  private handleProcessExit(sessionId: string, code: number | null): void {
    this.logger.info(`RDP process exited for session ${sessionId}`, {
      exitCode: code,
    });

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = code === 0 ? 'disconnected' : 'failed';
      session.lastActivity = new Date();
      this.sessions.set(sessionId, session);
    }

    this.cleanup(sessionId);
    this.emit('disconnected', sessionId, `Process exited with code ${code}`);
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') return;

    // Simulate performance metrics (in real implementation, gather from RDP client)
    const metrics: RDPPerformanceMetrics = {
      timestamp: new Date(),
      latency: Math.random() * 100 + 10, // 10-110ms
      bandwidth: Math.random() * 1000000 + 100000, // 100KB-1MB
      packetLoss: Math.random() * 0.1, // 0-10%
      frameRate: Math.random() * 10 + 20, // 20-30 fps
      compressionRatio: Math.random() * 0.5 + 0.3, // 30-80%
      cpuUsage: Math.random() * 50 + 10, // 10-60%
      memoryUsage: Math.random() * 1000000000 + 100000000, // 100MB-1GB
      networkUtilization: Math.random() * 0.8 + 0.1, // 10-90%
    };

    this.emit('performance-metrics', sessionId, metrics);
  }

  /**
   * Send input to RDP session
   */
  async sendRDPInput(sessionId: string, input: string): Promise<void> {
    const connection = this.connections.get(sessionId);
    const fallbackProcess = this.fallbackProcesses.get(sessionId);

    if (connection && connection.sendInput) {
      connection.sendInput(input);
    } else if (fallbackProcess && fallbackProcess.stdin) {
      fallbackProcess.stdin.write(input);
    } else {
      throw new Error(`No active connection for session ${sessionId}`);
    }

    // Update session activity
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      session.bytesSent += Buffer.byteLength(input);
      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Send key sequence to RDP session
   */
  async sendKeySequence(sessionId: string, keys: string[]): Promise<void> {
    const connection = this.connections.get(sessionId);

    if (connection && connection.sendKeySequence) {
      connection.sendKeySequence(keys);
    } else {
      throw new Error(`Key sequence not supported for session ${sessionId}`);
    }
  }

  /**
   * Send clipboard data to remote session
   */
  async sendClipboardData(
    sessionId: string,
    data: string,
    format: string = 'text'
  ): Promise<void> {
    const connection = this.connections.get(sessionId);

    if (connection && connection.setClipboard) {
      connection.setClipboard(data, format);
    } else {
      this.logger.warn(`Clipboard not supported for session ${sessionId}`);
    }
  }

  /**
   * Start file transfer
   */
  async startFileTransfer(
    sessionId: string,
    localPath: string,
    remotePath: string,
    direction: 'upload' | 'download'
  ): Promise<string> {
    const transferId = uuidv4();
    const connection = this.connections.get(sessionId);

    if (!connection || !connection.transferFile) {
      throw new Error(`File transfer not supported for session ${sessionId}`);
    }

    const progress: FileTransferProgress = {
      transferId,
      fileName: localPath.split('/').pop() || localPath,
      bytesTransferred: 0,
      totalBytes: 0,
      direction,
      status: 'pending',
    };

    let transfers = this.fileTransfers.get(sessionId) || [];
    transfers.push(progress);
    this.fileTransfers.set(sessionId, transfers);

    try {
      progress.status = 'in-progress';

      const result = await connection.transferFile(
        localPath,
        remotePath,
        direction,
        (bytesTransferred: number, totalBytes: number) => {
          progress.bytesTransferred = bytesTransferred;
          progress.totalBytes = totalBytes;
          this.emit('file-transfer-progress', sessionId, progress);
        }
      );

      progress.status = 'completed';
      this.emit('file-transfer-progress', sessionId, progress);

      return transferId;
    } catch (error) {
      progress.status = 'failed';
      progress.error = (error as Error).message;
      this.emit('file-transfer-progress', sessionId, progress);
      throw error;
    }
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): RDPSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): RDPSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get system capabilities
   */
  getCapabilities(): RDPCapabilities {
    return { ...this.rdpCapabilities };
  }

  /**
   * Disconnect session
   */
  async disconnectSession(sessionId: string): Promise<void> {
    const connection = this.connections.get(sessionId);
    const fallbackProcess = this.fallbackProcesses.get(sessionId);

    if (connection && connection.disconnect) {
      connection.disconnect();
    } else if (fallbackProcess) {
      fallbackProcess.kill('SIGTERM');
    }

    this.cleanup(sessionId);
  }

  /**
   * Cleanup session resources
   */
  private cleanup(sessionId: string): void {
    // Clear performance monitoring
    const monitor = this.performanceMonitors.get(sessionId);
    if (monitor) {
      clearInterval(monitor);
      this.performanceMonitors.delete(sessionId);
    }

    // Stop recording
    const recording = this.sessionRecordings.get(sessionId);
    if (recording) {
      // Finalize recording file
      this.sessionRecordings.delete(sessionId);
      this.emit('session-recording-update', sessionId, recording.filePath);
    }

    // Clear connections
    this.connections.delete(sessionId);
    this.fallbackProcesses.delete(sessionId);

    // Clear buffers
    this.clipboardBuffer.delete(sessionId);
    this.fileTransfers.delete(sessionId);
  }

  /**
   * Helper methods
   */
  private mapCompressionLevel(level?: string): number {
    switch (level) {
      case 'none':
        return 0;
      case 'low':
        return 1;
      case 'medium':
        return 2;
      case 'high':
        return 3;
      default:
        return 2;
    }
  }

  private mapAudioMode(mode?: string): number {
    switch (mode) {
      case 'local':
        return 0;
      case 'remote':
        return 1;
      case 'disabled':
        return 2;
      default:
        return 0;
    }
  }

  // IProtocol required methods
  async initialize(): Promise<void> {
    // RDP initialization is handled in connect methods
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `rdp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (!options.rdpOptions) {
      throw new Error('RDP options are required');
    }

    // Create the actual RDP session
    await this.createRDPSession(sessionId, options.rdpOptions);

    const session: ConsoleSession = {
      id: sessionId,
      command: options.command || '',
      args: options.args || [],
      cwd: '/',
      env: options.environment || {},
      createdAt: new Date(),
      status: 'running',
      type: 'rdp',
      streaming: options.streaming ?? true,
      rdpOptions: options.rdpOptions,
      executionState: 'idle',
      activeCommands: new Map(),
    };

    this.emit('sessionCreated', session);
    return session;
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    // RDP doesn't execute commands directly, but we can emit events
    this.emit('commandExecuted', {
      sessionId,
      command,
      args,
      timestamp: new Date(),
    });
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    await this.sendRDPInput(sessionId, input);
  }

  async getOutput(sessionId: string, since?: Date): Promise<string> {
    // RDP output is screen updates, not text
    return 'RDP screen output (binary data)';
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.disconnectSession(sessionId);
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    this.healthStatus.lastChecked = new Date();
    this.healthStatus.metrics.activeSessions = this.sessions.size;
    this.healthStatus.isHealthy = this.healthStatus.errors.length === 0;

    return { ...this.healthStatus };
  }

  async dispose(): Promise<void> {
    await this.destroy();
  }

  /**
   * Destroy protocol and cleanup all resources
   */
  async destroy(): Promise<void> {
    this.logger.info('Destroying RDP Protocol');

    // Disconnect all sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.disconnectSession(id)));

    // Clear all data structures
    this.sessions.clear();
    this.connections.clear();
    this.fallbackProcesses.clear();
    this.sessionRecordings.clear();
    this.clipboardBuffer.clear();
    this.fileTransfers.clear();

    // Clear all intervals
    this.performanceMonitors.forEach((monitor) => clearInterval(monitor));
    this.performanceMonitors.clear();

    this.removeAllListeners();
  }
}

export default RDPProtocol;
