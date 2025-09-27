import { ConsoleManager } from './ConsoleManager.js';
import { SessionOptions } from '../types/index.js';

export interface SessionInfo {
  id: string;
  consoleType: string;
  running: boolean;
  startTime: Date;
  pid?: number;
  command?: string;
  status?: string;
  createdAt: Date;
}

export class ConsoleSessionManager {
  private consoleManager: ConsoleManager;
  private sessions: Map<string, SessionInfo> = new Map();

  constructor() {
    this.consoleManager = new ConsoleManager();
  }

  async createSession(options: SessionOptions): Promise<string> {
    const sessionId = await this.consoleManager.createSession(options);
    
    this.sessions.set(sessionId, {
      id: sessionId,
      consoleType: options.consoleType || 'auto',
      running: true,
      startTime: new Date(),
      createdAt: new Date(),
      command: options.command,
      status: 'active'
    });

    return sessionId;
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.consoleManager.stopSession(sessionId);
    
    const session = this.sessions.get(sessionId);
    if (session) {
      session.running = false;
      session.status = 'stopped';
    }
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  cleanupStoppedSessions(): void {
    const stoppedSessions = Array.from(this.sessions.entries())
      .filter(([_, info]) => !info.running);
    
    stoppedSessions.forEach(([id, _]) => {
      this.sessions.delete(id);
    });
  }

  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter(session => session.running);
  }
}