/**
 * Production-ready SSH Session Handler
 * Complete replacement for broken SSH implementation
 */

import { Client as SSHClient, ClientChannel, ConnectConfig } from 'ssh2';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export interface SSHSessionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  tryKeyboard?: boolean;
  keepAliveInterval?: number;
  readyTimeout?: number;
  term?: string;
  cols?: number;
  rows?: number;
}

export interface SSHSession {
  id: string;
  client: SSHClient;
  channel: ClientChannel;
  options: SSHSessionOptions;
  isInteractive: boolean;
  created: Date;
  lastActivity: Date;
  outputBuffer: string[];
  commandHistory: string[];
  lastReadIndex: number; // Track the last read position to return only new output
}

export class SSHSessionHandler extends EventEmitter {
  private logger: Logger;
  private sessions: Map<string, SSHSession>;
  private readonly MAX_OUTPUT_BUFFER = 10000;
  private readonly INTERACTIVE_PROGRAMS = new Set([
    'nano', 'vim', 'vi', 'emacs', 'pico', 'joe', 'jed', 'ne',
    'less', 'more', 'man', 'info',
    'top', 'htop', 'iotop', 'iftop', 'nethogs', 'btop', 'glances', 'atop',
    'mysql', 'psql', 'sqlite3', 'mongo', 'redis-cli', 'influx',
    'python', 'python3', 'ipython', 'node', 'irb', 'php', 'julia', 'R',
    'ssh', 'telnet', 'ftp', 'sftp', 'scp',
    'screen', 'tmux', 'byobu',
    'gdb', 'pdb', 'lldb', 'radare2',
    'crontab', 'visudo', 'vipw',
    'passwd', 'su', 'sudo',
    'mc', 'ranger', 'nnn', 'lf', 'vifm',
    'tig', 'gitui', 'lazygit',
    'ncdu', 'duf', 'dust',
    'watch', 'tail', 'journalctl'
  ]);

  constructor() {
    super();
    this.logger = new Logger('SSHSessionHandler');
    this.sessions = new Map();
  }

  /**
   * Create a new SSH session with proper PTY allocation
   */
  async createSession(options: SSHSessionOptions): Promise<string> {
    const sessionId = `ssh-${uuidv4()}`;
    const client = new SSHClient();
    
    this.logger.info(`Creating SSH session ${sessionId} to ${options.host}`);
    
    try {
      // Connect to SSH server
      await this.connectSSH(client, options, sessionId);
      
      // Create shell with PTY
      const channel = await this.createShellChannel(client, options, sessionId);
      
      // Setup session
      const session: SSHSession = {
        id: sessionId,
        client,
        channel,
        options,
        isInteractive: false,
        created: new Date(),
        lastActivity: new Date(),
        outputBuffer: [],
        commandHistory: [],
        lastReadIndex: 0
      };
      
      // Setup event handlers
      this.setupChannelHandlers(session);
      
      // Store session
      this.sessions.set(sessionId, session);
      
      this.logger.info(`SSH session ${sessionId} created successfully`);
      return sessionId;
      
    } catch (error) {
      client.end();
      this.logger.error(`Failed to create SSH session: ${error}`);
      throw error;
    }
  }

  /**
   * Connect to SSH server with proper error handling
   */
  private async connectSSH(client: SSHClient, options: SSHSessionOptions, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('SSH connection timeout'));
      }, options.readyTimeout || 30000);
      
      const config: ConnectConfig = {
        host: options.host,
        port: options.port || 22,
        username: options.username,
        password: options.password,
        privateKey: options.privateKey,
        passphrase: options.passphrase,
        tryKeyboard: options.tryKeyboard !== false,
        keepaliveInterval: options.keepAliveInterval || 10000,
        readyTimeout: options.readyTimeout || 30000
      };
      
      client.on('ready', () => {
        clearTimeout(timeout);
        this.logger.debug(`SSH client ready for session ${sessionId}`);
        resolve();
      });
      
      client.on('error', (err) => {
        clearTimeout(timeout);
        this.logger.error(`SSH connection error for session ${sessionId}:`, err);
        reject(err);
      });
      
      client.on('end', () => {
        this.logger.info(`SSH connection ended for session ${sessionId}`);
        this.cleanupSession(sessionId);
      });
      
      client.on('close', () => {
        this.logger.info(`SSH connection closed for session ${sessionId}`);
        this.cleanupSession(sessionId);
      });
      
      client.connect(config);
    });
  }

  /**
   * Create shell channel with proper PTY settings
   */
  private async createShellChannel(client: SSHClient, options: SSHSessionOptions, sessionId: string): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      const ptyOptions = {
        term: options.term || process.env.TERM || 'xterm-256color',
        cols: options.cols || 80,
        rows: options.rows || 24,
        height: 480,
        width: 640,
        modes: {}
      };
      
      this.logger.debug(`Creating shell with PTY options:`, ptyOptions);
      
      client.shell(ptyOptions, (err, channel) => {
        if (err) {
          this.logger.error(`Failed to create shell for session ${sessionId}:`, err);
          reject(err);
          return;
        }
        
        // Set encoding to UTF-8
        channel.setEncoding('utf8');
        
        this.logger.debug(`Shell channel created for session ${sessionId}`);
        resolve(channel);
      });
    });
  }

  /**
   * Setup channel event handlers
   */
  private setupChannelHandlers(session: SSHSession): void {
    const { channel, id } = session;
    
    // Handle stdout data
    channel.on('data', (data: string | Buffer) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      session.lastActivity = new Date();
      
      // Add to buffer
      session.outputBuffer.push(text);
      if (session.outputBuffer.length > this.MAX_OUTPUT_BUFFER) {
        session.outputBuffer.shift();
      }
      
      // Detect interactive mode from output
      this.detectInteractiveMode(session, text);
      
      // Emit output event
      this.emit('output', {
        sessionId: id,
        data: text,
        type: 'stdout',
        timestamp: new Date()
      });
    });
    
    // Handle stderr data
    channel.stderr?.on('data', (data: string | Buffer) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      session.lastActivity = new Date();
      
      // Add to buffer
      session.outputBuffer.push(`[stderr] ${text}`);
      if (session.outputBuffer.length > this.MAX_OUTPUT_BUFFER) {
        session.outputBuffer.shift();
      }
      
      // Emit output event
      this.emit('output', {
        sessionId: id,
        data: text,
        type: 'stderr',
        timestamp: new Date()
      });
    });
    
    // Handle channel close
    channel.on('close', () => {
      this.logger.info(`Channel closed for session ${id}`);
      this.cleanupSession(id);
    });
    
    // Handle channel errors
    channel.on('error', (err) => {
      this.logger.error(`Channel error for session ${id}:`, err);
      this.emit('error', { sessionId: id, error: err });
    });
  }

  /**
   * Execute a command in the session
   */
  async executeCommand(sessionId: string, command: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // Check if this is an interactive command
    const isInteractive = this.isInteractiveCommand(command);
    if (isInteractive) {
      session.isInteractive = true;
      this.logger.info(`Entering interactive mode for session ${sessionId}: ${command}`);
    }
    
    // Record command in history
    session.commandHistory.push(command);
    session.lastActivity = new Date();
    
    // Send command to channel
    return this.writeToChannel(session.channel, command + '\n', sessionId);
  }

  /**
   * Send raw input to the session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    session.lastActivity = new Date();
    return this.writeToChannel(session.channel, input, sessionId);
  }

  /**
   * Send a special key to the session
   */
  async sendKey(sessionId: string, key: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const keySequences: Record<string, string> = {
      // Control keys
      'ctrl+c': '\x03',
      'ctrl+d': '\x04',
      'ctrl+z': '\x1a',
      'ctrl+l': '\x0c',
      'ctrl+a': '\x01',
      'ctrl+e': '\x05',
      'ctrl+k': '\x0b',
      'ctrl+u': '\x15',
      'ctrl+w': '\x17',
      'ctrl+x': '\x18',
      'ctrl+o': '\x0f',
      'ctrl+s': '\x13',
      'ctrl+q': '\x11',
      'ctrl+r': '\x12',
      'ctrl+t': '\x14',
      'ctrl+y': '\x19',
      'ctrl+p': '\x10',
      'ctrl+n': '\x0e',
      'ctrl+b': '\x02',
      'ctrl+f': '\x06',
      'ctrl+g': '\x07',
      'ctrl+h': '\x08',
      'ctrl+v': '\x16',
      
      // Special keys
      'enter': '\r',
      'tab': '\t',
      'escape': '\x1b',
      'space': ' ',
      'backspace': '\x7f',
      'delete': '\x1b[3~',
      
      // Arrow keys
      'up': '\x1b[A',
      'down': '\x1b[B',
      'right': '\x1b[C',
      'left': '\x1b[D',
      
      // Navigation keys
      'home': '\x1b[H',
      'end': '\x1b[F',
      'pageup': '\x1b[5~',
      'pagedown': '\x1b[6~',
      'insert': '\x1b[2~',
      
      // Function keys
      'f1': '\x1bOP',
      'f2': '\x1bOQ',
      'f3': '\x1bOR',
      'f4': '\x1bOS',
      'f5': '\x1b[15~',
      'f6': '\x1b[17~',
      'f7': '\x1b[18~',
      'f8': '\x1b[19~',
      'f9': '\x1b[20~',
      'f10': '\x1b[21~',
      'f11': '\x1b[23~',
      'f12': '\x1b[24~'
    };
    
    const sequence = keySequences[key.toLowerCase()] || key;
    session.lastActivity = new Date();
    
    this.logger.debug(`Sending key '${key}' (${this.escapeSequence(sequence)}) to session ${sessionId}`);
    return this.writeToChannel(session.channel, sequence, sessionId);
  }

  /**
   * Get output from the session
   */
  getOutput(sessionId: string, lines?: number): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (lines && lines > 0) {
      // For limited lines, return last N lines and update read index
      const result = session.outputBuffer.slice(-lines);
      session.lastReadIndex = session.outputBuffer.length;
      return result;
    }

    // Return only new output since last read
    const newOutput = session.outputBuffer.slice(session.lastReadIndex);
    session.lastReadIndex = session.outputBuffer.length;
    return newOutput;
  }

  /**
   * Get full output history from the session (for debugging)
   */
  getFullOutput(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return [...session.outputBuffer];
  }

  /**
   * Get session information
   */
  getSessionInfo(sessionId: string): Partial<SSHSession> | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    
    return {
      id: session.id,
      isInteractive: session.isInteractive,
      created: session.created,
      lastActivity: session.lastActivity,
      commandHistory: [...session.commandHistory]
    };
  }

  /**
   * List all active sessions
   */
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    
    this.logger.info(`Closing SSH session ${sessionId}`);
    
    try {
      session.channel.end();
      session.client.end();
    } catch (error) {
      this.logger.error(`Error closing session ${sessionId}:`, error);
    }
    
    this.cleanupSession(sessionId);
  }

  /**
   * Write data to channel with error handling
   */
  private writeToChannel(channel: ClientChannel, data: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!channel.writable) {
        reject(new Error(`Channel not writable for session ${sessionId}`));
        return;
      }
      
      channel.write(data, (err) => {
        if (err) {
          this.logger.error(`Write error for session ${sessionId}:`, err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Check if a command is interactive
   */
  private isInteractiveCommand(command: string): boolean {
    const cmd = command.toLowerCase().trim().split(/\s+/)[0];
    const basename = cmd.split('/').pop() || cmd;
    return this.INTERACTIVE_PROGRAMS.has(basename);
  }

  /**
   * Detect interactive mode from output patterns
   */
  private detectInteractiveMode(session: SSHSession, output: string): void {
    // Terminal control sequences that indicate interactive mode
    const interactivePatterns = [
      /\x1b\[2J/,         // Clear screen
      /\x1b\[\?1049h/,    // Alternative screen buffer (vim, less)
      /\x1b\[\d+;\d+H/,   // Cursor positioning
      /\x1b\[6n/,         // Cursor position request
      /\x1b\[\d+;\d+r/,   // Set scrolling region
    ];
    
    // Check for interactive patterns
    const hasInteractivePattern = interactivePatterns.some(pattern => pattern.test(output));
    if (hasInteractivePattern && !session.isInteractive) {
      session.isInteractive = true;
      this.logger.info(`Interactive mode detected for session ${session.id}`);
    }
    
    // Check for return to shell prompt (exit from interactive mode)
    const exitPatterns = [
      /\x1b\[\?1049l/,    // Exit alternative screen buffer
      /^\$ $/m,           // Bash prompt
      /^# $/m,            // Root prompt
      /> $/m,             // Generic prompt
    ];
    
    const hasExitPattern = exitPatterns.some(pattern => pattern.test(output));
    if (hasExitPattern && session.isInteractive) {
      session.isInteractive = false;
      this.logger.info(`Exited interactive mode for session ${session.id}`);
    }
  }

  /**
   * Escape special characters for logging
   */
  private escapeSequence(seq: string): string {
    return seq.replace(/[\x00-\x1f]/g, (char) => {
      return '\\x' + char.charCodeAt(0).toString(16).padStart(2, '0');
    });
  }

  /**
   * Clean up session resources
   */
  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    
    try {
      if (session.channel && !session.channel.destroyed) {
        session.channel.destroy();
      }
      if (session.client) {
        session.client.end();
      }
    } catch (error) {
      this.logger.error(`Error during cleanup for session ${sessionId}:`, error);
    }
    
    this.sessions.delete(sessionId);
    this.emit('sessionClosed', sessionId);
    this.logger.info(`Session ${sessionId} cleaned up`);
  }

  /**
   * Destroy all sessions and clean up
   */
  async destroy(): Promise<void> {
    this.logger.info('Destroying all SSH sessions');
    
    const closePromises = Array.from(this.sessions.keys()).map(sessionId => 
      this.closeSession(sessionId).catch(err => 
        this.logger.error(`Error closing session ${sessionId}:`, err)
      )
    );
    
    await Promise.all(closePromises);
    this.removeAllListeners();
    this.logger.info('SSH session handler destroyed');
  }
}