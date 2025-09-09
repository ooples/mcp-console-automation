/**
 * Test Server Infrastructure for Console Automation Testing
 * Production-ready test servers for protocol validation
 */

import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
import * as ws from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Readable, PassThrough } from 'stream';

export interface TestServerConfig {
  port?: number;
  host?: string;
  protocol: 'tcp' | 'http' | 'https' | 'websocket' | 'ssh' | 'telnet' | 'custom';
  ssl?: {
    cert: string;
    key: string;
    ca?: string;
  };
  auth?: {
    username: string;
    password: string;
    publicKey?: string;
    privateKey?: string;
  };
  behavior?: {
    responseDelay?: number;
    connectionDelay?: number;
    errorRate?: number;
    dropRate?: number;
    slowResponse?: boolean;
    largeResponse?: boolean;
  };
  logging?: boolean;
  maxConnections?: number;
}

export interface ConnectionInfo {
  id: string;
  remoteAddress: string;
  remotePort: number;
  connectedAt: Date;
  lastActivity: Date;
  bytesReceived: number;
  bytesSent: number;
  authenticated: boolean;
}

/**
 * Base Test Server class
 */
export abstract class BaseTestServer extends EventEmitter {
  protected config: TestServerConfig;
  protected server: any;
  protected connections: Map<string, ConnectionInfo> = new Map();
  protected isRunning: boolean = false;
  protected startTime?: Date;
  protected stats = {
    totalConnections: 0,
    activeConnections: 0,
    totalRequests: 0,
    totalErrors: 0,
    totalBytesReceived: 0,
    totalBytesSent: 0
  };

  constructor(config: TestServerConfig) {
    super();
    this.config = config;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  protected generateConnectionId(): string {
    return `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  protected addConnection(id: string, socket: any): void {
    const info: ConnectionInfo = {
      id,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      connectedAt: new Date(),
      lastActivity: new Date(),
      bytesReceived: 0,
      bytesSent: 0,
      authenticated: false
    };

    this.connections.set(id, info);
    this.stats.totalConnections++;
    this.stats.activeConnections++;
    this.emit('connection', info);

    if (this.config.logging) {
      console.log(`[TestServer] New connection: ${id} from ${info.remoteAddress}:${info.remotePort}`);
    }
  }

  protected removeConnection(id: string): void {
    const info = this.connections.get(id);
    if (info) {
      this.connections.delete(id);
      this.stats.activeConnections--;
      this.emit('disconnection', info);

      if (this.config.logging) {
        console.log(`[TestServer] Connection closed: ${id}`);
      }
    }
  }

  protected updateConnectionActivity(id: string, bytesReceived: number = 0, bytesSent: number = 0): void {
    const info = this.connections.get(id);
    if (info) {
      info.lastActivity = new Date();
      info.bytesReceived += bytesReceived;
      info.bytesSent += bytesSent;
      this.stats.totalBytesReceived += bytesReceived;
      this.stats.totalBytesSent += bytesSent;
    }
  }

  protected async simulateDelay(): Promise<void> {
    if (this.config.behavior?.responseDelay) {
      return new Promise(resolve => {
        setTimeout(resolve, this.config.behavior!.responseDelay);
      });
    }
  }

  protected shouldSimulateError(): boolean {
    return this.config.behavior?.errorRate ? Math.random() < this.config.behavior.errorRate : false;
  }

  protected shouldDropConnection(): boolean {
    return this.config.behavior?.dropRate ? Math.random() < this.config.behavior.dropRate : false;
  }

  getStats() {
    return {
      ...this.stats,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      activeConnections: this.connections.size,
      isRunning: this.isRunning
    };
  }

  getConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values());
  }

  isServerRunning(): boolean {
    return this.isRunning;
  }
}

/**
 * TCP Test Server
 */
export class TCPTestServer extends BaseTestServer {
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        const connId = this.generateConnectionId();
        this.addConnection(connId, socket);

        socket.on('data', async (data) => {
          this.updateConnectionActivity(connId, data.length);
          this.stats.totalRequests++;

          if (this.shouldDropConnection()) {
            socket.destroy();
            return;
          }

          if (this.shouldSimulateError()) {
            socket.write('ERROR: Simulated server error\r\n');
            this.stats.totalErrors++;
            return;
          }

          await this.simulateDelay();

          // Echo the data back with a timestamp
          const response = `[${new Date().toISOString()}] Echo: ${data.toString().trim()}\r\n`;
          socket.write(response);
          this.updateConnectionActivity(connId, 0, response.length);
        });

        socket.on('close', () => {
          this.removeConnection(connId);
        });

        socket.on('error', (error) => {
          this.stats.totalErrors++;
          this.emit('error', error, connId);
          this.removeConnection(connId);
        });
      });

      this.server.listen(this.config.port || 0, this.config.host || '127.0.0.1', () => {
        this.isRunning = true;
        this.startTime = new Date();
        const address = this.server.address();
        this.emit('listening', address);
        
        if (this.config.logging) {
          console.log(`[TCPTestServer] Listening on ${address.address}:${address.port}`);
        }
        
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.emit('closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getListeningPort(): number {
    return this.server?.address()?.port || 0;
  }
}

/**
 * HTTP Test Server
 */
export class HTTPTestServer extends BaseTestServer {
  private routes: Map<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = new Map();

  constructor(config: TestServerConfig) {
    super(config);
    this.setupDefaultRoutes();
  }

  private setupDefaultRoutes(): void {
    this.addRoute('GET', '/', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: 'Test server is running',
        timestamp: new Date().toISOString(),
        uptime: this.getStats().uptime
      }));
    });

    this.addRoute('GET', '/health', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', ...this.getStats() }));
    });

    this.addRoute('POST', '/echo', (req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          echoed: body,
          timestamp: new Date().toISOString(),
          headers: req.headers
        }));
      });
    });

    this.addRoute('GET', '/delay/:ms', (req, res) => {
      const delay = parseInt(req.url!.split('/')[2]) || 1000;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `Delayed response after ${delay}ms` }));
      }, delay);
    });

    this.addRoute('GET', '/error/:code', (req, res) => {
      const code = parseInt(req.url!.split('/')[2]) || 500;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Simulated error with code ${code}` }));
    });
  }

  addRoute(method: string, path: string, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): void {
    this.routes.set(`${method} ${path}`, handler);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
        const connId = this.generateConnectionId();
        this.stats.totalRequests++;

        if (this.shouldSimulateError()) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Simulated server error' }));
          this.stats.totalErrors++;
          return;
        }

        await this.simulateDelay();

        const routeKey = `${req.method} ${req.url}`;
        const handler = this.routes.get(routeKey) || this.routes.get(`${req.method} ${req.url?.split('/')[1]}`);

        if (handler) {
          try {
            handler(req, res);
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
            this.stats.totalErrors++;
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Route not found' }));
        }
      };

      if (this.config.protocol === 'https') {
        this.server = https.createServer({
          cert: fs.readFileSync(this.config.ssl!.cert),
          key: fs.readFileSync(this.config.ssl!.key)
        }, requestHandler);
      } else {
        this.server = http.createServer(requestHandler);
      }

      this.server.listen(this.config.port || 0, this.config.host || '127.0.0.1', () => {
        this.isRunning = true;
        this.startTime = new Date();
        const address = this.server.address();
        this.emit('listening', address);
        
        if (this.config.logging) {
          console.log(`[HTTPTestServer] Listening on ${address.address}:${address.port}`);
        }
        
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.emit('closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getListeningPort(): number {
    return this.server?.address()?.port || 0;
  }
}

/**
 * WebSocket Test Server
 */
export class WebSocketTestServer extends BaseTestServer {
  private wss?: ws.WebSocketServer;

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer();
      this.wss = new ws.WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws, req) => {
        const connId = this.generateConnectionId();
        this.addConnection(connId, { remoteAddress: req.socket.remoteAddress, remotePort: req.socket.remotePort });

        ws.on('message', async (data) => {
          this.updateConnectionActivity(connId, data.length);
          this.stats.totalRequests++;

          if (this.shouldDropConnection()) {
            ws.close();
            return;
          }

          if (this.shouldSimulateError()) {
            ws.send(JSON.stringify({ error: 'Simulated server error' }));
            this.stats.totalErrors++;
            return;
          }

          await this.simulateDelay();

          // Echo the message back with metadata
          const response = JSON.stringify({
            type: 'echo',
            data: data.toString(),
            timestamp: new Date().toISOString(),
            connectionId: connId
          });

          ws.send(response);
          this.updateConnectionActivity(connId, 0, response.length);
        });

        ws.on('close', () => {
          this.removeConnection(connId);
        });

        ws.on('error', (error) => {
          this.stats.totalErrors++;
          this.emit('error', error, connId);
          this.removeConnection(connId);
        });

        // Send welcome message
        ws.send(JSON.stringify({
          type: 'welcome',
          connectionId: connId,
          timestamp: new Date().toISOString()
        }));
      });

      this.server.listen(this.config.port || 0, this.config.host || '127.0.0.1', () => {
        this.isRunning = true;
        this.startTime = new Date();
        const address = this.server.address();
        this.emit('listening', address);
        
        if (this.config.logging) {
          console.log(`[WebSocketTestServer] Listening on ${address.address}:${address.port}`);
        }
        
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close();
      }
      
      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.emit('closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getListeningPort(): number {
    return this.server?.address()?.port || 0;
  }

  broadcast(message: any): void {
    if (this.wss) {
      const data = JSON.stringify({
        type: 'broadcast',
        data: message,
        timestamp: new Date().toISOString()
      });

      this.wss.clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      });
    }
  }
}

/**
 * SSH-like Test Server (simplified implementation)
 */
export class SSHTestServer extends BaseTestServer {
  private sessions: Map<string, any> = new Map();

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        const connId = this.generateConnectionId();
        this.addConnection(connId, socket);

        // Simplified SSH-like protocol
        socket.write('SSH-2.0-TestServer\r\n');

        let buffer = '';
        let authenticated = false;
        let currentPath = '/home/user';

        socket.on('data', async (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            this.updateConnectionActivity(connId, trimmed.length);
            this.stats.totalRequests++;

            if (this.shouldDropConnection()) {
              socket.destroy();
              return;
            }

            if (this.shouldSimulateError()) {
              socket.write('ERROR: Simulated server error\r\n');
              this.stats.totalErrors++;
              continue;
            }

            await this.simulateDelay();

            // Simple authentication
            if (!authenticated) {
              if (trimmed.startsWith('USER ')) {
                socket.write('PASSWORD required\r\n');
              } else if (trimmed.startsWith('PASS ')) {
                authenticated = true;
                const connInfo = this.connections.get(connId);
                if (connInfo) connInfo.authenticated = true;
                socket.write(`Welcome! You are now in ${currentPath}\r\n$ `);
              } else {
                socket.write('Authentication required\r\n');
              }
              continue;
            }

            // Handle commands
            const [command, ...args] = trimmed.split(' ');
            let response = '';

            switch (command.toLowerCase()) {
              case 'pwd':
                response = `${currentPath}\r\n$ `;
                break;
              case 'ls':
                response = 'file1.txt  file2.txt  directory1/\r\n$ ';
                break;
              case 'cd':
                if (args[0]) {
                  currentPath = args[0].startsWith('/') ? args[0] : `${currentPath}/${args[0]}`;
                }
                response = `$ `;
                break;
              case 'echo':
                response = `${args.join(' ')}\r\n$ `;
                break;
              case 'exit':
              case 'quit':
                socket.write('Goodbye!\r\n');
                socket.end();
                return;
              default:
                response = `Command not found: ${command}\r\n$ `;
            }

            socket.write(response);
            this.updateConnectionActivity(connId, 0, response.length);
          }
        });

        socket.on('close', () => {
          this.removeConnection(connId);
        });

        socket.on('error', (error) => {
          this.stats.totalErrors++;
          this.emit('error', error, connId);
          this.removeConnection(connId);
        });
      });

      this.server.listen(this.config.port || 0, this.config.host || '127.0.0.1', () => {
        this.isRunning = true;
        this.startTime = new Date();
        const address = this.server.address();
        this.emit('listening', address);
        
        if (this.config.logging) {
          console.log(`[SSHTestServer] Listening on ${address.address}:${address.port}`);
        }
        
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.emit('closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getListeningPort(): number {
    return this.server?.address()?.port || 0;
  }
}

/**
 * Test Server Manager
 */
export class TestServerManager {
  private servers: Map<string, BaseTestServer> = new Map();

  createServer(name: string, config: TestServerConfig): BaseTestServer {
    let server: BaseTestServer;

    switch (config.protocol) {
      case 'tcp':
        server = new TCPTestServer(config);
        break;
      case 'http':
      case 'https':
        server = new HTTPTestServer(config);
        break;
      case 'websocket':
        server = new WebSocketTestServer(config);
        break;
      case 'ssh':
        server = new SSHTestServer(config);
        break;
      case 'telnet':
        server = new TCPTestServer(config); // Telnet is essentially TCP
        break;
      default:
        throw new Error(`Unsupported server protocol: ${config.protocol}`);
    }

    this.servers.set(name, server);
    return server;
  }

  getServer(name: string): BaseTestServer | undefined {
    return this.servers.get(name);
  }

  async startServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`Server ${name} not found`);
    }
    await server.start();
  }

  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (server) {
      await server.stop();
    }
  }

  async startAllServers(): Promise<void> {
    const promises = Array.from(this.servers.values()).map(server => server.start());
    await Promise.all(promises);
  }

  async stopAllServers(): Promise<void> {
    const promises = Array.from(this.servers.values()).map(server => server.stop());
    await Promise.all(promises);
  }

  getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name, server] of this.servers) {
      stats[name] = server.getStats();
    }
    return stats;
  }

  listServers(): string[] {
    return Array.from(this.servers.keys());
  }

  removeServer(name: string): boolean {
    return this.servers.delete(name);
  }
}

export const testServerManager = new TestServerManager();

/**
 * Test Server Builder for easy server creation
 */
export class TestServerBuilder {
  private config: Partial<TestServerConfig> = {};

  protocol(protocol: TestServerConfig['protocol']): TestServerBuilder {
    this.config.protocol = protocol;
    return this;
  }

  port(port: number): TestServerBuilder {
    this.config.port = port;
    return this;
  }

  host(host: string): TestServerBuilder {
    this.config.host = host;
    return this;
  }

  ssl(cert: string, key: string, ca?: string): TestServerBuilder {
    this.config.ssl = { cert, key, ca };
    return this;
  }

  auth(username: string, password: string): TestServerBuilder {
    this.config.auth = { username, password };
    return this;
  }

  withBehavior(behavior: NonNullable<TestServerConfig['behavior']>): TestServerBuilder {
    this.config.behavior = { ...this.config.behavior, ...behavior };
    return this;
  }

  withLogging(enabled: boolean = true): TestServerBuilder {
    this.config.logging = enabled;
    return this;
  }

  maxConnections(max: number): TestServerBuilder {
    this.config.maxConnections = max;
    return this;
  }

  build(): TestServerConfig {
    if (!this.config.protocol) {
      throw new Error('Protocol is required');
    }
    return this.config as TestServerConfig;
  }
}

export const createTestServer = (): TestServerBuilder => new TestServerBuilder();