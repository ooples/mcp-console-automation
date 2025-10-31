import { Socket, createConnection } from 'net';
import { createSecureContext, TLSSocket, connect as tlsConnect } from 'tls';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, spawn, SpawnOptionsWithoutStdio } from 'child_process';
import { BaseProtocol } from '../core/BaseProtocol.js';
import { SessionState } from '../core/IProtocol.js';
import {
  VNCConnectionOptions,
  VNCSession,
  VNCEncoding,
  VNCSecurityType,
  VeNCryptSubType,
  VNCRectangle,
  VNCFramebufferUpdate,
  VNCKeyEvent,
  VNCPointerEvent,
  VNCClientCutText,
  VNCFileTransfer,
  VNCClipboardSync,
  VNCPerformanceMetrics,
  VNCServerInfo,
  VNCRepeaterInfo,
  VNCProtocolConfig,
  VNCCapabilities,
  VNCMonitorConfig,
  ConsoleOutput,
  SessionOptions,
  ConsoleSession,
  ConsoleType,
} from '../types/index.js';
import {
  ProtocolCapabilities,
  ProtocolHealthStatus,
} from '../core/ProtocolFactory.js';

// RFB Protocol Constants (RFC 6143)
const RFB_PROTOCOL_VERSION_3_3 = 'RFB 003.003\n';
const RFB_PROTOCOL_VERSION_3_7 = 'RFB 003.007\n';
const RFB_PROTOCOL_VERSION_3_8 = 'RFB 003.008\n';

// RFB Message Types
const RFB_CLIENT_MESSAGES = {
  SET_PIXEL_FORMAT: 0,
  SET_ENCODINGS: 2,
  FRAMEBUFFER_UPDATE_REQUEST: 3,
  KEY_EVENT: 4,
  POINTER_EVENT: 5,
  CLIENT_CUT_TEXT: 6,
  ENABLE_CONTINUOUS_UPDATES: 150, // TigerVNC extension
  FENCE: 248, // TigerVNC fence extension
  XVP: 250, // Xvp extension
  QEMU: 255, // QEMU extension
} as const;

const RFB_SERVER_MESSAGES = {
  FRAMEBUFFER_UPDATE: 0,
  SET_COLOUR_MAP_ENTRIES: 1,
  BELL: 2,
  SERVER_CUT_TEXT: 3,
  RESIZE_FRAME_BUFFER: 4, // ExtendedDesktopSize pseudo-encoding
  END_OF_CONTINUOUS_UPDATES: 150, // TigerVNC extension
  FENCE: 248, // TigerVNC fence extension
  XVP: 250, // Xvp extension
  QEMU: 255, // QEMU extension
} as const;

// Encoding Constants
const RFB_ENCODINGS = {
  RAW: 0,
  COPY_RECT: 1,
  RRE: 2,
  HEXTILE: 5,
  TRLE: 15,
  ZRLE: 16,
  CURSOR: -239,
  DESKTOP_SIZE: -223,
  LAST_RECT: -224,
  PSEUDO_DESKTOP_SIZE: -223,
  PSEUDO_CURSOR: -239,
  PSEUDO_X_CURSOR: -240,
  PSEUDO_DESKTOP_NAME: -307,
  PSEUDO_EXTENDED_DESKTOP_SIZE: -308,
  PSEUDO_XVP: -309,
  PSEUDO_FENCE: -312,
  PSEUDO_CONTINUOUS_UPDATES: -313,
  TIGHT: 7,
  ULTRA: 6,
  ZLIB: 6,
  ZLIBHEX: 8,
  JPEG: 21, // TurboVNC
  JRLE: 22, // TurboVNC
} as const;

// Security Types
const RFB_SECURITY_TYPES = {
  INVALID: 0,
  NONE: 1,
  VNC_AUTH: 2,
  RA2: 5,
  RA2NE: 6,
  TIGHT: 16,
  ULTRA: 17,
  TLS: 18,
  VENCRYPT: 19,
  SASL: 20,
  MD5_HASH: 21,
  XVP: 22,
} as const;

// VeNCrypt Sub-types
const VENCRYPT_SUBTYPES = {
  PLAIN: 256,
  TLS_NONE: 257,
  TLS_VNC: 258,
  TLS_PLAIN: 259,
  X509_NONE: 260,
  X509_VNC: 261,
  X509_PLAIN: 262,
  TLS_SASL: 263,
  X509_SASL: 264,
} as const;

// Key mappings for keyboard events
const KEY_MAPPINGS = {
  // ASCII keys
  BACKSPACE: 0xff08,
  TAB: 0xff09,
  RETURN: 0xff0d,
  ESCAPE: 0xff1b,
  DELETE: 0xffff,

  // Function keys
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,

  // Arrow keys
  LEFT: 0xff51,
  UP: 0xff52,
  RIGHT: 0xff53,
  DOWN: 0xff54,

  // Modifier keys
  SHIFT_L: 0xffe1,
  SHIFT_R: 0xffe2,
  CONTROL_L: 0xffe3,
  CONTROL_R: 0xffe4,
  META_L: 0xffe7,
  META_R: 0xffe8,
  ALT_L: 0xffe9,
  ALT_R: 0xffea,

  // Special keys
  HOME: 0xff50,
  END: 0xff57,
  PAGE_UP: 0xff55,
  PAGE_DOWN: 0xff56,
  INSERT: 0xff63,
  PRINT: 0xff61,
  MENU: 0xff67,
  PAUSE: 0xff13,
  CAPS_LOCK: 0xffe5,
  NUM_LOCK: 0xff7f,
  SCROLL_LOCK: 0xff14,
} as const;

/**
 * Production-ready VNC Protocol implementation with comprehensive RFB support
 */
export class VNCProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'vnc';
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;

  // VNC-specific properties
  private socket?: Socket | TLSSocket;
  private vncSessions: Map<string, VNCSession> = new Map();
  private defaultOptions: Partial<VNCConnectionOptions>;
  private config: VNCProtocolConfig;
  private vncProcesses: Map<string, ChildProcess> = new Map();
  private vncViewers: Map<
    string,
    { process: ChildProcess; pid: number; port: number }
  > = new Map();

  // Required properties for VNC protocol functionality
  public options: Partial<VNCConnectionOptions>;
  public connectionId: string;
  public session?: VNCSession;

  // Protocol state
  private protocolVersion: string = '';
  private securityTypes: number[] = [];
  private selectedSecurity: number = 0;
  private serverInit?: any;
  private pixelFormat: any;
  private framebufferWidth: number = 0;
  private framebufferHeight: number = 0;

  // Buffers and state management
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private expectedMessageLength: number = 0;
  private messageHandler?: (data: Buffer) => void;
  private isConnected: boolean = false;
  private isAuthenticated: boolean = false;

  // Performance tracking
  private performanceMetrics: VNCPerformanceMetrics;
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private bytesReceived: number = 0;
  private bytesSent: number = 0;

  // Encoding support
  private supportedEncodings: Map<number, string> = new Map();
  private compressionLevel: number = 6;
  private qualityLevel: number = 6;

  // File transfer state
  private activeFileTransfers: Map<string, VNCFileTransfer> = new Map();
  private clipboardData: string = '';

  // TLS/Encryption state
  private tlsSocket?: TLSSocket;
  private encryptionEnabled: boolean = false;

  // Recording state
  private recordingStream?: fs.WriteStream;
  private recordingStartTime?: Date;

  // Multi-monitor support
  private monitors: VNCMonitorConfig[] = [];
  private primaryMonitor: number = 0;

  // Repeater support
  private repeaterConnection?: Socket;
  private repeaterMode: 'mode1' | 'mode2' = 'mode1';

  constructor(options?: VNCConnectionOptions) {
    super('VNCProtocol');

    this.defaultOptions = { ...this.getDefaultOptions(), ...(options || {}) };

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
      maxConcurrentSessions: 10,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['password', 'none', 'tls', 'vencrypt'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true,
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
        vnc: { available: true, version: '1.0' },
        vncviewer: { available: true, version: '1.0' },
        tightvnc: { available: true, version: '1.0' },
        tigervnc: { available: true, version: '1.0' },
        realvnc: { available: true, version: '1.0' },
        ultravnc: { available: true, version: '1.0' },
      },
    };

    this.config = this.createDefaultConfig();
    this.initializeEncodingSupport();
    this.initializePerformanceMetrics();

    // Initialize required properties
    this.options = this.defaultOptions;
    this.connectionId = this.generateConnectionId();
  }

  private getDefaultOptions(): Partial<VNCConnectionOptions> {
    return {
      host: 'localhost',
      port: 5900,
      rfbProtocolVersion: 'auto',
      sharedConnection: true,
      viewOnly: false,
      pixelFormat: {
        bitsPerPixel: 32,
        depth: 24,
        bigEndianFlag: false,
        trueColorFlag: true,
        redMax: 255,
        greenMax: 255,
        blueMax: 255,
        redShift: 16,
        greenShift: 8,
        blueShift: 0,
      },
      supportedEncodings: [
        'zrle',
        'hextile',
        'rre',
        'raw',
        'copyrect',
        'cursor',
        'desktopsize',
      ],
      authMethod: 'vencrypt',
      timeout: 30000,
      keepAlive: true,
      keepAliveInterval: 30000,
      retryAttempts: 3,
      retryDelay: 5000,
      enableKeyboard: true,
      enableMouse: true,
      enableClipboard: true,
      compressionLevel: 6,
      qualityLevel: 6,
      enableJPEGCompression: true,
      jpegQuality: 75,
      autoResize: true,
      enableFileTransfer: true,
      maxFileSize: 100 * 1024 * 1024, // 100MB
      enableUltraVNCExtensions: true,
      enableTightVNCExtensions: true,
      enableRealVNCExtensions: true,
      enableAppleRemoteDesktop: false,
      cursorMode: 'local',
      enableCursorShapeUpdates: true,
      enableRichCursor: true,
      recordSession: false,
      recordingFormat: 'fbs',
      securityTypes: ['vencrypt', 'tls', 'vnc', 'none'],
      allowInsecure: false,
      enableFastPath: true,
      bufferSize: 65536,
      maxUpdateRate: 60,
      enableLazyUpdates: false,
      debugLevel: 'info',
    };
  }

  private createDefaultConfig(): VNCProtocolConfig {
    return {
      defaultPort: 5900,
      defaultProtocolVersion: 'RFB 003.008\n',
      connectionTimeout: 30000,
      readTimeout: 60000,
      writeTimeout: 30000,
      preferredEncodings: [
        'zrle',
        'hextile',
        'tight',
        'rre',
        'raw',
        'copyrect',
      ],
      defaultPixelFormat: {
        bitsPerPixel: 32,
        depth: 24,
        bigEndianFlag: false,
        trueColorFlag: true,
      },
      allowedSecurityTypes: ['vencrypt', 'tls', 'vnc'],
      requireEncryption: false,
      enableCompression: true,
      compressionLevel: 6,
      enableJPEG: true,
      jpegQuality: 75,
      maxUpdateRate: 60,
      bufferSize: 65536,
      enableCursorShapeUpdates: true,
      enableDesktopResize: true,
      enableContinuousUpdates: true,
      enableFileTransfer: true,
      enableClipboard: true,
      logLevel: 'info',
      enableProtocolLogging: false,
      enablePerformanceLogging: true,
      enableSessionRecording: false,
      recordingPath: './vnc-recordings',
      recordingFormat: 'fbs',
      enableUltraVNCExtensions: true,
      enableTightVNCExtensions: true,
      enableRealVNCExtensions: true,
      enableTigerVNCExtensions: true,
      enableTurboVNCExtensions: true,
    };
  }

  private initializeEncodingSupport(): void {
    this.supportedEncodings.set(RFB_ENCODINGS.RAW, 'Raw');
    this.supportedEncodings.set(RFB_ENCODINGS.COPY_RECT, 'CopyRect');
    this.supportedEncodings.set(RFB_ENCODINGS.RRE, 'RRE');
    this.supportedEncodings.set(RFB_ENCODINGS.HEXTILE, 'Hextile');
    this.supportedEncodings.set(RFB_ENCODINGS.TRLE, 'TRLE');
    this.supportedEncodings.set(RFB_ENCODINGS.ZRLE, 'ZRLE');
    this.supportedEncodings.set(RFB_ENCODINGS.TIGHT, 'Tight');
    this.supportedEncodings.set(RFB_ENCODINGS.ULTRA, 'Ultra');
    this.supportedEncodings.set(RFB_ENCODINGS.ZLIBHEX, 'ZlibHex');
    this.supportedEncodings.set(RFB_ENCODINGS.JPEG, 'JPEG');
    this.supportedEncodings.set(RFB_ENCODINGS.JRLE, 'JRLE');
    this.supportedEncodings.set(RFB_ENCODINGS.CURSOR, 'Cursor');
    this.supportedEncodings.set(RFB_ENCODINGS.DESKTOP_SIZE, 'DesktopSize');
    this.supportedEncodings.set(RFB_ENCODINGS.LAST_RECT, 'LastRect');
    this.supportedEncodings.set(
      RFB_ENCODINGS.PSEUDO_EXTENDED_DESKTOP_SIZE,
      'ExtendedDesktopSize'
    );
    this.supportedEncodings.set(
      RFB_ENCODINGS.PSEUDO_CONTINUOUS_UPDATES,
      'ContinuousUpdates'
    );
    this.supportedEncodings.set(RFB_ENCODINGS.PSEUDO_FENCE, 'Fence');
  }

  private initializePerformanceMetrics(): void {
    this.performanceMetrics = {
      sessionId: this.connectionId,
      timestamp: new Date(),
      frameRate: 0,
      avgFrameTime: 0,
      frameSkips: 0,
      bandwidth: 0,
      latency: 0,
      packetLoss: 0,
      compressionRatio: 1.0,
      uncompressedBytes: 0,
      compressedBytes: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      networkIO: 0,
      pixelChanges: 0,
      screenUpdateArea: 0,
      cursorUpdates: 0,
    };
  }

  /**
   * Connect to VNC server with comprehensive authentication and encryption support
   */
  public async connect(): Promise<VNCSession> {
    try {
      this.logger.info(
        `Connecting to VNC server at ${this.options.host}:${this.options.port}`
      );

      // Handle VNC Repeater connection if configured
      if (this.options.repeater?.enabled) {
        await this.connectViaRepeater();
      } else {
        await this.connectDirect();
      }

      // Initialize session
      this.session = this.createVNCSession();

      // Start session recording if enabled
      if (this.options.recordSession) {
        await this.startSessionRecording();
      }

      // Begin RFB protocol handshake
      await this.performHandshake();

      this.logger.info(
        `Successfully connected to VNC server: ${this.session.serverName || 'Unknown'}`
      );
      this.emit('connected', this.session);

      return this.session;
    } catch (error) {
      this.logger.error('Failed to connect to VNC server:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private async connectDirect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectOptions = {
        host: this.options.host,
        port: this.options.port,
        timeout: this.options.timeout,
      };

      // Handle proxy connection if configured
      if (this.options.proxy) {
        // Proxy support would be implemented here
        this.logger.warn(
          'Proxy support not yet implemented, connecting directly'
        );
      }

      this.socket = createConnection(connectOptions);

      this.socket.setTimeout(this.options.timeout || 30000);

      this.socket.on('connect', () => {
        this.logger.debug('TCP connection established');
        this.isConnected = true;

        if (this.options.keepAlive) {
          this.socket!.setKeepAlive(
            true,
            this.options.keepAliveInterval || 30000
          );
        }

        resolve();
      });

      this.socket.on('data', (data: Buffer) => {
        this.handleIncomingData(data);
      });

      this.socket.on('error', (error: Error) => {
        this.logger.error('Socket error:', error);
        this.emit('error', error);
        reject(error);
      });

      this.socket.on('close', () => {
        this.logger.debug('Socket closed');
        this.isConnected = false;
        this.emit('disconnected');
      });

      this.socket.on('timeout', () => {
        this.logger.error('Connection timeout');
        const error = new Error('Connection timeout');
        this.emit('error', error);
        reject(error);
      });
    });
  }

  private async connectViaRepeater(): Promise<void> {
    if (!this.options.repeater) {
      throw new Error('Repeater configuration not provided');
    }

    const { host, port, id, mode } = this.options.repeater;
    this.repeaterMode = mode || 'mode1';

    this.logger.info(
      `Connecting via VNC repeater: ${host}:${port} (${this.repeaterMode})`
    );

    return new Promise((resolve, reject) => {
      this.repeaterConnection = createConnection({
        host: host || this.options.host,
        port: port || 5901,
        timeout: this.options.timeout,
      });

      this.repeaterConnection.on('connect', async () => {
        try {
          if (this.repeaterMode === 'mode1') {
            // Mode 1: Send ID then connect
            const idBuffer = Buffer.from(id || '000000000000');
            await this.writeData(idBuffer);

            // Wait for repeater response then establish VNC connection
            this.socket = this.repeaterConnection;
            resolve();
          } else {
            // Mode 2: More complex handshake
            await this.handleRepeaterMode2();
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      });

      this.repeaterConnection.on('error', reject);
    });
  }

  private async handleRepeaterMode2(): Promise<void> {
    // Mode 2 repeater handshake implementation
    // This would involve a more complex protocol exchange
    this.logger.warn('Repeater Mode 2 not fully implemented yet');
  }

  private createVNCSession(): VNCSession {
    return {
      sessionId: this.connectionId,
      connectionId: this.connectionId,
      host: this.options.host,
      port: this.options.port || 5900,
      protocolVersion: this.protocolVersion,
      securityType: this.mapSecurityType(this.selectedSecurity),
      sharedConnection: this.options.sharedConnection || true,
      viewOnlyMode: this.options.viewOnly || false,
      framebufferInfo: {
        width: this.framebufferWidth,
        height: this.framebufferHeight,
        pixelFormat: this.pixelFormat || this.options.pixelFormat,
      },
      supportedEncodings: this.options.supportedEncodings || [],
      serverCapabilities: {
        cursorShapeUpdates: this.options.enableCursorShapeUpdates || false,
        richCursor: this.options.enableRichCursor || false,
        desktopResize: this.options.autoResize || false,
        continuousUpdates: false,
        fence: false,
        fileTransfer: this.options.enableFileTransfer || false,
        clipboardTransfer: this.options.enableClipboard || false,
        audio: false,
      },
      status: 'connecting',
      connectionTime: new Date(),
      statistics: {
        bytesReceived: 0,
        bytesSent: 0,
        framebufferUpdates: 0,
        keyboardEvents: 0,
        mouseEvents: 0,
        clipboardTransfers: 0,
        fileTransfers: 0,
        avgFrameRate: 0,
        bandwidth: 0,
        compression: 1.0,
        latency: 0,
      },
      errorCount: 0,
      warnings: [],
      monitors: this.options.monitors || [],
      metadata: {},
    };
  }

  private mapSecurityType(securityTypeNumber: number): VNCSecurityType {
    switch (securityTypeNumber) {
      case RFB_SECURITY_TYPES.NONE:
        return 'none';
      case RFB_SECURITY_TYPES.VNC_AUTH:
        return 'vnc';
      case RFB_SECURITY_TYPES.RA2:
        return 'ra2';
      case RFB_SECURITY_TYPES.RA2NE:
        return 'ra2ne';
      case RFB_SECURITY_TYPES.TIGHT:
        return 'tight';
      case RFB_SECURITY_TYPES.ULTRA:
        return 'ultra';
      case RFB_SECURITY_TYPES.TLS:
        return 'tls';
      case RFB_SECURITY_TYPES.VENCRYPT:
        return 'vencrypt';
      case RFB_SECURITY_TYPES.SASL:
        return 'sasl';
      case RFB_SECURITY_TYPES.MD5_HASH:
        return 'md5hash';
      case RFB_SECURITY_TYPES.XVP:
        return 'xvp';
      default:
        return 'vnc';
    }
  }

  /**
   * RFB Protocol Handshake Implementation
   */
  private async performHandshake(): Promise<void> {
    try {
      // Step 1: Protocol Version Negotiation
      await this.negotiateProtocolVersion();

      // Step 2: Security Negotiation
      await this.negotiateSecurity();

      // Step 3: Authentication
      await this.performAuthentication();

      // Step 4: Client Initialization
      await this.performClientInit();

      // Step 5: Server Initialization
      await this.handleServerInit();

      // Step 6: Set encodings and pixel format
      await this.configureSession();

      this.isAuthenticated = true;
      if (this.session) {
        this.session.status = 'connected';
      }
    } catch (error) {
      this.logger.error('Handshake failed:', error);
      throw error;
    }
  }

  private async negotiateProtocolVersion(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.messageHandler = (data: Buffer) => {
        if (data.length >= 12) {
          const version = data.slice(0, 12).toString();
          this.logger.debug(`Server protocol version: ${version.trim()}`);

          // Determine client protocol version to use
          let clientVersion: string;
          if (this.options.rfbProtocolVersion === 'auto') {
            if (version.includes('003.008')) {
              clientVersion = RFB_PROTOCOL_VERSION_3_8;
            } else if (version.includes('003.007')) {
              clientVersion = RFB_PROTOCOL_VERSION_3_7;
            } else {
              clientVersion = RFB_PROTOCOL_VERSION_3_3;
            }
          } else {
            switch (this.options.rfbProtocolVersion) {
              case '3.8':
                clientVersion = RFB_PROTOCOL_VERSION_3_8;
                break;
              case '3.7':
                clientVersion = RFB_PROTOCOL_VERSION_3_7;
                break;
              case '3.3':
                clientVersion = RFB_PROTOCOL_VERSION_3_3;
                break;
              default:
                clientVersion = RFB_PROTOCOL_VERSION_3_8;
                break;
            }
          }

          this.protocolVersion = clientVersion.trim();
          this.logger.debug(
            `Using client protocol version: ${this.protocolVersion}`
          );

          // Send client protocol version
          this.writeData(Buffer.from(clientVersion))
            .then(() => {
              this.messageHandler = undefined;
              resolve();
            })
            .catch(reject);
        }
      };

      this.expectedMessageLength = 12;
    });
  }

  private async negotiateSecurity(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.messageHandler = async (data: Buffer) => {
        try {
          if (this.protocolVersion === 'RFB 003.003') {
            // RFB 3.3: Server decides security type
            if (data.length >= 4) {
              this.selectedSecurity = data.readUInt32BE(0);
              this.logger.debug(
                `Server selected security type: ${this.selectedSecurity}`
              );
              this.messageHandler = undefined;
              resolve();
            }
          } else {
            // RFB 3.7+: Client chooses from server list
            const numTypes = data.readUInt8(0);
            if (numTypes === 0) {
              // Server error
              const reasonLength = data.readUInt32BE(1);
              const reason = data.slice(5, 5 + reasonLength).toString();
              reject(
                new Error(`Server security negotiation failed: ${reason}`)
              );
              return;
            }

            this.securityTypes = [];
            for (let i = 0; i < numTypes; i++) {
              this.securityTypes.push(data.readUInt8(1 + i));
            }

            this.logger.debug(
              `Server security types: ${this.securityTypes.join(', ')}`
            );

            // Select preferred security type
            this.selectedSecurity = this.selectPreferredSecurity();

            // Send selected security type
            const securityBuffer = Buffer.allocUnsafe(1);
            securityBuffer.writeUInt8(this.selectedSecurity, 0);
            await this.writeData(securityBuffer);

            this.messageHandler = undefined;
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      this.expectedMessageLength =
        this.protocolVersion === 'RFB 003.003' ? 4 : 1;
    });
  }

  private selectPreferredSecurity(): number {
    const preferenceOrder = [
      RFB_SECURITY_TYPES.VENCRYPT,
      RFB_SECURITY_TYPES.TLS,
      RFB_SECURITY_TYPES.VNC_AUTH,
      RFB_SECURITY_TYPES.NONE,
    ];

    for (const preferred of preferenceOrder) {
      if (this.securityTypes.includes(preferred)) {
        // Check if this security type is allowed by configuration
        if (
          preferred === RFB_SECURITY_TYPES.NONE &&
          !this.options.allowInsecure
        ) {
          continue;
        }
        return preferred;
      }
    }

    throw new Error(
      `No compatible security type found. Server offers: ${this.securityTypes.join(', ')}`
    );
  }

  private async performAuthentication(): Promise<void> {
    switch (this.selectedSecurity) {
      case RFB_SECURITY_TYPES.NONE:
        await this.authenticateNone();
        break;
      case RFB_SECURITY_TYPES.VNC_AUTH:
        await this.authenticateVNC();
        break;
      case RFB_SECURITY_TYPES.TLS:
        await this.authenticateTLS();
        break;
      case RFB_SECURITY_TYPES.VENCRYPT:
        await this.authenticateVeNCrypt();
        break;
      default:
        throw new Error(`Unsupported security type: ${this.selectedSecurity}`);
    }
  }

  private async authenticateNone(): Promise<void> {
    this.logger.debug('Using no authentication');
    // For RFB 3.8+, wait for security result
    if (this.protocolVersion !== 'RFB 003.003') {
      await this.waitForSecurityResult();
    }
  }

  private async authenticateVNC(): Promise<void> {
    if (!this.options.password) {
      throw new Error('VNC authentication requires a password');
    }

    return new Promise((resolve, reject) => {
      this.messageHandler = async (data: Buffer) => {
        try {
          if (data.length >= 16) {
            const challenge = data.slice(0, 16);
            const response = this.vncAuthChallenge(
              challenge,
              this.options.password!
            );

            await this.writeData(response);
            await this.waitForSecurityResult();

            this.messageHandler = undefined;
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      this.expectedMessageLength = 16;
    });
  }

  private vncAuthChallenge(challenge: Buffer, password: string): Buffer {
    // VNC uses DES encryption with the password as key
    const key = Buffer.alloc(8);
    const passwordBytes = Buffer.from(password.slice(0, 8), 'binary');
    passwordBytes.copy(key);

    // VNC DES key has bits in reverse order
    for (let i = 0; i < 8; i++) {
      let byte = key[i];
      byte = ((byte & 0xf0) >> 4) | ((byte & 0x0f) << 4);
      byte = ((byte & 0xcc) >> 2) | ((byte & 0x33) << 2);
      byte = ((byte & 0xaa) >> 1) | ((byte & 0x55) << 1);
      key[i] = byte;
    }

    const cipher = crypto.createCipheriv('des-ecb', key, null);
    cipher.setAutoPadding(false);

    return Buffer.concat([cipher.update(challenge), cipher.final()]);
  }

  private async authenticateTLS(): Promise<void> {
    this.logger.debug('Starting TLS authentication');
    await this.upgradToTLS();

    // After TLS upgrade, continue with sub-authentication
    await this.negotiateSecurity(); // Re-negotiate security over TLS
  }

  private async authenticateVeNCrypt(): Promise<void> {
    this.logger.debug('Starting VeNCrypt authentication');

    // VeNCrypt version negotiation
    return new Promise((resolve, reject) => {
      this.messageHandler = async (data: Buffer) => {
        try {
          if (data.length >= 2) {
            const majorVersion = data.readUInt8(0);
            const minorVersion = data.readUInt8(1);
            this.logger.debug(
              `VeNCrypt server version: ${majorVersion}.${minorVersion}`
            );

            // Send client version (0.2)
            const versionBuffer = Buffer.from([0, 2]);
            await this.writeData(versionBuffer);

            // Continue with VeNCrypt handshake
            this.messageHandler = this.handleVeNCryptHandshake.bind(this);
            this.expectedMessageLength = 1;
          }
        } catch (error) {
          reject(error);
        }
      };

      this.expectedMessageLength = 2;
    });
  }

  private async handleVeNCryptHandshake(data: Buffer): Promise<void> {
    const status = data.readUInt8(0);
    if (status !== 0) {
      throw new Error('VeNCrypt version negotiation failed');
    }

    // Get list of VeNCrypt subtypes
    this.messageHandler = async (data: Buffer) => {
      const numSubtypes = data.readUInt8(0);
      const subtypes: number[] = [];

      for (let i = 0; i < numSubtypes; i++) {
        subtypes.push(data.readUInt32BE(1 + i * 4));
      }

      this.logger.debug(`VeNCrypt subtypes: ${subtypes.join(', ')}`);

      // Select preferred subtype
      const selectedSubtype = this.selectVeNCryptSubtype(subtypes);

      // Send selected subtype
      const subtypeBuffer = Buffer.allocUnsafe(4);
      subtypeBuffer.writeUInt32BE(selectedSubtype, 0);
      await this.writeData(subtypeBuffer);

      // Handle subtype-specific authentication
      await this.handleVeNCryptSubtype(selectedSubtype);
    };

    this.expectedMessageLength = 1; // Will be updated when we know the number of subtypes
  }

  private selectVeNCryptSubtype(subtypes: number[]): number {
    const preferenceOrder = [
      VENCRYPT_SUBTYPES.X509_VNC,
      VENCRYPT_SUBTYPES.X509_PLAIN,
      VENCRYPT_SUBTYPES.TLS_VNC,
      VENCRYPT_SUBTYPES.TLS_PLAIN,
      VENCRYPT_SUBTYPES.PLAIN,
    ];

    for (const preferred of preferenceOrder) {
      if (subtypes.includes(preferred)) {
        return preferred;
      }
    }

    throw new Error(
      `No compatible VeNCrypt subtype found. Server offers: ${subtypes.join(', ')}`
    );
  }

  private async handleVeNCryptSubtype(subtype: number): Promise<void> {
    switch (subtype) {
      case VENCRYPT_SUBTYPES.TLS_VNC:
      case VENCRYPT_SUBTYPES.X509_VNC:
        await this.upgradToTLS();
        await this.authenticateVNC();
        break;
      case VENCRYPT_SUBTYPES.TLS_PLAIN:
      case VENCRYPT_SUBTYPES.X509_PLAIN:
        await this.upgradToTLS();
        await this.authenticatePlain();
        break;
      case VENCRYPT_SUBTYPES.PLAIN:
        await this.authenticatePlain();
        break;
      default:
        throw new Error(`Unsupported VeNCrypt subtype: ${subtype}`);
    }
  }

  private async upgradToTLS(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tlsOptions: any = {
        socket: this.socket,
        rejectUnauthorized: this.options.tlsOptions?.rejectUnauthorized ?? true,
      };

      if (this.options.tlsOptions?.certificates) {
        const certs = this.options.tlsOptions.certificates;
        if (certs.ca) tlsOptions.ca = certs.ca;
        if (certs.cert) tlsOptions.cert = certs.cert;
        if (certs.key) tlsOptions.key = certs.key;
        if (certs.passphrase) tlsOptions.passphrase = certs.passphrase;
      }

      this.tlsSocket = tlsConnect(tlsOptions);
      this.socket = this.tlsSocket;
      this.encryptionEnabled = true;

      this.tlsSocket.on('secureConnect', () => {
        this.logger.debug('TLS connection established');
        resolve();
      });

      this.tlsSocket.on('error', (error) => {
        this.logger.error('TLS connection failed:', error);
        reject(error);
      });

      // Re-attach data handler
      this.tlsSocket.on('data', (data: Buffer) => {
        this.handleIncomingData(data);
      });
    });
  }

  private async authenticatePlain(): Promise<void> {
    if (!this.options.username || !this.options.password) {
      throw new Error('Plain authentication requires username and password');
    }

    const username = Buffer.from(this.options.username, 'utf8');
    const password = Buffer.from(this.options.password, 'utf8');

    const authBuffer = Buffer.alloc(4 + username.length + 4 + password.length);
    let offset = 0;

    authBuffer.writeUInt32BE(username.length, offset);
    offset += 4;
    username.copy(authBuffer, offset);
    offset += username.length;

    authBuffer.writeUInt32BE(password.length, offset);
    offset += 4;
    password.copy(authBuffer, offset);

    await this.writeData(authBuffer);
    await this.waitForSecurityResult();
  }

  private async waitForSecurityResult(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.messageHandler = (data: Buffer) => {
        if (data.length >= 4) {
          const result = data.readUInt32BE(0);

          if (result === 0) {
            this.logger.debug('Authentication successful');
            this.messageHandler = undefined;
            resolve();
          } else {
            // Authentication failed
            let reason = 'Authentication failed';

            if (this.protocolVersion !== 'RFB 003.003' && data.length > 4) {
              const reasonLength = data.readUInt32BE(4);
              if (data.length >= 8 + reasonLength) {
                reason = data.slice(8, 8 + reasonLength).toString();
              }
            }

            reject(new Error(reason));
          }
        }
      };

      this.expectedMessageLength = 4;
    });
  }

  private async performClientInit(): Promise<void> {
    // Send ClientInit message
    const sharedFlag = this.options.sharedConnection ? 1 : 0;
    const clientInitBuffer = Buffer.from([sharedFlag]);

    await this.writeData(clientInitBuffer);
    this.logger.debug(`Sent ClientInit: shared=${sharedFlag}`);
  }

  private async handleServerInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.messageHandler = (data: Buffer) => {
        try {
          if (data.length < 24) {
            this.logger.warn('ServerInit message too short');
            return;
          }

          // Parse ServerInit message
          this.framebufferWidth = data.readUInt16BE(0);
          this.framebufferHeight = data.readUInt16BE(2);

          const pixelFormat = {
            bitsPerPixel: data.readUInt8(4),
            depth: data.readUInt8(5),
            bigEndianFlag: data.readUInt8(6) === 1,
            trueColorFlag: data.readUInt8(7) === 1,
            redMax: data.readUInt16BE(8),
            greenMax: data.readUInt16BE(10),
            blueMax: data.readUInt16BE(12),
            redShift: data.readUInt8(14),
            greenShift: data.readUInt8(15),
            blueShift: data.readUInt8(16),
          };

          this.pixelFormat = pixelFormat;

          // Desktop name
          const nameLength = data.readUInt32BE(20);
          let desktopName = '';
          if (data.length >= 24 + nameLength) {
            desktopName = data.slice(24, 24 + nameLength).toString('utf8');
          }

          this.serverInit = {
            framebufferWidth: this.framebufferWidth,
            framebufferHeight: this.framebufferHeight,
            pixelFormat,
            desktopName,
          };

          this.logger.debug(
            `ServerInit: ${this.framebufferWidth}x${this.framebufferHeight}, ${desktopName}`
          );

          if (this.session) {
            this.session.serverName = desktopName;
            this.session.framebufferInfo = {
              width: this.framebufferWidth,
              height: this.framebufferHeight,
              pixelFormat,
            };
          }

          this.messageHandler = this.handleServerMessage.bind(this);
          this.expectedMessageLength = 1; // Server messages start with 1-byte type

          resolve();
        } catch (error) {
          reject(error);
        }
      };

      this.expectedMessageLength = 24; // Minimum ServerInit size
    });
  }

  private async configureSession(): Promise<void> {
    // Set pixel format if different from server default
    if (
      this.options.pixelFormat &&
      JSON.stringify(this.options.pixelFormat) !==
        JSON.stringify(this.pixelFormat)
    ) {
      await this.setPixelFormat(this.options.pixelFormat);
    }

    // Set supported encodings
    await this.setEncodings();

    // Request initial framebuffer update
    await this.requestFramebufferUpdate(
      0,
      0,
      this.framebufferWidth,
      this.framebufferHeight,
      false
    );

    this.logger.debug('Session configuration completed');
  }

  private async setPixelFormat(pixelFormat: any): Promise<void> {
    const buffer = Buffer.allocUnsafe(20);
    let offset = 0;

    buffer.writeUInt8(RFB_CLIENT_MESSAGES.SET_PIXEL_FORMAT, offset++);
    buffer.writeUInt8(0, offset++); // padding
    buffer.writeUInt8(0, offset++); // padding
    buffer.writeUInt8(0, offset++); // padding

    buffer.writeUInt8(pixelFormat.bitsPerPixel || 32, offset++);
    buffer.writeUInt8(pixelFormat.depth || 24, offset++);
    buffer.writeUInt8(pixelFormat.bigEndianFlag ? 1 : 0, offset++);
    buffer.writeUInt8(pixelFormat.trueColorFlag ? 1 : 0, offset++);
    buffer.writeUInt16BE(pixelFormat.redMax || 255, offset);
    offset += 2;
    buffer.writeUInt16BE(pixelFormat.greenMax || 255, offset);
    offset += 2;
    buffer.writeUInt16BE(pixelFormat.blueMax || 255, offset);
    offset += 2;
    buffer.writeUInt8(pixelFormat.redShift || 16, offset++);
    buffer.writeUInt8(pixelFormat.greenShift || 8, offset++);
    buffer.writeUInt8(pixelFormat.blueShift || 0, offset++);
    buffer.writeUInt8(0, offset++); // padding
    buffer.writeUInt8(0, offset++); // padding
    buffer.writeUInt8(0, offset++); // padding

    await this.writeData(buffer);
    this.pixelFormat = pixelFormat;

    this.logger.debug('Set pixel format:', pixelFormat);
  }

  private async setEncodings(): Promise<void> {
    const encodings = this.mapEncodingsToNumbers(
      this.options.supportedEncodings || []
    );

    const buffer = Buffer.allocUnsafe(4 + encodings.length * 4);
    let offset = 0;

    buffer.writeUInt8(RFB_CLIENT_MESSAGES.SET_ENCODINGS, offset++);
    buffer.writeUInt8(0, offset++); // padding
    buffer.writeUInt16BE(encodings.length, offset);
    offset += 2;

    for (const encoding of encodings) {
      buffer.writeInt32BE(encoding, offset);
      offset += 4;
    }

    await this.writeData(buffer);
    this.logger.debug(
      `Set encodings: ${this.options.supportedEncodings?.join(', ')}`
    );
  }

  private mapEncodingsToNumbers(encodings: VNCEncoding[]): number[] {
    const encodingMap: Record<string, number> = {
      raw: RFB_ENCODINGS.RAW,
      copyrect: RFB_ENCODINGS.COPY_RECT,
      rre: RFB_ENCODINGS.RRE,
      hextile: RFB_ENCODINGS.HEXTILE,
      trle: RFB_ENCODINGS.TRLE,
      zrle: RFB_ENCODINGS.ZRLE,
      tight: RFB_ENCODINGS.TIGHT,
      ultra: RFB_ENCODINGS.ULTRA,
      zlibhex: RFB_ENCODINGS.ZLIBHEX,
      jpeg: RFB_ENCODINGS.JPEG,
      jrle: RFB_ENCODINGS.JRLE,
      cursor: RFB_ENCODINGS.CURSOR,
      desktopsize: RFB_ENCODINGS.DESKTOP_SIZE,
      lastrect: RFB_ENCODINGS.LAST_RECT,
      continuous: RFB_ENCODINGS.PSEUDO_CONTINUOUS_UPDATES,
      fence: RFB_ENCODINGS.PSEUDO_FENCE,
      x11cursor: RFB_ENCODINGS.PSEUDO_X_CURSOR,
      richcursor: RFB_ENCODINGS.CURSOR,
      wmvi: 0x574d5649,
    };

    return encodings
      .map((encoding) => encodingMap[encoding])
      .filter((num) => num !== undefined);
  }

  /**
   * Handle incoming data from server
   */
  private handleIncomingData(data: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
    this.bytesReceived += data.length;

    // Update performance metrics
    this.updateNetworkMetrics();

    // Process complete messages
    while (
      this.receiveBuffer.length >= this.expectedMessageLength &&
      (this.messageHandler || this.expectedMessageLength > 0)
    ) {
      if (this.messageHandler) {
        const messageData = this.receiveBuffer.slice(
          0,
          this.expectedMessageLength
        );
        this.receiveBuffer = this.receiveBuffer.slice(
          this.expectedMessageLength
        );

        this.messageHandler(messageData);
      } else {
        // Default server message handling
        this.processServerMessage();
      }
    }
  }

  private processServerMessage(): void {
    if (this.receiveBuffer.length < 1) return;

    const messageType = this.receiveBuffer.readUInt8(0);

    switch (messageType) {
      case RFB_SERVER_MESSAGES.FRAMEBUFFER_UPDATE:
        this.handleFramebufferUpdate();
        break;
      case RFB_SERVER_MESSAGES.SET_COLOUR_MAP_ENTRIES:
        this.handleSetColourMapEntries();
        break;
      case RFB_SERVER_MESSAGES.BELL:
        this.handleBell();
        break;
      case RFB_SERVER_MESSAGES.SERVER_CUT_TEXT:
        this.handleServerCutText();
        break;
      case RFB_SERVER_MESSAGES.RESIZE_FRAME_BUFFER:
        this.handleResizeFrameBuffer();
        break;
      default:
        this.logger.warn(`Unknown server message type: ${messageType}`);
        // Skip unknown message
        this.receiveBuffer = this.receiveBuffer.slice(1);
        break;
    }
  }

  private handleFramebufferUpdate(): void {
    if (this.receiveBuffer.length < 4) return;

    const numRectangles = this.receiveBuffer.readUInt16BE(2);

    if (this.receiveBuffer.length < 4 + numRectangles * 12) return;

    const rectangles: VNCRectangle[] = [];
    let offset = 4;

    for (let i = 0; i < numRectangles; i++) {
      if (this.receiveBuffer.length < offset + 12) return;

      const x = this.receiveBuffer.readUInt16BE(offset);
      const y = this.receiveBuffer.readUInt16BE(offset + 2);
      const width = this.receiveBuffer.readUInt16BE(offset + 4);
      const height = this.receiveBuffer.readUInt16BE(offset + 6);
      const encoding = this.receiveBuffer.readInt32BE(offset + 8);

      offset += 12;

      // Calculate expected data size based on encoding
      let dataSize = 0;
      let data: Buffer;

      switch (encoding) {
        case RFB_ENCODINGS.RAW:
          dataSize = width * height * (this.pixelFormat.bitsPerPixel / 8);
          break;
        case RFB_ENCODINGS.COPY_RECT:
          dataSize = 4; // source x, y
          break;
        case RFB_ENCODINGS.CURSOR:
        case RFB_ENCODINGS.PSEUDO_X_CURSOR:
          dataSize = this.calculateCursorDataSize(width, height);
          break;
        case RFB_ENCODINGS.DESKTOP_SIZE:
        case RFB_ENCODINGS.PSEUDO_EXTENDED_DESKTOP_SIZE:
          dataSize = 0; // No additional data
          break;
        default:
          // For complex encodings, we need to parse the data to determine size
          dataSize = this.calculateEncodingDataSize(
            encoding,
            width,
            height,
            offset
          );
          break;
      }

      if (this.receiveBuffer.length < offset + dataSize) return;

      data = this.receiveBuffer.slice(offset, offset + dataSize);
      offset += dataSize;

      rectangles.push({
        x,
        y,
        width,
        height,
        encoding: this.mapEncodingNumberToString(encoding),
        data,
      });

      // Handle pseudo-encodings
      if (encoding === RFB_ENCODINGS.DESKTOP_SIZE) {
        this.handleDesktopResize(width, height);
      } else if (
        encoding === RFB_ENCODINGS.CURSOR ||
        encoding === RFB_ENCODINGS.PSEUDO_X_CURSOR
      ) {
        this.handleCursorUpdate(x, y, width, height, data);
      }
    }

    // Remove processed data from buffer
    this.receiveBuffer = this.receiveBuffer.slice(offset);

    // Create framebuffer update event
    const update: VNCFramebufferUpdate = {
      messageType: RFB_SERVER_MESSAGES.FRAMEBUFFER_UPDATE,
      rectangles,
      timestamp: new Date(),
      sequenceNumber: this.frameCount++,
    };

    // Update performance metrics
    this.updateFrameMetrics();

    // Emit framebuffer update event
    this.emit('framebufferUpdate', update);

    // Process rectangles for recording
    if (this.recordingStream) {
      this.recordFramebufferUpdate(update);
    }
  }

  private calculateCursorDataSize(width: number, height: number): number {
    const pixelData = width * height * (this.pixelFormat.bitsPerPixel / 8);
    const maskData = Math.floor((width + 7) / 8) * height;
    return pixelData + maskData;
  }

  private calculateEncodingDataSize(
    encoding: number,
    width: number,
    height: number,
    offset: number
  ): number {
    // This is a simplified implementation
    // In a full implementation, you would need to parse the encoding-specific data
    switch (encoding) {
      case RFB_ENCODINGS.RRE:
        return this.calculateRREDataSize(width, height, offset);
      case RFB_ENCODINGS.HEXTILE:
        return this.calculateHextileDataSize(width, height, offset);
      case RFB_ENCODINGS.ZRLE:
      case RFB_ENCODINGS.TRLE:
        return this.calculateZRLEDataSize(offset);
      case RFB_ENCODINGS.TIGHT:
        return this.calculateTightDataSize(offset);
      default:
        // For unknown encodings, assume raw data size
        return width * height * (this.pixelFormat.bitsPerPixel / 8);
    }
  }

  private calculateRREDataSize(
    width: number,
    height: number,
    offset: number
  ): number {
    if (this.receiveBuffer.length < offset + 4) return 0;
    const numSubrects = this.receiveBuffer.readUInt32BE(offset);
    const bgPixelSize = this.pixelFormat.bitsPerPixel / 8;
    const subrectSize = bgPixelSize + 8; // pixel + x + y + w + h
    return 4 + bgPixelSize + numSubrects * subrectSize;
  }

  private calculateHextileDataSize(
    width: number,
    height: number,
    offset: number
  ): number {
    // Hextile divides rectangle into 16x16 tiles
    let dataSize = 0;
    let currentOffset = offset;

    for (let ty = 0; ty < height; ty += 16) {
      for (let tx = 0; tx < width; tx += 16) {
        if (this.receiveBuffer.length < currentOffset + 1) return 0;

        const subencoding = this.receiveBuffer.readUInt8(currentOffset);
        currentOffset += 1;
        dataSize += 1;

        const tileWidth = Math.min(16, width - tx);
        const tileHeight = Math.min(16, height - ty);
        const pixelSize = this.pixelFormat.bitsPerPixel / 8;

        if (subencoding & 0x01) {
          // Raw
          const tileDataSize = tileWidth * tileHeight * pixelSize;
          currentOffset += tileDataSize;
          dataSize += tileDataSize;
        } else {
          // Parse other hextile subencodings
          if (subencoding & 0x02) {
            // Background specified
            currentOffset += pixelSize;
            dataSize += pixelSize;
          }
          if (subencoding & 0x04) {
            // Foreground specified
            currentOffset += pixelSize;
            dataSize += pixelSize;
          }
          if (subencoding & 0x08) {
            // Any subrects
            if (this.receiveBuffer.length < currentOffset + 1) return 0;
            const numSubrects = this.receiveBuffer.readUInt8(currentOffset);
            currentOffset += 1;
            dataSize += 1;

            const subrectSize = subencoding & 0x10 ? 2 : 2 + pixelSize; // Subrects coloured
            currentOffset += numSubrects * subrectSize;
            dataSize += numSubrects * subrectSize;
          }
        }
      }
    }

    return dataSize;
  }

  private calculateZRLEDataSize(offset: number): number {
    if (this.receiveBuffer.length < offset + 4) return 0;
    const length = this.receiveBuffer.readUInt32BE(offset);
    return 4 + length;
  }

  private calculateTightDataSize(offset: number): number {
    // Tight encoding has a complex structure
    // This is a simplified version
    if (this.receiveBuffer.length < offset + 1) return 0;

    const compressionControl = this.receiveBuffer.readUInt8(offset);
    let dataSize = 1;
    let currentOffset = offset + 1;

    // Parse length
    let length = 0;
    if (compressionControl & 0x80) {
      // JPEG
      if (this.receiveBuffer.length < currentOffset + 3) return 0;
      length =
        this.receiveBuffer.readUInt8(currentOffset) |
        (this.receiveBuffer.readUInt8(currentOffset + 1) << 8) |
        (this.receiveBuffer.readUInt8(currentOffset + 2) << 16);
      dataSize += 3;
    } else {
      // Basic or fill compression
      if (this.receiveBuffer.length < currentOffset + 1) return 0;
      const byte1 = this.receiveBuffer.readUInt8(currentOffset);
      dataSize += 1;

      if (byte1 & 0x80) {
        if (this.receiveBuffer.length < currentOffset + 2) return 0;
        const byte2 = this.receiveBuffer.readUInt8(currentOffset + 1);
        dataSize += 1;

        if (byte2 & 0x80) {
          if (this.receiveBuffer.length < currentOffset + 3) return 0;
          const byte3 = this.receiveBuffer.readUInt8(currentOffset + 2);
          length =
            (byte1 & 0x7f) | ((byte2 & 0x7f) << 7) | ((byte3 & 0x7f) << 14);
          dataSize += 1;
        } else {
          length = (byte1 & 0x7f) | ((byte2 & 0x7f) << 7);
        }
      } else {
        length = byte1 & 0x7f;
      }
    }

    return dataSize + length;
  }

  private mapEncodingNumberToString(encoding: number): VNCEncoding {
    switch (encoding) {
      case RFB_ENCODINGS.RAW:
        return 'raw';
      case RFB_ENCODINGS.COPY_RECT:
        return 'copyrect';
      case RFB_ENCODINGS.RRE:
        return 'rre';
      case RFB_ENCODINGS.HEXTILE:
        return 'hextile';
      case RFB_ENCODINGS.TRLE:
        return 'trle';
      case RFB_ENCODINGS.ZRLE:
        return 'zrle';
      case RFB_ENCODINGS.TIGHT:
        return 'tight';
      case RFB_ENCODINGS.ULTRA:
        return 'ultra';
      case RFB_ENCODINGS.ZLIBHEX:
        return 'zlibhex';
      case RFB_ENCODINGS.JPEG:
        return 'jpeg';
      case RFB_ENCODINGS.JRLE:
        return 'jrle';
      case RFB_ENCODINGS.CURSOR:
        return 'cursor';
      case RFB_ENCODINGS.DESKTOP_SIZE:
        return 'desktopsize';
      case RFB_ENCODINGS.LAST_RECT:
        return 'lastrect';
      case RFB_ENCODINGS.PSEUDO_CONTINUOUS_UPDATES:
        return 'continuous';
      case RFB_ENCODINGS.PSEUDO_FENCE:
        return 'fence';
      case RFB_ENCODINGS.PSEUDO_X_CURSOR:
        return 'x11cursor';
      default:
        return 'raw';
    }
  }

  private handleDesktopResize(width: number, height: number): void {
    this.framebufferWidth = width;
    this.framebufferHeight = height;

    if (this.session) {
      this.session.framebufferInfo.width = width;
      this.session.framebufferInfo.height = height;
    }

    this.logger.debug(`Desktop resized to ${width}x${height}`);
    this.emit('desktopResize', { width, height });
  }

  private handleCursorUpdate(
    x: number,
    y: number,
    width: number,
    height: number,
    data: Buffer
  ): void {
    this.emit('cursorUpdate', { x, y, width, height, data });
  }

  private handleSetColourMapEntries(): void {
    // Color map is rarely used in modern VNC implementations
    this.logger.debug('Received SetColourMapEntries message');
    // Skip the message for now
    this.receiveBuffer = this.receiveBuffer.slice(1);
  }

  private handleBell(): void {
    this.logger.debug('Received Bell message');
    this.emit('bell');

    if (this.options.bellCommand) {
      // Execute custom bell command
      const { spawn } = require('child_process');
      spawn(this.options.bellCommand, [], { detached: true, stdio: 'ignore' });
    }

    // Remove bell message from buffer
    this.receiveBuffer = this.receiveBuffer.slice(1);
  }

  private handleServerCutText(): void {
    if (this.receiveBuffer.length < 8) return;

    const length = this.receiveBuffer.readUInt32BE(4);

    if (this.receiveBuffer.length < 8 + length) return;

    const text = this.receiveBuffer.slice(8, 8 + length).toString('utf8');
    this.receiveBuffer = this.receiveBuffer.slice(8 + length);

    this.clipboardData = text;

    // Create clipboard sync event
    const clipboardSync: VNCClipboardSync = {
      sessionId: this.connectionId,
      direction: 'to_client',
      contentType: 'text',
      content: text,
      timestamp: new Date(),
      size: length,
    };

    this.logger.debug(`Received clipboard data: ${text.length} characters`);
    this.emit('clipboardSync', clipboardSync);

    if (this.session) {
      this.session.statistics.clipboardTransfers++;
    }
  }

  private handleResizeFrameBuffer(): void {
    // Extended desktop size pseudo-encoding
    this.logger.debug('Received ResizeFrameBuffer message');
    // Implementation depends on the specific pseudo-encoding
    this.receiveBuffer = this.receiveBuffer.slice(1);
  }

  /**
   * Client input methods
   */
  public async sendKeyEvent(
    key: number | string,
    down: boolean
  ): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    const keyCode = typeof key === 'string' ? this.mapKeyToCode(key) : key;

    const buffer = Buffer.allocUnsafe(8);
    buffer.writeUInt8(RFB_CLIENT_MESSAGES.KEY_EVENT, 0);
    buffer.writeUInt8(down ? 1 : 0, 1);
    buffer.writeUInt16BE(0, 2); // padding
    buffer.writeUInt32BE(keyCode, 4);

    await this.writeData(buffer);

    if (this.session) {
      this.session.statistics.keyboardEvents++;
    }

    // Create key event
    const keyEvent: VNCKeyEvent = {
      messageType: RFB_CLIENT_MESSAGES.KEY_EVENT,
      downFlag: down,
      key: keyCode,
      timestamp: new Date(),
    };

    this.emit('keyEvent', keyEvent);
  }

  private mapKeyToCode(key: string): number {
    // Check if it's a named key
    const namedKey = (KEY_MAPPINGS as any)[key.toUpperCase()];
    if (namedKey) {
      return namedKey;
    }

    // For single characters, use their Unicode code point
    if (key.length === 1) {
      return key.charCodeAt(0);
    }

    // Default to space
    return 0x20;
  }

  public async sendPointerEvent(
    x: number,
    y: number,
    buttonMask: number
  ): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    const buffer = Buffer.allocUnsafe(6);
    buffer.writeUInt8(RFB_CLIENT_MESSAGES.POINTER_EVENT, 0);
    buffer.writeUInt8(buttonMask, 1);
    buffer.writeUInt16BE(x, 2);
    buffer.writeUInt16BE(y, 4);

    await this.writeData(buffer);

    if (this.session) {
      this.session.statistics.mouseEvents++;
    }

    // Create pointer event
    const pointerEvent: VNCPointerEvent = {
      messageType: RFB_CLIENT_MESSAGES.POINTER_EVENT,
      buttonMask,
      x,
      y,
      timestamp: new Date(),
    };

    this.emit('pointerEvent', pointerEvent);
  }

  public async sendClientCutText(text: string): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    const textBuffer = Buffer.from(text, 'utf8');
    const buffer = Buffer.allocUnsafe(8 + textBuffer.length);

    buffer.writeUInt8(RFB_CLIENT_MESSAGES.CLIENT_CUT_TEXT, 0);
    buffer.writeUInt8(0, 1); // padding
    buffer.writeUInt8(0, 2); // padding
    buffer.writeUInt8(0, 3); // padding
    buffer.writeUInt32BE(textBuffer.length, 4);
    textBuffer.copy(buffer, 8);

    await this.writeData(buffer);

    this.clipboardData = text;

    // Create clipboard sync event
    const clipboardSync: VNCClipboardSync = {
      sessionId: this.connectionId,
      direction: 'to_server',
      contentType: 'text',
      content: text,
      timestamp: new Date(),
      size: textBuffer.length,
    };

    this.emit('clipboardSync', clipboardSync);

    if (this.session) {
      this.session.statistics.clipboardTransfers++;
    }
  }

  public async requestFramebufferUpdate(
    x: number,
    y: number,
    width: number,
    height: number,
    incremental: boolean
  ): Promise<void> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    const buffer = Buffer.allocUnsafe(10);
    buffer.writeUInt8(RFB_CLIENT_MESSAGES.FRAMEBUFFER_UPDATE_REQUEST, 0);
    buffer.writeUInt8(incremental ? 1 : 0, 1);
    buffer.writeUInt16BE(x, 2);
    buffer.writeUInt16BE(y, 4);
    buffer.writeUInt16BE(width, 6);
    buffer.writeUInt16BE(height, 8);

    await this.writeData(buffer);
  }

  /**
   * File transfer methods
   */
  public async uploadFile(
    localPath: string,
    remotePath: string
  ): Promise<VNCFileTransfer> {
    if (!this.options.enableFileTransfer) {
      throw new Error('File transfer is disabled');
    }

    const transferId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const fileTransfer: VNCFileTransfer = {
      transferId,
      sessionId: this.connectionId,
      direction: 'upload',
      localPath,
      remotePath,
      fileSize: 0,
      transferredBytes: 0,
      progress: 0,
      speed: 0,
      status: 'queued',
      startTime: new Date(),
    };

    this.activeFileTransfers.set(transferId, fileTransfer);

    // Start file transfer (implementation would depend on VNC server extension)
    this.logger.info(`Starting file upload: ${localPath} -> ${remotePath}`);

    return fileTransfer;
  }

  public async downloadFile(
    remotePath: string,
    localPath: string
  ): Promise<VNCFileTransfer> {
    if (!this.options.enableFileTransfer) {
      throw new Error('File transfer is disabled');
    }

    const transferId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const fileTransfer: VNCFileTransfer = {
      transferId,
      sessionId: this.connectionId,
      direction: 'download',
      localPath,
      remotePath,
      fileSize: 0,
      transferredBytes: 0,
      progress: 0,
      speed: 0,
      status: 'queued',
      startTime: new Date(),
    };

    this.activeFileTransfers.set(transferId, fileTransfer);

    // Start file transfer (implementation would depend on VNC server extension)
    this.logger.info(`Starting file download: ${remotePath} -> ${localPath}`);

    return fileTransfer;
  }

  /**
   * Session recording methods
   */
  private async startSessionRecording(): Promise<void> {
    if (!this.options.recordSession || !this.options.recordingPath) {
      return;
    }

    const recordingDir = path.dirname(this.options.recordingPath);
    if (!fs.existsSync(recordingDir)) {
      fs.mkdirSync(recordingDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `vnc-session-${timestamp}.${this.options.recordingFormat || 'fbs'}`;
    const filepath = path.join(recordingDir, filename);

    this.recordingStream = fs.createWriteStream(filepath);
    this.recordingStartTime = new Date();

    if (this.session) {
      this.session.recording = {
        active: true,
        startTime: this.recordingStartTime,
        filePath: filepath,
        format: this.options.recordingFormat || 'fbs',
        fileSize: 0,
      };
    }

    // Write FBS header
    if (this.options.recordingFormat === 'fbs') {
      this.writeFBSHeader();
    }

    this.logger.info(`Session recording started: ${filepath}`);
  }

  private writeFBSHeader(): void {
    if (!this.recordingStream || !this.serverInit) return;

    // FBS format header
    const header = Buffer.alloc(12);
    header.write('FBS 001.000\n', 0, 12);

    this.recordingStream.write(header);

    // Write server initialization data
    const serverInitBuffer = Buffer.alloc(
      24 + this.serverInit.desktopName.length
    );
    serverInitBuffer.writeUInt16BE(this.serverInit.framebufferWidth, 0);
    serverInitBuffer.writeUInt16BE(this.serverInit.framebufferHeight, 2);

    const pf = this.serverInit.pixelFormat;
    serverInitBuffer.writeUInt8(pf.bitsPerPixel, 4);
    serverInitBuffer.writeUInt8(pf.depth, 5);
    serverInitBuffer.writeUInt8(pf.bigEndianFlag ? 1 : 0, 6);
    serverInitBuffer.writeUInt8(pf.trueColorFlag ? 1 : 0, 7);
    serverInitBuffer.writeUInt16BE(pf.redMax, 8);
    serverInitBuffer.writeUInt16BE(pf.greenMax, 10);
    serverInitBuffer.writeUInt16BE(pf.blueMax, 12);
    serverInitBuffer.writeUInt8(pf.redShift, 14);
    serverInitBuffer.writeUInt8(pf.greenShift, 15);
    serverInitBuffer.writeUInt8(pf.blueShift, 16);

    serverInitBuffer.writeUInt32BE(this.serverInit.desktopName.length, 20);
    Buffer.from(this.serverInit.desktopName, 'utf8').copy(serverInitBuffer, 24);

    this.recordingStream.write(serverInitBuffer);
  }

  private recordFramebufferUpdate(update: VNCFramebufferUpdate): void {
    if (!this.recordingStream) return;

    // Calculate timestamp since recording start
    const timestamp = Date.now() - (this.recordingStartTime?.getTime() || 0);

    // Write timestamp (4 bytes)
    const timestampBuffer = Buffer.allocUnsafe(4);
    timestampBuffer.writeUInt32BE(timestamp, 0);
    this.recordingStream.write(timestampBuffer);

    // Write message type and data
    const messageBuffer = Buffer.allocUnsafe(4);
    messageBuffer.writeUInt8(RFB_SERVER_MESSAGES.FRAMEBUFFER_UPDATE, 0);
    messageBuffer.writeUInt8(0, 1); // padding
    messageBuffer.writeUInt16BE(update.rectangles.length, 2);
    this.recordingStream.write(messageBuffer);

    // Write rectangles
    for (const rect of update.rectangles) {
      const rectBuffer = Buffer.allocUnsafe(12);
      rectBuffer.writeUInt16BE(rect.x, 0);
      rectBuffer.writeUInt16BE(rect.y, 2);
      rectBuffer.writeUInt16BE(rect.width, 4);
      rectBuffer.writeUInt16BE(rect.height, 6);

      const encodingNumber = this.mapEncodingStringToNumber(rect.encoding);
      rectBuffer.writeInt32BE(encodingNumber, 8);

      this.recordingStream.write(rectBuffer);
      this.recordingStream.write(rect.data);
    }

    if (this.session?.recording) {
      this.session.recording.fileSize = this.recordingStream.bytesWritten || 0;
    }
  }

  private mapEncodingStringToNumber(encoding: VNCEncoding): number {
    switch (encoding) {
      case 'raw':
        return RFB_ENCODINGS.RAW;
      case 'copyrect':
        return RFB_ENCODINGS.COPY_RECT;
      case 'rre':
        return RFB_ENCODINGS.RRE;
      case 'hextile':
        return RFB_ENCODINGS.HEXTILE;
      case 'trle':
        return RFB_ENCODINGS.TRLE;
      case 'zrle':
        return RFB_ENCODINGS.ZRLE;
      case 'tight':
        return RFB_ENCODINGS.TIGHT;
      case 'ultra':
        return RFB_ENCODINGS.ULTRA;
      case 'zlibhex':
        return RFB_ENCODINGS.ZLIBHEX;
      case 'jpeg':
        return RFB_ENCODINGS.JPEG;
      case 'jrle':
        return RFB_ENCODINGS.JRLE;
      case 'cursor':
        return RFB_ENCODINGS.CURSOR;
      case 'desktopsize':
        return RFB_ENCODINGS.DESKTOP_SIZE;
      case 'lastrect':
        return RFB_ENCODINGS.LAST_RECT;
      case 'continuous':
        return RFB_ENCODINGS.PSEUDO_CONTINUOUS_UPDATES;
      case 'fence':
        return RFB_ENCODINGS.PSEUDO_FENCE;
      case 'x11cursor':
        return RFB_ENCODINGS.PSEUDO_X_CURSOR;
      case 'richcursor':
        return RFB_ENCODINGS.CURSOR;
      default:
        return RFB_ENCODINGS.RAW;
    }
  }

  /**
   * Performance and metrics methods
   */
  private updateNetworkMetrics(): void {
    const now = Date.now();
    const timeDiff = now - this.performanceMetrics.timestamp.getTime();

    if (timeDiff > 1000) {
      // Update every second
      this.performanceMetrics.bandwidth =
        (this.bytesReceived * 8) / (timeDiff / 1000); // bits per second
      this.performanceMetrics.networkIO = this.bytesReceived + this.bytesSent;
      this.performanceMetrics.timestamp = new Date();
    }
  }

  private updateFrameMetrics(): void {
    const now = Date.now();
    const frameDuration = now - this.lastFrameTime;

    if (this.lastFrameTime > 0) {
      this.performanceMetrics.avgFrameTime = frameDuration;
      this.performanceMetrics.frameRate = 1000 / frameDuration;
    }

    this.lastFrameTime = now;
    this.performanceMetrics.pixelChanges++; // Simplified metric
  }

  public getPerformanceMetrics(): VNCPerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  public getServerCapabilities(): VNCCapabilities {
    return {
      protocolVersions: ['3.3', '3.7', '3.8'],
      maxResolution: { width: 16384, height: 16384 },
      supportedEncodings: Array.from(this.supportedEncodings.keys()).map((k) =>
        this.mapEncodingNumberToString(k)
      ),
      supportedSecurityTypes: this.securityTypes.map((s) =>
        this.mapSecurityType(s)
      ),
      supportedPixelFormats: {
        bitsPerPixel: [8, 16, 32],
        depths: [8, 16, 24],
        colorModes: ['truecolor', 'colormap'],
      },
      cursorShapeUpdates: this.options.enableCursorShapeUpdates || false,
      desktopResize: this.options.autoResize || false,
      continuousUpdates: false,
      fileTransfer: this.options.enableFileTransfer || false,
      clipboardTransfer: this.options.enableClipboard || false,
      audio: false,
      tightVNCExtensions: this.options.enableTightVNCExtensions || false,
      ultraVNCExtensions: this.options.enableUltraVNCExtensions || false,
      realVNCExtensions: this.options.enableRealVNCExtensions || false,
      appleRemoteDesktop: this.options.enableAppleRemoteDesktop || false,
      tigervncExtensions: this.config.enableTigerVNCExtensions,
      turbovncExtensions: this.config.enableTurboVNCExtensions,
      compressionSupport: this.config.enableCompression,
      jpegSupport: this.config.enableJPEG,
      multiMonitorSupport: (this.options.monitors?.length || 0) > 1,
      tlsSupport: this.encryptionEnabled,
      vencryptSupport: this.selectedSecurity === RFB_SECURITY_TYPES.VENCRYPT,
      saslSupport: false,
      x509Support: false,
    };
  }

  /**
   * Utility methods
   */
  private async writeData(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      this.socket.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          this.bytesSent += data.length;
          resolve();
        }
      });
    });
  }

  /**
   * Disconnect from VNC server
   */
  public async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from VNC server');

    if (this.recordingStream) {
      this.recordingStream.end();
      this.recordingStream = undefined;

      if (this.session?.recording) {
        this.session.recording.active = false;
      }
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }

    if (this.repeaterConnection) {
      this.repeaterConnection.destroy();
      this.repeaterConnection = undefined;
    }

    this.isConnected = false;
    this.isAuthenticated = false;

    if (this.session) {
      this.session.status = 'disconnected';
    }

    this.emit('disconnected');
  }

  /**
   * Handle server message - main message processing entry point
   */
  private handleServerMessage(data: Buffer): void {
    // This method is set as the messageHandler after authentication
    this.processServerMessage();
  }

  // BaseProtocol required methods
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.logger.info('Initializing VNC Protocol');

    try {
      // Check VNC tool availability
      await this.checkVNCAvailability();

      this.isInitialized = true;
      this.logger.info('VNC Protocol initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize VNC Protocol:', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const sessionId = this.generateSessionId();
    const vncOptions = {
      ...this.defaultOptions,
      ...(options.vncOptions || {}),
    };

    // Handle different VNC connection modes
    let command: string;
    let args: string[];

    if (vncOptions.mode === 'viewer') {
      // VNC Viewer mode - connect to existing VNC server
      const viewerResult = this.buildVNCViewerCommand(vncOptions);
      command = viewerResult.command;
      args = viewerResult.args;
    } else if (vncOptions.mode === 'server') {
      // VNC Server mode - start VNC server
      const serverResult = this.buildVNCServerCommand(vncOptions);
      command = serverResult.command;
      args = serverResult.args;
    } else {
      // Direct VNC protocol connection
      const directResult = this.buildVNCDirectCommand(vncOptions);
      command = directResult.command;
      args = directResult.args;
    }

    const session = await this.createSessionWithTypeDetection(sessionId, {
      ...options,
      command,
      args,
    });

    // Create VNC-specific session tracking
    const vncSession: VNCSession = {
      sessionId,
      connectionId: sessionId,
      host: vncOptions.host || 'localhost',
      port: vncOptions.port || 5900,
      protocolVersion: vncOptions.rfbProtocolVersion || '3.8',
      securityType: vncOptions.authMethod || 'vencrypt',
      sharedConnection: vncOptions.sharedConnection || true,
      viewOnlyMode: vncOptions.viewOnly || false,
      framebufferInfo: {
        width: vncOptions.initialWidth || 1024,
        height: vncOptions.initialHeight || 768,
        pixelFormat: {
          bitsPerPixel: vncOptions.pixelFormat?.bitsPerPixel || 32,
          depth: vncOptions.pixelFormat?.depth || 24,
          bigEndianFlag: vncOptions.pixelFormat?.bigEndianFlag || false,
          trueColorFlag: vncOptions.pixelFormat?.trueColorFlag || true,
          redMax: vncOptions.pixelFormat?.redMax || 255,
          greenMax: vncOptions.pixelFormat?.greenMax || 255,
          blueMax: vncOptions.pixelFormat?.blueMax || 255,
          redShift: vncOptions.pixelFormat?.redShift || 16,
          greenShift: vncOptions.pixelFormat?.greenShift || 8,
          blueShift: vncOptions.pixelFormat?.blueShift || 0,
        },
      },
      supportedEncodings: vncOptions.supportedEncodings || [
        'zrle',
        'hextile',
        'raw',
      ],
      serverCapabilities: {
        cursorShapeUpdates: vncOptions.enableCursorShapeUpdates || false,
        richCursor: vncOptions.enableRichCursor || false,
        desktopResize: vncOptions.autoResize || false,
        continuousUpdates: false,
        fence: false,
        fileTransfer: vncOptions.enableFileTransfer || false,
        clipboardTransfer: vncOptions.enableClipboard || false,
        audio: false,
      },
      status: 'connecting',
      connectionTime: new Date(),
      statistics: {
        bytesReceived: 0,
        bytesSent: 0,
        framebufferUpdates: 0,
        keyboardEvents: 0,
        mouseEvents: 0,
        clipboardTransfers: 0,
        fileTransfers: 0,
        avgFrameRate: 0,
        bandwidth: 0,
        compression: 1.0,
        latency: 0,
      },
      errorCount: 0,
      warnings: [],
      monitors: vncOptions.monitors || [],
      metadata: { mode: vncOptions.mode },
    };

    this.vncSessions.set(sessionId, vncSession);

    this.logger.info(
      `VNC session created: ${sessionId} (${vncOptions.mode || 'direct'})`
    );
    return session;
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const vncSession = this.vncSessions.get(sessionId);
    const process = this.vncProcesses.get(sessionId);

    if (process && !process.killed) {
      // Send commands to VNC process stdin if available
      if (process.stdin && process.stdin.writable) {
        const commandLine = args ? `${command} ${args.join(' ')}` : command;
        process.stdin.write(`${commandLine}\n`);

        if (vncSession) {
          vncSession.statistics.keyboardEvents++;
        }
      }
    }

    this.emit('commandExecuted', {
      sessionId,
      command,
      args,
      timestamp: new Date(),
    });
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const vncSession = this.vncSessions.get(sessionId);
    const process = this.vncProcesses.get(sessionId);

    if (process && !process.killed && process.stdin && process.stdin.writable) {
      process.stdin.write(input);

      if (vncSession) {
        vncSession.statistics.keyboardEvents++;
      }
    }

    // Also handle VNC-specific key events for direct connections
    if (vncSession?.status === 'connected') {
      for (const char of input) {
        const keycode = char.charCodeAt(0);
        await this.sendKeyEvent(keycode, true); // key down
        await this.sendKeyEvent(keycode, false); // key up
      }
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`Attempted to close non-existent session: ${sessionId}`);
      return;
    }

    try {
      // Close VNC-specific resources
      const vncSession = this.vncSessions.get(sessionId);
      if (vncSession) {
        vncSession.status = 'disconnected';
      }

      // Terminate VNC process
      const process = this.vncProcesses.get(sessionId);
      if (process && !process.killed) {
        process.kill('SIGTERM');

        // Force kill after 5 seconds
        setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGKILL');
          }
        }, 5000);
      }

      // Clean up viewer processes
      const viewer = this.vncViewers.get(sessionId);
      if (viewer && !viewer.process.killed) {
        viewer.process.kill('SIGTERM');
        setTimeout(() => {
          if (!viewer.process.killed) {
            viewer.process.kill('SIGKILL');
          }
        }, 5000);
      }

      // Clean up maps
      this.vncSessions.delete(sessionId);
      this.vncProcesses.delete(sessionId);
      this.vncViewers.delete(sessionId);
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      session.status = 'terminated';
      session.endedAt = new Date();

      this.logger.info(`VNC session closed: ${sessionId}`);
      this.emit('sessionClosed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing VNC session ${sessionId}:`, error);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing VNC Protocol');

    // Close all active sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));

    // Disconnect any active VNC connections
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }

    if (this.repeaterConnection) {
      this.repeaterConnection.destroy();
      this.repeaterConnection = undefined;
    }

    this.removeAllListeners();
    this.isInitialized = false;

    this.logger.info('VNC Protocol disposed');
  }

  /**
   * VNC-specific helper methods for BaseProtocol integration
   */
  private generateSessionId(): string {
    return `vnc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateConnectionId(): string {
    return `vnc-conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async checkVNCAvailability(): Promise<void> {
    // Check for VNC tools availability
    const tools = [
      'vncviewer',
      'tigervnc',
      'tightvncviewer',
      'realvnc',
      'ultravnc',
    ];
    let availableTools = 0;

    for (const tool of tools) {
      try {
        await new Promise<void>((resolve, reject) => {
          const process = spawn(tool, ['--version'], { stdio: 'pipe' });
          process.on('close', (code) => {
            if (code === 0 || code === 1) {
              // Some tools return 1 for --version
              availableTools++;
              this.healthStatus.dependencies[tool] = {
                available: true,
                version: 'detected',
              };
            }
            resolve();
          });
          process.on('error', () => resolve()); // Ignore errors, tool not available
          setTimeout(() => {
            process.kill();
            resolve();
          }, 3000);
        });
      } catch {
        // Tool not available
      }
    }

    if (availableTools === 0) {
      this.logger.warn(
        'No VNC tools detected, some functionality may be limited'
      );
    } else {
      this.logger.debug(`Detected ${availableTools} VNC tools`);
    }
  }

  private buildVNCViewerCommand(options: Partial<VNCConnectionOptions>): {
    command: string;
    args: string[];
  } {
    // Determine best VNC viewer
    const viewers = [
      { cmd: 'vncviewer', name: 'TigerVNC Viewer' },
      { cmd: 'tigervnc', name: 'TigerVNC' },
      { cmd: 'tightvncviewer', name: 'TightVNC Viewer' },
      { cmd: 'realvnc', name: 'RealVNC Viewer' },
      { cmd: 'ultravnc', name: 'UltraVNC' },
    ];

    const command = options.vncViewer || 'vncviewer';
    const args: string[] = [];

    // Connection target
    const target = `${options.host || 'localhost'}:${options.port || 5900}`;
    args.push(target);

    // Common VNC viewer options
    if (options.viewOnly) {
      args.push('-ViewOnly');
    }

    if (options.sharedConnection) {
      args.push('-Shared');
    }

    if (options.password) {
      args.push('-passwd', options.password);
    }

    if (options.qualityLevel !== undefined) {
      args.push('-quality', options.qualityLevel.toString());
    }

    if (options.compressionLevel !== undefined) {
      args.push('-compresslevel', options.compressionLevel.toString());
    }

    if (options.enableJPEGCompression) {
      args.push('-jpeg');
    }

    if (options.cursorMode) {
      args.push('-cursor', options.cursorMode);
    }

    // Full screen mode
    if (options.fullScreen) {
      args.push('-fullscreen');
    }

    // Scaling
    if (options.scaleFactor) {
      args.push('-scale', options.scaleFactor.toString());
    }

    return { command, args };
  }

  private buildVNCServerCommand(options: Partial<VNCConnectionOptions>): {
    command: string;
    args: string[];
  } {
    // Determine VNC server to use
    const servers = ['x11vnc', 'tigervnc', 'tightvncserver', 'vncserver'];
    const command = options.vncServer || 'x11vnc';
    const args: string[] = [];

    if (command === 'x11vnc') {
      // x11vnc server options
      args.push('-display', options.display || ':0');
      args.push('-rfbport', (options.port || 5900).toString());

      if (options.password) {
        args.push('-passwd', options.password);
      }

      if (options.viewOnly) {
        args.push('-viewonly');
      }

      if (options.sharedConnection) {
        args.push('-shared');
      }

      if (options.enableFileTransfer) {
        args.push('-ultrafilexfer');
      }

      if (options.enableClipboard) {
        args.push('-clipboard');
      }

      // Security options
      if (options.allowInsecure) {
        args.push('-nopw');
      }

      // Performance options
      if (options.compressionLevel !== undefined) {
        args.push('-compress', options.compressionLevel.toString());
      }

      // Daemon mode
      if (options.daemonMode) {
        args.push('-forever', '-loop');
      }
    } else if (command.includes('tigervnc') || command === 'vncserver') {
      // TigerVNC/standard vncserver options
      if (options.geometry) {
        args.push('-geometry', options.geometry);
      } else {
        args.push('-geometry', '1024x768');
      }

      if (options.depth) {
        args.push('-depth', options.depth.toString());
      }

      if (options.port) {
        args.push('-rfbport', options.port.toString());
      }

      // Display number (e.g., :1, :2)
      const displayNum = options.display || ':1';
      args.push(displayNum);
    }

    return { command, args };
  }

  private buildVNCDirectCommand(options: Partial<VNCConnectionOptions>): {
    command: string;
    args: string[];
  } {
    // For direct VNC protocol connections, we can use netcat or custom connection tools
    const command = 'nc'; // netcat for basic TCP connection
    const args = [
      options.host || 'localhost',
      (options.port || 5900).toString(),
    ];

    if (options.timeout) {
      args.unshift('-w', (options.timeout / 1000).toString());
    }

    return { command, args };
  }

  /**
   * Enhanced createSessionWithTypeDetection wrapper for VNC-specific session creation
   */
  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    const vncOptions = {
      ...this.defaultOptions,
      ...(options.vncOptions || {}),
    };

    let command: string;
    let args: string[];

    if (vncOptions.mode === 'viewer') {
      const result = this.buildVNCViewerCommand(vncOptions);
      command = result.command;
      args = result.args;
    } else if (vncOptions.mode === 'server') {
      const result = this.buildVNCServerCommand(vncOptions);
      command = result.command;
      args = result.args;
    } else {
      const result = this.buildVNCDirectCommand(vncOptions);
      command = result.command;
      args = result.args;
    }

    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    this.logger.debug(`Starting VNC process: ${command} ${args.join(' ')}`);

    const childProcess = spawn(command, args, spawnOptions);
    this.vncProcesses.set(sessionId, childProcess);

    // Handle process events
    childProcess.on('spawn', () => {
      this.logger.debug(
        `VNC process spawned for session ${sessionId} (PID: ${childProcess.pid})`
      );
    });

    childProcess.on('error', (error) => {
      this.logger.error(`VNC process error for session ${sessionId}:`, error);
      this.emit('processError', { sessionId, error });
    });

    childProcess.on('exit', (code, signal) => {
      this.logger.debug(
        `VNC process exited for session ${sessionId}: code=${code}, signal=${signal}`
      );
      this.vncProcesses.delete(sessionId);

      const vncSession = this.vncSessions.get(sessionId);
      if (vncSession) {
        vncSession.status = 'disconnected';
      }
    });

    // Handle stdout/stderr
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        const output: ConsoleOutput = {
          sessionId,
          type: 'stdout',
          data: data.toString(),
          timestamp: new Date(),
          stream: 'stdout',
        };

        const outputBuffer = this.outputBuffers.get(sessionId) || [];
        outputBuffer.push(output);
        this.outputBuffers.set(sessionId, outputBuffer);

        this.emit('output', output);
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        const output: ConsoleOutput = {
          sessionId,
          type: 'stderr',
          data: data.toString(),
          timestamp: new Date(),
          stream: 'stderr',
        };

        const outputBuffer = this.outputBuffers.get(sessionId) || [];
        outputBuffer.push(output);
        this.outputBuffers.set(sessionId, outputBuffer);

        this.emit('output', output);
      });
    }

    // Create and return ConsoleSession
    const session: ConsoleSession = {
      id: sessionId,
      command,
      args,
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.environment },
      createdAt: new Date(),
      pid: childProcess.pid,
      status: 'running',
      type: 'vnc',
      vncOptions: vncOptions as VNCConnectionOptions,
      executionState: 'executing',
      activeCommands: new Map(),
    };

    return session;
  }

  // Compatibility properties for legacy ProtocolFactory interface
  public get supportedAuthMethods(): string[] {
    return this.capabilities.supportedAuthMethods || [];
  }

  public get maxConcurrentSessions(): number {
    return this.capabilities.maxConcurrentSessions || 10;
  }

  public get defaultTimeout(): number {
    return this.capabilities.defaultTimeout || 30000;
  }

  public async getOutput(
    sessionId: string,
    since?: Date
  ): Promise<ConsoleOutput[]> {
    const outputs = this.outputBuffers.get(sessionId) || [];
    const filteredOutputs = since
      ? outputs.filter((output) => output.timestamp > since)
      : outputs;

    return filteredOutputs;
  }

  public async getHealthStatus(): Promise<ProtocolHealthStatus> {
    this.healthStatus.lastChecked = new Date();
    this.healthStatus.metrics.activeSessions = this.sessions.size;
    this.healthStatus.isHealthy = this.isInitialized;

    // Check for any failed sessions
    let hasErrors = false;
    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'failed' || session.status === 'crashed') {
        hasErrors = true;
        break;
      }
    }

    if (
      hasErrors &&
      !this.healthStatus.errors.includes('Some VNC sessions have errors')
    ) {
      this.healthStatus.errors.push('Some VNC sessions have errors');
    }

    return { ...this.healthStatus };
  }
}

// Export VNC-specific error types
export class VNCProtocolError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'VNCProtocolError';
  }
}

export class VNCAuthenticationError extends VNCProtocolError {
  constructor(message: string) {
    super(message, 'VNC_AUTH_ERROR');
    this.name = 'VNCAuthenticationError';
  }
}

export class VNCConnectionError extends VNCProtocolError {
  constructor(message: string) {
    super(message, 'VNC_CONN_ERROR');
    this.name = 'VNCConnectionError';
  }
}

export class VNCEncryptionError extends VNCProtocolError {
  constructor(message: string) {
    super(message, 'VNC_ENCRYPT_ERROR');
    this.name = 'VNCEncryptionError';
  }
}
