import { SerialPort, SerialPortOpenOptions } from 'serialport';
import { AutoDetectTypes } from '@serialport/bindings-cpp';
import { ReadlineParser } from '@serialport/parser-readline';
import { ByteLengthParser } from '@serialport/parser-byte-length';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';
import { 
  SerialConnectionOptions, 
  SerialDeviceInfo, 
  SerialProtocolProfile, 
  ConsoleSession, 
  ConsoleOutput, 
  ConsoleEvent,
  SessionOptions,
  ConsoleType
} from '../types/index.js';
import { IProtocol, ProtocolCapabilities, ProtocolHealthStatus } from '../core/ProtocolFactory.js';
import { Logger } from '../utils/logger.js';

/**
 * Production-ready Serial/COM port protocol implementation for embedded device communication
 * Supports Arduino, ESP32, and various USB serial adapters (FTDI, CH340, CP2102)
 */
export class SerialProtocol extends EventEmitter implements IProtocol {
  public readonly type = 'serial' as const;
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;
  private connections: Map<string, SerialConnectionState> = new Map();
  private deviceProfiles: Map<string, SerialProtocolProfile> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private logger: Logger;
  
  private static readonly DEFAULT_BAUD_RATES = [
    110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 
    38400, 57600, 115200, 128000, 256000, 460800, 921600
  ];

  private static readonly DEVICE_VENDOR_IDS = {
    ARDUINO: ['2341', '2A03', '1B4F'],
    FTDI: ['0403'],
    CH340: ['1A86'],
    CP2102: ['10C4', '1BA4'],
    ESP32: ['303A', '1A86', '0403'] // Various ESP32 board manufacturers
  };

  constructor() {
    super();
    this.logger = new Logger('SerialProtocol');
    
    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: false,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: false,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: false,
      supportsWorkingDirectory: false,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 10,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'ascii', 'binary'],
      supportedAuthMethods: [],
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
        serialport: {
          available: true,
          version: '12.x',
        },
      },
    };
    
    this.initializeDeviceProfiles();
    this.startDeviceMonitoring();
  }

  /**
   * Initialize predefined device profiles for common embedded platforms
   */
  private initializeDeviceProfiles(): void {
    // Arduino Uno/Nano/Pro Mini profile
    this.deviceProfiles.set('arduino_uno', {
      name: 'Arduino Uno/Nano',
      deviceType: 'arduino',
      defaultBaudRate: 9600,
      supportedBaudRates: [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 115200],
      defaultSettings: {
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: false,
        dtr: true,
        rts: true,
        resetOnConnect: true,
        resetDelay: 100,
        lineEnding: '\r\n',
        encoding: 'ascii',
        timeout: 5000
      },
      resetSequence: {
        dtr: false,
        rts: true,
        delay: 100,
        pulseWidth: 50
      },
      bootloaderDetection: {
        patterns: [/avrdude/i, /STK500/i],
        timeout: 2000
      },
      commandProtocol: {
        commandTerminator: '\r\n',
        responseTerminator: '\r\n',
        timeout: 3000,
        retryCount: 3
      }
    });

    // ESP32 profile
    this.deviceProfiles.set('esp32', {
      name: 'ESP32',
      deviceType: 'esp32',
      defaultBaudRate: 115200,
      supportedBaudRates: [9600, 57600, 115200, 230400, 460800, 921600],
      defaultSettings: {
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: false,
        dtr: true,
        rts: true,
        resetOnConnect: false,
        resetDelay: 250,
        lineEnding: '\r\n',
        encoding: 'utf8',
        timeout: 10000,
        bufferSize: 8192
      },
      resetSequence: {
        dtr: false,
        rts: false,
        delay: 250,
        pulseWidth: 100
      },
      bootloaderDetection: {
        patterns: [/esptool/i, /ESP32/i, /Brownout detector/i],
        timeout: 5000
      },
      commandProtocol: {
        commandTerminator: '\r\n',
        responseTerminator: '\r\n',
        timeout: 5000,
        retryCount: 2
      }
    });

    // Generic UART device profile
    this.deviceProfiles.set('generic', {
      name: 'Generic UART',
      deviceType: 'generic',
      defaultBaudRate: 9600,
      supportedBaudRates: SerialProtocol.DEFAULT_BAUD_RATES,
      defaultSettings: {
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: false,
        lineEnding: '\n',
        encoding: 'ascii',
        timeout: 5000
      },
      commandProtocol: {
        commandTerminator: '\n',
        responseTerminator: '\n',
        timeout: 3000,
        retryCount: 1
      }
    });
  }

  /**
   * Discover and enumerate all available serial devices
   */
  async discoverDevices(): Promise<SerialDeviceInfo[]> {
    try {
      const ports = await SerialPort.list();
      const devices: SerialDeviceInfo[] = [];

      for (const port of ports) {
        const deviceInfo: SerialDeviceInfo = {
          path: port.path,
          manufacturer: port.manufacturer,
          serialNumber: port.serialNumber,
          pnpId: port.pnpId,
          locationId: port.locationId,
          vendorId: port.vendorId,
          productId: port.productId,
          description: port.manufacturer || 'Unknown Device',
          isConnected: false,
          deviceType: this.detectDeviceType(port.vendorId, port.productId, port.manufacturer),
          supportedBaudRates: this.getSupportedBaudRates(port.vendorId),
          capabilities: this.getDeviceCapabilities(port.vendorId)
        };

        devices.push(deviceInfo);
      }

      this.logger.info(`Discovered ${devices.length} serial devices`);
      return devices;
    } catch (error) {
      this.logger.error('Failed to discover serial devices:', error);
      throw new Error(`Serial device discovery failed: ${error.message}`);
    }
  }

  /**
   * Detect device type based on vendor/product IDs and manufacturer
   */
  private detectDeviceType(vendorId?: string, productId?: string, manufacturer?: string): SerialDeviceInfo['deviceType'] {
    if (!vendorId) return 'generic';

    const vid = vendorId.toUpperCase();

    if (SerialProtocol.DEVICE_VENDOR_IDS.ARDUINO.includes(vid)) {
      return 'arduino';
    }
    if (SerialProtocol.DEVICE_VENDOR_IDS.FTDI.includes(vid)) {
      return 'ftdi';
    }
    if (SerialProtocol.DEVICE_VENDOR_IDS.CH340.includes(vid)) {
      return 'ch340';
    }
    if (SerialProtocol.DEVICE_VENDOR_IDS.CP2102.includes(vid)) {
      return 'cp2102';
    }
    if (SerialProtocol.DEVICE_VENDOR_IDS.ESP32.includes(vid)) {
      return 'esp32';
    }

    // Additional detection based on manufacturer string
    if (manufacturer) {
      const mfg = manufacturer.toLowerCase();
      if (mfg.includes('arduino') || mfg.includes('arduino.cc')) return 'arduino';
      if (mfg.includes('espressif') || mfg.includes('esp32')) return 'esp32';
      if (mfg.includes('ftdi')) return 'ftdi';
      if (mfg.includes('qinheng') || mfg.includes('ch340')) return 'ch340';
      if (mfg.includes('silicon labs') || mfg.includes('cp210')) return 'cp2102';
    }

    return 'generic';
  }

  /**
   * Get supported baud rates for device type
   */
  private getSupportedBaudRates(vendorId?: string): number[] {
    const deviceType = this.detectDeviceType(vendorId);
    
    switch (deviceType) {
      case 'esp32':
        return [9600, 57600, 115200, 230400, 460800, 921600];
      case 'arduino':
        return [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 115200];
      case 'ftdi':
        return [110, 300, 600, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
      default:
        return SerialProtocol.DEFAULT_BAUD_RATES;
    }
  }

  /**
   * Get device capabilities based on vendor ID
   */
  private getDeviceCapabilities(vendorId?: string) {
    const deviceType = this.detectDeviceType(vendorId);
    
    return {
      hardwareFlowControl: ['ftdi', 'cp2102'].includes(deviceType),
      softwareFlowControl: true,
      dtrRtsControl: true,
      breakSignal: ['ftdi', 'cp2102'].includes(deviceType)
    };
  }

  /**
   * Create a new serial connection
   */
  async createConnection(sessionId: string, options: SerialConnectionOptions): Promise<void> {
    try {
      // Apply device profile defaults if available
      const enhancedOptions = await this.enhanceOptionsWithProfile(options);
      
      // Validate the serial port path
      await this.validateSerialPort(enhancedOptions.path);

      const serialOptions: SerialPortOpenOptions<AutoDetectTypes> = {
        path: enhancedOptions.path,
        baudRate: enhancedOptions.baudRate || 9600,
        dataBits: enhancedOptions.dataBits || 8,
        stopBits: enhancedOptions.stopBits || 1,
        parity: enhancedOptions.parity || 'none',
        rtscts: enhancedOptions.rtscts || false,
        xon: enhancedOptions.xon || false,
        xoff: enhancedOptions.xoff || false,
        xany: enhancedOptions.xany || false,
        hupcl: enhancedOptions.hupcl !== false,
        autoOpen: enhancedOptions.autoOpen !== false,
        lock: enhancedOptions.lock !== false,
        highWaterMark: enhancedOptions.highWaterMark || 65536,
        vmin: enhancedOptions.vmin || 1,
        vtime: enhancedOptions.vtime || 0
      };

      const serialPort = new SerialPort(serialOptions);

      const connectionState: SerialConnectionState = {
        sessionId,
        port: serialPort,
        options: enhancedOptions,
        isConnected: false,
        reconnectAttempts: 0,
        lastActivity: new Date(),
        outputBuffer: [],
        parsers: new Map(),
        deviceInfo: await this.getDeviceInfoForPath(enhancedOptions.path)
      };

      this.connections.set(sessionId, connectionState);
      this.setupSerialPortHandlers(sessionId, connectionState);
      this.setupParsers(sessionId, connectionState);

      // Handle device reset if required
      if (enhancedOptions.resetOnConnect) {
        await this.performDeviceReset(sessionId);
      }

      this.logger.info(`Serial connection created for session ${sessionId} on ${enhancedOptions.path}`);
    } catch (error) {
      this.logger.error(`Failed to create serial connection for session ${sessionId}:`, error);
      throw new Error(`Serial connection failed: ${error.message}`);
    }
  }

  /**
   * Enhance options with device profile defaults
   */
  private async enhanceOptionsWithProfile(options: SerialConnectionOptions): Promise<SerialConnectionOptions> {
    let profile: SerialProtocolProfile | undefined;

    // Use explicit device type or detect from path
    if (options.deviceType) {
      profile = this.getProfileForDeviceType(options.deviceType);
    } else {
      const deviceInfo = await this.getDeviceInfoForPath(options.path);
      if (deviceInfo?.deviceType) {
        profile = this.getProfileForDeviceType(deviceInfo.deviceType);
      }
    }

    if (!profile) {
      profile = this.deviceProfiles.get('generic');
    }

    // Merge profile defaults with user options (user options take precedence)
    return {
      ...profile?.defaultSettings,
      ...options,
      baudRate: options.baudRate || profile?.defaultBaudRate || 9600
    };
  }

  /**
   * Get profile for device type
   */
  private getProfileForDeviceType(deviceType: SerialDeviceInfo['deviceType']): SerialProtocolProfile | undefined {
    switch (deviceType) {
      case 'arduino':
        return this.deviceProfiles.get('arduino_uno');
      case 'esp32':
        return this.deviceProfiles.get('esp32');
      default:
        return this.deviceProfiles.get('generic');
    }
  }

  /**
   * Validate that the serial port exists and is available
   */
  private async validateSerialPort(path: string): Promise<void> {
    try {
      const ports = await SerialPort.list();
      const portExists = ports.some(port => port.path === path);
      
      if (!portExists) {
        throw new Error(`Serial port ${path} not found`);
      }
    } catch (error) {
      throw new Error(`Serial port validation failed: ${error.message}`);
    }
  }

  /**
   * Get device info for a specific path
   */
  private async getDeviceInfoForPath(path: string): Promise<SerialDeviceInfo | undefined> {
    try {
      const devices = await this.discoverDevices();
      return devices.find(device => device.path === path);
    } catch (error) {
      this.logger.warn(`Failed to get device info for ${path}:`, error);
      return undefined;
    }
  }

  /**
   * Setup serial port event handlers
   */
  private setupSerialPortHandlers(sessionId: string, connectionState: SerialConnectionState): void {
    const { port } = connectionState;

    port.on('open', () => {
      connectionState.isConnected = true;
      connectionState.reconnectAttempts = 0;
      connectionState.lastActivity = new Date();
      
      // Apply DTR/RTS settings after connection
      this.applySignalSettings(sessionId);
      
      this.logger.info(`Serial port opened for session ${sessionId}`);
      this.emit('connection', { sessionId, type: 'connected' });
    });

    port.on('data', (data: Buffer) => {
      this.handleSerialData(sessionId, data);
    });

    port.on('error', (error: Error) => {
      this.logger.error(`Serial port error for session ${sessionId}:`, error);
      connectionState.isConnected = false;
      
      this.emit('error', {
        sessionId,
        type: 'connection_error',
        error: error.message
      });

      // Attempt reconnection if enabled
      if (connectionState.options.reconnectOnDisconnect) {
        this.scheduleReconnect(sessionId);
      }
    });

    port.on('close', () => {
      this.logger.info(`Serial port closed for session ${sessionId}`);
      connectionState.isConnected = false;
      
      this.emit('disconnection', { sessionId, type: 'disconnected' });

      // Attempt reconnection if enabled
      if (connectionState.options.reconnectOnDisconnect) {
        this.scheduleReconnect(sessionId);
      }
    });
  }

  /**
   * Setup data parsers based on connection options
   */
  private setupParsers(sessionId: string, connectionState: SerialConnectionState): void {
    const { port, options } = connectionState;

    // Setup line-based parser for text mode
    if (options.encoding !== 'binary') {
      const lineParser = port.pipe(new ReadlineParser({
        delimiter: options.lineEnding || '\r\n',
        encoding: options.encoding as BufferEncoding || 'utf8',
        includeDelimiter: false
      }));

      lineParser.on('data', (line: string) => {
        this.handleParsedLine(sessionId, line);
      });

      connectionState.parsers.set('readline', lineParser);
    }

    // Setup binary parser if specified
    if (options.encoding === 'binary' && options.bufferSize) {
      const binaryParser = port.pipe(new ByteLengthParser({
        length: options.bufferSize
      }));

      binaryParser.on('data', (data: Buffer) => {
        this.handleBinaryData(sessionId, data);
      });

      connectionState.parsers.set('binary', binaryParser);
    }
  }

  /**
   * Apply DTR/RTS signal settings
   */
  private async applySignalSettings(sessionId: string): Promise<void> {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return;

    const { port, options } = connectionState;

    try {
      if (options.dtr !== undefined) {
        await new Promise<void>((resolve, reject) => {
          port.set({ dtr: options.dtr }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }

      if (options.rts !== undefined) {
        await new Promise<void>((resolve, reject) => {
          port.set({ rts: options.rts }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }

      this.logger.debug(`Applied signal settings for session ${sessionId}`, {
        dtr: options.dtr,
        rts: options.rts
      });
    } catch (error) {
      this.logger.error(`Failed to apply signal settings for session ${sessionId}:`, error);
    }
  }

  /**
   * Perform device reset sequence (e.g., Arduino reset)
   */
  async performDeviceReset(sessionId: string): Promise<void> {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return;

    const { port, options, deviceInfo } = connectionState;
    const profile = deviceInfo ? this.getProfileForDeviceType(deviceInfo.deviceType) : undefined;
    const resetSequence = profile?.resetSequence;

    if (!resetSequence) {
      this.logger.debug(`No reset sequence defined for session ${sessionId}`);
      return;
    }

    try {
      this.logger.info(`Performing device reset for session ${sessionId}`);

      // Apply reset sequence
      await new Promise<void>((resolve, reject) => {
        port.set({ 
          dtr: resetSequence.dtr || false,
          rts: resetSequence.rts || false
        }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      // Wait for pulse width
      await new Promise(resolve => setTimeout(resolve, resetSequence.pulseWidth || 50));

      // Release reset
      await new Promise<void>((resolve, reject) => {
        port.set({ 
          dtr: !resetSequence.dtr,
          rts: !resetSequence.rts
        }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      // Wait for reset delay
      await new Promise(resolve => setTimeout(resolve, resetSequence.delay || 100));

      this.logger.info(`Device reset completed for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Device reset failed for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming serial data
   */
  private handleSerialData(sessionId: string, data: Buffer): void {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return;

    connectionState.lastActivity = new Date();

    // Store raw data
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: data.toString(connectionState.options.encoding as BufferEncoding || 'utf8'),
      timestamp: new Date(),
      raw: data.toString('hex')
    };

    connectionState.outputBuffer.push(output);

    // Emit raw data event
    this.emit('data', output);
  }

  /**
   * Handle parsed line data
   */
  private handleParsedLine(sessionId: string, line: string): void {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return;

    // Clean line of ANSI escape codes
    const cleanLine = stripAnsi(line);

    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: cleanLine,
      timestamp: new Date()
    };

    this.emit('line', output);

    // Check for bootloader patterns if device is in reset state
    const profile = connectionState.deviceInfo ? 
      this.getProfileForDeviceType(connectionState.deviceInfo.deviceType) : undefined;
    
    if (profile?.bootloaderDetection) {
      const patterns = profile.bootloaderDetection.patterns;
      if (patterns.some(pattern => pattern.test(cleanLine))) {
        this.emit('bootloader_detected', { sessionId, line: cleanLine });
      }
    }
  }

  /**
   * Handle binary data
   */
  private handleBinaryData(sessionId: string, data: Buffer): void {
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: data.toString('hex'),
      timestamp: new Date(),
      raw: data.toString('hex')
    };

    this.emit('binary_data', output);
  }

  /**
   * Send data to serial device
   */
  async sendData(sessionId: string, data: string | Buffer): Promise<void> {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState || !connectionState.isConnected) {
      throw new Error(`No active serial connection for session ${sessionId}`);
    }

    const { port, options } = connectionState;

    try {
      let dataToSend: Buffer;

      if (typeof data === 'string') {
        // Add line ending if specified
        const dataWithEnding = options.lineEnding ? 
          data + options.lineEnding : data;
        
        dataToSend = Buffer.from(dataWithEnding, options.encoding as BufferEncoding || 'utf8');
      } else {
        dataToSend = data;
      }

      await new Promise<void>((resolve, reject) => {
        port.write(dataToSend, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      connectionState.lastActivity = new Date();
      
      this.logger.debug(`Sent data to session ${sessionId}:`, {
        length: dataToSend.length,
        type: typeof data
      });

    } catch (error) {
      this.logger.error(`Failed to send data to session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Close serial connection
   */
  async closeConnection(sessionId: string): Promise<void> {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return;

    // Cancel any pending reconnection
    const reconnectTimer = this.reconnectTimers.get(sessionId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(sessionId);
    }

    try {
      if (connectionState.port.isOpen) {
        await new Promise<void>((resolve) => {
          connectionState.port.close(() => resolve());
        });
      }
      
      this.connections.delete(sessionId);
      this.logger.info(`Serial connection closed for session ${sessionId}`);
      
    } catch (error) {
      this.logger.error(`Error closing serial connection for session ${sessionId}:`, error);
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(sessionId: string): void {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return;

    const maxAttempts = connectionState.options.maxReconnectAttempts || 5;
    if (connectionState.reconnectAttempts >= maxAttempts) {
      this.logger.warn(`Max reconnection attempts reached for session ${sessionId}`);
      return;
    }

    const delay = (connectionState.options.reconnectDelay || 1000) * 
      Math.pow(2, connectionState.reconnectAttempts); // Exponential backoff

    this.logger.info(`Scheduling reconnection for session ${sessionId} in ${delay}ms`);

    const timer = setTimeout(async () => {
      try {
        connectionState.reconnectAttempts++;
        await this.reconnectSession(sessionId);
      } catch (error) {
        this.logger.error(`Reconnection failed for session ${sessionId}:`, error);
        this.scheduleReconnect(sessionId); // Schedule another attempt
      }
    }, delay);

    this.reconnectTimers.set(sessionId, timer);
  }

  /**
   * Attempt to reconnect a session
   */
  private async reconnectSession(sessionId: string): Promise<void> {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return;

    this.logger.info(`Attempting to reconnect session ${sessionId}`);

    try {
      // Close existing connection if still open
      if (connectionState.port.isOpen) {
        await new Promise<void>((resolve) => {
          connectionState.port.close(() => resolve());
        });
      }

      // Create new connection with same options
      await this.createConnection(sessionId, connectionState.options);

      this.logger.info(`Successfully reconnected session ${sessionId}`);
      
    } catch (error) {
      this.logger.error(`Reconnection attempt failed for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus(sessionId: string): SerialConnectionStatus | undefined {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return undefined;

    return {
      sessionId,
      isConnected: connectionState.isConnected,
      path: connectionState.options.path,
      baudRate: connectionState.options.baudRate || 9600,
      deviceType: connectionState.deviceInfo?.deviceType || 'generic',
      lastActivity: connectionState.lastActivity,
      reconnectAttempts: connectionState.reconnectAttempts,
      outputBufferSize: connectionState.outputBuffer.length
    };
  }

  /**
   * Get output buffer for a session
   */
  getOutputBuffer(sessionId: string, limit?: number): ConsoleOutput[] {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return [];

    const buffer = connectionState.outputBuffer;
    return limit ? buffer.slice(-limit) : buffer;
  }

  /**
   * Clear output buffer for a session
   */
  clearOutputBuffer(sessionId: string): void {
    const connectionState = this.connections.get(sessionId);
    if (connectionState) {
      connectionState.outputBuffer = [];
    }
  }

  /**
   * Start monitoring for device connections/disconnections
   */
  private startDeviceMonitoring(): void {
    // Monitor device list changes every 5 seconds
    setInterval(async () => {
      try {
        const devices = await this.discoverDevices();
        this.emit('device_list_updated', devices);
      } catch (error) {
        this.logger.error('Device monitoring error:', error);
      }
    }, 5000);
  }

  /**
   * Cleanup all connections
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up all serial connections');

    const cleanupPromises = Array.from(this.connections.keys()).map(
      sessionId => this.closeConnection(sessionId)
    );

    await Promise.allSettled(cleanupPromises);
    
    // Clear all reconnect timers
    this.reconnectTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.reconnectTimers.clear();
  }

  // IProtocol required methods
  async initialize(): Promise<void> {
    // Already initialized in constructor
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `serial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    if (!options.serialOptions) {
      throw new Error('Serial options are required');
    }

    await this.createConnection(sessionId, options.serialOptions);

    const session: ConsoleSession = {
      id: sessionId,
      command: options.command || '',
      args: options.args || [],
      cwd: '/',
      env: options.environment || {},
      createdAt: new Date(),
      status: 'running',
      type: 'serial',
      streaming: options.streaming ?? true,
      serialOptions: options.serialOptions,
      executionState: 'idle',
      activeCommands: new Map(),
    };

    this.emit('sessionCreated', session);
    return session;
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const fullCommand = args ? `${command} ${args.join(' ')}` : command;
    await this.sendData(sessionId, fullCommand + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    await this.sendData(sessionId, input);
  }

  async getOutput(sessionId: string, since?: Date): Promise<string> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return '';
    }

    const outputs = connection.outputBuffer
      .filter(output => !since || output.timestamp >= since)
      .map(output => output.data)
      .join('\n');
    
    return outputs;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.closeConnection(sessionId);
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    this.healthStatus.lastChecked = new Date();
    this.healthStatus.metrics.activeSessions = this.connections.size;
    
    // Check for any connection errors
    let hasErrors = false;
    Array.from(this.connections.entries()).forEach(([sessionId, connection]) => {
      if (!connection.isConnected) {
        hasErrors = true;
        this.healthStatus.errors.push(`Connection ${sessionId} is not connected`);
      }
    });
    
    this.healthStatus.isHealthy = !hasErrors;
    return { ...this.healthStatus };
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }
}

/**
 * Internal connection state interface
 */
interface SerialConnectionState {
  sessionId: string;
  port: SerialPort;
  options: SerialConnectionOptions;
  isConnected: boolean;
  reconnectAttempts: number;
  lastActivity: Date;
  outputBuffer: ConsoleOutput[];
  parsers: Map<string, any>;
  deviceInfo?: SerialDeviceInfo;
}

/**
 * Connection status interface
 */
export interface SerialConnectionStatus {
  sessionId: string;
  isConnected: boolean;
  path: string;
  baudRate: number;
  deviceType: string;
  lastActivity: Date;
  reconnectAttempts: number;
  outputBufferSize: number;
}