/**
 * Bridge between MCP server and SSHSessionHandler
 * This replaces the broken ConsoleManager SSH handling
 */

import {
  SSHSessionHandler,
  SSHSessionOptions,
} from '../core/SSHSessionHandler.js';
import { Logger } from '../utils/logger.js';

export class SSHBridge {
  private sshHandler: SSHSessionHandler;
  private logger: Logger;
  private sessionMap: Map<string, string>; // MCP sessionId -> SSH sessionId

  constructor() {
    this.logger = new Logger('SSHBridge');
    this.sshHandler = new SSHSessionHandler();
    this.sessionMap = new Map();

    // Setup event listeners
    this.sshHandler.on('output', (data) => {
      this.logger.debug(
        `Output from session ${data.sessionId}: ${data.data.substring(0, 100)}...`
      );
    });

    this.sshHandler.on('error', (data) => {
      this.logger.error(`Error in session ${data.sessionId}:`, data.error);
    });

    this.sshHandler.on('sessionClosed', (sessionId) => {
      // Clean up mapping
      for (const [mcp, ssh] of this.sessionMap.entries()) {
        if (ssh === sessionId) {
          this.sessionMap.delete(mcp);
          break;
        }
      }
    });
  }

  /**
   * Create an SSH session
   */
  async createSession(options: any): Promise<string> {
    try {
      // Convert MCP options to SSH options
      const sshOptions: SSHSessionOptions = {
        host: options.sshOptions?.host || options.host,
        port: options.sshOptions?.port || options.port || 22,
        username: options.sshOptions?.username || options.username,
        password: options.sshOptions?.password || options.password,
        privateKey: options.sshOptions?.privateKey || options.privateKey,
        passphrase: options.sshOptions?.passphrase || options.passphrase,
        tryKeyboard: options.sshOptions?.tryKeyboard !== false,
        keepAliveInterval: options.sshOptions?.keepAliveInterval || 10000,
        readyTimeout: options.sshOptions?.readyTimeout || 30000,
        term: options.term || 'xterm-256color',
        cols: options.cols || 80,
        rows: options.rows || 24,
      };

      // Create SSH session
      const sshSessionId = await this.sshHandler.createSession(sshOptions);

      // Generate MCP session ID
      const mcpSessionId = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Map MCP session to SSH session
      this.sessionMap.set(mcpSessionId, sshSessionId);

      this.logger.info(
        `Created MCP session ${mcpSessionId} -> SSH session ${sshSessionId}`
      );
      return mcpSessionId;
    } catch (error) {
      this.logger.error('Failed to create SSH session:', error);
      throw error;
    }
  }

  /**
   * Execute a command in the session
   */
  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const sshSessionId = this.sessionMap.get(sessionId);
    if (!sshSessionId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const fullCommand =
      args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sshHandler.executeCommand(sshSessionId, fullCommand);
  }

  /**
   * Send input to the session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    const sshSessionId = this.sessionMap.get(sessionId);
    if (!sshSessionId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await this.sshHandler.sendInput(sshSessionId, input);
  }

  /**
   * Send a key to the session
   */
  async sendKey(sessionId: string, key: string): Promise<void> {
    const sshSessionId = this.sessionMap.get(sessionId);
    if (!sshSessionId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await this.sshHandler.sendKey(sshSessionId, key);
  }

  /**
   * Get output from the session
   */
  getOutput(sessionId: string, limit?: number): string {
    const sshSessionId = this.sessionMap.get(sessionId);
    if (!sshSessionId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const outputLines = this.sshHandler.getOutput(sshSessionId, limit);
    return outputLines.join('');
  }

  /**
   * Get session information
   */
  getSessionInfo(sessionId: string): any {
    const sshSessionId = this.sessionMap.get(sessionId);
    if (!sshSessionId) {
      return null;
    }

    const info = this.sshHandler.getSessionInfo(sshSessionId);
    return {
      ...info,
      mcpSessionId: sessionId,
      sshSessionId: sshSessionId,
    };
  }

  /**
   * List all sessions
   */
  listSessions(): any[] {
    const sessions = [];
    for (const [mcpId, sshId] of this.sessionMap.entries()) {
      const info = this.sshHandler.getSessionInfo(sshId);
      if (info) {
        sessions.push({
          sessionId: mcpId,
          sshSessionId: sshId,
          ...info,
        });
      }
    }
    return sessions;
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const sshSessionId = this.sessionMap.get(sessionId);
    if (!sshSessionId) {
      this.logger.warn(`Session ${sessionId} not found`);
      return;
    }

    await this.sshHandler.closeSession(sshSessionId);
    this.sessionMap.delete(sessionId);
    this.logger.info(`Stopped MCP session ${sessionId}`);
  }

  /**
   * Clean up all sessions
   */
  async destroy(): Promise<void> {
    this.logger.info('Destroying SSH bridge');
    await this.sshHandler.destroy();
    this.sessionMap.clear();
  }
}
