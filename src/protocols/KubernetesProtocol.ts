import { BaseProtocol } from '../core/BaseProtocol.js';
import { ProtocolCapabilities, SessionState } from '../core/IProtocol.js';
import { Logger } from '../utils/logger.js';
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
  ConsoleSession,
  SessionOptions,
  ConsoleType,
} from '../types/index.js';

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
      ports?: Array<{
        containerPort: number;
        name?: string;
        protocol?: string;
      }>;
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

export class KubernetesProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'k8s-exec';
  public readonly capabilities: ProtocolCapabilities;

  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private k8sAppsApi: k8s.AppsV1Api;
  private k8sExecApi: k8s.Exec;
  private k8sLogsApi: k8s.Log;
  private k8sPortForwardApi: k8s.PortForward;
  private k8sCpApi: k8s.Cp;
  private connectionOptions: KubernetesConnectionOptions;
  private kubernetesSessions: Map<string, KubernetesSessionState> = new Map();
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
    super('KubernetesProtocol');
    this.connectionOptions = options.connectionOptions;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 5000;
    this.heartbeatInterval = options.heartbeatInterval || 30000;

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
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
      maxConcurrentSessions: 50,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['token', 'cert', 'exec'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true,
      },
    };

    this.kc = new k8s.KubeConfig();
    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.k8sExecApi = new k8s.Exec(this.kc);
    this.k8sLogsApi = new k8s.Log(this.kc);
    this.k8sPortForwardApi = new k8s.PortForward(this.kc);
    this.k8sCpApi = new k8s.Cp(this.kc);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.loadKubeConfig();
      await this.validateConnection();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.isInitialized = true;
      this.logger.info(
        'Kubernetes protocol initialized with session management fixes',
        {
          context: this.currentContext,
          namespace: this.currentNamespace,
        }
      );
    } catch (error: any) {
      this.logger.error(
        'Failed to initialize Kubernetes cluster connection',
        error
      );
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Connect to Kubernetes cluster (alias for initialize)
   */
  async connect(): Promise<void> {
    await this.initialize();
  }

  /**
   * Disconnect from Kubernetes cluster
   */
  async disconnect(): Promise<void> {
    try {
      this.stopHeartbeat();

      // Close all active sessions
      for (const [sessionId, session] of Array.from(this.sessions.entries())) {
        await this.closeSession(sessionId);
      }

      // Close active port forwards
      for (const [portForwardId, portForward] of Array.from(
        this.activePortForwards.entries()
      )) {
        try {
          await this.stopPortForward(portForwardId);
        } catch (error: any) {
          this.logger.warn('Error closing port forward', {
            portForwardId,
            error,
          });
        }
      }

      // Close active log streams
      for (const [streamId, stream] of Array.from(
        this.activeLogStreams.entries()
      )) {
        try {
          if (stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
        } catch (error: any) {
          this.logger.warn('Error closing log stream', { streamId, error });
        }
      }

      this.isConnected = false;
      this.sessions.clear();
      this.activeExecSessions.clear();
      this.activePortForwards.clear();
      this.activeLogStreams.clear();

      this.emit('disconnected');
      this.logger.info('Disconnected from Kubernetes cluster');
    } catch (error: any) {
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
        if (
          this.connectionOptions.kubeconfig.includes('\n') ||
          this.connectionOptions.kubeconfig.includes('apiVersion')
        ) {
          // Direct YAML content
          const config = yaml.load(this.connectionOptions.kubeconfig) as any;
          this.kc.loadFromOptions(config);
        } else {
          // File path
          if (existsSync(this.connectionOptions.kubeconfig)) {
            this.kc.loadFromFile(this.connectionOptions.kubeconfig);
          } else {
            throw new Error(
              `Kubeconfig file not found: ${this.connectionOptions.kubeconfig}`
            );
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
      this.currentNamespace =
        this.connectionOptions.namespace ||
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
    } catch (error: any) {
      this.logger.error('Failed to load Kubernetes configuration', error);
      throw error;
    }
  }

  /**
   * Apply additional connection options to kubeconfig
   */
  private applyConnectionOptions(): void {
    if (!this.currentContext) return;
    const currentContext = this.kc.getContextObject(this.currentContext);
    if (!currentContext) return;

    const cluster = this.kc.getCluster(currentContext.cluster);
    const user = this.kc.getUser(currentContext.user);

    if (cluster) {
      // Create new cluster object with updated properties to avoid read-only issues
      const updatedCluster = {
        ...cluster,
        ...(this.connectionOptions.server && {
          server: this.connectionOptions.server,
        }),
        ...(this.connectionOptions.clusterCertificateAuthority && {
          caData: this.connectionOptions.clusterCertificateAuthority,
        }),
        ...(this.connectionOptions.insecureSkipTlsVerify !== undefined && {
          skipTLSVerify: this.connectionOptions.insecureSkipTlsVerify,
        }),
      };

      // Replace cluster in kubeconfig
      const clusters = this.kc.getClusters();
      const clusterIndex = clusters.findIndex(
        (c: any) => c.name === cluster.name
      );
      if (clusterIndex >= 0) {
        clusters[clusterIndex] = updatedCluster;
      }
    }

    if (user) {
      // Create new user object with updated properties to avoid read-only issues
      const updatedUser = {
        ...user,
        ...(this.connectionOptions.token && {
          token: this.connectionOptions.token,
        }),
        ...(this.connectionOptions.clientCertificate && {
          certData: this.connectionOptions.clientCertificate,
        }),
        ...(this.connectionOptions.clientKey && {
          keyData: this.connectionOptions.clientKey,
        }),
      };

      // Replace user in kubeconfig
      const users = this.kc.getUsers();
      const userIndex = users.findIndex((u: any) => u.name === user.name);
      if (userIndex >= 0) {
        users[userIndex] = updatedUser;
      }
    }
  }

  /**
   * Validate connection to Kubernetes cluster
   */
  private async validateConnection(): Promise<void> {
    try {
      const response = await this.k8sApi.listNamespace();
      // Use .data for newer versions of @kubernetes/client-node, fallback to .body for older versions
      const responseData = (response as any).data || (response as any).body;
      this.logger.info('Connection validated', {
        namespacesCount: responseData.items.length,
      });
    } catch (error: any) {
      this.logger.error('Connection validation failed', error);
      throw new Error(
        `Failed to connect to Kubernetes cluster: ${error.message}`
      );
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
      } catch (error: any) {
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
      await this.k8sApi.listNamespace();
    } catch (error: any) {
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
    this.logger.info(
      `Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay));
      await this.connect();
      this.emit('reconnected');
    } catch (error: any) {
      this.logger.warn(
        `Reconnection attempt ${this.reconnectAttempts} failed`,
        error
      );
      // Will try again on next heartbeat
    }
  }

  /**
   * Get available contexts
   */
  getContexts(): KubernetesContext[] {
    const contexts = this.kc.getContexts();
    return contexts.map((context: any) => ({
      name: context.name,
      cluster: context.cluster,
      user: context.user,
      namespace: context.namespace,
    }));
  }

  /**
   * Get available clusters
   */
  getClusters(): KubernetesCluster[] {
    const clusters = this.kc.getClusters();
    return clusters.map((cluster: any) => ({
      name: cluster.name,
      server: cluster.server,
      certificateAuthorityData: cluster.caData,
      insecureSkipTlsVerify: cluster.skipTLSVerify,
    }));
  }

  /**
   * Get available users
   */
  getUsers(): KubernetesUser[] {
    const users = this.kc.getUsers();
    return users.map((user: any) => ({
      name: user.name,
      token: user.token,
      clientCertificateData: user.certData,
      clientKeyData: user.keyData,
      exec: user.exec,
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
      this.emit('contextChanged', {
        context: contextName,
        namespace: this.currentNamespace,
      });
      this.logger.info('Switched context', {
        context: contextName,
        namespace: this.currentNamespace,
      });
    } catch (error: any) {
      this.logger.error('Failed to switch context', {
        context: contextName,
        error,
      });
      throw error;
    }
  }

  /**
   * List pods based on selection criteria
   */
  async listPods(
    options: Partial<PodSelectionOptions> = {}
  ): Promise<KubernetesPod[]> {
    try {
      const namespace = options.namespace || this.currentNamespace || 'default';
      let fieldSelector = options.fieldSelector;
      let labelSelector = options.labelSelector;

      // Handle deployment-based selection
      if (options.deploymentName) {
        const deployment = await this.k8sAppsApi.readNamespacedDeployment({
          name: options.deploymentName,
          namespace: namespace,
        });
        const deploymentData =
          (deployment as any).data || (deployment as any).body;
        const matchLabels = deploymentData.spec?.selector?.matchLabels;
        if (matchLabels) {
          const labels = Object.entries(matchLabels)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
          labelSelector = labelSelector ? `${labelSelector},${labels}` : labels;
        }
      }

      // Handle replica set-based selection
      if (options.replicaSetName) {
        const replicaSet = await this.k8sAppsApi.readNamespacedReplicaSet({
          name: options.replicaSetName,
          namespace: namespace,
        });
        const replicaSetData =
          (replicaSet as any).data || (replicaSet as any).body;
        const matchLabels = replicaSetData.spec?.selector?.matchLabels;
        if (matchLabels) {
          const labels = Object.entries(matchLabels)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
          labelSelector = labelSelector ? `${labelSelector},${labels}` : labels;
        }
      }

      // Handle service-based selection
      if (options.serviceName) {
        const service = await this.k8sApi.readNamespacedService({
          name: options.serviceName,
          namespace: namespace,
        });
        const serviceData = (service as any).data || (service as any).body;
        const selector = serviceData.spec?.selector;
        if (selector) {
          const labels = Object.entries(selector)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
          labelSelector = labelSelector ? `${labelSelector},${labels}` : labels;
        }
      }

      const response = await this.k8sApi.listNamespacedPod({
        namespace: namespace,
        fieldSelector: fieldSelector,
        labelSelector: labelSelector,
      });

      const responseData = (response as any).data || (response as any).body;
      return responseData.items.map((pod: any) => this.mapPodFromApi(pod));
    } catch (error: any) {
      this.logger.error('Failed to list pods', { options, error });
      throw error;
    }
  }

  /**
   * Get a specific pod
   */
  async getPod(name: string, namespace?: string): Promise<KubernetesPod> {
    try {
      const ns = namespace || this.currentNamespace || 'default';
      const response = await this.k8sApi.readNamespacedPod({
        name: name,
        namespace: ns,
      });
      const responseData = (response as any).data || (response as any).body;
      return this.mapPodFromApi(responseData);
    } catch (error: any) {
      this.logger.error('Failed to get pod', { name, namespace, error });
      throw error;
    }
  }

  /**
   * Create an exec session to a pod
   */
  async createExecSession(
    sessionId: string,
    options: KubernetesExecOptions
  ): Promise<KubernetesSessionState> {
    try {
      const namespace = options.namespace || this.currentNamespace || 'default';

      // Find pod if not specified by name
      let podName = options.name;
      if (!podName) {
        const pods = await this.listPods(options);
        if (pods.length === 0) {
          throw new Error('No pods found matching the criteria');
        }
        if (pods.length > 1) {
          throw new Error(
            `Multiple pods found (${pods.length}). Please specify a pod name.`
          );
        }
        podName = pods[0].metadata.name;
      }

      const pod = await this.getPod(podName, namespace);

      // Determine container name
      let containerName = options.containerName;
      if (!containerName) {
        if (pod.spec.containers.length > 1) {
          throw new Error(
            `Pod has ${pod.spec.containers.length} containers. Please specify container name.`
          );
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
          containerName: containerName || '',
          status: pod.status.phase,
          restartCount: pod.status.containerStatuses?.[0]?.restartCount || 0,
          creationTimestamp: pod.metadata.creationTimestamp,
        },
        connectionState: {
          connected: false,
          reconnectAttempts: 0,
        },
      };

      // Store session state
      this.kubernetesSessions.set(sessionId, sessionState);

      // Create exec connection
      const command = options.command || ['/bin/bash'];
      const execOptions = {
        stdin: options.stdin !== false,
        stdout: true,
        stderr: true,
        tty: options.interactive !== false,
        command: command,
      };

      // Create proper streams for exec
      const ws = await this.k8sExecApi.exec(
        namespace,
        podName,
        containerName || '',
        command,
        process.stdout,
        process.stderr,
        process.stdin,
        execOptions.tty
      );

      const execSession = {
        ws,
        stdin: ws,
        stdout: ws,
        stderr: ws,
      };

      // Store exec session
      this.activeExecSessions.set(sessionId, execSession);
      sessionState.connectionState.connected = true;
      sessionState.connectionState.lastHeartbeat = new Date();

      this.emit('sessionCreated', { sessionId, sessionState });
      this.logger.info('Exec session created', {
        sessionId,
        pod: podName,
        namespace,
        container: containerName,
      });

      return sessionState;
    } catch (error: any) {
      this.logger.error('Failed to create exec session', {
        sessionId,
        options,
        error,
      });
      this.kubernetesSessions.delete(sessionId);
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
    } catch (error: any) {
      this.logger.error('Failed to send input to exec session', {
        sessionId,
        error,
      });
      throw error;
    }
  }

  /**
   * Start port forwarding
   */
  async startPortForward(
    portForwardId: string,
    options: PortForwardOptions
  ): Promise<void> {
    try {
      const namespace = options.namespace || this.currentNamespace || 'default';

      const portForward = await this.k8sPortForwardApi.portForward(
        namespace,
        options.podName,
        [options.remotePort],
        process.stdout,
        process.stderr,
        process.stdin,
        options.localPort
      );

      this.activePortForwards.set(portForwardId, portForward);

      this.emit('portForwardStarted', {
        portForwardId,
        localPort: options.localPort,
        remotePort: options.remotePort,
        podName: options.podName,
        namespace,
      });

      this.logger.info('Port forward started', {
        portForwardId,
        localPort: options.localPort,
        remotePort: options.remotePort,
        pod: options.podName,
        namespace,
      });
    } catch (error: any) {
      this.logger.error('Failed to start port forward', {
        portForwardId,
        options,
        error,
      });
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
        this.logger.warn('Port forward not found for stopping', {
          portForwardId,
        });
        return;
      }

      if (typeof portForward.destroy === 'function') {
        portForward.destroy();
      }

      this.activePortForwards.delete(portForwardId);
      this.emit('portForwardStopped', { portForwardId });
      this.logger.info('Port forward stopped', { portForwardId });
    } catch (error: any) {
      this.logger.error('Failed to stop port forward', {
        portForwardId,
        error,
      });
      throw error;
    }
  }

  /**
   * Stream logs from pods
   */
  async streamLogs(
    streamId: string,
    options: KubernetesLogOptions
  ): Promise<void> {
    try {
      const namespace = options.namespace || this.currentNamespace || 'default';

      if (options.podName) {
        // Single pod logs
        await this.streamSinglePodLogs(
          streamId,
          options.podName,
          namespace,
          options
        );
      } else if (options.labelSelector) {
        // Multiple pods logs
        const pods = await this.listPods({
          namespace,
          labelSelector: options.labelSelector,
        });

        if (pods.length === 0) {
          throw new Error('No pods found matching label selector');
        }

        // Stream logs from all matching pods
        for (const pod of pods) {
          const podStreamId = `${streamId}-${pod.metadata.name}`;
          await this.streamSinglePodLogs(
            podStreamId,
            pod.metadata.name,
            namespace,
            {
              ...options,
              prefix: options.prefix !== false,
            }
          );
        }
      } else {
        throw new Error('Either podName or labelSelector must be specified');
      }
    } catch (error: any) {
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
      const logOptions = {
        follow: options.follow !== false,
        tailLines: options.tail,
        sinceSeconds: this.parseDuration(options.since),
        sinceTime: options.sinceTime
          ? new Date(options.sinceTime).toISOString()
          : undefined,
        timestamps: options.timestamps === true,
        previous: options.previous === true,
      };

      const logStream = await this.k8sLogsApi.log(
        namespace,
        podName,
        options.containerName || '',
        process.stdout,
        logOptions
      );

      this.activeLogStreams.set(streamId, logStream);

      // The log method returns an AbortController, not a readable stream
      // We need to handle this differently for log data events
      // For now, we'll emit that the stream started and handle data through other mechanisms

      if (logStream && typeof logStream === 'object' && 'signal' in logStream) {
        // This is an AbortController
        const abortController = logStream as AbortController;

        // Handle abort signal
        abortController.signal.addEventListener('abort', () => {
          this.logger.info('Log stream aborted', { streamId, podName });
          this.emit('logEnd', { streamId, podName });
          this.activeLogStreams.delete(streamId);
        });
      }

      this.emit('logStreamStarted', {
        streamId,
        podName,
        namespace,
        containerName: options.containerName,
      });

      this.logger.info('Log stream started', {
        streamId,
        pod: podName,
        namespace,
        container: options.containerName,
      });
    } catch (error: any) {
      this.logger.error('Failed to stream single pod logs', {
        streamId,
        podName,
        namespace,
        error,
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
    } catch (error: any) {
      this.logger.error('Failed to stop log stream', { streamId, error });
      throw error;
    }
  }

  /**
   * Copy files to/from pods
   */
  async copyFiles(
    copyId: string,
    options: KubernetesCopyOptions
  ): Promise<void> {
    try {
      const namespace = options.namespace || this.currentNamespace || 'default';

      const containerName = options.containerName || '';

      if (options.direction === 'upload') {
        await this.k8sCpApi.cpToPod(
          namespace,
          options.podName,
          containerName,
          options.localPath,
          options.remotePath
        );
      } else {
        await this.k8sCpApi.cpFromPod(
          namespace,
          options.podName,
          containerName,
          options.remotePath,
          options.localPath
        );
      }

      this.emit('copyCompleted', {
        copyId,
        direction: options.direction,
        localPath: options.localPath,
        remotePath: options.remotePath,
        podName: options.podName,
        namespace,
      });

      this.logger.info('File copy completed', {
        copyId,
        direction: options.direction,
        pod: options.podName,
        namespace,
      });
    } catch (error: any) {
      this.logger.error('Failed to copy files', { copyId, options, error });
      this.emit('copyError', { copyId, error });
      throw error;
    }
  }

  /**
   * Get session state
   */
  async getSessionState(sessionId: string): Promise<SessionState> {
    const kubernetesSession = this.kubernetesSessions.get(sessionId);
    if (!kubernetesSession) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const consoleSession = this.sessions.get(sessionId);
    if (!consoleSession) {
      throw new Error(`Console session ${sessionId} not found`);
    }

    // Convert KubernetesSessionState + ConsoleSession to BaseProtocol SessionState
    return {
      sessionId: sessionId,
      status: kubernetesSession.connectionState.connected
        ? 'running'
        : 'stopped',
      isOneShot:
        kubernetesSession.sessionType === 'exec' &&
        consoleSession.status === 'initializing',
      isPersistent:
        kubernetesSession.sessionType === 'exec' &&
        consoleSession.status === 'running',
      createdAt: consoleSession.createdAt,
      lastActivity:
        kubernetesSession.connectionState.lastHeartbeat ||
        consoleSession.lastActivity,
      pid: undefined, // Kubernetes sessions don't have PIDs
      exitCode: undefined,
      metadata: {
        sessionType: kubernetesSession.sessionType,
        podInfo: kubernetesSession.podInfo,
        connectionState: kubernetesSession.connectionState,
      },
    };
  }

  /**
   * Get Kubernetes-specific session state
   */
  getKubernetesSessionState(
    sessionId: string
  ): KubernetesSessionState | undefined {
    return this.kubernetesSessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get all Kubernetes-specific active sessions
   */
  getKubernetesActiveSessions(): Map<string, KubernetesSessionState> {
    return new Map(this.kubernetesSessions);
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
      namespace: this.currentNamespace || 'default',
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
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      default:
        return undefined;
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
        creationTimestamp: new Date(apiPod.metadata.creationTimestamp),
      },
      spec: {
        containers: apiPod.spec.containers.map((container: any) => ({
          name: container.name,
          image: container.image,
          ports: container.ports,
        })),
        nodeName: apiPod.spec.nodeName,
      },
      status: {
        phase: apiPod.status.phase,
        conditions: apiPod.status.conditions?.map((condition: any) => ({
          type: condition.type,
          status: condition.status,
          lastTransitionTime: new Date(condition.lastTransitionTime),
          reason: condition.reason,
          message: condition.message,
        })),
        containerStatuses: apiPod.status.containerStatuses?.map(
          (status: any) => ({
            name: status.name,
            ready: status.ready,
            restartCount: status.restartCount,
            state: status.state,
          })
        ),
        podIP: apiPod.status.podIP,
        hostIP: apiPod.status.hostIP,
      },
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
        await this.k8sApi.listNamespace();
        const duration = Date.now() - start;
        checks.apiServer = {
          checkStatus: 'pass',
          value: `${duration}ms`,
          message: 'API server accessible',
          duration,
        };
        totalScore += duration < 1000 ? 100 : duration < 5000 ? 75 : 50;
      } catch (error: any) {
        checks.apiServer = {
          checkStatus: 'fail',
          message: `API server error: ${error.message}`,
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
          message: 'Context is valid',
        };
        totalScore += 100;
      } catch (error: any) {
        checks.context = {
          checkStatus: 'fail',
          message: `Context error: ${error.message}`,
        };
        totalScore += 0;
      }
      checkCount++;

      // Active sessions health
      const sessionCount = this.kubernetesSessions.size;
      const healthySessions = Array.from(
        this.kubernetesSessions.values()
      ).filter((session) => session.connectionState.connected).length;

      checks.sessions = {
        checkStatus: sessionCount === healthySessions ? 'pass' : 'warn',
        value: `${healthySessions}/${sessionCount}`,
        message: `${healthySessions} of ${sessionCount} sessions healthy`,
      };
      totalScore +=
        sessionCount === 0 ? 100 : (healthySessions / sessionCount) * 100;
      checkCount++;

      // Resource usage check
      try {
        const memUsage = process.memoryUsage();
        const memUsageMB = memUsage.heapUsed / 1024 / 1024;
        checks.memory = {
          checkStatus:
            memUsageMB < 500 ? 'pass' : memUsageMB < 1000 ? 'warn' : 'fail',
          value: `${memUsageMB.toFixed(2)}MB`,
          message: `Memory usage: ${memUsageMB.toFixed(2)}MB`,
        };
        totalScore += memUsageMB < 500 ? 100 : memUsageMB < 1000 ? 75 : 25;
        checkCount++;
      } catch (error: any) {
        checks.memory = {
          checkStatus: 'fail',
          message: `Memory check error: ${error.message}`,
        };
        totalScore += 0;
        checkCount++;
      }
    } catch (error: any) {
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

  // ==========================================
  // BaseProtocol Integration Methods
  // ==========================================

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const sessionId = `k8s-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Use session management fixes from BaseProtocol
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    try {
      if (!options.kubernetesOptions) {
        throw new Error('Kubernetes options are required');
      }

      // Create a comprehensive Kubernetes exec options object combining different sources
      const kubernetesExecOptions: KubernetesExecOptions = {
        // Use name from kubernetesOptions or a default
        name:
          (options.kubernetesOptions as any).podName ||
          (options.kubernetesOptions as any).name ||
          'default-pod',
        namespace:
          options.kubernetesOptions.namespace ||
          this.currentNamespace ||
          'default',
        containerName: (options.kubernetesOptions as any).containerName,
        command: options.command
          ? [options.command, ...(options.args || [])]
          : ['/bin/bash'],
        stdin: true,
        interactive: true,
        workingDir: options.cwd,
        env: options.env,
      };

      // Create Kubernetes exec session
      await this.createExecSession(sessionId, kubernetesExecOptions);

      const session: ConsoleSession = {
        id: sessionId,
        command: options.command || '/bin/bash',
        args: options.args || [],
        cwd: options.cwd || '/',
        env: options.env || {},
        createdAt: new Date(),
        status: sessionState.isOneShot ? 'initializing' : 'running',
        type: this.type,
        streaming: options.streaming ?? false,
        kubernetesOptions: options.kubernetesOptions,
        executionState: 'idle',
        activeCommands: new Map(),
        lastActivity: new Date(),
        pid: undefined, // Kubernetes sessions don't have local PIDs
      };

      this.sessions.set(sessionId, session);
      this.outputBuffers.set(sessionId, []);

      this.logger.info(
        `Kubernetes session ${sessionId} created (${sessionState.isOneShot ? 'one-shot' : 'persistent'})`
      );
      return session;
    } catch (error) {
      this.logger.error(`Failed to create Kubernetes session: ${error}`);

      // Cleanup on failure
      const kubernetesSession = this.kubernetesSessions.get(sessionId);
      if (kubernetesSession) {
        this.kubernetesSessions.delete(sessionId);
      }
      const execSession = this.activeExecSessions.get(sessionId);
      if (execSession) {
        this.activeExecSessions.delete(sessionId);
      }

      throw error;
    }
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const kubernetesSession = this.kubernetesSessions.get(sessionId);
    const sessionState = await this.getSessionState(sessionId);

    if (!kubernetesSession) {
      throw new Error(`Kubernetes session ${sessionId} not found`);
    }

    try {
      // For one-shot sessions, ensure connection first
      if (
        sessionState.isOneShot &&
        !kubernetesSession.connectionState.connected
      ) {
        // Session should already be connected through doCreateSession
        // This is a fallback
        await this.initialize();
      }

      // Build full command
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;

      // Send command via existing sendInput method
      await this.sendInput(sessionId, fullCommand + '\n');

      // For one-shot sessions, mark as complete when command is sent
      if (sessionState.isOneShot) {
        setTimeout(() => {
          this.markSessionComplete(sessionId, 0);
        }, 1000); // Give time for output to be captured
      }

      this.emit('commandExecuted', {
        sessionId,
        command: fullCommand,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to execute Kubernetes command: ${error}`);
      throw error;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const sessionState = this.kubernetesSessions.get(sessionId);
      if (!sessionState) {
        this.logger.warn('Session not found for closing', { sessionId });
        return;
      }

      // Close exec session
      const execSession = this.activeExecSessions.get(sessionId);
      if (execSession) {
        try {
          if (
            execSession.stdin &&
            typeof execSession.stdin.end === 'function'
          ) {
            execSession.stdin.end();
          }
          if (
            execSession.stdout &&
            typeof execSession.stdout.destroy === 'function'
          ) {
            execSession.stdout.destroy();
          }
          if (
            execSession.stderr &&
            typeof execSession.stderr.destroy === 'function'
          ) {
            execSession.stderr.destroy();
          }
        } catch (error: any) {
          this.logger.warn('Error closing exec session streams', {
            sessionId,
            error,
          });
        }
        this.activeExecSessions.delete(sessionId);
      }

      // Update session state
      sessionState.connectionState.connected = false;
      this.kubernetesSessions.delete(sessionId);

      // Remove from base class tracking
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      this.emit('sessionClosed', sessionId);
      this.logger.info('Session closed', { sessionId });
    } catch (error: any) {
      this.logger.error('Failed to close session', { sessionId, error });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Kubernetes protocol');

    // Close all sessions
    const sessionIds = Array.from(this.kubernetesSessions.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.closeSession(sessionId);
      } catch (error) {
        this.logger.warn(
          `Error closing session ${sessionId} during dispose:`,
          error
        );
      }
    }

    // Stop heartbeat and disconnect
    this.stopHeartbeat();
    await this.disconnect();

    await this.cleanup();
  }
}

export default KubernetesProtocol;
