/**
 * Protocol Mock Utilities for Console Automation Testing
 * Production-ready mock implementations for all protocol types
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import * as ws from 'ws';
import { Readable, PassThrough } from 'stream';
import { 
  DockerSession, 
  WSLSession, 
  KubernetesSession, 
  SerialSession, 
  SFTPSession,
  AWSSSMSession,
  AzureSession,
  GCPSession,
  TelnetSession,
  RDPSession,
  VNCSession,
  WinRMSession,
  IPMISession,
  WebSocketSession,
  AnsibleSession,
  IPCSession,
  ConsoleSession,
  ConsoleOutput
} from '../../src/types/index.js';

export interface MockServerConfig {
  port?: number;
  host?: string;
  ssl?: boolean;
  auth?: {
    username: string;
    password: string;
  };
  responses?: Record<string, string | Buffer>;
  delays?: Record<string, number>;
  errors?: Record<string, Error>;
}

export interface MockProtocolBehavior {
  connectionDelay?: number;
  commandDelay?: number;
  responseDelay?: number;
  errorRate?: number;
  disconnectRate?: number;
  memoryLeakSimulation?: boolean;
  highCpuSimulation?: boolean;
}

/**
 * Base Mock Protocol class with common functionality
 */
export abstract class BaseMockProtocol extends EventEmitter {
  protected config: MockServerConfig;
  protected behavior: MockProtocolBehavior;
  protected isConnected: boolean = false;
  protected sessions: Map<string, ConsoleSession> = new Map();
  protected mockData: Map<string, any> = new Map();

  constructor(config: MockServerConfig = {}, behavior: MockProtocolBehavior = {}) {
    super();
    this.config = config;
    this.behavior = behavior;
  }

  protected simulateDelay(operation: string): Promise<void> {
    const delay = this.config.delays?.[operation] || this.behavior.connectionDelay || 0;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  protected simulateError(operation: string): void {
    const error = this.config.errors?.[operation];
    if (error) {
      throw error;
    }

    if (this.behavior.errorRate && Math.random() < this.behavior.errorRate) {
      throw new Error(`Simulated error for operation: ${operation}`);
    }
  }

  protected simulateResponse(command: string): string | Buffer {
    const response = this.config.responses?.[command];
    if (response) {
      return response;
    }
    return `Mock response for command: ${command}`;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract createSession(options: any): Promise<ConsoleSession>;
  abstract executeCommand(sessionId: string, command: string): Promise<string>;
}

/**
 * Mock Docker Protocol
 */
export class MockDockerProtocol extends BaseMockProtocol {
  private containers: Map<string, any> = new Map();
  private images: Set<string> = new Set(['ubuntu:latest', 'alpine:latest', 'nginx:latest']);

  async start(): Promise<void> {
    await this.simulateDelay('start');
    this.simulateError('start');
    this.isConnected = true;
    this.emit('connected');
  }

  async stop(): Promise<void> {
    this.isConnected = false;
    this.containers.clear();
    this.sessions.clear();
    this.emit('disconnected');
  }

  async createSession(options: any): Promise<DockerSession> {
    await this.simulateDelay('createSession');
    this.simulateError('createSession');

    const sessionId = `docker-${Date.now()}`;
    const containerId = `mock-container-${Date.now()}`;
    
    const container = {
      id: containerId,
      image: options.image || 'ubuntu:latest',
      status: 'running',
      created: new Date(),
      ports: options.ports || [],
      volumes: options.volumes || []
    };

    this.containers.set(containerId, container);

    const session: DockerSession = {
      id: sessionId,
      command: options.command || '/bin/bash',
      args: options.args || [],
      cwd: options.cwd || '/app',
      env: options.env || {},
      createdAt: new Date(),
      status: 'running',
      type: 'docker',
      streaming: options.streaming || false,
      executionState: 'idle',
      activeCommands: new Map(),
      dockerOptions: options.dockerOptions || {},
      containerId,
      containerName: options.name || `mock-container-${Date.now()}`,
      isExecSession: options.isExecSession || false,
      isRunning: true,
      autoCleanup: options.autoCleanup || true
    };

    this.sessions.set(sessionId, session);
    this.emit('session-created', session);

    return session;
  }

  async executeCommand(sessionId: string, command: string): Promise<string> {
    await this.simulateDelay('executeCommand');
    this.simulateError('executeCommand');

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const response = this.simulateResponse(command);
    
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: response.toString(),
      timestamp: new Date(),
      raw: response.toString()
    };

    this.emit('output', output);
    return response.toString();
  }

  async listContainers(): Promise<any[]> {
    return Array.from(this.containers.values());
  }

  async getContainerInfo(containerId: string): Promise<any> {
    return this.containers.get(containerId);
  }

  async pullImage(image: string): Promise<void> {
    await this.simulateDelay('pullImage');
    this.images.add(image);
  }
}

/**
 * Mock WSL Protocol
 */
export class MockWSLProtocol extends BaseMockProtocol {
  private distributions: Set<string> = new Set(['Ubuntu', 'Debian', 'Alpine']);
  private defaultDistribution: string = 'Ubuntu';

  async start(): Promise<void> {
    await this.simulateDelay('start');
    this.simulateError('start');
    this.isConnected = true;
    this.emit('connected');
  }

  async stop(): Promise<void> {
    this.isConnected = false;
    this.sessions.clear();
    this.emit('disconnected');
  }

  async createSession(options: any): Promise<WSLSession> {
    await this.simulateDelay('createSession');
    this.simulateError('createSession');

    const sessionId = `wsl-${Date.now()}`;
    const distribution = options.distribution || this.defaultDistribution;

    if (!this.distributions.has(distribution)) {
      throw new Error(`WSL distribution ${distribution} not found`);
    }

    const session: WSLSession = {
      id: sessionId,
      command: options.command || '/bin/bash',
      args: options.args || [],
      cwd: options.cwd || '/home/user',
      env: options.env || {},
      createdAt: new Date(),
      status: 'running',
      type: 'wsl',
      streaming: options.streaming || false,
      executionState: 'idle',
      activeCommands: new Map(),
      distribution,
      wslVersion: 2,
      isDefaultDistro: distribution === this.defaultDistribution,
      kernelVersion: '5.4.72-microsoft-standard-WSL2',
      systemdSupport: true
    };

    this.sessions.set(sessionId, session);
    this.emit('session-created', session);

    return session;
  }

  async executeCommand(sessionId: string, command: string): Promise<string> {
    await this.simulateDelay('executeCommand');
    this.simulateError('executeCommand');

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const response = this.simulateResponse(command);
    
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: response.toString(),
      timestamp: new Date(),
      raw: response.toString()
    };

    this.emit('output', output);
    return response.toString();
  }

  async listDistributions(): Promise<string[]> {
    return Array.from(this.distributions);
  }

  async setDefaultDistribution(distribution: string): Promise<void> {
    if (!this.distributions.has(distribution)) {
      throw new Error(`Distribution ${distribution} not found`);
    }
    this.defaultDistribution = distribution;
  }
}

/**
 * Mock Kubernetes Protocol
 */
export class MockKubernetesProtocol extends BaseMockProtocol {
  private clusters: Map<string, any> = new Map();
  private pods: Map<string, any> = new Map();
  private services: Map<string, any> = new Map();
  private currentContext: string = 'mock-cluster';

  async start(): Promise<void> {
    await this.simulateDelay('start');
    this.simulateError('start');
    
    // Initialize mock cluster
    this.clusters.set(this.currentContext, {
      name: this.currentContext,
      server: 'https://kubernetes.mock:6443',
      version: '1.28.0',
      nodes: 3
    });

    this.isConnected = true;
    this.emit('connected');
  }

  async stop(): Promise<void> {
    this.isConnected = false;
    this.clusters.clear();
    this.pods.clear();
    this.services.clear();
    this.sessions.clear();
    this.emit('disconnected');
  }

  async createSession(options: any): Promise<KubernetesSession> {
    await this.simulateDelay('createSession');
    this.simulateError('createSession');

    const sessionId = `k8s-${Date.now()}`;
    const podName = options.podName || `mock-pod-${Date.now()}`;
    const namespace = options.namespace || 'default';
    const container = options.container || 'main';

    // Create mock pod if it doesn't exist
    if (!this.pods.has(podName)) {
      this.pods.set(podName, {
        name: podName,
        namespace,
        containers: [container],
        status: 'Running',
        ip: '10.244.0.100'
      });
    }

    const session: KubernetesSession = {
      id: sessionId,
      command: options.command || '/bin/bash',
      args: options.args || [],
      cwd: options.cwd || '/app',
      env: options.env || {},
      createdAt: new Date(),
      status: 'running',
      type: 'kubernetes',
      streaming: options.streaming || false,
      executionState: 'idle',
      activeCommands: new Map(),
      kubeconfig: options.kubeconfig,
      context: options.context || this.currentContext,
      namespace,
      podName,
      containerName: container,
      isExecSession: true
    };

    this.sessions.set(sessionId, session);
    this.emit('session-created', session);

    return session;
  }

  async executeCommand(sessionId: string, command: string): Promise<string> {
    await this.simulateDelay('executeCommand');
    this.simulateError('executeCommand');

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const response = this.simulateResponse(command);
    
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: response.toString(),
      timestamp: new Date(),
      raw: response.toString()
    };

    this.emit('output', output);
    return response.toString();
  }

  async listPods(namespace: string = 'default'): Promise<any[]> {
    return Array.from(this.pods.values()).filter(pod => pod.namespace === namespace);
  }

  async getPodLogs(podName: string, namespace: string = 'default'): Promise<string> {
    return `Mock logs for pod ${podName} in namespace ${namespace}`;
  }
}

/**
 * Mock Serial Protocol
 */
export class MockSerialProtocol extends BaseMockProtocol {
  private ports: Set<string> = new Set(['COM1', 'COM2', '/dev/ttyUSB0', '/dev/ttyACM0']);
  private openPorts: Map<string, any> = new Map();

  async start(): Promise<void> {
    await this.simulateDelay('start');
    this.simulateError('start');
    this.isConnected = true;
    this.emit('connected');
  }

  async stop(): Promise<void> {
    this.isConnected = false;
    this.openPorts.clear();
    this.sessions.clear();
    this.emit('disconnected');
  }

  async createSession(options: any): Promise<SerialSession> {
    await this.simulateDelay('createSession');
    this.simulateError('createSession');

    const sessionId = `serial-${Date.now()}`;
    const portName = options.portName || 'COM1';
    const baudRate = options.baudRate || 9600;

    if (!this.ports.has(portName)) {
      throw new Error(`Serial port ${portName} not found`);
    }

    const session: SerialSession = {
      id: sessionId,
      command: '',
      args: [],
      cwd: '',
      env: {},
      createdAt: new Date(),
      status: 'running',
      type: 'serial',
      streaming: true,
      executionState: 'idle',
      activeCommands: new Map(),
      portName,
      baudRate,
      dataBits: options.dataBits || 8,
      stopBits: options.stopBits || 1,
      parity: options.parity || 'none',
      flowControl: options.flowControl || 'none',
      timeout: options.timeout || 1000,
      isOpen: true,
      serialOptions: {
        autoOpen: true,
        ...options.serialOptions
      }
    };

    this.openPorts.set(portName, session);
    this.sessions.set(sessionId, session);
    this.emit('session-created', session);

    return session;
  }

  async executeCommand(sessionId: string, command: string): Promise<string> {
    await this.simulateDelay('executeCommand');
    this.simulateError('executeCommand');

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // For serial, "executing command" means sending data
    const response = this.simulateResponse(command);
    
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: response.toString(),
      timestamp: new Date(),
      raw: response.toString()
    };

    this.emit('output', output);
    this.emit('data-received', response);

    return response.toString();
  }

  async listPorts(): Promise<string[]> {
    return Array.from(this.ports);
  }

  async writeData(sessionId: string, data: Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    this.emit('data-sent', data);
    
    // Simulate echo back
    setTimeout(() => {
      this.emit('data-received', data);
    }, 10);
  }
}

/**
 * Mock SFTP Protocol
 */
export class MockSFTPProtocol extends BaseMockProtocol {
  private fileSystem: Map<string, { content: Buffer; stats: any }> = new Map();
  private currentDirectory: string = '/';

  constructor(config: MockServerConfig = {}, behavior: MockProtocolBehavior = {}) {
    super(config, behavior);
    this.initializeMockFileSystem();
  }

  private initializeMockFileSystem(): void {
    // Create mock files and directories
    this.fileSystem.set('/', { 
      content: Buffer.from(''), 
      stats: { isDirectory: () => true, size: 0, mtime: new Date() } 
    });
    
    this.fileSystem.set('/home', { 
      content: Buffer.from(''), 
      stats: { isDirectory: () => true, size: 0, mtime: new Date() } 
    });
    
    this.fileSystem.set('/home/user', { 
      content: Buffer.from(''), 
      stats: { isDirectory: () => true, size: 0, mtime: new Date() } 
    });
    
    this.fileSystem.set('/home/user/test.txt', { 
      content: Buffer.from('This is a test file'), 
      stats: { isDirectory: () => false, size: 19, mtime: new Date() } 
    });
  }

  async start(): Promise<void> {
    await this.simulateDelay('start');
    this.simulateError('start');
    this.isConnected = true;
    this.emit('connected');
  }

  async stop(): Promise<void> {
    this.isConnected = false;
    this.sessions.clear();
    this.emit('disconnected');
  }

  async createSession(options: any): Promise<SFTPSession> {
    await this.simulateDelay('createSession');
    this.simulateError('createSession');

    const sessionId = `sftp-${Date.now()}`;

    const session: SFTPSession = {
      id: sessionId,
      command: '',
      args: [],
      cwd: options.cwd || '/home/user',
      env: {},
      createdAt: new Date(),
      status: 'running',
      type: 'sftp',
      streaming: false,
      executionState: 'idle',
      activeCommands: new Map(),
      host: options.host || 'localhost',
      port: options.port || 22,
      username: options.username || 'user',
      privateKey: options.privateKey,
      passphrase: options.passphrase,
      connectionOptions: options.connectionOptions || {},
      currentPath: options.cwd || '/home/user',
      isConnected: true,
      transferStats: {
        uploadedBytes: 0,
        downloadedBytes: 0,
        uploadedFiles: 0,
        downloadedFiles: 0,
        errors: 0
      }
    };

    this.sessions.set(sessionId, session);
    this.emit('session-created', session);

    return session;
  }

  async executeCommand(sessionId: string, command: string): Promise<string> {
    await this.simulateDelay('executeCommand');
    this.simulateError('executeCommand');

    const session = this.sessions.get(sessionId) as SFTPSession;
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Parse SFTP commands
    const [cmd, ...args] = command.split(' ');
    let response: string;

    switch (cmd) {
      case 'ls':
      case 'dir':
        response = await this.listFiles(args[0] || session.currentPath);
        break;
      case 'cd':
        response = await this.changeDirectory(sessionId, args[0]);
        break;
      case 'pwd':
        response = session.currentPath;
        break;
      case 'get':
        response = await this.downloadFile(sessionId, args[0], args[1]);
        break;
      case 'put':
        response = await this.uploadFile(sessionId, args[0], args[1]);
        break;
      case 'rm':
      case 'delete':
        response = await this.deleteFile(args[0]);
        break;
      case 'mkdir':
        response = await this.createDirectory(args[0]);
        break;
      default:
        response = this.simulateResponse(command).toString();
    }

    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: response,
      timestamp: new Date(),
      raw: response
    };

    this.emit('output', output);
    return response;
  }

  private async listFiles(path: string): Promise<string> {
    const files = Array.from(this.fileSystem.keys())
      .filter(filePath => {
        const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
        return dir === (path || '/');
      })
      .map(filePath => {
        const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
        const fileInfo = this.fileSystem.get(filePath)!;
        const isDir = fileInfo.stats.isDirectory() ? 'd' : '-';
        const size = fileInfo.stats.size;
        const mtime = fileInfo.stats.mtime.toDateString();
        return `${isDir}rwxrwxrwx 1 user user ${size.toString().padStart(8)} ${mtime} ${fileName}`;
      })
      .join('\n');
    
    return files || 'Directory is empty';
  }

  private async changeDirectory(sessionId: string, path: string): Promise<string> {
    const session = this.sessions.get(sessionId) as SFTPSession;
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (this.fileSystem.has(path) && this.fileSystem.get(path)!.stats.isDirectory()) {
      session.currentPath = path;
      return `Changed directory to ${path}`;
    } else {
      throw new Error(`Directory ${path} not found`);
    }
  }

  private async downloadFile(sessionId: string, remotePath: string, localPath?: string): Promise<string> {
    const session = this.sessions.get(sessionId) as SFTPSession;
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const fileInfo = this.fileSystem.get(remotePath);
    if (!fileInfo) {
      throw new Error(`File ${remotePath} not found`);
    }

    session.transferStats.downloadedBytes += fileInfo.content.length;
    session.transferStats.downloadedFiles++;

    return `Downloaded ${remotePath} (${fileInfo.content.length} bytes)`;
  }

  private async uploadFile(sessionId: string, localPath: string, remotePath?: string): Promise<string> {
    const session = this.sessions.get(sessionId) as SFTPSession;
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const targetPath = remotePath || localPath;
    const mockContent = Buffer.from(`Mock content for ${localPath}`);
    
    this.fileSystem.set(targetPath, {
      content: mockContent,
      stats: { isDirectory: () => false, size: mockContent.length, mtime: new Date() }
    });

    session.transferStats.uploadedBytes += mockContent.length;
    session.transferStats.uploadedFiles++;

    return `Uploaded ${localPath} to ${targetPath} (${mockContent.length} bytes)`;
  }

  private async deleteFile(path: string): Promise<string> {
    if (this.fileSystem.has(path)) {
      this.fileSystem.delete(path);
      return `Deleted ${path}`;
    } else {
      throw new Error(`File ${path} not found`);
    }
  }

  private async createDirectory(path: string): Promise<string> {
    this.fileSystem.set(path, {
      content: Buffer.from(''),
      stats: { isDirectory: () => true, size: 0, mtime: new Date() }
    });
    return `Created directory ${path}`;
  }
}

/**
 * Mock Test Server Factory
 */
export class MockTestServerFactory {
  private servers: Map<string, any> = new Map();

  createMockServer(protocol: string, config: MockServerConfig = {}): BaseMockProtocol {
    switch (protocol.toLowerCase()) {
      case 'docker':
        return new MockDockerProtocol(config);
      case 'wsl':
        return new MockWSLProtocol(config);
      case 'kubernetes':
      case 'k8s':
        return new MockKubernetesProtocol(config);
      case 'serial':
        return new MockSerialProtocol(config);
      case 'sftp':
        return new MockSFTPProtocol(config);
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  async startAllServers(): Promise<void> {
    const startPromises = Array.from(this.servers.values()).map(server => server.start());
    await Promise.all(startPromises);
  }

  async stopAllServers(): Promise<void> {
    const stopPromises = Array.from(this.servers.values()).map(server => server.stop());
    await Promise.all(stopPromises);
  }

  getServer(name: string): BaseMockProtocol | undefined {
    return this.servers.get(name);
  }

  registerServer(name: string, server: BaseMockProtocol): void {
    this.servers.set(name, server);
  }
}

export const mockServerFactory = new MockTestServerFactory();