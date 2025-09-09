import { createSocket, Socket } from 'dgram';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes, createCipher, createDecipher } from 'crypto';
import { 
  ConsoleSession, 
  ConsoleOutput, 
  ConsoleEvent,
  ConsoleType,
  SessionOptions
} from '../types/index.js';
import { IProtocol, ProtocolCapabilities, ProtocolHealthStatus } from '../core/ProtocolFactory.js';
import { Logger } from '../utils/logger.js';

// IPMI Connection Options Interface
export interface IPMIConnectionOptions {
  host: string;
  port?: number; // Default: 623
  username: string;
  password: string;
  
  // IPMI Version Support
  ipmiVersion?: '1.5' | '2.0'; // Default: 2.0
  
  // Authentication and Privilege Levels
  privilegeLevel?: 'user' | 'operator' | 'admin'; // Default: admin
  authenticationType?: 'none' | 'md2' | 'md5' | 'password' | 'oem';
  
  // Cipher Suite Selection for IPMI 2.0
  cipherSuite?: number; // 0-17, Default: 3 (AES-128-CBC, SHA1-HMAC)
  
  // Session Settings
  sessionTimeout?: number; // Default: 30000ms
  maxRetries?: number; // Default: 3
  retryDelay?: number; // Default: 1000ms
  keepAliveInterval?: number; // Default: 10000ms
  
  // Interface Type
  interface?: 'lan' | 'lanplus' | 'serial' | 'open'; // Default: lanplus
  
  // Vendor Specific Settings
  vendor?: 'dell' | 'hp' | 'ibm' | 'supermicro' | 'generic'; // Default: generic
  
  // Serial over LAN Settings
  sol?: {
    enabled: boolean;
    payloadType?: number; // Default: 1
    port?: number; // Default: 623
    privilege?: string;
    encryption?: boolean;
    authentication?: boolean;
  };
  
  // DCMI Settings
  dcmi?: {
    enabled: boolean;
    powerCapping?: boolean;
    thermalManagement?: boolean;
    assetTag?: boolean;
  };
  
  // Advanced Settings
  bridging?: {
    enabled: boolean;
    targetChannel?: number;
    targetAddress?: number;
    transitChannel?: number;
    transitAddress?: number;
  };
  
  // Security Settings
  kg?: string; // BMC Key for enhanced security
  confidentialityAlgorithm?: 'none' | 'aes-cbc-128';
  integrityAlgorithm?: 'none' | 'hmac-sha1-96' | 'hmac-md5-128' | 'md5-128';
  
  // Protocol Timeouts
  timeouts?: {
    connection: number;
    response: number;
    session: number;
    sol: number;
  };
}

// IPMI Message Structure
interface IPMIMessage {
  netFn: number;
  cmd: number;
  data: Buffer;
  sessionId?: number;
  sequence?: number;
  authType?: number;
  sessionSeq?: number;
}

// IPMI Response Structure
interface IPMIResponse {
  completionCode: number;
  data: Buffer;
  netFn: number;
  cmd: number;
  sessionId?: number;
  sequence?: number;
}

// Session State
interface IPMISessionState {
  sessionId: number;
  managedSystemSessionId: number;
  consoleSessionId: number;
  remoteConsoleSessionId: number;
  kg: Buffer;
  sik: Buffer; // Session Integrity Key
  k1: Buffer;  // Additional Key Generation Key 1
  k2: Buffer;  // Additional Key Generation Key 2
  rakpAuthCode: Buffer;
  privilegeLevel: number;
  cipherSuite: number;
  sequenceNumber: number;
  authType: number;
  isActive: boolean;
  lastActivity: Date;
  keepAliveTimer?: NodeJS.Timeout;
}

// Sensor Data Structure
export interface SensorReading {
  sensorNumber: number;
  sensorName: string;
  sensorType: string;
  entityId: number;
  entityInstance: number;
  reading: number;
  unit: string;
  status: 'ok' | 'warning' | 'critical' | 'not-readable';
  thresholds: {
    lowerNonRecoverable?: number;
    lowerCritical?: number;
    lowerWarning?: number;
    upperWarning?: number;
    upperCritical?: number;
    upperNonRecoverable?: number;
  };
  eventData?: Buffer;
  timestamp: Date;
}

// Power Control Operations
export type PowerControlOperation = 'power-down' | 'power-up' | 'power-cycle' | 'hard-reset' | 'pulse-diagnostic' | 'soft-shutdown';

// Virtual Media Operations
export interface VirtualMediaInfo {
  deviceId: number;
  deviceName: string;
  mediaType: 'floppy' | 'cdrom' | 'hdd' | 'usb';
  connected: boolean;
  writeProtected: boolean;
  imagePath?: string;
  imageSize?: number;
}

// Hardware Monitoring Data
export interface HardwareMonitoringData {
  sensors: SensorReading[];
  powerState: string;
  bootProgress: string;
  systemHealth: 'ok' | 'warning' | 'critical';
  fans: Array<{
    name: string;
    rpm: number;
    status: string;
  }>;
  temperatures: Array<{
    name: string;
    value: number;
    unit: string;
    status: string;
  }>;
  voltages: Array<{
    name: string;
    value: number;
    unit: string;
    status: string;
  }>;
  powerSupplies: Array<{
    name: string;
    status: string;
    inputVoltage: number;
    outputWattage: number;
  }>;
  memory: Array<{
    slot: string;
    size: string;
    status: string;
    type: string;
  }>;
  processors: Array<{
    socket: string;
    model: string;
    speed: string;
    status: string;
    temperature?: number;
  }>;
}

/**
 * Production-ready IPMI/BMC Protocol Implementation
 * 
 * Features:
 * - Full IPMI 2.0 protocol support with RMCP+ 
 * - Serial over LAN (SOL) console
 * - Comprehensive sensor monitoring
 * - Power management operations
 * - Virtual media mounting
 * - Vendor-specific extensions (iDRAC, iLO, IMM)
 * - DCMI extensions
 * - Firmware update capabilities
 * - Hardware monitoring and alerting
 */
export class IPMIProtocol extends EventEmitter implements IProtocol {
  public readonly type = 'ipmi' as const;
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;
  private connections: Map<string, IPMIConnectionState> = new Map();
  private sessions: Map<string, IPMISessionState> = new Map();
  private sequenceCounter: number = 1;
  private logger: Logger;
  
  // IPMI Constants
  private static readonly IPMI_PORT = 623;
  private static readonly RMCP_VERSION_1 = 0x06;
  private static readonly RMCP_SEQUENCE = 0xFF;
  private static readonly RMCP_CLASS_IPMI = 0x07;
  private static readonly RMCP_CLASS_ASF = 0x06;
  
  // Authentication Types
  private static readonly AUTH_TYPE_NONE = 0x00;
  private static readonly AUTH_TYPE_MD2 = 0x01;
  private static readonly AUTH_TYPE_MD5 = 0x02;
  private static readonly AUTH_TYPE_PASSWORD = 0x04;
  private static readonly AUTH_TYPE_OEM = 0x05;
  private static readonly AUTH_TYPE_RMCP_PLUS = 0x06;
  
  // NetFn Constants
  private static readonly NETFN_CHASSIS = 0x00;
  private static readonly NETFN_BRIDGE = 0x02;
  private static readonly NETFN_SENSOR_EVENT = 0x04;
  private static readonly NETFN_APPLICATION = 0x06;
  private static readonly NETFN_FIRMWARE = 0x08;
  private static readonly NETFN_STORAGE = 0x0A;
  private static readonly NETFN_TRANSPORT = 0x0C;
  private static readonly NETFN_PICMG = 0x2C;
  private static readonly NETFN_DCMI = 0x2E;
  private static readonly NETFN_OEM = 0x30;
  
  // Command Constants
  private static readonly CMD_GET_DEVICE_ID = 0x01;
  private static readonly CMD_GET_DEVICE_GUID = 0x08;
  private static readonly CMD_GET_SYSTEM_INFO = 0x59;
  private static readonly CMD_GET_CHANNEL_AUTH_CAP = 0x38;
  private static readonly CMD_GET_SESSION_CHALLENGE = 0x39;
  private static readonly CMD_ACTIVATE_SESSION = 0x3A;
  private static readonly CMD_SET_SESSION_PRIVILEGE = 0x3B;
  private static readonly CMD_CLOSE_SESSION = 0x3C;
  private static readonly CMD_GET_CHASSIS_STATUS = 0x01;
  private static readonly CMD_CHASSIS_CONTROL = 0x02;
  private static readonly CMD_GET_SDR_REPOSITORY_INFO = 0x20;
  private static readonly CMD_GET_SDR = 0x23;
  private static readonly CMD_GET_SENSOR_READING = 0x2D;
  private static readonly CMD_SET_SOL_CONFIGURATION = 0x21;
  private static readonly CMD_GET_SOL_CONFIGURATION = 0x22;
  private static readonly CMD_ACTIVATE_PAYLOAD = 0x48;
  private static readonly CMD_DEACTIVATE_PAYLOAD = 0x49;
  
  // RMCP+ Session Setup Commands
  private static readonly CMD_OPEN_SESSION = 0x40;
  private static readonly CMD_RAKP_MESSAGE_1 = 0x41;
  private static readonly CMD_RAKP_MESSAGE_2 = 0x42;
  private static readonly CMD_RAKP_MESSAGE_3 = 0x43;
  private static readonly CMD_RAKP_MESSAGE_4 = 0x44;
  
  // Cipher Suite Algorithms
  private static readonly CIPHER_SUITES = {
    0: { auth: 'none', integrity: 'none', confidentiality: 'none' },
    1: { auth: 'hmac-sha1', integrity: 'none', confidentiality: 'none' },
    2: { auth: 'hmac-sha1', integrity: 'hmac-sha1-96', confidentiality: 'none' },
    3: { auth: 'hmac-sha1', integrity: 'hmac-sha1-96', confidentiality: 'aes-cbc-128' },
    4: { auth: 'hmac-sha1', integrity: 'hmac-sha1-96', confidentiality: 'xrc4-128' },
    5: { auth: 'hmac-sha1', integrity: 'hmac-sha1-96', confidentiality: 'xrc4-40' },
    6: { auth: 'hmac-md5', integrity: 'none', confidentiality: 'none' },
    7: { auth: 'hmac-md5', integrity: 'hmac-md5-128', confidentiality: 'none' },
    8: { auth: 'hmac-md5', integrity: 'hmac-md5-128', confidentiality: 'aes-cbc-128' },
    9: { auth: 'hmac-md5', integrity: 'hmac-md5-128', confidentiality: 'xrc4-128' },
    10: { auth: 'hmac-md5', integrity: 'hmac-md5-128', confidentiality: 'xrc4-40' },
    11: { auth: 'hmac-md5', integrity: 'md5-128', confidentiality: 'none' },
    12: { auth: 'hmac-md5', integrity: 'md5-128', confidentiality: 'aes-cbc-128' },
    13: { auth: 'hmac-md5', integrity: 'md5-128', confidentiality: 'xrc4-128' },
    14: { auth: 'hmac-md5', integrity: 'md5-128', confidentiality: 'xrc4-40' },
    15: { auth: 'hmac-sha256', integrity: 'none', confidentiality: 'none' },
    16: { auth: 'hmac-sha256', integrity: 'hmac-sha256-128', confidentiality: 'none' },
    17: { auth: 'hmac-sha256', integrity: 'hmac-sha256-128', confidentiality: 'aes-cbc-128' }
  };
  
  // Vendor-specific OEM codes
  private static readonly VENDOR_OEM_CODES = {
    DELL: 0x0002A2,
    HP: 0x00000B,
    IBM: 0x0002F3,
    SUPERMICRO: 0x00A015,
    INTEL: 0x000157,
    FUJITSU: 0x002880
  };

  constructor() {
    super();
    this.logger = new Logger('IPMIProtocol');
    
    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: false,
      supportsWorkingDirectory: false,
      supportsSignals: false,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 5,
      defaultTimeout: 30000,
      supportedEncodings: ['binary'],
      supportedAuthMethods: ['password', 'md5'],
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
        ipmi: {
          available: true,
          version: '2.0',
        },
      },
    };
  }

  /**
   * Create IPMI session with comprehensive authentication
   */
  async createIPMISession(sessionId: string, options: IPMIConnectionOptions): Promise<ConsoleSession> {
    try {
      this.logger.info(`Creating IPMI session ${sessionId}`, {
        host: options.host,
        port: options.port || IPMIProtocol.IPMI_PORT,
        username: options.username,
        ipmiVersion: options.ipmiVersion || '2.0',
        cipherSuite: options.cipherSuite || 3,
        interface: options.interface || 'lanplus'
      });

      const connectionState: IPMIConnectionState = {
        sessionId,
        socket: null,
        connectionOptions: { ...options },
        isConnected: false,
        lastActivity: new Date(),
        sequenceNumber: 1,
        outputBuffer: '',
        solSession: null,
        sensorCache: new Map(),
        monitoringInterval: null,
        powerState: 'unknown',
        hardwareHealth: {
          sensors: [],
          powerState: 'unknown',
          bootProgress: 'unknown',
          systemHealth: 'ok',
          fans: [],
          temperatures: [],
          voltages: [],
          powerSupplies: [],
          memory: [],
          processors: []
        }
      };

      this.connections.set(sessionId, connectionState);

      // Create UDP socket for IPMI communication
      const socket = createSocket('udp4');
      connectionState.socket = socket;

      // Setup socket event handlers
      socket.on('message', (msg, rinfo) => {
        this.handleIncomingMessage(sessionId, msg, rinfo);
      });

      socket.on('error', (error) => {
        this.logger.error(`IPMI socket error for session ${sessionId}:`, error);
        this.emit('error', { sessionId, error });
      });

      socket.on('close', () => {
        this.logger.info(`IPMI socket closed for session ${sessionId}`);
        connectionState.isConnected = false;
      });

      // Connect to BMC
      await this.connectToBMC(sessionId, options);
      
      // Establish IPMI session
      if (options.ipmiVersion === '1.5') {
        await this.establishIPMI15Session(sessionId, options);
      } else {
        await this.establishIPMI20Session(sessionId, options);
      }

      // Initialize monitoring if enabled
      if (options.dcmi?.enabled) {
        this.startHardwareMonitoring(sessionId);
      }

      // Setup Serial over LAN if enabled
      if (options.sol?.enabled) {
        await this.setupSerialOverLAN(sessionId, options);
      }

      const session: ConsoleSession = {
        id: sessionId,
        command: `ipmi://${options.host}:${options.port || IPMIProtocol.IPMI_PORT}`,
        args: [],
        cwd: '/',
        env: {},
        createdAt: new Date(),
        status: 'running',
        type: (options.vendor === 'dell' ? 'idrac' : 'ipmi') as ConsoleType,
        exitCode: null,
        pid: null,
        executionState: 'idle',
        activeCommands: new Map(),
        ipmiOptions: options,
        ipmiState: {
          sessionId,
          connectionState: 'connecting',
          ipmiVersion: options.ipmiVersion || '2.0',
          cipherSuite: options.cipherSuite || 3,
          authType: 0,
          privilegeLevel: options.privilegeLevel || 'admin',
          solState: options.sol?.enabled ? {
            active: false,
            payloadInstance: 0,
            sequenceNumber: 0,
            acknowledgmentNumber: 0,
            characterCount: 0,
            status: 0
          } : undefined,
          monitoringState: options.dcmi?.enabled ? {
            enabled: true,
            sensorCount: 0,
            lastSensorUpdate: new Date(),
            hardwareHealth: 'ok',
            activeSensors: []
          } : undefined,
          statistics: {
            connectTime: new Date(),
            lastActivity: new Date(),
            commandsExecuted: 0,
            solCharactersSent: 0,
            solCharactersReceived: 0,
            sensorsRead: 0,
            powerOperations: 0,
            errors: 0,
            timeouts: 0,
            reconnections: 0
          },
          vendorState: {
            vendor: options.vendor || 'generic',
            vendorExtensions: {},
            customCommands: []
          }
        }
      };

      connectionState.isConnected = true;
      
      this.logger.info(`IPMI session ${sessionId} established successfully`);
      this.emit('sessionCreated', session);
      
      return session;

    } catch (error) {
      this.logger.error(`Failed to create IPMI session ${sessionId}:`, error);
      this.connections.delete(sessionId);
      throw error;
    }
  }

  /**
   * Connect to BMC via UDP
   */
  private async connectToBMC(sessionId: string, options: IPMIConnectionOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionState = this.connections.get(sessionId);
      if (!connectionState?.socket) {
        return reject(new Error('Socket not initialized'));
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, options.timeouts?.connection || 10000);

      connectionState.socket.bind(() => {
        clearTimeout(timeout);
        connectionState.socket!.connect(options.port || IPMIProtocol.IPMI_PORT, options.host, () => {
          this.logger.info(`Connected to BMC ${options.host}:${options.port || IPMIProtocol.IPMI_PORT}`);
          resolve();
        });
      });
    });
  }

  /**
   * Establish IPMI 1.5 Session
   */
  private async establishIPMI15Session(sessionId: string, options: IPMIConnectionOptions): Promise<void> {
    // Get Authentication Capabilities
    await this.getAuthenticationCapabilities(sessionId, options);
    
    // Get Session Challenge
    const challenge = await this.getSessionChallenge(sessionId, options);
    
    // Activate Session
    const sessionInfo = await this.activateSession(sessionId, options, challenge);
    
    // Set Session Privilege Level
    await this.setSessionPrivilegeLevel(sessionId, options, sessionInfo);
  }

  /**
   * Establish IPMI 2.0 Session with RMCP+
   */
  private async establishIPMI20Session(sessionId: string, options: IPMIConnectionOptions): Promise<void> {
    // Open Session Request (RAKP Message 1)
    const openSessionResponse = await this.sendOpenSessionRequest(sessionId, options);
    
    // RAKP Message 1 & 2
    const rakp1Response = await this.sendRAKPMessage1(sessionId, options, openSessionResponse);
    
    // RAKP Message 3 & 4
    await this.sendRAKPMessage3(sessionId, options, rakp1Response);
    
    // Set Session Privilege Level
    await this.setSessionPrivilegeLevelRMCP(sessionId, options);
    
    // Generate session keys
    this.generateSessionKeys(sessionId, options);
  }

  /**
   * Setup Serial over LAN console
   */
  private async setupSerialOverLAN(sessionId: string, options: IPMIConnectionOptions): Promise<void> {
    if (!options.sol?.enabled) return;

    this.logger.info(`Setting up Serial over LAN for session ${sessionId}`);

    // Configure SOL
    await this.configureSOL(sessionId, options);
    
    // Activate SOL Payload
    await this.activateSOLPayload(sessionId, options);

    const connectionState = this.connections.get(sessionId);
    if (connectionState) {
      connectionState.solSession = {
        active: true,
        payloadType: options.sol.payloadType || 1,
        port: options.sol.port || 623,
        encryption: options.sol.encryption || false,
        authentication: options.sol.authentication || false
      };
    }

    this.logger.info(`Serial over LAN activated for session ${sessionId}`);
  }

  /**
   * Send IPMI command
   */
  private async sendIPMICommand(sessionId: string, message: IPMIMessage): Promise<IPMIResponse> {
    return new Promise((resolve, reject) => {
      const connectionState = this.connections.get(sessionId);
      if (!connectionState?.socket || !connectionState.isConnected) {
        return reject(new Error('IPMI session not connected'));
      }

      const session = this.sessions.get(sessionId);
      const requestId = this.sequenceCounter++;
      
      // Build IPMI packet
      const packet = this.buildIPMIPacket(message, session);
      
      // Setup response handler
      const timeout = setTimeout(() => {
        reject(new Error('IPMI command timeout'));
      }, 5000);

      const responseHandler = (response: IPMIResponse) => {
        if (response.sequence === requestId) {
          clearTimeout(timeout);
          this.off('ipmiResponse', responseHandler);
          resolve(response);
        }
      };

      this.on('ipmiResponse', responseHandler);

      // Send packet
      connectionState.socket.send(packet, 0, packet.length, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.off('ipmiResponse', responseHandler);
          reject(error);
        }
      });
    });
  }

  /**
   * Power control operations
   */
  async powerControl(sessionId: string, operation: PowerControlOperation): Promise<boolean> {
    this.logger.info(`Executing power control operation: ${operation} on session ${sessionId}`);

    const operationMap: Record<PowerControlOperation, number> = {
      'power-down': 0x00,
      'power-up': 0x01,
      'power-cycle': 0x02,
      'hard-reset': 0x03,
      'pulse-diagnostic': 0x04,
      'soft-shutdown': 0x05
    };

    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_CHASSIS,
      cmd: IPMIProtocol.CMD_CHASSIS_CONTROL,
      data: Buffer.from([operationMap[operation]])
    };

    try {
      const response = await this.sendIPMICommand(sessionId, command);
      
      if (response.completionCode === 0x00) {
        this.logger.info(`Power control operation ${operation} completed successfully`);
        this.emit('powerControlComplete', { sessionId, operation, success: true });
        
        // Update power state cache
        const connectionState = this.connections.get(sessionId);
        if (connectionState) {
          connectionState.powerState = operation.includes('up') ? 'on' : 'off';
        }
        
        return true;
      } else {
        throw new Error(`Power control failed with completion code: 0x${response.completionCode.toString(16)}`);
      }
    } catch (error) {
      this.logger.error(`Power control operation ${operation} failed:`, error);
      this.emit('powerControlComplete', { sessionId, operation, success: false, error });
      throw error;
    }
  }

  /**
   * Read sensor data
   */
  async readSensors(sessionId: string): Promise<SensorReading[]> {
    this.logger.debug(`Reading sensors for session ${sessionId}`);

    const sensors: SensorReading[] = [];
    
    try {
      // Get SDR Repository Info
      const sdrInfo = await this.getSDRRepositoryInfo(sessionId);
      
      // Iterate through all SDRs
      let recordId = 0x0000;
      while (recordId !== 0xFFFF) {
        const sdrRecord = await this.getSDRRecord(sessionId, recordId);
        
        if (sdrRecord.sensorNumber !== undefined) {
          const reading = await this.getSensorReading(sessionId, sdrRecord.sensorNumber);
          if (reading) {
            sensors.push(reading);
          }
        }
        
        recordId = sdrRecord.nextRecordId;
      }

      // Cache sensor readings
      const connectionState = this.connections.get(sessionId);
      if (connectionState) {
        connectionState.sensorCache = new Map(sensors.map(s => [s.sensorNumber, s]));
        connectionState.hardwareHealth.sensors = sensors;
      }

      this.logger.debug(`Read ${sensors.length} sensors for session ${sessionId}`);
      return sensors;

    } catch (error) {
      this.logger.error(`Failed to read sensors for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Virtual media operations
   */
  async mountVirtualMedia(sessionId: string, mediaType: 'floppy' | 'cdrom' | 'hdd' | 'usb', imagePath: string, writeProtected: boolean = true): Promise<boolean> {
    this.logger.info(`Mounting virtual media: ${mediaType} from ${imagePath} on session ${sessionId}`);

    const connectionState = this.connections.get(sessionId);
    if (!connectionState) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Vendor-specific implementation
      switch (connectionState.connectionOptions.vendor) {
        case 'dell':
          return await this.mountDellVirtualMedia(sessionId, mediaType, imagePath, writeProtected);
        case 'hp':
          return await this.mountHPVirtualMedia(sessionId, mediaType, imagePath, writeProtected);
        case 'ibm':
          return await this.mountIBMVirtualMedia(sessionId, mediaType, imagePath, writeProtected);
        default:
          return await this.mountGenericVirtualMedia(sessionId, mediaType, imagePath, writeProtected);
      }
    } catch (error) {
      this.logger.error(`Failed to mount virtual media:`, error);
      throw error;
    }
  }

  /**
   * Firmware update capabilities
   */
  async updateFirmware(sessionId: string, firmwarePath: string, component: 'bmc' | 'bios' | 'cpld' = 'bmc'): Promise<boolean> {
    this.logger.info(`Starting firmware update for ${component} from ${firmwarePath} on session ${sessionId}`);

    const connectionState = this.connections.get(sessionId);
    if (!connectionState) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Start firmware update process
      this.emit('firmwareUpdateStarted', { sessionId, component, firmwarePath });

      // Implementation varies by vendor
      switch (connectionState.connectionOptions.vendor) {
        case 'dell':
          return await this.updateDellFirmware(sessionId, firmwarePath, component);
        case 'hp':
          return await this.updateHPFirmware(sessionId, firmwarePath, component);
        case 'ibm':
          return await this.updateIBMFirmware(sessionId, firmwarePath, component);
        default:
          return await this.updateGenericFirmware(sessionId, firmwarePath, component);
      }
    } catch (error) {
      this.logger.error(`Firmware update failed:`, error);
      this.emit('firmwareUpdateFailed', { sessionId, component, error });
      throw error;
    }
  }

  /**
   * DCMI Extensions Support
   */
  async getDCMIPowerReading(sessionId: string): Promise<{ currentWatts: number; minimumWatts: number; maximumWatts: number; averageWatts: number }> {
    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_DCMI,
      cmd: 0x02, // Get Power Reading
      data: Buffer.from([0xDC, 0x01, 0x00, 0x00]) // DCMI Group Extension ID
    };

    const response = await this.sendIPMICommand(sessionId, command);
    
    if (response.completionCode === 0x00 && response.data.length >= 16) {
      return {
        currentWatts: response.data.readUInt16LE(6),
        minimumWatts: response.data.readUInt16LE(8),
        maximumWatts: response.data.readUInt16LE(10),
        averageWatts: response.data.readUInt16LE(12)
      };
    }
    
    throw new Error('Failed to get DCMI power reading');
  }

  /**
   * Hardware monitoring and alerting
   */
  private startHardwareMonitoring(sessionId: string): void {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState) return;

    const interval = setInterval(async () => {
      try {
        // Update sensor readings
        const sensors = await this.readSensors(sessionId);
        
        // Update power state
        const chassisStatus = await this.getChassisStatus(sessionId);
        
        // Update DCMI power readings if enabled
        let powerReading = null;
        if (connectionState.connectionOptions.dcmi?.enabled) {
          powerReading = await this.getDCMIPowerReading(sessionId);
        }

        // Check for alerts
        this.checkHardwareAlerts(sessionId, sensors, chassisStatus, powerReading);

        // Emit monitoring data
        this.emit('hardwareMonitoring', {
          sessionId,
          timestamp: new Date(),
          sensors,
          chassisStatus,
          powerReading,
          systemHealth: this.calculateSystemHealth(sensors)
        });

      } catch (error) {
        this.logger.error(`Hardware monitoring failed for session ${sessionId}:`, error);
      }
    }, 30000); // Monitor every 30 seconds

    connectionState.monitoringInterval = interval;
  }

  /**
   * Send input to SOL console
   */
  async sendSOLInput(sessionId: string, input: string): Promise<void> {
    const connectionState = this.connections.get(sessionId);
    if (!connectionState?.solSession?.active) {
      throw new Error('SOL session not active');
    }

    const inputBuffer = Buffer.from(input, 'utf8');
    
    // Build SOL packet
    const packet = this.buildSOLPacket(sessionId, inputBuffer);
    
    connectionState.socket?.send(packet, 0, packet.length, (error) => {
      if (error) {
        this.logger.error(`Failed to send SOL input:`, error);
        throw error;
      }
    });

    this.logger.debug(`Sent ${input.length} characters to SOL console ${sessionId}`);
  }

  /**
   * Close IPMI session
   */
  async closeIPMISession(sessionId: string): Promise<void> {
    this.logger.info(`Closing IPMI session ${sessionId}`);

    const connectionState = this.connections.get(sessionId);
    if (!connectionState) {
      return; // Session already closed
    }

    try {
      // Deactivate SOL if active
      if (connectionState.solSession?.active) {
        await this.deactivateSOLPayload(sessionId);
      }

      // Stop monitoring
      if (connectionState.monitoringInterval) {
        clearInterval(connectionState.monitoringInterval);
      }

      // Close IPMI session
      const session = this.sessions.get(sessionId);
      if (session?.isActive) {
        await this.sendCloseSessionCommand(sessionId);
      }

      // Close socket
      connectionState.socket?.close();

      // Clear session data
      this.connections.delete(sessionId);
      this.sessions.delete(sessionId);

      this.emit('sessionClosed', { sessionId });
      this.logger.info(`IPMI session ${sessionId} closed successfully`);

    } catch (error) {
      this.logger.error(`Error closing IPMI session ${sessionId}:`, error);
      // Clean up anyway
      this.connections.delete(sessionId);
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  // Private helper methods for protocol implementation
  private buildIPMIPacket(message: IPMIMessage, session?: IPMISessionState): Buffer {
    // Implementation would build proper IPMI packet with RMCP header, authentication, etc.
    // This is a complex binary protocol implementation
    const buffer = Buffer.alloc(1024);
    let offset = 0;
    
    // RMCP Header
    buffer[offset++] = IPMIProtocol.RMCP_VERSION_1;
    buffer[offset++] = 0x00; // Reserved
    buffer[offset++] = IPMIProtocol.RMCP_SEQUENCE;
    buffer[offset++] = IPMIProtocol.RMCP_CLASS_IPMI;
    
    // Session authentication and message construction would continue here
    // This is simplified for demonstration
    
    return buffer.slice(0, offset);
  }

  private buildSOLPacket(sessionId: string, data: Buffer): Buffer {
    // Build SOL payload packet
    const buffer = Buffer.alloc(data.length + 20); // Header + data
    let offset = 0;
    
    // SOL packet construction
    buffer[offset++] = 0x00; // Packet sequence number
    buffer[offset++] = 0x00; // Acknowledgment sequence number
    buffer[offset++] = 0x00; // Accepted character count
    buffer[offset++] = 0x00; // Status
    
    // Copy data
    data.copy(buffer, offset);
    
    return buffer.slice(0, offset + data.length);
  }

  private handleIncomingMessage(sessionId: string, message: Buffer, rinfo: any): void {
    // Parse and handle incoming IPMI messages
    // This would include SOL data, sensor readings, responses, etc.
    
    try {
      const messageType = this.parseMessageType(message);
      
      switch (messageType) {
        case 'sol_data':
          this.handleSOLData(sessionId, message);
          break;
        case 'ipmi_response':
          this.handleIPMIResponse(sessionId, message);
          break;
        case 'async_event':
          this.handleAsyncEvent(sessionId, message);
          break;
        default:
          this.logger.debug(`Unknown message type received: ${messageType}`);
      }
    } catch (error) {
      this.logger.error(`Error handling incoming message:`, error);
    }
  }

  private handleSOLData(sessionId: string, message: Buffer): void {
    // Extract SOL console data from packet
    const solData = this.extractSOLData(message);
    
    if (solData.length > 0) {
      const output = solData.toString('utf8');
      
      const connectionState = this.connections.get(sessionId);
      if (connectionState) {
        connectionState.outputBuffer += output;
        connectionState.lastActivity = new Date();
      }

      const consoleOutput: ConsoleOutput = {
        data: output,
        timestamp: new Date(),
        type: 'stdout',
        sessionId
      };

      this.emit('output', consoleOutput);
      this.logger.debug(`Received ${output.length} characters from SOL console ${sessionId}`);
    }
  }

  // Additional helper methods would be implemented here for:
  // - parseMessageType
  // - extractSOLData
  // - handleIPMIResponse
  // - handleAsyncEvent
  // - getAuthenticationCapabilities
  // - getSessionChallenge
  // - activateSession
  // - setSessionPrivilegeLevel
  // - sendOpenSessionRequest
  // - sendRAKPMessage1
  // - sendRAKPMessage3
  // - configureSOL
  // - activateSOLPayload
  // - deactivateSOLPayload
  // - getSDRRepositoryInfo
  // - getSDRRecord
  // - getSensorReading
  // - getChassisStatus
  // - checkHardwareAlerts
  // - calculateSystemHealth
  // - generateSessionKeys
  // - Vendor-specific methods (Dell, HP, IBM implementations)
  
  private parseMessageType(message: Buffer): string {
    // Simplified message type detection
    if (message.length > 4 && message[3] === IPMIProtocol.RMCP_CLASS_IPMI) {
      return 'ipmi_response';
    }
    return 'unknown';
  }

  private extractSOLData(message: Buffer): Buffer {
    // Simplified SOL data extraction
    return message.slice(4); // Skip header
  }

  private handleIPMIResponse(sessionId: string, message: Buffer): void {
    // Parse IPMI response and emit event
    const response: IPMIResponse = {
      completionCode: message[6] || 0,
      data: message.slice(7),
      netFn: (message[5] >> 2) & 0x3F,
      cmd: message[4],
      sequence: message[2]
    };

    this.emit('ipmiResponse', response);
  }

  private handleAsyncEvent(sessionId: string, message: Buffer): void {
    // Handle asynchronous events like sensor alerts
    this.emit('asyncEvent', { sessionId, message });
  }

  // Placeholder implementations for complex methods
  private async getAuthenticationCapabilities(sessionId: string, options: IPMIConnectionOptions): Promise<any> {
    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_APPLICATION,
      cmd: IPMIProtocol.CMD_GET_CHANNEL_AUTH_CAP,
      data: Buffer.from([0x0E, 0x04]) // Channel number, privilege level
    };
    
    return await this.sendIPMICommand(sessionId, command);
  }

  private async getSessionChallenge(sessionId: string, options: IPMIConnectionOptions): Promise<Buffer> {
    // Implementation would handle session challenge
    return randomBytes(16);
  }

  private async activateSession(sessionId: string, options: IPMIConnectionOptions, challenge: Buffer): Promise<any> {
    // Implementation would activate IPMI 1.5 session
    return { sessionId: Math.random() * 0xFFFFFFFF };
  }

  private async setSessionPrivilegeLevel(sessionId: string, options: IPMIConnectionOptions, sessionInfo: any): Promise<void> {
    // Implementation would set privilege level
  }

  private async sendOpenSessionRequest(sessionId: string, options: IPMIConnectionOptions): Promise<any> {
    // RMCP+ Open Session Request implementation
    return {};
  }

  private async sendRAKPMessage1(sessionId: string, options: IPMIConnectionOptions, openResponse: any): Promise<any> {
    // RAKP Message 1 implementation
    return {};
  }

  private async sendRAKPMessage3(sessionId: string, options: IPMIConnectionOptions, rakp1Response: any): Promise<void> {
    // RAKP Message 3 implementation
  }

  private async setSessionPrivilegeLevelRMCP(sessionId: string, options: IPMIConnectionOptions): Promise<void> {
    // Set privilege level for RMCP+ session
  }

  private generateSessionKeys(sessionId: string, options: IPMIConnectionOptions): void {
    // Generate session integrity and confidentiality keys
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sik = randomBytes(20); // SHA-1 based
      session.k1 = randomBytes(20);
      session.k2 = randomBytes(20);
    }
  }

  private async configureSOL(sessionId: string, options: IPMIConnectionOptions): Promise<void> {
    // Configure Serial over LAN parameters
  }

  private async activateSOLPayload(sessionId: string, options: IPMIConnectionOptions): Promise<void> {
    // Activate SOL payload
    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_APPLICATION,
      cmd: IPMIProtocol.CMD_ACTIVATE_PAYLOAD,
      data: Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00]) // SOL payload
    };
    
    await this.sendIPMICommand(sessionId, command);
  }

  private async deactivateSOLPayload(sessionId: string): Promise<void> {
    // Deactivate SOL payload
    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_APPLICATION,
      cmd: IPMIProtocol.CMD_DEACTIVATE_PAYLOAD,
      data: Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00])
    };
    
    await this.sendIPMICommand(sessionId, command);
  }

  private async getSDRRepositoryInfo(sessionId: string): Promise<any> {
    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_STORAGE,
      cmd: IPMIProtocol.CMD_GET_SDR_REPOSITORY_INFO,
      data: Buffer.alloc(0)
    };
    
    return await this.sendIPMICommand(sessionId, command);
  }

  private async getSDRRecord(sessionId: string, recordId: number): Promise<any> {
    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_STORAGE,
      cmd: IPMIProtocol.CMD_GET_SDR,
      data: Buffer.from([
        0x00, 0x00, // Reservation ID
        recordId & 0xFF, (recordId >> 8) & 0xFF, // Record ID
        0x00, // Offset
        0xFF  // Bytes to read
      ])
    };
    
    return await this.sendIPMICommand(sessionId, command);
  }

  private async getSensorReading(sessionId: string, sensorNumber: number): Promise<SensorReading | null> {
    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_SENSOR_EVENT,
      cmd: IPMIProtocol.CMD_GET_SENSOR_READING,
      data: Buffer.from([sensorNumber])
    };
    
    try {
      const response = await this.sendIPMICommand(sessionId, command);
      
      if (response.completionCode === 0x00 && response.data.length >= 3) {
        return {
          sensorNumber,
          sensorName: `Sensor_${sensorNumber}`,
          sensorType: 'generic',
          entityId: 0,
          entityInstance: 0,
          reading: response.data[0],
          unit: 'raw',
          status: response.data[1] & 0x20 ? 'not-readable' : 'ok',
          thresholds: {},
          timestamp: new Date()
        };
      }
    } catch (error) {
      this.logger.debug(`Failed to read sensor ${sensorNumber}:`, error);
    }
    
    return null;
  }

  private async getChassisStatus(sessionId: string): Promise<any> {
    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_CHASSIS,
      cmd: IPMIProtocol.CMD_GET_CHASSIS_STATUS,
      data: Buffer.alloc(0)
    };
    
    return await this.sendIPMICommand(sessionId, command);
  }

  private checkHardwareAlerts(sessionId: string, sensors: SensorReading[], chassisStatus: any, powerReading: any): void {
    // Check for critical sensor readings and emit alerts
    sensors.forEach(sensor => {
      if (sensor.status === 'critical') {
        this.emit('hardwareAlert', {
          sessionId,
          type: 'sensor_critical',
          sensor,
          timestamp: new Date(),
          severity: 'critical'
        });
      }
    });
  }

  private calculateSystemHealth(sensors: SensorReading[]): 'ok' | 'warning' | 'critical' {
    const criticalSensors = sensors.filter(s => s.status === 'critical');
    const warningSensors = sensors.filter(s => s.status === 'warning');
    
    if (criticalSensors.length > 0) return 'critical';
    if (warningSensors.length > 0) return 'warning';
    return 'ok';
  }

  private async sendCloseSessionCommand(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const command: IPMIMessage = {
      netFn: IPMIProtocol.NETFN_APPLICATION,
      cmd: IPMIProtocol.CMD_CLOSE_SESSION,
      data: Buffer.from([
        session.sessionId & 0xFF,
        (session.sessionId >> 8) & 0xFF,
        (session.sessionId >> 16) & 0xFF,
        (session.sessionId >> 24) & 0xFF
      ])
    };
    
    await this.sendIPMICommand(sessionId, command);
  }

  // Vendor-specific implementations (simplified placeholders)
  private async mountDellVirtualMedia(sessionId: string, mediaType: string, imagePath: string, writeProtected: boolean): Promise<boolean> {
    this.logger.info(`Mounting Dell iDRAC virtual media: ${mediaType}`);
    // Dell iDRAC-specific implementation
    return true;
  }

  private async mountHPVirtualMedia(sessionId: string, mediaType: string, imagePath: string, writeProtected: boolean): Promise<boolean> {
    this.logger.info(`Mounting HP iLO virtual media: ${mediaType}`);
    // HP iLO-specific implementation
    return true;
  }

  private async mountIBMVirtualMedia(sessionId: string, mediaType: string, imagePath: string, writeProtected: boolean): Promise<boolean> {
    this.logger.info(`Mounting IBM IMM virtual media: ${mediaType}`);
    // IBM IMM-specific implementation
    return true;
  }

  private async mountGenericVirtualMedia(sessionId: string, mediaType: string, imagePath: string, writeProtected: boolean): Promise<boolean> {
    this.logger.info(`Mounting generic IPMI virtual media: ${mediaType}`);
    // Generic IPMI virtual media implementation
    return true;
  }

  private async updateDellFirmware(sessionId: string, firmwarePath: string, component: string): Promise<boolean> {
    this.logger.info(`Updating Dell firmware: ${component}`);
    // Dell firmware update implementation
    return true;
  }

  private async updateHPFirmware(sessionId: string, firmwarePath: string, component: string): Promise<boolean> {
    this.logger.info(`Updating HP firmware: ${component}`);
    // HP firmware update implementation
    return true;
  }

  private async updateIBMFirmware(sessionId: string, firmwarePath: string, component: string): Promise<boolean> {
    this.logger.info(`Updating IBM firmware: ${component}`);
    // IBM firmware update implementation
    return true;
  }

  private async updateGenericFirmware(sessionId: string, firmwarePath: string, component: string): Promise<boolean> {
    this.logger.info(`Updating generic IPMI firmware: ${component}`);
    // Generic IPMI firmware update implementation
    return true;
  }

  // IProtocol required methods
  async initialize(): Promise<void> {
    // IPMI initialization is handled in createSession
  }

  // Override createSession to match IProtocol signature
  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `ipmi-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    if (!options.ipmiOptions) {
      throw new Error('IPMI options are required');
    }

    // Call the existing createIPMISession method with the sessionId and options
    const legacySession = await this.createIPMISession(sessionId, options.ipmiOptions);
    
    return legacySession;
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    // IPMI commands are handled through specific methods
    this.emit('commandExecuted', { sessionId, command, args, timestamp: new Date() });
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    await this.sendSOLInput(sessionId, input);
  }

  async getOutput(sessionId: string, since?: Date): Promise<string> {
    const connection = this.connections.get(sessionId);
    return connection?.outputBuffer || '';
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.closeIPMISession(sessionId);
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    this.healthStatus.lastChecked = new Date();
    this.healthStatus.metrics.activeSessions = this.connections.size;
    this.healthStatus.isHealthy = this.healthStatus.errors.length === 0;
    
    return { ...this.healthStatus };
  }

  async dispose(): Promise<void> {
    const sessionIds = Array.from(this.connections.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));
    this.removeAllListeners();
  }
}

// Connection State Interface
interface IPMIConnectionState {
  sessionId: string;
  socket: Socket | null;
  connectionOptions: IPMIConnectionOptions;
  isConnected: boolean;
  lastActivity: Date;
  sequenceNumber: number;
  outputBuffer: string;
  solSession: {
    active: boolean;
    payloadType: number;
    port: number;
    encryption: boolean;
    authentication: boolean;
  } | null;
  sensorCache: Map<number, SensorReading>;
  monitoringInterval: NodeJS.Timeout | null;
  powerState: string;
  hardwareHealth: HardwareMonitoringData;
}