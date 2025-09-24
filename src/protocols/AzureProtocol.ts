import { WebSocket } from 'ws';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput
} from '../types/index.js';
import {
  ProtocolCapabilities,
  SessionState as BaseSessionState,
  ErrorContext
} from '../core/IProtocol.js';

// Azure SDK imports - made optional to handle missing dependencies
let DefaultAzureCredential: any, ClientSecretCredential: any, ManagedIdentityCredential: any,
    ChainedTokenCredential: any, AzureCliCredential: any, InteractiveBrowserCredential: any,
    ClientCertificateCredential: any;

try {
  const identityModule = require('@azure/identity');
  DefaultAzureCredential = identityModule.DefaultAzureCredential;
  ClientSecretCredential = identityModule.ClientSecretCredential;
  ManagedIdentityCredential = identityModule.ManagedIdentityCredential;
  ChainedTokenCredential = identityModule.ChainedTokenCredential;
  AzureCliCredential = identityModule.AzureCliCredential;
  InteractiveBrowserCredential = identityModule.InteractiveBrowserCredential;
  ClientCertificateCredential = identityModule.ClientCertificateCredential;
} catch (error) {
  console.warn('@azure/identity not available, Azure identity functionality will be disabled');
}

let ComputeManagementClient: any, NetworkManagementClient: any, SecretClient: any;

try {
  const computeModule = require('@azure/arm-compute');
  ComputeManagementClient = computeModule.ComputeManagementClient;
} catch (error) {
  console.warn('@azure/arm-compute not available, Compute management functionality will be disabled');
}

try {
  const networkModule = require('@azure/arm-network');
  NetworkManagementClient = networkModule.NetworkManagementClient;
} catch (error) {
  console.warn('@azure/arm-network not available, Network management functionality will be disabled');
}

try {
  const keyVaultModule = require('@azure/keyvault-secrets');
  SecretClient = keyVaultModule.SecretClient;
} catch (error) {
  console.warn('@azure/keyvault-secrets not available, Key Vault functionality will be disabled');
}
import {
  AzureConnectionOptions,
  AzureCloudShellSession,
  AzureBastionSession,
  AzureArcSession,
  AzureTokenInfo,
  AzureResourceInfo
} from '../types/index.js';

// Azure API Response Interfaces
interface AzureResourceResponse {
  id: string;
  type: string;
  location: string;
  name: string;
  properties: any;
}

interface AzureCloudShellCreateResponse {
  properties: {
    uri: string;
  };
}

interface AzureCloudShellConnectResponse {
  properties: {
    socketUri: string;
  };
}

interface AzureBastionConnectionResponse {
  value: Array<{
    bsl: string;
  }>;
}

interface AzureArcConnectionResponse {
  properties: {
    connectionDetails: {
      socketUri: string;
    };
  };
}

interface AzureHybridConnectionResponse {
  hybridConnectionString: string;
}

// Type interfaces for Azure SDK types when not available
interface AzureCredentialLike {
  getToken(scope: string | string[]): Promise<{
    token: string;
    expiresOnTimestamp: number;
  }>;
}

interface ComputeManagementClientLike {
  virtualMachines: {
    get(resourceGroupName: string, vmName: string): Promise<any>;
  };
}

interface NetworkManagementClientLike {
  networkInterfaces: {
    get(resourceGroupName: string, networkInterfaceName: string): Promise<any>;
  };
}

interface SecretClientLike {
  getSecret(secretName: string): Promise<{ value?: string }>;
}

// Azure-specific session state interface
interface AzureSessionState extends BaseSessionState {
  tokenExpiry?: Date;
  tokenValid?: boolean;
  sessionType?: 'cloud-shell' | 'bastion' | 'arc';
  webSocketConnected?: boolean;
}

export class AzureProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'azure-shell';
  public readonly capabilities: ProtocolCapabilities;

  private azureSessions: Map<string, AzureCloudShellSession | AzureBastionSession | AzureArcSession> = new Map();
  private webSockets: Map<string, WebSocket> = new Map();
  private credentials: Map<string, AzureCredentialLike> = new Map();
  private computeClients: Map<string, ComputeManagementClientLike> = new Map();
  private networkClients: Map<string, NetworkManagementClientLike> = new Map();
  private secretClients: Map<string, SecretClientLike> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private tokenRefreshTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super('azure');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: false,
      supportsCustomEnvironment: false,
      supportsWorkingDirectory: false,
      supportsSignals: false,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 50,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['oauth', 'service-principal', 'managed-identity'],
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
      // Verify Azure SDK availability
      if (!DefaultAzureCredential) {
        this.logger.warn('Azure SDK not fully available, some features may be disabled');
      }

      this.isInitialized = true;
      this.logger.info('Azure protocol initialized with session management fixes');
    } catch (error: any) {
      this.logger.error('Failed to initialize Azure protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const sessionId = `azure-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const azureOptions = options as AzureConnectionOptions;

    // Determine Azure service type
    if (azureOptions.cloudShellType) {
      const azureSession = await this.createCloudShellSession(sessionId, azureOptions);
      return await this.createAzureSessionWithDetection(sessionId, options, azureSession);
    } else if (azureOptions.bastionResourceId) {
      const azureSession = await this.createBastionSession(sessionId, azureOptions);
      return await this.createAzureSessionWithDetection(sessionId, options, azureSession);
    } else if (azureOptions.arcResourceId) {
      const azureSession = await this.createArcSession(sessionId, azureOptions);
      return await this.createAzureSessionWithDetection(sessionId, options, azureSession);
    } else {
      throw new Error('Azure connection type not specified');
    }
  }


  getSessionState(sessionId: string): Promise<BaseSessionState> {
    const azureSession = this.azureSessions.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!azureSession || !session) {
      return Promise.resolve({
        sessionId,
        status: 'failed',
        isOneShot: false,
        isPersistent: true,
        createdAt: new Date(),
        lastActivity: new Date(),
        metadata: { error: 'Session not found' }
      });
    }

    const webSocket = this.webSockets.get(sessionId);
    const connected = webSocket?.readyState === WebSocket.OPEN;

    const state: BaseSessionState = {
      sessionId,
      status: connected ? 'running' : 'stopped',
      isOneShot: false,
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity || new Date(),
      metadata: {
        tokenExpiry: azureSession.tokenExpiry,
        tokenValid: azureSession.tokenExpiry.getTime() > Date.now(),
        sessionType: 'webSocketUrl' in azureSession ? 'cloud-shell' :
                    'bastionResourceId' in azureSession ? 'bastion' : 'arc',
        webSocketConnected: connected
      }
    };

    return Promise.resolve(state);
  }

  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  async attemptReconnection(context: ErrorContext): Promise<boolean> {
    try {
      const sessionId = context.sessionId;
      if (!sessionId) {
        return false;
      }

      const azureSession = this.azureSessions.get(sessionId);
      if (!azureSession) {
        return false;
      }

      // Close existing WebSocket if present
      const existingWs = this.webSockets.get(sessionId);
      if (existingWs) {
        existingWs.close();
        this.webSockets.delete(sessionId);
      }

      // Re-establish WebSocket connection
      await this.connectWebSocket(sessionId, azureSession);
      return true;
    } catch (error) {
      this.logger.error(`Failed to reconnect Azure session ${context.sessionId}:`, error);
      return false;
    }
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\n');
  }

  async doCreateSession(sessionId: string, options: SessionOptions): Promise<ConsoleSession> {
    return await this.createSession(options);
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const webSocket = this.webSockets.get(sessionId);
    if (!webSocket) {
      throw new Error(`No WebSocket connection found for session: ${sessionId}`);
    }

    if (webSocket.readyState === WebSocket.OPEN) {
      const message = {
        type: 'input',
        data: input
      };
      webSocket.send(JSON.stringify(message));
      this.logger.debug(`Sent input to session ${sessionId}: ${input.substring(0, 100)}`);
    } else {
      throw new Error(`WebSocket connection is not open for session: ${sessionId}`);
    }
  }

  /**
   * Helper method to create session with type detection and BaseProtocol integration
   */
  private async createAzureSessionWithDetection(
    sessionId: string,
    options: SessionOptions,
    azureSession: AzureCloudShellSession | AzureBastionSession | AzureArcSession
  ): Promise<ConsoleSession> {
    this.azureSessions.set(sessionId, azureSession);

    // Create BaseProtocol session
    const session: ConsoleSession = {
      id: sessionId,
      command: 'azure-session',
      args: [],
      cwd: '',
      env: {},
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'initializing',
      type: this.type,
      executionState: 'idle',
      activeCommands: new Map()
    };

    this.sessions.set(sessionId, session);

    // Set up event handlers for Azure-specific events
    this.setupAzureEventHandlers(sessionId);

    return session;
  }

  /**
   * Set up Azure-specific event handlers
   */
  private setupAzureEventHandlers(sessionId: string): void {
    // Set up handlers for token refresh, WebSocket events, etc.
    // This replaces the EventEmitter pattern with direct callback management
  }

  /**
   * Create a new Azure Cloud Shell session
   */
  async createCloudShellSession(
    sessionId: string,
    options: AzureConnectionOptions
  ): Promise<AzureCloudShellSession> {
    try {
      this.logger.info(`Creating Azure Cloud Shell session: ${sessionId}`);

      // Get authentication credentials
      const credential = await this.getCredential(options);
      const token = await this.getAccessToken(credential, 'https://management.azure.com/');

      // Create Cloud Shell session via Azure API
      const cloudShellUrl = await this.createCloudShellInstance(options, token);
      const webSocketUrl = await this.getCloudShellWebSocketUrl(cloudShellUrl, token);

      const session: AzureCloudShellSession = {
        sessionId,
        webSocketUrl,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenExpiry: token.expiresOn,
        shellType: options.cloudShellType || 'bash',
        subscription: options.subscriptionId || '',
        resourceGroup: options.resourceGroupName || 'cloud-shell-storage-eastus',
        location: options.region || 'eastus',
        storageAccount: options.storageAccountName ? {
          name: options.storageAccountName,
          resourceGroup: options.resourceGroupName || 'cloud-shell-storage-eastus',
          fileShare: options.fileShareName || 'cs-' + sessionId.substring(0, 8)
        } : undefined,
        metadata: {}
      };

      this.azureSessions.set(sessionId, session);
      this.credentials.set(sessionId, credential);

      // Establish WebSocket connection
      await this.connectWebSocket(sessionId, session);

      // Schedule token refresh
      this.scheduleTokenRefresh(sessionId, session);

      this.logger.info(`Azure Cloud Shell session created successfully: ${sessionId}`);
      return session;
    } catch (error) {
      this.logger.error(`Failed to create Azure Cloud Shell session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Create a new Azure Bastion session
   */
  async createBastionSession(
    sessionId: string,
    options: AzureConnectionOptions
  ): Promise<AzureBastionSession> {
    try {
      this.logger.info(`Creating Azure Bastion session: ${sessionId}`);

      const credential = await this.getCredential(options);
      const token = await this.getAccessToken(credential, 'https://management.azure.com/');

      // Get Bastion and VM resource information
      const bastionInfo = await this.getBastionResourceInfo(options, token);
      const vmInfo = await this.getVmResourceInfo(options, token);

      // Create Bastion connection
      const connectionUrl = await this.createBastionConnection(bastionInfo, vmInfo, options, token);

      const session: AzureBastionSession = {
        sessionId,
        bastionResourceId: options.bastionResourceId || '',
        targetVmResourceId: options.targetVmResourceId || '',
        targetVmName: options.targetVmName || '',
        protocol: options.protocol || 'ssh',
        connectionUrl,
        accessToken: token.accessToken,
        tokenExpiry: token.expiresOn,
        metadata: {
          bastionName: bastionInfo.name,
          vmName: vmInfo.name,
          location: bastionInfo.location
        }
      };

      this.azureSessions.set(sessionId, session);
      this.credentials.set(sessionId, credential);

      // For SSH connections through Bastion, establish tunnel
      if (options.protocol === 'ssh') {
        await this.establishBastionTunnel(sessionId, session, options);
      }

      this.scheduleTokenRefresh(sessionId, session);

      this.logger.info(`Azure Bastion session created successfully: ${sessionId}`);
      return session;
    } catch (error) {
      this.logger.error(`Failed to create Azure Bastion session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Create a new Azure Arc session
   */
  async createArcSession(
    sessionId: string,
    options: AzureConnectionOptions
  ): Promise<AzureArcSession> {
    try {
      this.logger.info(`Creating Azure Arc session: ${sessionId}`);

      const credential = await this.getCredential(options);
      const token = await this.getAccessToken(credential, 'https://management.azure.com/');

      // Get Arc resource information
      const arcInfo = await this.getArcResourceInfo(options, token);
      
      // Create hybrid connection
      const connectionEndpoint = await this.createArcConnection(arcInfo, options, token);
      const hybridConnectionString = await this.getHybridConnectionString(arcInfo, token);

      const session: AzureArcSession = {
        sessionId,
        arcResourceId: options.arcResourceId || '',
        connectionEndpoint,
        accessToken: token.accessToken,
        tokenExpiry: token.expiresOn,
        hybridConnectionString,
        targetMachine: {
          name: arcInfo.name,
          osType: arcInfo.properties?.osName?.includes('Windows') ? 'Windows' : 'Linux',
          version: arcInfo.properties?.osVersion
        },
        metadata: {
          location: arcInfo.location,
          resourceGroup: arcInfo.resourceGroup
        }
      };

      this.azureSessions.set(sessionId, session);
      this.credentials.set(sessionId, credential);

      // Establish Arc connection
      await this.connectArcSession(sessionId, session);

      this.scheduleTokenRefresh(sessionId, session);

      this.logger.info(`Azure Arc session created successfully: ${sessionId}`);
      return session;
    } catch (error) {
      this.logger.error(`Failed to create Azure Arc session: ${sessionId}`, error);
      throw error;
    }
  }


  /**
   * Resize terminal for a session
   */
  async resizeTerminal(sessionId: string, rows: number, cols: number): Promise<void> {
    const webSocket = this.webSockets.get(sessionId);
    if (!webSocket) {
      throw new Error(`No WebSocket connection found for session: ${sessionId}`);
    }

    if (webSocket.readyState === WebSocket.OPEN) {
      const message = {
        type: 'resize',
        rows,
        cols
      };
      webSocket.send(JSON.stringify(message));
      this.logger.debug(`Resized terminal for session ${sessionId}: ${rows}x${cols}`);
    }
  }

  /**
   * Close a session (overrides BaseProtocol)
   */
  async closeSession(sessionId: string): Promise<void> {
    try {
      this.logger.info(`Closing Azure session: ${sessionId}`);

      // Close WebSocket connection
      const webSocket = this.webSockets.get(sessionId);
      if (webSocket) {
        webSocket.close();
        this.webSockets.delete(sessionId);
      }

      // Clear timers
      const reconnectTimer = this.reconnectTimers.get(sessionId);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        this.reconnectTimers.delete(sessionId);
      }

      const refreshTimer = this.tokenRefreshTimers.get(sessionId);
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        this.tokenRefreshTimers.delete(sessionId);
      }

      // Clean up Azure session data
      this.azureSessions.delete(sessionId);
      this.credentials.delete(sessionId);

      // Remove from base session map
      this.sessions.delete(sessionId);

      this.logger.info(`Azure session closed: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to close Azure session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Get Azure session information
   */
  getAzureSession(sessionId: string): AzureCloudShellSession | AzureBastionSession | AzureArcSession | undefined {
    return this.azureSessions.get(sessionId);
  }

  /**
   * List all active Azure sessions
   */
  listAzureSessions(): string[] {
    return Array.from(this.azureSessions.keys());
  }

  /**
   * Check if session is connected
   */
  isConnected(sessionId: string): boolean {
    const webSocket = this.webSockets.get(sessionId);
    return webSocket?.readyState === WebSocket.OPEN;
  }

  /**
   * Private methods
   */

  private async getCredential(options: AzureConnectionOptions): Promise<AzureCredentialLike> {
    if (!DefaultAzureCredential) {
      throw new Error('@azure/identity package is required but not available');
    }

    if (options.managedIdentity) {
      if (!ManagedIdentityCredential) {
        throw new Error('ManagedIdentityCredential not available');
      }
      return new ManagedIdentityCredential(options.clientId);
    }

    if (options.clientId && options.clientSecret && options.tenantId) {
      if (!ClientSecretCredential) {
        throw new Error('ClientSecretCredential not available');
      }
      return new ClientSecretCredential(
        options.tenantId,
        options.clientId,
        options.clientSecret
      );
    }

    if (options.clientCertificatePath && options.tenantId && options.clientId) {
      if (!ClientCertificateCredential) {
        throw new Error('ClientCertificateCredential not available');
      }
      return new ClientCertificateCredential(
        options.tenantId,
        options.clientId,
        options.clientCertificatePath
      );
    }

    // Use chained credential for maximum compatibility
    if (!ChainedTokenCredential || !AzureCliCredential || !ManagedIdentityCredential) {
      // Fallback to DefaultAzureCredential if chained components not available
      return new DefaultAzureCredential();
    }

    return new ChainedTokenCredential(
      new AzureCliCredential(),
      new ManagedIdentityCredential(),
      new DefaultAzureCredential()
    );
  }

  private async getAccessToken(credential: AzureCredentialLike, scope: string): Promise<AzureTokenInfo> {
    const tokenResponse = await credential.getToken(scope);
    
    return {
      accessToken: tokenResponse.token,
      tokenType: 'Bearer',
      expiresIn: Math.floor((tokenResponse.expiresOnTimestamp - Date.now()) / 1000),
      expiresOn: new Date(tokenResponse.expiresOnTimestamp),
      scope: [scope],
      tenantId: (credential as any).tenantId || '',
      resource: scope,
      authority: 'https://login.microsoftonline.com/'
    };
  }

  private async createCloudShellInstance(
    options: AzureConnectionOptions,
    token: AzureTokenInfo
  ): Promise<string> {
    const subscriptionId = options.subscriptionId;
    const shellType = options.cloudShellType || 'bash';
    const location = options.region || 'eastus';

    // Azure Cloud Shell API endpoint
    const cloudShellApiUrl = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Portal/consoles/default`;

    const response = await fetch(cloudShellApiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
        'x-ms-console-preferred-location': location
      },
      body: JSON.stringify({
        properties: {
          osType: shellType === 'powershell' ? 'Windows' : 'Linux',
          consoleDefinition: {
            type: shellType
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create Cloud Shell instance: ${response.statusText}`);
    }

    const data = await response.json() as AzureCloudShellCreateResponse;
    return data.properties.uri;
  }

  private async getCloudShellWebSocketUrl(consoleUri: string, token: AzureTokenInfo): Promise<string> {
    const response = await fetch(`${consoleUri}/connect`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          connectParams: {
            osType: 'Linux',
            shellType: 'bash'
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to get WebSocket URL: ${response.statusText}`);
    }

    const data = await response.json() as AzureCloudShellConnectResponse;
    return data.properties.socketUri;
  }

  private async getBastionResourceInfo(
    options: AzureConnectionOptions,
    token: AzureTokenInfo
  ): Promise<AzureResourceInfo> {
    const bastionResourceId = options.bastionResourceId;
    if (!bastionResourceId) {
      throw new Error('Bastion resource ID is required');
    }

    const response = await fetch(`https://management.azure.com${bastionResourceId}?api-version=2021-02-01`, {
      headers: {
        'Authorization': `Bearer ${token.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get Bastion resource info: ${response.statusText}`);
    }

    const data = await response.json() as AzureResourceResponse;
    return {
      resourceId: data.id,
      resourceType: data.type,
      resourceGroup: data.id.split('/')[4],
      subscriptionId: data.id.split('/')[2],
      location: data.location,
      name: data.name,
      properties: data.properties
    };
  }

  private async getVmResourceInfo(
    options: AzureConnectionOptions,
    token: AzureTokenInfo
  ): Promise<AzureResourceInfo> {
    const vmResourceId = options.targetVmResourceId;
    if (!vmResourceId) {
      throw new Error('Target VM resource ID is required');
    }

    const response = await fetch(`https://management.azure.com${vmResourceId}?api-version=2021-03-01`, {
      headers: {
        'Authorization': `Bearer ${token.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get VM resource info: ${response.statusText}`);
    }

    const data = await response.json() as AzureResourceResponse;
    return {
      resourceId: data.id,
      resourceType: data.type,
      resourceGroup: data.id.split('/')[4],
      subscriptionId: data.id.split('/')[2],
      location: data.location,
      name: data.name,
      properties: data.properties
    };
  }

  private async createBastionConnection(
    bastionInfo: AzureResourceInfo,
    vmInfo: AzureResourceInfo,
    options: AzureConnectionOptions,
    token: AzureTokenInfo
  ): Promise<string> {
    const protocol = options.protocol || 'ssh';
    const bastionEndpoint = `https://management.azure.com${bastionInfo.resourceId}/createShareableLinks`;

    const response = await fetch(bastionEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        vms: [{
          vm: {
            id: vmInfo.resourceId
          }
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create Bastion connection: ${response.statusText}`);
    }

    const data = await response.json() as AzureBastionConnectionResponse;
    return data.value[0]?.bsl || '';
  }

  private async getArcResourceInfo(
    options: AzureConnectionOptions,
    token: AzureTokenInfo
  ): Promise<AzureResourceInfo> {
    const arcResourceId = options.arcResourceId;
    if (!arcResourceId) {
      throw new Error('Arc resource ID is required');
    }

    const response = await fetch(`https://management.azure.com${arcResourceId}?api-version=2020-08-02`, {
      headers: {
        'Authorization': `Bearer ${token.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get Arc resource info: ${response.statusText}`);
    }

    const data = await response.json() as AzureResourceResponse;
    return {
      resourceId: data.id,
      resourceType: data.type,
      resourceGroup: data.id.split('/')[4],
      subscriptionId: data.id.split('/')[2],
      location: data.location,
      name: data.name,
      properties: data.properties
    };
  }

  private async createArcConnection(
    arcInfo: AzureResourceInfo,
    options: AzureConnectionOptions,
    token: AzureTokenInfo
  ): Promise<string> {
    // Create Arc connection endpoint
    const endpoint = `https://management.azure.com${arcInfo.resourceId}/providers/Microsoft.HybridConnectivity/endpoints/default`;
    
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          type: 'default',
          resourceId: arcInfo.resourceId
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create Arc connection: ${response.statusText}`);
    }

    const data = await response.json() as AzureArcConnectionResponse;
    return data.properties.connectionDetails.socketUri;
  }

  private async getHybridConnectionString(
    arcInfo: AzureResourceInfo,
    token: AzureTokenInfo
  ): Promise<string> {
    const endpoint = `https://management.azure.com${arcInfo.resourceId}/providers/Microsoft.HybridConnectivity/endpoints/default/listCredentials`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get hybrid connection string: ${response.statusText}`);
    }

    const data = await response.json() as AzureHybridConnectionResponse;
    return data.hybridConnectionString;
  }

  private async connectWebSocket(
    sessionId: string,
    session: AzureCloudShellSession | AzureBastionSession | AzureArcSession
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const webSocketUrl = (session as AzureCloudShellSession).webSocketUrl || 
                           (session as AzureArcSession).connectionEndpoint;

        const webSocket = new WebSocket(webSocketUrl, {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`
          }
        });

        webSocket.on('open', () => {
          this.logger.info(`WebSocket connected for session: ${sessionId}`);
          this.webSockets.set(sessionId, webSocket);
          this.emit('connected', sessionId);
          resolve();
        });

        webSocket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
          try {
            const message = Buffer.isBuffer(data) ? data.toString() :
                           data instanceof ArrayBuffer ? Buffer.from(data).toString() :
                           Buffer.concat(data as Buffer[]).toString();
            const output: ConsoleOutput = {
              sessionId,
              type: 'stdout',
              data: message,
              timestamp: new Date(),
              raw: message
            };
            this.addToOutputBuffer(sessionId, output);
          } catch (error) {
            this.logger.error(`Error processing WebSocket message for session ${sessionId}:`, error);
          }
        });

        webSocket.on('error', (error) => {
          this.logger.error(`WebSocket error for session ${sessionId}:`, error);
          this.emit('error', { sessionId, error });
          reject(error);
        });

        webSocket.on('close', (code, reason) => {
          this.logger.info(`WebSocket closed for session ${sessionId}: ${code} - ${reason}`);
          this.webSockets.delete(sessionId);

          // Attempt reconnection if not intentionally closed
          if (code !== 1000 && this.azureSessions.has(sessionId)) {
            this.scheduleReconnect(sessionId);
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  private async establishBastionTunnel(
    sessionId: string,
    session: AzureBastionSession,
    options: AzureConnectionOptions
  ): Promise<void> {
    // For Bastion SSH connections, we need to establish a tunnel
    // This is a simplified implementation - in practice, you'd use the Bastion API
    // to create a proper SSH tunnel
    
    const localPort = 2222 + Math.floor(Math.random() * 1000);
    session.tunnelEndpoint = `localhost:${localPort}`;
    session.portForwarding = {
      localPort,
      remotePort: 22,
      remoteHost: session.targetVmName
    };

    this.logger.info(`Bastion SSH tunnel established for session ${sessionId} on port ${localPort}`);
  }

  private async connectArcSession(
    sessionId: string,
    session: AzureArcSession
  ): Promise<void> {
    // For Arc sessions, establish the hybrid connection
    await this.connectWebSocket(sessionId, session);
  }

  private scheduleTokenRefresh(
    sessionId: string,
    session: AzureCloudShellSession | AzureBastionSession | AzureArcSession
  ): void {
    const refreshTime = session.tokenExpiry.getTime() - Date.now() - (5 * 60 * 1000); // 5 minutes before expiry
    
    if (refreshTime > 0) {
      const timer = setTimeout(async () => {
        try {
          await this.refreshToken(sessionId);
        } catch (error) {
          this.logger?.error(`Failed to refresh token for session ${sessionId}:`, error);
          this.emit('error', sessionId, error as Error);
        }
      }, refreshTime);

      this.tokenRefreshTimers.set(sessionId, timer);
    }
  }

  private async refreshToken(sessionId: string): Promise<void> {
    const session = this.azureSessions.get(sessionId);
    const credential = this.credentials.get(sessionId);

    if (!session || !credential) {
      throw new Error(`Session or credential not found: ${sessionId}`);
    }

    const newToken = await this.getAccessToken(credential, 'https://management.azure.com/');
    
    // Update session with new token
    session.accessToken = newToken.accessToken;
    session.tokenExpiry = newToken.expiresOn;

    // Update session activity in BaseProtocol
    const baseSession = this.sessions.get(sessionId);
    if (baseSession) {
      baseSession.lastActivity = new Date();
    }

    this.scheduleTokenRefresh(sessionId, session);

    this.logger.info(`Token refreshed for session: ${sessionId}`);
  }

  private scheduleReconnect(sessionId: string, attempt: number = 1): void {
    const maxAttempts = 5;
    const baseDelay = 1000;
    const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff

    if (attempt > maxAttempts) {
      this.logger.error(`Max reconnection attempts reached for session: ${sessionId}`);
      this.emit('error', { sessionId, error: new Error('Max reconnection attempts reached') });
      return;
    }

    this.logger.info(`Attempting reconnection for session ${sessionId}, attempt ${attempt}`);

    const timer = setTimeout(async () => {
      try {
        const session = this.azureSessions.get(sessionId);
        if (session) {
          await this.connectWebSocket(sessionId, session);
          this.logger.info(`Reconnected session ${sessionId} on attempt ${attempt}`);
        }
      } catch (error) {
        this.logger.error(`Reconnection attempt ${attempt} failed for session ${sessionId}:`, error);
        this.scheduleReconnect(sessionId, attempt + 1);
      }
    }, delay);

    this.reconnectTimers.set(sessionId, timer);
  }

  /**
   * Get secrets from Azure Key Vault
   */
  private async getKeyVaultSecret(keyVaultUrl: string, secretName: string, credential: AzureCredentialLike): Promise<string> {
    if (!SecretClient) {
      throw new Error('@azure/keyvault-secrets package is required but not available');
    }
    const secretClient = new SecretClient(keyVaultUrl, credential);
    const secret = await secretClient.getSecret(secretName);
    return secret.value || '';
  }

  /**
   * Health check for Azure sessions
   */
  async healthCheck(sessionId: string): Promise<boolean> {
    const session = this.azureSessions.get(sessionId);
    if (!session) {
      return false;
    }

    const webSocket = this.webSockets.get(sessionId);
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
      return false;
    }

    // Check if token is still valid
    const tokenExpiry = session.tokenExpiry.getTime();
    const now = Date.now();

    if (tokenExpiry <= now) {
      try {
        await this.refreshToken(sessionId);
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Get session metrics
   */
  getSessionMetrics(sessionId: string): Record<string, any> {
    const session = this.azureSessions.get(sessionId);
    const webSocket = this.webSockets.get(sessionId);

    if (!session) {
      return {};
    }

    return {
      sessionId,
      connected: webSocket?.readyState === WebSocket.OPEN,
      tokenExpiry: session.tokenExpiry,
      tokenValid: session.tokenExpiry.getTime() > Date.now(),
      sessionType: 'webSocketUrl' in session ? 'cloud-shell' :
                  'bastionResourceId' in session ? 'bastion' : 'arc',
      metadata: session.metadata
    };
  }

  /**
   * Cleanup all sessions
   */
  async cleanup(): Promise<void> {
    const sessionIds = Array.from(this.azureSessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));

    this.azureSessions.clear();
    this.webSockets.clear();
    this.credentials.clear();
    this.computeClients.clear();
    this.networkClients.clear();
    this.secretClients.clear();
    this.reconnectTimers.clear();
    this.tokenRefreshTimers.clear();
  }
}