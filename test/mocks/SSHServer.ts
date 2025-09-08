import { createServer, Server, Socket } from 'net';
import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { createHash, randomBytes } from 'crypto';

export interface MockSSHUser {
  username: string;
  password?: string;
  publicKey?: string;
  keyFingerprint?: string;
}

export interface SSHServerOptions {
  port?: number;
  host?: string;
  banner?: string;
  version?: string;
}

export class SSHServer extends EventEmitter {
  private server: Server;
  private connections: Map<string, Socket> = new Map();
  private users: Map<string, MockSSHUser> = new Map();
  private authMode: 'password' | 'key' | 'both' = 'password';
  private isRunning: boolean = false;
  private port: number = 0;
  private host: string = 'localhost';
  private banner: string = 'Mock SSH Server';
  private version: string = 'SSH-2.0-MockSSH';
  private maxConnections: number = 100;
  private failureMode: boolean = false;
  private slowMode: boolean = false;
  private slowDelay: number = 3000;
  private commandHistory: Map<string, string[]> = new Map();
  private sessionStates: Map<string, any> = new Map();

  constructor(options: SSHServerOptions = {}) {
    super();
    
    this.host = options.host || 'localhost';
    this.banner = options.banner || 'Mock SSH Server';
    this.version = options.version || 'SSH-2.0-MockSSH';
    
    this.server = createServer();
    this.setupServerHandlers();
  }

  private setupServerHandlers(): void {
    this.server.on('connection', (socket: Socket) => {
      if (this.failureMode) {
        socket.destroy();
        return;
      }

      if (this.connections.size >= this.maxConnections) {
        socket.write('Too many connections\r\n');
        socket.destroy();
        return;
      }

      const connectionId = this.generateConnectionId();
      this.connections.set(connectionId, socket);
      this.commandHistory.set(connectionId, []);
      this.sessionStates.set(connectionId, { 
        authenticated: false, 
        user: null,
        environment: { HOME: '/home', PATH: '/usr/bin:/bin', PWD: '/home' }
      });

      this.handleConnection(connectionId, socket);
    });

    this.server.on('error', (error: Error) => {
      this.emit('error', error);
    });
  }

  private async handleConnection(connectionId: string, socket: Socket): Promise<void> {
    try {
      if (this.slowMode) {
        await new Promise(resolve => setTimeout(resolve, this.slowDelay));
      }

      // Send SSH version
      socket.write(`${this.version}\r\n`);

      // Send banner if configured
      if (this.banner) {
        socket.write(`${this.banner}\r\n`);
      }

      // Simple mock SSH handshake
      await this.performMockHandshake(connectionId, socket);

      socket.on('data', (data: Buffer) => {
        this.handleSocketData(connectionId, socket, data);
      });

      socket.on('close', () => {
        this.cleanup(connectionId);
      });

      socket.on('error', (error: Error) => {
        this.cleanup(connectionId);
        this.emit('connectionError', { connectionId, error });
      });

    } catch (error) {
      socket.destroy();
      this.cleanup(connectionId);
    }
  }

  private async performMockHandshake(connectionId: string, socket: Socket): Promise<void> {
    // Simulate SSH key exchange and authentication
    const state = this.sessionStates.get(connectionId);
    
    if (this.authMode === 'password') {
      socket.write('Password: ');
      await this.waitForAuthentication(connectionId, socket);
    } else if (this.authMode === 'key') {
      await this.performKeyAuthentication(connectionId, socket);
    } else {
      socket.write('Authentication required\r\n');
    }
  }

  private async waitForAuthentication(connectionId: string, socket: Socket): Promise<void> {
    return new Promise((resolve) => {
      const onData = (data: Buffer) => {
        const input = data.toString().trim();
        const state = this.sessionStates.get(connectionId);
        
        if (!state.authenticated) {
          // Handle password authentication
          this.handlePasswordAuth(connectionId, socket, input);
          resolve();
        }
        
        socket.removeListener('data', onData);
      };
      
      socket.on('data', onData);
    });
  }

  private handlePasswordAuth(connectionId: string, socket: Socket, password: string): void {
    const state = this.sessionStates.get(connectionId);
    
    // Try to authenticate with any configured user
    for (const [username, user] of this.users.entries()) {
      if (user.password === password) {
        state.authenticated = true;
        state.user = username;
        this.sessionStates.set(connectionId, state);
        
        socket.write(`\r\nWelcome ${username}!\r\n`);
        socket.write(`${username}@mockserver:~$ `);
        return;
      }
    }
    
    // Authentication failed
    socket.write('\r\nAuthentication failed\r\n');
    this.emit('authFailed', { connectionId, type: 'password' });
    socket.destroy();
  }

  private async performKeyAuthentication(connectionId: string, socket: Socket): Promise<void> {
    const state = this.sessionStates.get(connectionId);
    
    // In a real SSH server, this would involve complex key exchange
    // For mock purposes, we'll just check if any user has a public key configured
    for (const [username, user] of this.users.entries()) {
      if (user.publicKey && existsSync(user.publicKey)) {
        state.authenticated = true;
        state.user = username;
        this.sessionStates.set(connectionId, state);
        
        socket.write(`Welcome ${username}! (key authentication)\r\n`);
        socket.write(`${username}@mockserver:~$ `);
        return;
      }
    }
    
    socket.write('Public key authentication failed\r\n');
    this.emit('authFailed', { connectionId, type: 'key' });
    socket.destroy();
  }

  private handleSocketData(connectionId: string, socket: Socket, data: Buffer): void {
    const state = this.sessionStates.get(connectionId);
    
    if (!state || !state.authenticated) {
      return;
    }

    const input = data.toString().trim();
    const history = this.commandHistory.get(connectionId) || [];
    history.push(input);
    this.commandHistory.set(connectionId, history);

    // Handle common SSH commands
    this.executeCommand(connectionId, socket, input);
  }

  private executeCommand(connectionId: string, socket: Socket, command: string): void {
    const state = this.sessionStates.get(connectionId);
    const args = command.split(' ');
    const cmd = args[0];

    switch (cmd) {
      case 'echo':
        const message = args.slice(1).join(' ').replace(/["']/g, '');
        socket.write(`${message}\r\n`);
        break;

      case 'pwd':
        socket.write(`${state.environment.PWD}\r\n`);
        break;

      case 'cd':
        const newDir = args[1] || state.environment.HOME;
        state.environment.PWD = newDir;
        this.sessionStates.set(connectionId, state);
        break;

      case 'export':
        if (args[1] && args[1].includes('=')) {
          const [key, value] = args[1].split('=');
          state.environment[key] = value.replace(/["']/g, '');
          this.sessionStates.set(connectionId, state);
        }
        break;

      case 'env':
        Object.entries(state.environment).forEach(([key, value]) => {
          socket.write(`${key}=${value}\r\n`);
        });
        break;

      case 'whoami':
        socket.write(`${state.user}\r\n`);
        break;

      case 'hostname':
        socket.write('mockserver\r\n');
        break;

      case 'date':
        socket.write(`${new Date().toString()}\r\n`);
        break;

      case 'uname':
        socket.write('Linux mockserver 5.4.0-mock #1 SMP x86_64 GNU/Linux\r\n');
        break;

      case 'ps':
        socket.write('  PID TTY          TIME CMD\r\n');
        socket.write(' 1234 pts/0    00:00:01 bash\r\n');
        socket.write(' 5678 pts/0    00:00:00 ps\r\n');
        break;

      case 'ls':
        const dir = args[1] || '.';
        if (dir === '.') {
          socket.write('file1.txt  file2.txt  directory1/  directory2/\r\n');
        } else {
          socket.write(`Contents of ${dir}:\r\n`);
          socket.write('mock-file1  mock-file2  mock-dir/\r\n');
        }
        break;

      case 'cat':
        const filename = args[1];
        if (filename) {
          socket.write(`Mock contents of ${filename}\r\nLine 1 of file\r\nLine 2 of file\r\n`);
        } else {
          socket.write('cat: missing file operand\r\n');
        }
        break;

      case 'sleep':
        const duration = parseInt(args[1]) || 1;
        setTimeout(() => {
          // Command completed after sleep
        }, duration * 1000);
        break;

      case 'ping':
        const host = args[1] || 'localhost';
        socket.write(`PING ${host} (127.0.0.1): 56 data bytes\r\n`);
        let pingCount = 0;
        const pingInterval = setInterval(() => {
          if (pingCount >= 4) {
            clearInterval(pingInterval);
            socket.write(`\r\n--- ${host} ping statistics ---\r\n`);
            socket.write('4 packets transmitted, 4 packets received, 0% packet loss\r\n');
            this.sendPrompt(connectionId, socket);
            return;
          }
          socket.write(`64 bytes from ${host}: icmp_seq=${pingCount} ttl=64 time=0.1ms\r\n`);
          pingCount++;
        }, 1000);
        return; // Don't send prompt immediately

      case 'history':
        const history = this.commandHistory.get(connectionId) || [];
        history.forEach((cmd, index) => {
          socket.write(`${index + 1}  ${cmd}\r\n`);
        });
        break;

      case 'exit':
      case 'logout':
        socket.write('Connection closed\r\n');
        socket.destroy();
        return;

      case 'clear':
        socket.write('\x1b[2J\x1b[H'); // ANSI clear screen
        break;

      default:
        if (command.startsWith('for ')) {
          // Handle for loops (bash)
          this.handleForLoop(connectionId, socket, command);
          return;
        } else if (command.includes('&')) {
          // Handle background processes
          const parts = command.split('&');
          parts.forEach(part => {
            const cmd = part.trim();
            if (cmd) {
              this.executeCommand(connectionId, socket, cmd);
            }
          });
        } else if (command.includes('&&')) {
          // Handle command chaining
          const parts = command.split('&&');
          parts.forEach(part => {
            const cmd = part.trim();
            if (cmd) {
              this.executeCommand(connectionId, socket, cmd);
            }
          });
        } else if (command.includes('|')) {
          // Handle pipes (simplified)
          const parts = command.split('|');
          parts.forEach((part, index) => {
            const cmd = part.trim();
            if (cmd && index === 0) { // Only execute first command for simplicity
              this.executeCommand(connectionId, socket, cmd);
            }
          });
        } else if (command.includes('>')) {
          // Handle output redirection
          const parts = command.split('>');
          const cmd = parts[0].trim();
          const file = parts[1]?.trim();
          if (cmd) {
            this.executeCommand(connectionId, socket, cmd);
            if (file) {
              socket.write(`Output redirected to ${file}\r\n`);
            }
          }
        } else if (command.includes('2>&1')) {
          // Handle stderr redirection
          const cleanCmd = command.replace('2>&1', '').trim();
          if (cleanCmd) {
            socket.write(`Error output: ${cleanCmd} failed\r\n`);
          }
        } else {
          // Unknown command
          if (command.trim()) {
            socket.write(`${cmd}: command not found\r\n`);
          }
        }
        break;
    }

    this.sendPrompt(connectionId, socket);
  }

  private handleForLoop(connectionId: string, socket: Socket, command: string): void {
    // Simple bash for loop simulation
    if (command.includes('{1..')) {
      const match = command.match(/\{1\.\.(\d+)\}/);
      if (match) {
        const count = parseInt(match[1]);
        const loopBody = command.match(/do\s+(.*?)(?:;|$)/)?.[1] || 'echo $i';
        
        for (let i = 1; i <= Math.min(count, 20); i++) { // Limit to prevent spam
          const expandedCmd = loopBody.replace(/\$i/g, i.toString());
          this.executeCommand(connectionId, socket, expandedCmd);
        }
      }
    }
    
    this.sendPrompt(connectionId, socket);
  }

  private sendPrompt(connectionId: string, socket: Socket): void {
    const state = this.sessionStates.get(connectionId);
    if (state && state.authenticated) {
      socket.write(`${state.user}@mockserver:${state.environment.PWD}$ `);
    }
  }

  private generateConnectionId(): string {
    return randomBytes(8).toString('hex');
  }

  private cleanup(connectionId: string): void {
    this.connections.delete(connectionId);
    this.commandHistory.delete(connectionId);
    this.sessionStates.delete(connectionId);
  }

  // Public API methods

  async start(port?: number): Promise<number> {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    return new Promise((resolve, reject) => {
      const targetPort = port || 0; // Use 0 for random available port
      
      this.server.listen(targetPort, this.host, () => {
        const address = this.server.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
          this.isRunning = true;
          this.emit('started', { port: this.port, host: this.host });
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${targetPort} is already in use`));
        } else {
          reject(error);
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      // Close all active connections
      this.connections.forEach((socket) => {
        socket.destroy();
      });
      this.connections.clear();

      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.isRunning = false;
          this.emit('stopped');
          resolve();
        }
      });
    });
  }

  addUser(username: string, password?: string, publicKeyPath?: string): void {
    const user: MockSSHUser = {
      username,
      password
    };

    if (publicKeyPath) {
      user.publicKey = publicKeyPath;
      if (existsSync(publicKeyPath)) {
        try {
          const publicKey = readFileSync(publicKeyPath, 'utf8');
          user.keyFingerprint = createHash('md5')
            .update(publicKey)
            .digest('hex');
        } catch (error) {
          // Invalid key file
        }
      }
    }

    this.users.set(username, user);
  }

  removeUser(username: string): void {
    this.users.delete(username);
  }

  setAuthMode(mode: 'password' | 'key' | 'both'): void {
    this.authMode = mode;
  }

  setMaxConnections(max: number): void {
    this.maxConnections = max;
  }

  setFailureMode(enabled: boolean): void {
    this.failureMode = enabled;
  }

  setSlowMode(enabled: boolean, delay: number = 3000): void {
    this.slowMode = enabled;
    this.slowDelay = delay;
  }

  getConnections(): string[] {
    return Array.from(this.connections.keys());
  }

  getActiveUsers(): string[] {
    const activeUsers: string[] = [];
    this.sessionStates.forEach((state) => {
      if (state.authenticated && state.user) {
        activeUsers.push(state.user);
      }
    });
    return activeUsers;
  }

  getCommandHistory(connectionId?: string): Map<string, string[]> | string[] {
    if (connectionId) {
      return this.commandHistory.get(connectionId) || [];
    }
    return this.commandHistory;
  }

  isRunning(): boolean {
    return this.isRunning;
  }

  getPort(): number {
    return this.port;
  }

  getHost(): string {
    return this.host;
  }

  // Simulation methods for testing specific scenarios

  simulateConnectionDrop(connectionId?: string): void {
    if (connectionId && this.connections.has(connectionId)) {
      const socket = this.connections.get(connectionId)!;
      socket.destroy();
    } else {
      // Drop all connections
      this.connections.forEach((socket) => {
        socket.destroy();
      });
    }
  }

  simulateHighLatency(enabled: boolean, latency: number = 1000): void {
    this.slowMode = enabled;
    this.slowDelay = latency;
  }

  simulateMemoryPressure(enabled: boolean): void {
    if (enabled) {
      // Simulate memory pressure by reducing max connections
      this.maxConnections = Math.max(1, Math.floor(this.maxConnections / 2));
    }
  }

  simulateNetworkPartition(duration: number): void {
    const originalFailureMode = this.failureMode;
    this.failureMode = true;
    
    setTimeout(() => {
      this.failureMode = originalFailureMode;
    }, duration);
  }

  injectCommand(connectionId: string, command: string): void {
    const socket = this.connections.get(connectionId);
    if (socket) {
      this.executeCommand(connectionId, socket, command);
    }
  }

  getSessionState(connectionId: string): any {
    return this.sessionStates.get(connectionId);
  }

  setSessionEnvironment(connectionId: string, key: string, value: string): void {
    const state = this.sessionStates.get(connectionId);
    if (state) {
      state.environment[key] = value;
      this.sessionStates.set(connectionId, state);
    }
  }

  // Performance testing capabilities

  enablePerformanceMode(): void {
    // Optimize for performance testing
    this.maxConnections = 1000;
    this.slowMode = false;
    this.failureMode = false;
  }

  getPerformanceMetrics(): {
    activeConnections: number;
    totalCommands: number;
    averageCommandsPerConnection: number;
    memoryUsage: NodeJS.MemoryUsage;
  } {
    const totalCommands = Array.from(this.commandHistory.values())
      .reduce((sum, history) => sum + history.length, 0);
    
    return {
      activeConnections: this.connections.size,
      totalCommands,
      averageCommandsPerConnection: this.connections.size > 0 
        ? totalCommands / this.connections.size 
        : 0,
      memoryUsage: process.memoryUsage()
    };
  }

  reset(): void {
    // Reset server state for clean tests
    this.connections.clear();
    this.users.clear();
    this.commandHistory.clear();
    this.sessionStates.clear();
    this.authMode = 'password';
    this.failureMode = false;
    this.slowMode = false;
    this.maxConnections = 100;
  }
}