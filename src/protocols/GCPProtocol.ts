import { EventEmitter } from 'events';
import { GoogleAuth, JWT, OAuth2Client, UserRefreshClient } from 'google-auth-library';
import { Compute, InstancesClient, ZonesClient } from '@google-cloud/compute';
import { OSLoginServiceClient } from '@google-cloud/os-login';
import { spawn, ChildProcess } from 'child_process';
import { createTunnel } from 'tunnel-ssh';
import WebSocket from 'ws';
import * as gcpMetadata from 'gcp-metadata';
import { v4 as uuidv4 } from 'uuid';
import { 
  GCPConnectionOptions, 
  GCPCloudShellSession, 
  GCPComputeSession, 
  GCPGKESession,
  GCPTokenInfo,
  GCPResourceInfo,
  GCPQuotaInfo,
  GCPRateLimitInfo,
  GCPServiceAccountInfo,
  GCPIAMPolicy,
  ConsoleSession,
  ConsoleOutput,
  ConsoleEvent
} from '../types/index.js';
import { Logger } from '../utils/logger.js';

/**
 * Google Cloud Platform Protocol Implementation
 * 
 * This class provides comprehensive support for:
 * - Google Cloud Shell integration
 * - Compute Engine VM connections via OS Login
 * - GKE cluster access
 * - Identity-Aware Proxy (IAP) tunneling
 * - OAuth2 and service account authentication
 * - Quota and rate limiting management
 */
export class GCPProtocol extends EventEmitter {
  private auth: GoogleAuth;
  private computeClient: InstancesClient;
  private osLoginClient: OSLoginServiceClient;
  private zonesClient: ZonesClient;
  private logger: Logger;
  
  // Session management
  private cloudShellSessions = new Map<string, GCPCloudShellSession>();
  private computeSessions = new Map<string, GCPComputeSession>();
  private gkeSessions = new Map<string, GCPGKESession>();
  
  // Connection pools
  private sshConnections = new Map<string, ChildProcess>();
  private webSocketConnections = new Map<string, WebSocket>();
  private iapTunnels = new Map<string, any>();
  
  // Rate limiting and quota management
  private rateLimiters = new Map<string, GCPRateLimitInfo>();
  private quotaUsage = new Map<string, GCPQuotaInfo>();
  
  // Authentication cache
  private tokenCache = new Map<string, GCPTokenInfo>();
  private serviceAccountCache = new Map<string, GCPServiceAccountInfo>();
  
  // Cloud Shell API endpoints
  private readonly CLOUD_SHELL_API = 'https://cloudshell.googleapis.com';
  private readonly CLOUD_SHELL_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/cloudshell'
  ];
  
  // Compute Engine scopes
  private readonly COMPUTE_SCOPES = [
    'https://www.googleapis.com/auth/compute',
    'https://www.googleapis.com/auth/cloud-platform'
  ];
  
  // OS Login scopes
  private readonly OSLOGIN_SCOPES = [
    'https://www.googleapis.com/auth/compute.oslogin',
    'https://www.googleapis.com/auth/cloud-platform'
  ];

  constructor() {
    super();
    this.logger = new Logger('GCPProtocol');
    this.initializeClients();
  }

  /**
   * Initialize Google Cloud clients with default authentication
   */
  private async initializeClients(): Promise<void> {
    try {
      this.auth = new GoogleAuth({
        scopes: [
          ...this.CLOUD_SHELL_SCOPES,
          ...this.COMPUTE_SCOPES,
          ...this.OSLOGIN_SCOPES
        ]
      });

      this.computeClient = new InstancesClient({
        auth: this.auth
      });
      
      this.osLoginClient = new OSLoginServiceClient({
        auth: this.auth
      });
      
      this.zonesClient = new ZonesClient({
        auth: this.auth
      });

      this.logger.info('GCP clients initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize GCP clients:', error);
      throw error;
    }
  }

  /**
   * Create a Google Cloud Shell session
   */
  async createCloudShellSession(
    sessionId: string,
    options: GCPConnectionOptions
  ): Promise<GCPCloudShellSession> {
    try {
      const projectId = options.projectId || await this.getDefaultProjectId();
      const region = options.region || 'us-central1';
      const shellType = options.cloudShellType || 'bash';
      
      // Get authentication token
      const authClient = await this.getAuthenticatedClient(options);
      const tokenInfo = await this.getTokenInfo(authClient);
      
      // Check and enforce quotas
      await this.checkCloudShellQuota(projectId);
      
      // Create or get existing Cloud Shell environment
      const environment = await this.createCloudShellEnvironment(projectId, options);
      
      // Get WebSocket URL for the shell
      const webSocketUrl = await this.getCloudShellWebSocketUrl(environment.name, tokenInfo.accessToken);
      
      // Detect installed tools and capabilities
      const capabilities = await this.detectCloudShellCapabilities(environment.name, tokenInfo.accessToken);
      
      const session: GCPCloudShellSession = {
        sessionId,
        webSocketUrl,
        accessToken: tokenInfo.accessToken,
        refreshToken: tokenInfo.refreshToken,
        tokenExpiry: tokenInfo.expiresOn,
        shellType,
        projectId,
        region,
        zone: options.zone,
        vmName: environment.vmName,
        machineType: environment.machineType || 'e2-small',
        diskSizeGb: environment.diskSizeGb || 5,
        homeDirectory: '/home/user',
        environment: environment.env || {},
        capabilities,
        persistentDisk: environment.persistentDisk,
        networkInfo: {
          internalIp: environment.internalIp,
          externalIp: environment.externalIp,
          subnetwork: environment.subnetwork,
          network: environment.network
        },
        metadata: options.metadata
      };

      this.cloudShellSessions.set(sessionId, session);
      
      // Set up WebSocket connection
      await this.establishCloudShellConnection(session);
      
      this.logger.info(`Cloud Shell session ${sessionId} created for project ${projectId}`);
      this.emit('session-created', { sessionId, type: 'gcp-shell', session });
      
      return session;
    } catch (error) {
      this.logger.error(`Failed to create Cloud Shell session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Create a Compute Engine VM session with OS Login
   */
  async createComputeSession(
    sessionId: string,
    options: GCPConnectionOptions
  ): Promise<GCPComputeSession> {
    try {
      const projectId = options.vmProject || options.projectId || await this.getDefaultProjectId();
      const zone = options.vmZone || options.zone || 'us-central1-a';
      const vmName = options.vmName;
      
      if (!vmName) {
        throw new Error('VM name is required for Compute Engine sessions');
      }

      // Get authentication
      const authClient = await this.getAuthenticatedClient(options);
      const tokenInfo = await this.getTokenInfo(authClient);
      
      // Get VM instance details
      const instance = await this.getComputeInstance(projectId, zone, vmName);
      
      // Set up OS Login if enabled
      let osLoginInfo;
      if (options.osLoginEnabled) {
        osLoginInfo = await this.setupOSLogin(projectId, authClient, options);
      }
      
      // Set up IAP tunnel if enabled
      let iapTunnelInfo;
      if (options.iapTunnelEnabled) {
        iapTunnelInfo = await this.setupIAPTunnel(projectId, zone, vmName, options);
      }
      
      const session: GCPComputeSession = {
        sessionId,
        vmName,
        vmZone: zone,
        vmProject: projectId,
        instanceId: instance.id!.toString(),
        machineType: instance.machineType?.split('/').pop() || 'unknown',
        status: instance.status as any,
        accessMethod: options.osLoginEnabled ? 'oslogin' : 
                    options.iapTunnelEnabled ? 'iap-tunnel' : 'ssh',
        connectionInfo: {
          internalIp: instance.networkInterfaces?.[0]?.networkIP,
          externalIp: instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP,
          username: osLoginInfo?.username || options.osLoginUser || 'user',
          sshKeys: instance.metadata?.items?.find(item => item.key === 'ssh-keys')?.value?.split('\n') || []
        },
        osLogin: osLoginInfo,
        iapTunnel: iapTunnelInfo,
        metadata: options.metadata
      };

      this.computeSessions.set(sessionId, session);
      
      // Establish SSH connection
      await this.establishComputeConnection(session, options);
      
      this.logger.info(`Compute session ${sessionId} created for VM ${vmName} in ${zone}`);
      this.emit('session-created', { sessionId, type: 'gcp-ssh', session });
      
      return session;
    } catch (error) {
      this.logger.error(`Failed to create Compute session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Create a GKE cluster session
   */
  async createGKESession(
    sessionId: string,
    options: GCPConnectionOptions
  ): Promise<GCPGKESession> {
    try {
      const projectId = options.projectId || await this.getDefaultProjectId();
      const clusterName = options.clusterName;
      const clusterLocation = options.clusterLocation;
      const namespace = options.namespace || 'default';
      
      if (!clusterName || !clusterLocation) {
        throw new Error('Cluster name and location are required for GKE sessions');
      }

      // Get authentication
      const authClient = await this.getAuthenticatedClient(options);
      const tokenInfo = await this.getTokenInfo(authClient);
      
      // Get cluster details
      const cluster = await this.getGKECluster(projectId, clusterLocation, clusterName);
      
      // Generate kubeconfig
      const kubeconfig = await this.generateKubeconfig(cluster, tokenInfo);
      
      const session: GCPGKESession = {
        sessionId,
        clusterName,
        clusterLocation,
        clusterProject: projectId,
        namespace,
        podName: options.podName,
        containerName: options.containerName,
        accessToken: tokenInfo.accessToken,
        tokenExpiry: tokenInfo.expiresOn,
        kubeconfig,
        clusterInfo: {
          version: cluster.currentMasterVersion || 'unknown',
          nodeCount: cluster.currentNodeCount || 0,
          location: clusterLocation,
          network: cluster.network,
          subnetwork: cluster.subnetwork,
          masterAuthorizedNetworks: cluster.masterAuthorizedNetworksConfig?.cidrBlocks?.map(block => block.cidrBlock) || []
        },
        metadata: options.metadata
      };

      this.gkeSessions.set(sessionId, session);
      
      // Establish kubectl connection
      await this.establishGKEConnection(session, options);
      
      this.logger.info(`GKE session ${sessionId} created for cluster ${clusterName}`);
      this.emit('session-created', { sessionId, type: 'gcp-oslogin', session });
      
      return session;
    } catch (error) {
      this.logger.error(`Failed to create GKE session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Send input to a GCP session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    const cloudShellSession = this.cloudShellSessions.get(sessionId);
    if (cloudShellSession) {
      return this.sendCloudShellInput(sessionId, input);
    }
    
    const computeSession = this.computeSessions.get(sessionId);
    if (computeSession) {
      return this.sendComputeInput(sessionId, input);
    }
    
    const gkeSession = this.gkeSessions.get(sessionId);
    if (gkeSession) {
      return this.sendGKEInput(sessionId, input);
    }
    
    throw new Error(`Session ${sessionId} not found`);
  }

  /**
   * Close a GCP session
   */
  async closeSession(sessionId: string): Promise<void> {
    try {
      // Close WebSocket connections
      const ws = this.webSocketConnections.get(sessionId);
      if (ws) {
        ws.close();
        this.webSocketConnections.delete(sessionId);
      }
      
      // Close SSH connections
      const ssh = this.sshConnections.get(sessionId);
      if (ssh) {
        ssh.kill();
        this.sshConnections.delete(sessionId);
      }
      
      // Close IAP tunnels
      const tunnel = this.iapTunnels.get(sessionId);
      if (tunnel) {
        tunnel.close();
        this.iapTunnels.delete(sessionId);
      }
      
      // Remove from session maps
      this.cloudShellSessions.delete(sessionId);
      this.computeSessions.delete(sessionId);
      this.gkeSessions.delete(sessionId);
      
      this.logger.info(`Session ${sessionId} closed`);
      this.emit('session-closed', { sessionId });
    } catch (error) {
      this.logger.error(`Error closing session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): GCPCloudShellSession | GCPComputeSession | GCPGKESession | null {
    return this.cloudShellSessions.get(sessionId) ||
           this.computeSessions.get(sessionId) ||
           this.gkeSessions.get(sessionId) ||
           null;
  }

  /**
   * List all active sessions
   */
  listSessions(): Array<{ sessionId: string; type: string; session: any }> {
    const sessions: Array<{ sessionId: string; type: string; session: any }> = [];
    
    for (const [sessionId, session] of this.cloudShellSessions) {
      sessions.push({ sessionId, type: 'gcp-shell', session });
    }
    
    for (const [sessionId, session] of this.computeSessions) {
      sessions.push({ sessionId, type: 'gcp-ssh', session });
    }
    
    for (const [sessionId, session] of this.gkeSessions) {
      sessions.push({ sessionId, type: 'gcp-oslogin', session });
    }
    
    return sessions;
  }

  // Private helper methods

  private async getAuthenticatedClient(options: GCPConnectionOptions): Promise<JWT | OAuth2Client | UserRefreshClient> {
    if (options.oauth2Config) {
      return this.createOAuth2Client(options.oauth2Config);
    }
    
    if (options.keyFile || options.keyFilename || options.credentials) {
      return this.createServiceAccountClient(options);
    }
    
    // Default to ADC (Application Default Credentials)
    return this.auth.getClient() as Promise<JWT | OAuth2Client | UserRefreshClient>;
  }

  private createOAuth2Client(oauth2Config: NonNullable<GCPConnectionOptions['oauth2Config']>): OAuth2Client {
    const client = new OAuth2Client({
      clientId: oauth2Config.clientId,
      clientSecret: oauth2Config.clientSecret,
      redirectUri: 'urn:ietf:wg:oauth:2.0:oob'
    });

    if (oauth2Config.refreshToken) {
      client.setCredentials({
        refresh_token: oauth2Config.refreshToken,
        access_token: oauth2Config.accessToken
      });
    }

    return client;
  }

  private createServiceAccountClient(options: GCPConnectionOptions): JWT {
    let credentials;
    
    if (options.keyFile) {
      credentials = JSON.parse(options.keyFile);
    } else if (options.keyFilename) {
      credentials = require(options.keyFilename);
    } else if (options.credentials) {
      credentials = options.credentials;
    } else {
      throw new Error('No service account credentials provided');
    }

    return new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: options.scopes || [...this.CLOUD_SHELL_SCOPES, ...this.COMPUTE_SCOPES, ...this.OSLOGIN_SCOPES]
    });
  }

  private async getTokenInfo(client: JWT | OAuth2Client | UserRefreshClient): Promise<GCPTokenInfo> {
    const accessToken = await client.getAccessToken();
    const credentials = client.credentials;
    
    return {
      accessToken: accessToken.token!,
      refreshToken: credentials.refresh_token,
      tokenType: credentials.token_type || 'Bearer',
      expiresIn: credentials.expiry_date ? Math.floor((credentials.expiry_date - Date.now()) / 1000) : 3600,
      expiresOn: new Date(credentials.expiry_date || Date.now() + 3600000),
      scope: (credentials.scope as string)?.split(' ') || [],
      projectId: await this.getDefaultProjectId(),
      clientId: (client as OAuth2Client)._clientId,
      clientEmail: (client as JWT).email,
      serviceAccount: client instanceof JWT
    };
  }

  private async getDefaultProjectId(): Promise<string> {
    try {
      return await this.auth.getProjectId();
    } catch (error) {
      // Fallback to metadata service if available
      try {
        return await gcpMetadata.project('project-id');
      } catch (metadataError) {
        throw new Error('Unable to determine project ID. Please specify projectId in options.');
      }
    }
  }

  private async createCloudShellEnvironment(projectId: string, options: GCPConnectionOptions): Promise<any> {
    // Implementation would call Cloud Shell API to create/get environment
    // This is a simplified version - actual implementation would make REST calls
    return {
      name: `projects/${projectId}/environments/${uuidv4()}`,
      vmName: `cloudshell-vm-${Date.now()}`,
      machineType: options.machineType || 'e2-small',
      diskSizeGb: options.diskSizeGb || 5,
      env: process.env,
      persistentDisk: options.persistentDisk,
      internalIp: '10.0.0.1',
      externalIp: undefined, // Cloud Shell typically doesn't have external IP
      network: 'default',
      subnetwork: 'default'
    };
  }

  private async getCloudShellWebSocketUrl(environmentName: string, accessToken: string): Promise<string> {
    // Implementation would get actual WebSocket URL from Cloud Shell API
    return `wss://cloudshell.googleapis.com/v1/${environmentName}/connect`;
  }

  private async detectCloudShellCapabilities(environmentName: string, accessToken: string): Promise<GCPCloudShellSession['capabilities']> {
    // Implementation would detect installed tools in Cloud Shell environment
    return {
      cloudSdk: true,
      docker: true,
      kubectl: true,
      terraform: true,
      customTools: ['git', 'vim', 'nano', 'curl', 'wget', 'python3', 'node', 'go']
    };
  }

  private async establishCloudShellConnection(session: GCPCloudShellSession): Promise<void> {
    const ws = new WebSocket(session.webSocketUrl, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      }
    });

    ws.on('open', () => {
      this.logger.info(`Cloud Shell WebSocket connection established for session ${session.sessionId}`);
      this.emit('session-connected', { sessionId: session.sessionId, type: 'websocket' });
    });

    ws.on('message', (data) => {
      const output: ConsoleOutput = {
        sessionId: session.sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.emit('output', output);
    });

    ws.on('error', (error) => {
      this.logger.error(`Cloud Shell WebSocket error for session ${session.sessionId}:`, error);
      this.emit('session-error', { sessionId: session.sessionId, error });
    });

    ws.on('close', () => {
      this.logger.info(`Cloud Shell WebSocket connection closed for session ${session.sessionId}`);
      this.emit('session-disconnected', { sessionId: session.sessionId });
    });

    this.webSocketConnections.set(session.sessionId, ws);
  }

  private async getComputeInstance(projectId: string, zone: string, instanceName: string): Promise<any> {
    const [instance] = await this.computeClient.get({
      project: projectId,
      zone: zone,
      instance: instanceName
    });
    return instance;
  }

  private async setupOSLogin(projectId: string, authClient: any, options: GCPConnectionOptions): Promise<any> {
    if (!options.osLoginUser) {
      // Get user info from token
      const tokenInfo = await authClient.getTokenInfo(await authClient.getAccessToken());
      options.osLoginUser = tokenInfo.email || 'unknown';
    }

    // Import SSH public key via OS Login API
    const osLoginUser = `users/${options.osLoginUser}`;
    
    return {
      enabled: true,
      username: options.osLoginUser,
      uid: 1000, // This would be returned by OS Login API
      gid: 1000,
      homeDirectory: `/home/${options.osLoginUser}`,
      shell: '/bin/bash'
    };
  }

  private async setupIAPTunnel(projectId: string, zone: string, instanceName: string, options: GCPConnectionOptions): Promise<any> {
    const localPort = 2222; // Random available port
    const remotePort = 22;
    
    // This would set up actual IAP tunnel using gcloud compute start-iap-tunnel
    // For now, return tunnel configuration
    return {
      enabled: true,
      localPort,
      targetPort: remotePort,
      clientId: options.iapConfig?.clientId,
      audience: options.iapConfig?.audience
    };
  }

  private async establishComputeConnection(session: GCPComputeSession, options: GCPConnectionOptions): Promise<void> {
    let sshCommand: string[];
    let sshHost: string;
    let sshPort = 22;

    if (session.iapTunnel?.enabled) {
      // Connect via IAP tunnel
      sshHost = 'localhost';
      sshPort = session.iapTunnel.localPort;
    } else {
      // Direct connection
      sshHost = session.connectionInfo.externalIp || session.connectionInfo.internalIp!;
    }

    sshCommand = [
      'ssh',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-p', sshPort.toString(),
      `${session.connectionInfo.username}@${sshHost}`
    ];

    const sshProcess = spawn(sshCommand[0], sshCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    sshProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId: session.sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.emit('output', output);
    });

    sshProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId: session.sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.emit('output', output);
    });

    sshProcess.on('error', (error) => {
      this.logger.error(`SSH process error for session ${session.sessionId}:`, error);
      this.emit('session-error', { sessionId: session.sessionId, error });
    });

    sshProcess.on('close', (code) => {
      this.logger.info(`SSH process closed for session ${session.sessionId} with code ${code}`);
      this.emit('session-disconnected', { sessionId: session.sessionId });
    });

    this.sshConnections.set(session.sessionId, sshProcess);
  }

  private async getGKECluster(projectId: string, location: string, clusterName: string): Promise<any> {
    // This would use Container API to get cluster info
    // Simplified implementation
    return {
      name: clusterName,
      location: location,
      currentMasterVersion: '1.24.0',
      currentNodeCount: 3,
      network: 'default',
      subnetwork: 'default',
      masterAuthorizedNetworksConfig: {
        cidrBlocks: [{ cidrBlock: '0.0.0.0/0' }]
      }
    };
  }

  private async generateKubeconfig(cluster: any, tokenInfo: GCPTokenInfo): Promise<any> {
    return {
      context: `gke_${tokenInfo.projectId}_${cluster.location}_${cluster.name}`,
      cluster: `gke_${tokenInfo.projectId}_${cluster.location}_${cluster.name}`,
      user: `gke_${tokenInfo.projectId}_${cluster.location}_${cluster.name}`,
      certificateAuthority: cluster.masterAuth?.clusterCaCertificate,
      clientCertificate: cluster.masterAuth?.clientCertificate,
      clientKey: cluster.masterAuth?.clientKey
    };
  }

  private async establishGKEConnection(session: GCPGKESession, options: GCPConnectionOptions): Promise<void> {
    // Set up kubectl with the generated kubeconfig
    const kubectlCommand = ['kubectl', 'get', 'pods', '-n', session.namespace];
    
    const kubectlProcess = spawn(kubectlCommand[0], kubectlCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        KUBECONFIG: '/tmp/kubeconfig-' + session.sessionId // This would contain the actual kubeconfig
      }
    });

    kubectlProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId: session.sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.emit('output', output);
    });

    kubectlProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId: session.sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.emit('output', output);
    });

    this.sshConnections.set(session.sessionId, kubectlProcess);
  }

  private async sendCloudShellInput(sessionId: string, input: string): Promise<void> {
    const ws = this.webSocketConnections.get(sessionId);
    if (!ws) {
      throw new Error(`No WebSocket connection for session ${sessionId}`);
    }
    
    ws.send(input);
  }

  private async sendComputeInput(sessionId: string, input: string): Promise<void> {
    const ssh = this.sshConnections.get(sessionId);
    if (!ssh || !ssh.stdin) {
      throw new Error(`No SSH connection for session ${sessionId}`);
    }
    
    ssh.stdin.write(input);
  }

  private async sendGKEInput(sessionId: string, input: string): Promise<void> {
    const kubectl = this.sshConnections.get(sessionId);
    if (!kubectl || !kubectl.stdin) {
      throw new Error(`No kubectl connection for session ${sessionId}`);
    }
    
    kubectl.stdin.write(input);
  }

  private async checkCloudShellQuota(projectId: string): Promise<void> {
    // Implementation would check Cloud Shell quotas
    // For now, just log
    this.logger.debug(`Checking Cloud Shell quota for project ${projectId}`);
  }

  /**
   * Get quota information for a service
   */
  async getQuotaInfo(service: string, region?: string, zone?: string): Promise<GCPQuotaInfo[]> {
    // This would call Compute Engine or other service APIs to get quota info
    return [
      {
        quotaId: 'compute.googleapis.com/instances',
        service: 'compute',
        quotaName: 'instances',
        limit: 10,
        usage: 2,
        remaining: 8,
        unit: 'count',
        region: region,
        zone: zone
      }
    ];
  }

  /**
   * Get rate limiting information
   */
  getRateLimitInfo(service: string, method: string): GCPRateLimitInfo | null {
    const key = `${service}:${method}`;
    return this.rateLimiters.get(key) || null;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Close all WebSocket connections
    for (const [sessionId, ws] of this.webSocketConnections) {
      try {
        ws.close();
      } catch (error) {
        this.logger.error(`Error closing WebSocket for session ${sessionId}:`, error);
      }
    }

    // Kill all SSH processes
    for (const [sessionId, process] of this.sshConnections) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing SSH process for session ${sessionId}:`, error);
      }
    }

    // Close all IAP tunnels
    for (const [sessionId, tunnel] of this.iapTunnels) {
      try {
        tunnel.close();
      } catch (error) {
        this.logger.error(`Error closing IAP tunnel for session ${sessionId}:`, error);
      }
    }

    // Clear all maps
    this.cloudShellSessions.clear();
    this.computeSessions.clear();
    this.gkeSessions.clear();
    this.webSocketConnections.clear();
    this.sshConnections.clear();
    this.iapTunnels.clear();
    this.tokenCache.clear();
    this.serviceAccountCache.clear();

    this.logger.info('GCP Protocol cleanup completed');
  }
}