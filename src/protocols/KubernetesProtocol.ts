import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as k8s from '@kubernetes/client-node';
import * as yaml from 'js-yaml';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import stripAnsi from 'strip-ansi';
import {
  KubernetesConnectionOptions,
  KubernetesSessionState,
  PodSelectionOptions,
  PortForwardOptions,
  KubernetesCopyOptions,
  KubernetesLogOptions,
  KubernetesExecOptions,
  ConsoleOutput,
  ConsoleSession
} from '../types/index.js';
import { Logger } from '../utils/logger.js';

export interface KubernetesProtocolOptions {
  connectionOptions: KubernetesConnectionOptions;
  logger?: Logger;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
}

export interface KubernetesPod {
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    creationTimestamp: Date;
  };
  spec: {
    containers: Array<{
      name: string;
      image: string;
      ports?: Array<{ containerPort: number; name?: string; protocol?: string }>;
    }>;
    nodeName?: string;
  };
  status: {
    phase: string;
    conditions?: Array<{
      type: string;
      status: string;
      lastTransitionTime: Date;
      reason?: string;
      message?: string;
    }>;
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
      state: any;
    }>;
    podIP?: string;
    hostIP?: string;
  };
}

export interface KubernetesContext {
  name: string;
  cluster: string;
  user: string;
  namespace?: string;
}

export interface KubernetesCluster {
  name: string;
  server: string;
  certificateAuthorityData?: string;
  insecureSkipTlsVerify?: boolean;
}

export interface KubernetesUser {
  name: string;
  token?: string;
  clientCertificateData?: string;
  clientKeyData?: string;
  exec?: {
    command: string;
    args?: string[];
    env?: Array<{ name: string; value: string }>;
  };
}

export class KubernetesProtocol extends EventEmitter {
  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private k8sAppsApi: k8s.AppsV1Api;
  private k8sExecApi: k8s.Exec;
  private k8sLogsApi: k8s.Log;
  private k8sPortForwardApi: k8s.PortForward;
  private k8sCpApi: k8s.Cp;
  private logger: Logger;
  private connectionOptions: KubernetesConnectionOptions;
  private activeSessions: Map<string, KubernetesSessionState> = new Map();
  private activeExecSessions: Map<string, any> = new Map();
  private activePortForwards: Map<string, any> = new Map();
  private activeLogStreams: Map<string, any> = new Map();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private heartbeatInterval: number;
  private heartbeatTimer?: NodeJS.Timeout;
  private isConnected: boolean = false;
  private currentContext?: string;
  private currentNamespace?: string;

  constructor(options: KubernetesProtocolOptions) {
    super();
    this.connectionOptions = options.connectionOptions;
    this.logger = options.logger || new Logger('KubernetesProtocol');
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 5000;
    this.heartbeatInterval = options.heartbeatInterval || 30000;

    this.kc = new k8s.KubeConfig();
    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.k8sExecApi = new k8s.Exec(this.kc);
    this.k8sLogsApi = new k8s.Log(this.kc);
    this.k8sPortForwardApi = new k8s.PortForward(this.kc);
    this.k8sCpApi = new k8s.Cp(this.kc);
  }

  /**
   * Initialize and connect to Kubernetes cluster
   */
  async connect(): Promise<void> {
    try {
      await this.loadKubeConfig();
      await this.validateConnection();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.emit('connected');
      this.logger.info('Successfully connected to Kubernetes cluster', {
        context: this.currentContext,
        namespace: this.currentNamespace
      });
    } catch (error) {
      this.logger.error('Failed to connect to Kubernetes cluster', error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Disconnect from Kubernetes cluster
   */
  async disconnect(): Promise<void> {
    try {
      this.stopHeartbeat();
      
      // Close all active sessions
      for (const [sessionId, session] of this.activeSessions) {
        await this.closeSession(sessionId);
      }
      
      // Close active port forwards
      for (const [portForwardId, portForward] of this.activePortForwards) {
        try {
          await this.stopPortForward(portForwardId);
        } catch (error) {
          this.logger.warn('Error closing port forward', { portForwardId, error });
        }
      }
      
      // Close active log streams
      for (const [streamId, stream] of this.activeLogStreams) {
        try {
          if (stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
        } catch (error) {
          this.logger.warn('Error closing log stream', { streamId, error });
        }
      }

      this.isConnected = false;
      this.activeSessions.clear();
      this.activeExecSessions.clear();
      this.activePortForwards.clear();
      this.activeLogStreams.clear();
      
      this.emit('disconnected');
      this.logger.info('Disconnected from Kubernetes cluster');
    } catch (error) {
      this.logger.error('Error during disconnect', error);
      throw error;
    }
  }

  /**
   * Load Kubernetes configuration
   */
  private async loadKubeConfig(): Promise<void> {
    try {
      if (this.connectionOptions.inCluster) {
        // Load in-cluster configuration
        this.kc.loadFromCluster();
        this.logger.info('Loaded in-cluster Kubernetes configuration');
      } else if (this.connectionOptions.kubeconfig) {
        if (this.connectionOptions.kubeconfig.includes('\n') || this.connectionOptions.kubeconfig.includes('apiVersion')) {
          // Direct YAML content
          const config = yaml.load(this.connectionOptions.kubeconfig) as any;
          this.kc.loadFromOptions(config);
        } else {
          // File path
          if (existsSync(this.connectionOptions.kubeconfig)) {
            this.kc.loadFromFile(this.connectionOptions.kubeconfig);
          } else {
            throw new Error(`Kubeconfig file not found: ${this.connectionOptions.kubeconfig}`);
          }
        }
      } else {
        // Load default configuration
        const defaultKubeConfig = join(homedir(), '.kube', 'config');
        if (existsSync(defaultKubeConfig)) {
          this.kc.loadFromDefault();
        } else {
          throw new Error('No kubeconfig found and not running in-cluster');
        }
      }

      // Set context if specified
      if (this.connectionOptions.context) {
        this.kc.setCurrentContext(this.connectionOptions.context);
      }
      
      this.currentContext = this.kc.getCurrentContext();
      this.currentNamespace = this.connectionOptions.namespace || 
                            this.kc.getContextObject(this.currentContext)?.namespace || 
                            'default';

      // Apply additional options
      this.applyConnectionOptions();
      
      // Re-initialize API clients with updated config
      this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.k8sExecApi = new k8s.Exec(this.kc);
      this.k8sLogsApi = new k8s.Log(this.kc);
      this.k8sPortForwardApi = new k8s.PortForward(this.kc);
      this.k8sCpApi = new k8s.Cp(this.kc);

    } catch (error) {
      this.logger.error('Failed to load Kubernetes configuration', error);
      throw error;
    }
  }

  /**
   * Apply additional connection options to kubeconfig
   */
  private applyConnectionOptions(): void {
    const currentContext = this.kc.getContextObject(this.currentContext);
    if (!currentContext) return;

    const cluster = this.kc.getCluster(currentContext.cluster);
    const user = this.kc.getUser(currentContext.user);

    if (cluster) {
      if (this.connectionOptions.server) {
        cluster.server = this.connectionOptions.server;
      }
      if (this.connectionOptions.clusterCertificateAuthority) {
        cluster.caData = this.connectionOptions.clusterCertificateAuthority;
      }
      if (this.connectionOptions.insecureSkipTlsVerify !== undefined) {
        cluster.skipTLSVerify = this.connectionOptions.insecureSkipTlsVerify;
      }
    }

    if (user) {
      if (this.connectionOptions.token) {
        user.token = this.connectionOptions.token;
      }
      if (this.connectionOptions.clientCertificate) {
        user.certData = this.connectionOptions.clientCertificate;
      }
      if (this.connectionOptions.clientKey) {
        user.keyData = this.connectionOptions.clientKey;
      }
    }
  }

  /**
   * Validate connection to Kubernetes cluster
   */
  private async validateConnection(): Promise<void> {
    try {
      const response = await this.k8sApi.listNamespace();
      this.logger.info('Connection validated', {
        namespacesCount: response.body.items.length
      });
    } catch (error) {
      this.logger.error('Connection validation failed', error);
      throw new Error(`Failed to connect to Kubernetes cluster: ${error.message}`);
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.healthCheck();
      } catch (error) {
        this.logger.warn('Heartbeat failed', error);
        await this.handleReconnect();
      }
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Perform health check
   */
  private async healthCheck(): Promise<void> {
    try {
      await this.k8sApi.listNamespace('', undefined, undefined, undefined, undefined, 1);
    } catch (error) {
      throw new Error(`Health check failed: ${error.message}`);
    }
  }

  /**
   * Handle reconnection logic
   */
  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      this.isConnected = false;
      this.emit('disconnected', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    this.logger.info(`Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    try {
      await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
      await this.connect();
      this.emit('reconnected');
    } catch (error) {
      this.logger.warn(`Reconnection attempt ${this.reconnectAttempts} failed`, error);
      // Will try again on next heartbeat
    }
  }

  /**
   * Get available contexts
   */
  getContexts(): KubernetesContext[] {
    const contexts = this.kc.getContexts();
    return contexts.map(context => ({
      name: context.name,
      cluster: context.cluster,
      user: context.user,
      namespace: context.namespace
    }));
  }

  /**
   * Get available clusters
   */
  getClusters(): KubernetesCluster[] {
    const clusters = this.kc.getClusters();
    return clusters.map(cluster => ({
      name: cluster.name,
      server: cluster.server,
      certificateAuthorityData: cluster.caData,
      insecureSkipTlsVerify: cluster.skipTLSVerify
    }));
  }

  /**
   * Get available users
   */
  getUsers(): KubernetesUser[] {
    const users = this.kc.getUsers();
    return users.map(user => ({
      name: user.name,
      token: user.token,
      clientCertificateData: user.certData,
      clientKeyData: user.keyData,
      exec: user.exec
    }));
  }

  /**
   * Switch to a different context
   */
  async switchContext(contextName: string): Promise<void> {
    try {
      this.kc.setCurrentContext(contextName);
      this.currentContext = contextName;
      
      // Update namespace from context
      const contextObj = this.kc.getContextObject(contextName);
      this.currentNamespace = contextObj?.namespace || 'default';
      
      // Re-initialize API clients
      this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.k8sExecApi = new k8s.Exec(this.kc);
      this.k8sLogsApi = new k8s.Log(this.kc);
      this.k8sPortForwardApi = new k8s.PortForward(this.kc);
      this.k8sCpApi = new k8s.Cp(this.kc);
      
      await this.validateConnection();
      this.emit('contextChanged', { context: contextName, namespace: this.currentNamespace });
      this.logger.info('Switched context', { context: contextName, namespace: this.currentNamespace });
    } catch (error) {
      this.logger.error('Failed to switch context', { context: contextName, error });
      throw error;
    }
  }

  /**
   * List pods based on selection criteria
   */
  async listPods(options: Partial<PodSelectionOptions> = {}): Promise<KubernetesPod[]> {
    try {
      const namespace = options.namespace || this.currentNamespace;
      let fieldSelector = options.fieldSelector;
      let labelSelector = options.labelSelector;

      // Handle deployment-based selection
      if (options.deploymentName) {
        const deployment = await this.k8sAppsApi.readNamespacedDeployment(
          options.deploymentName, 
          namespace
        );
        const matchLabels = deployment.body.spec?.selector?.matchLabels;
        if (matchLabels) {
          const labels = Object.entries(matchLabels)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
          labelSelector = labelSelector ? `${labelSelector},${labels}` : labels;
        }
      }

      // Handle replica set-based selection
      if (options.replicaSetName) {
        const replicaSet = await this.k8sAppsApi.readNamespacedReplicaSet(
          options.replicaSetName, 
          namespace
        );
        const matchLabels = replicaSet.body.spec?.selector?.matchLabels;
        if (matchLabels) {
          const labels = Object.entries(matchLabels)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
          labelSelector = labelSelector ? `${labelSelector},${labels}` : labels;
        }
      }

      // Handle service-based selection
      if (options.serviceName) {
        const service = await this.k8sApi.readNamespacedService(options.serviceName, namespace);
        const selector = service.body.spec?.selector;
        if (selector) {
          const labels = Object.entries(selector)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
          labelSelector = labelSelector ? `${labelSelector},${labels}` : labels;
        }
      }

      const response = await this.k8sApi.listNamespacedPod(
        namespace,
        undefined, // pretty
        undefined, // allowWatchBookmarks
        undefined, // continue
        fieldSelector,
        labelSelector
      );

      return response.body.items.map(pod => this.mapPodFromApi(pod));
    } catch (error) {
      this.logger.error('Failed to list pods', { options, error });
      throw error;
    }
  }

  /**
   * Get a specific pod
   */
  async getPod(name: string, namespace?: string): Promise<KubernetesPod> {
    try {
      const ns = namespace || this.currentNamespace;
      const response = await this.k8sApi.readNamespacedPod(name, ns);
      return this.mapPodFromApi(response.body);
    } catch (error) {
      this.logger.error('Failed to get pod', { name, namespace, error });
      throw error;
    }
  }

  /**
   * Create an exec session to a pod
   */
  async createExecSession(sessionId: string, options: KubernetesExecOptions): Promise<KubernetesSessionState> {
    try {
      const namespace = options.namespace || this.currentNamespace;
      
      // Find pod if not specified by name
      let podName = options.name;
      if (!podName) {
        const pods = await this.listPods(options);
        if (pods.length === 0) {
          throw new Error('No pods found matching the criteria');
        }
        if (pods.length > 1) {
          throw new Error(`Multiple pods found (${pods.length}). Please specify a pod name.`);
        }
        podName = pods[0].metadata.name;
      }

      const pod = await this.getPod(podName, namespace);
      
      // Determine container name
      let containerName = options.containerName;
      if (!containerName) {
        if (pod.spec.containers.length > 1) {
          throw new Error(`Pod has ${pod.spec.containers.length} containers. Please specify container name.`);
        }
        containerName = pod.spec.containers[0].name;
      }

      // Create session state
      const sessionState: KubernetesSessionState = {
        sessionType: 'exec',
        kubeConfig: this.connectionOptions,
        podInfo: {
          name: podName,
          namespace: namespace,
          containerName: containerName,
          status: pod.status.phase,
          restartCount: pod.status.containerStatuses?.[0]?.restartCount || 0,
          creationTimestamp: pod.metadata.creationTimestamp
        },
        connectionState: {
          connected: false,
          reconnectAttempts: 0
        }
      };

      // Store session state
      this.activeSessions.set(sessionId, sessionState);

      // Create exec connection
      const command = options.command || ['/bin/bash'];
      const execOptions = {
        stdin: options.stdin !== false,
        stdout: true,
        stderr: true,
        tty: options.interactive !== false,
        command: command
      };

      const execSession = await this.k8sExecApi.exec(
        namespace,
        podName,
        containerName,
        command,
        null, // stdout stream - will be handled by session manager
        null, // stderr stream - will be handled by session manager  
        null, // stdin stream - will be handled by session manager
        execOptions.tty,
        {
          stdin: execOptions.stdin,
          stdout: execOptions.stdout,
          stderr: execOptions.stderr
        }
      );

      // Store exec session
      this.activeExecSessions.set(sessionId, execSession);
      sessionState.connectionState.connected = true;
      sessionState.connectionState.lastHeartbeat = new Date();

      this.emit('sessionCreated', { sessionId, sessionState });
      this.logger.info('Exec session created', {
        sessionId,
        pod: podName,
        namespace,
        container: containerName
      });

      return sessionState;
    } catch (error) {
      this.logger.error('Failed to create exec session', { sessionId, options, error });
      this.activeSessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * Send input to an exec session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    try {
      const execSession = this.activeExecSessions.get(sessionId);
      if (!execSession) {
        throw new Error(`Exec session not found: ${sessionId}`);
      }

      if (execSession.stdin && typeof execSession.stdin.write === 'function') {
        execSession.stdin.write(input);
      } else {
        throw new Error(`Stdin not available for session: ${sessionId}`);
      }
    } catch (error) {
      this.logger.error('Failed to send input to exec session', { sessionId, error });
      throw error;
    }
  }

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    try {
      const sessionState = this.activeSessions.get(sessionId);
      if (!sessionState) {
        this.logger.warn('Session not found for closing', { sessionId });
        return;
      }

      // Close exec session
      const execSession = this.activeExecSessions.get(sessionId);
      if (execSession) {
        try {
          if (execSession.stdin && typeof execSession.stdin.end === 'function') {
            execSession.stdin.end();
          }
          if (execSession.stdout && typeof execSession.stdout.destroy === 'function') {
            execSession.stdout.destroy();
          }
          if (execSession.stderr && typeof execSession.stderr.destroy === 'function') {
            execSession.stderr.destroy();
          }
        } catch (error) {
          this.logger.warn('Error closing exec session streams', { sessionId, error });
        }
        this.activeExecSessions.delete(sessionId);
      }

      // Update session state
      sessionState.connectionState.connected = false;
      this.activeSessions.delete(sessionId);

      this.emit('sessionClosed', { sessionId });
      this.logger.info('Session closed', { sessionId });
    } catch (error) {
      this.logger.error('Failed to close session', { sessionId, error });
      throw error;
    }
  }

  /**
   * Start port forwarding
   */
  async startPortForward(portForwardId: string, options: PortForwardOptions): Promise<void> {
    try {
      const namespace = options.namespace || this.currentNamespace;
      
      const portForward = await this.k8sPortForwardApi.portForward(
        namespace,
        options.podName,
        [options.remotePort],
        null, // stdout
        null, // stderr
        null, // stdin
        0 // local port - let system assign
      );

      this.activePortForwards.set(portForwardId, portForward);
      
      this.emit('portForwardStarted', {
        portForwardId,
        localPort: options.localPort,
        remotePort: options.remotePort,
        podName: options.podName,
        namespace
      });

      this.logger.info('Port forward started', {
        portForwardId,
        localPort: options.localPort,
        remotePort: options.remotePort,
        pod: options.podName,
        namespace
      });
    } catch (error) {
      this.logger.error('Failed to start port forward', { portForwardId, options, error });
      throw error;
    }
  }

  /**
   * Stop port forwarding
   */
  async stopPortForward(portForwardId: string): Promise<void> {
    try {
      const portForward = this.activePortForwards.get(portForwardId);
      if (!portForward) {
        this.logger.warn('Port forward not found for stopping', { portForwardId });
        return;
      }

      if (typeof portForward.destroy === 'function') {
        portForward.destroy();
      }
      
      this.activePortForwards.delete(portForwardId);
      this.emit('portForwardStopped', { portForwardId });
      this.logger.info('Port forward stopped', { portForwardId });
    } catch (error) {
      this.logger.error('Failed to stop port forward', { portForwardId, error });
      throw error;
    }
  }

  /**
   * Stream logs from pods
   */
  async streamLogs(streamId: string, options: KubernetesLogOptions): Promise<void> {
    try {
      const namespace = options.namespace || this.currentNamespace;
      
      if (options.podName) {
        // Single pod logs
        await this.streamSinglePodLogs(streamId, options.podName, namespace, options);
      } else if (options.labelSelector) {
        // Multiple pods logs
        const pods = await this.listPods({
          namespace,
          labelSelector: options.labelSelector
        });
        
        if (pods.length === 0) {
          throw new Error('No pods found matching label selector');
        }

        // Stream logs from all matching pods
        for (const pod of pods) {
          const podStreamId = `${streamId}-${pod.metadata.name}`;
          await this.streamSinglePodLogs(podStreamId, pod.metadata.name, namespace, {
            ...options,
            prefix: options.prefix !== false
          });
        }
      } else {
        throw new Error('Either podName or labelSelector must be specified');
      }
    } catch (error) {
      this.logger.error('Failed to stream logs', { streamId, options, error });
      throw error;
    }
  }

  /**
   * Stream logs from a single pod
   */
  private async streamSinglePodLogs(
    streamId: string, 
    podName: string, 
    namespace: string, 
    options: KubernetesLogOptions
  ): Promise<void> {
    try {
      const logStream = await this.k8sLogsApi.log(
        namespace,
        podName,
        options.containerName,
        null, // logStream - will be handled by session manager
        {
          follow: options.follow !== false,
          tailLines: options.tail,
          sinceSeconds: this.parseDuration(options.since),
          sinceTime: options.sinceTime ? new Date(options.sinceTime) : undefined,
          timestamps: options.timestamps === true,
          previous: options.previous === true
        }
      );

      this.activeLogStreams.set(streamId, logStream);
      
      // Handle log data
      logStream.on('data', (chunk: Buffer) => {
        let data = chunk.toString();
        
        // Add pod prefix if requested
        if (options.prefix) {
          data = data.split('\n').map(line => 
            line ? `[${podName}] ${line}` : line
          ).join('\n');
        }
        
        this.emit('logData', {
          streamId,
          podName,
          namespace,
          data: stripAnsi(data),
          raw: data
        });
      });

      logStream.on('error', (error: Error) => {
        this.logger.error('Log stream error', { streamId, podName, error });
        this.emit('logError', { streamId, podName, error });
        this.activeLogStreams.delete(streamId);
      });

      logStream.on('end', () => {
        this.logger.info('Log stream ended', { streamId, podName });
        this.emit('logEnd', { streamId, podName });
        this.activeLogStreams.delete(streamId);
      });

      this.emit('logStreamStarted', {
        streamId,
        podName,
        namespace,
        containerName: options.containerName
      });

      this.logger.info('Log stream started', {
        streamId,
        pod: podName,
        namespace,
        container: options.containerName
      });
    } catch (error) {
      this.logger.error('Failed to stream single pod logs', {
        streamId, podName, namespace, error
      });
      throw error;
    }
  }

  /**
   * Stop log streaming
   */
  async stopLogStream(streamId: string): Promise<void> {
    try {
      const logStream = this.activeLogStreams.get(streamId);
      if (!logStream) {
        this.logger.warn('Log stream not found for stopping', { streamId });
        return;
      }

      if (typeof logStream.destroy === 'function') {
        logStream.destroy();
      }
      
      this.activeLogStreams.delete(streamId);
      this.emit('logStreamStopped', { streamId });
      this.logger.info('Log stream stopped', { streamId });
    } catch (error) {
      this.logger.error('Failed to stop log stream', { streamId, error });
      throw error;
    }
  }

  /**
   * Copy files to/from pods
   */
  async copyFiles(copyId: string, options: KubernetesCopyOptions): Promise<void> {
    try {
      const namespace = options.namespace || this.currentNamespace;
      
      if (options.direction === 'upload') {
        await this.k8sCpApi.cp(
          namespace,
          options.podName,
          options.containerName || '',
          options.localPath,
          options.remotePath,
          {
            recursive: options.recursive
          }
        );
      } else {
        await this.k8sCpApi.cp(
          namespace,
          options.podName,
          options.containerName || '',
          options.remotePath,
          options.localPath,
          {
            recursive: options.recursive
          }
        );
      }

      this.emit('copyCompleted', {
        copyId,
        direction: options.direction,
        localPath: options.localPath,
        remotePath: options.remotePath,
        podName: options.podName,
        namespace
      });

      this.logger.info('File copy completed', {
        copyId,
        direction: options.direction,
        pod: options.podName,
        namespace
      });
    } catch (error) {
      this.logger.error('Failed to copy files', { copyId, options, error });
      this.emit('copyError', { copyId, error });
      throw error;
    }
  }

  /**
   * Get session state
   */
  getSessionState(sessionId: string): KubernetesSessionState | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Map<string, KubernetesSessionState> {
    return new Map(this.activeSessions);
  }

  /**
   * Check if connected
   */
  isConnectedToCluster(): boolean {
    return this.isConnected;
  }

  /**
   * Get current context and namespace
   */
  getCurrentContext(): { context: string; namespace: string } {
    return {
      context: this.currentContext || '',
      namespace: this.currentNamespace || 'default'
    };
  }

  /**
   * Parse duration string to seconds
   */
  private parseDuration(duration?: string): number | undefined {
    if (!duration) return undefined;
    
    const match = duration.match(/^(\d+)([smh])$/);
    if (!match) return undefined;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      default: return undefined;
    }
  }

  /**
   * Map Kubernetes API pod to our pod interface
   */
  private mapPodFromApi(apiPod: any): KubernetesPod {
    return {
      metadata: {
        name: apiPod.metadata.name,
        namespace: apiPod.metadata.namespace,
        labels: apiPod.metadata.labels,
        annotations: apiPod.metadata.annotations,
        creationTimestamp: new Date(apiPod.metadata.creationTimestamp)
      },
      spec: {
        containers: apiPod.spec.containers.map((container: any) => ({
          name: container.name,
          image: container.image,
          ports: container.ports
        })),
        nodeName: apiPod.spec.nodeName
      },
      status: {
        phase: apiPod.status.phase,
        conditions: apiPod.status.conditions?.map((condition: any) => ({
          type: condition.type,
          status: condition.status,
          lastTransitionTime: new Date(condition.lastTransitionTime),
          reason: condition.reason,
          message: condition.message
        })),
        containerStatuses: apiPod.status.containerStatuses?.map((status: any) => ({
          name: status.name,
          ready: status.ready,
          restartCount: status.restartCount,
          state: status.state
        })),
        podIP: apiPod.status.podIP,
        hostIP: apiPod.status.hostIP
      }
    };
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<{
    status: 'healthy' | 'warning' | 'unhealthy' | 'critical';
    checks: Record<string, any>;
    overallScore: number;
  }> {
    const checks: Record<string, any> = {};
    let totalScore = 0;
    let checkCount = 0;

    try {
      // API Server connectivity
      try {
        const start = Date.now();
        await this.k8sApi.listNamespace('', undefined, undefined, undefined, undefined, 1);
        const duration = Date.now() - start;
        checks.apiServer = {
          checkStatus: 'pass',
          value: `${duration}ms`,
          message: 'API server accessible',
          duration
        };
        totalScore += duration < 1000 ? 100 : duration < 5000 ? 75 : 50;
      } catch (error) {
        checks.apiServer = {
          checkStatus: 'fail',
          message: `API server error: ${error.message}`
        };
        totalScore += 0;
      }
      checkCount++;

      // Current context validation
      try {
        const context = this.getCurrentContext();
        checks.context = {
          checkStatus: 'pass',
          value: `${context.context}/${context.namespace}`,
          message: 'Context is valid'
        };
        totalScore += 100;
      } catch (error) {
        checks.context = {
          checkStatus: 'fail',
          message: `Context error: ${error.message}`
        };
        totalScore += 0;
      }
      checkCount++;

      // Active sessions health
      const sessionCount = this.activeSessions.size;
      const healthySessions = Array.from(this.activeSessions.values())
        .filter(session => session.connectionState.connected).length;
      
      checks.sessions = {
        checkStatus: sessionCount === healthySessions ? 'pass' : 'warn',
        value: `${healthySessions}/${sessionCount}`,
        message: `${healthySessions} of ${sessionCount} sessions healthy`
      };
      totalScore += sessionCount === 0 ? 100 : (healthySessions / sessionCount) * 100;
      checkCount++;

      // Resource usage check
      try {
        const memUsage = process.memoryUsage();
        const memUsageMB = memUsage.heapUsed / 1024 / 1024;
        checks.memory = {
          checkStatus: memUsageMB < 500 ? 'pass' : memUsageMB < 1000 ? 'warn' : 'fail',
          value: `${memUsageMB.toFixed(2)}MB`,
          message: `Memory usage: ${memUsageMB.toFixed(2)}MB`
        };
        totalScore += memUsageMB < 500 ? 100 : memUsageMB < 1000 ? 75 : 25;
        checkCount++;
      } catch (error) {
        checks.memory = {
          checkStatus: 'fail',
          message: `Memory check error: ${error.message}`
        };
        totalScore += 0;
        checkCount++;
      }

    } catch (error) {
      this.logger.error('Health check failed', error);
    }

    const overallScore = checkCount > 0 ? totalScore / checkCount : 0;
    let status: 'healthy' | 'warning' | 'unhealthy' | 'critical';

    if (overallScore >= 90) {
      status = 'healthy';
    } else if (overallScore >= 70) {
      status = 'warning';
    } else if (overallScore >= 40) {
      status = 'unhealthy';
    } else {
      status = 'critical';
    }

    return { status, checks, overallScore };
  }
}

export default KubernetesProtocol;