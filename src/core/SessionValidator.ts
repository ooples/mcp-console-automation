import { ConsoleSession } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { ChildProcess } from 'child_process';

/**
 * SessionValidator ensures sessions are properly initialized and ready for use
 * This fixes the "session not found" and "stream destroyed" issues
 */
export class SessionValidator {
  private logger: Logger;
  private sessionReadyMap: Map<string, Promise<boolean>> = new Map();
  private sessionHealthMap: Map<
    string,
    { lastChecked: Date; healthy: boolean }
  > = new Map();
  private readonly HEALTH_CHECK_INTERVAL = 1000; // 1 second

  constructor() {
    this.logger = new Logger('SessionValidator');
  }

  /**
   * Validate that a session is ready for operations
   */
  async validateSessionReady(
    sessionId: string,
    session: ConsoleSession,
    process?: ChildProcess
  ): Promise<boolean> {
    // Check if we're already validating this session
    const existingValidation = this.sessionReadyMap.get(sessionId);
    if (existingValidation) {
      return existingValidation;
    }

    // Create validation promise
    const validationPromise = this.performValidation(
      sessionId,
      session,
      process
    );
    this.sessionReadyMap.set(sessionId, validationPromise);

    try {
      const result = await validationPromise;
      return result;
    } finally {
      // Clean up after validation
      this.sessionReadyMap.delete(sessionId);
    }
  }

  private async performValidation(
    sessionId: string,
    session: ConsoleSession,
    process?: ChildProcess
  ): Promise<boolean> {
    this.logger.debug(`Validating session ${sessionId}`);

    // Check basic session properties
    if (
      !session ||
      session.status === 'stopped' ||
      session.status === 'crashed'
    ) {
      this.logger.warn(
        `Session ${sessionId} is not in a valid state: ${session?.status}`
      );
      return false;
    }

    // For local processes, check if the process is still alive
    if (process) {
      if (process.killed || process.exitCode !== null) {
        this.logger.warn(`Session ${sessionId} process has terminated`);
        return false;
      }

      // Check if stdio streams are available
      if (!process.stdin || process.stdin.destroyed) {
        this.logger.warn(`Session ${sessionId} stdin is not available`);
        return false;
      }

      // Wait a bit for the process to initialize
      if (this.isNewSession(session)) {
        await this.waitForInitialization(sessionId, process);
      }
    }

    // Mark session as healthy
    this.sessionHealthMap.set(sessionId, {
      lastChecked: new Date(),
      healthy: true,
    });

    this.logger.debug(`Session ${sessionId} validation successful`);
    return true;
  }

  private isNewSession(session: ConsoleSession): boolean {
    const age = Date.now() - session.createdAt.getTime();
    return age < 5000; // Less than 5 seconds old
  }

  private async waitForInitialization(
    sessionId: string,
    process: ChildProcess
  ): Promise<void> {
    this.logger.debug(`Waiting for session ${sessionId} to initialize...`);

    return new Promise((resolve) => {
      let initialized = false;
      const timeout = setTimeout(() => {
        if (!initialized) {
          this.logger.debug(`Session ${sessionId} initialization timeout`);
        }
        resolve();
      }, 2000); // Wait max 2 seconds

      // Listen for initial output as sign of readiness
      const onData = () => {
        if (!initialized) {
          initialized = true;
          clearTimeout(timeout);
          this.logger.debug(`Session ${sessionId} initialized`);
          resolve();
        }
      };

      if (process.stdout) {
        process.stdout.once('data', onData);
      }
      if (process.stderr) {
        process.stderr.once('data', onData);
      }
    });
  }

  /**
   * Check if a session is healthy (cached check)
   */
  isSessionHealthy(sessionId: string): boolean {
    const health = this.sessionHealthMap.get(sessionId);
    if (!health) {
      return false;
    }

    // Check if health check is recent
    const age = Date.now() - health.lastChecked.getTime();
    if (age > this.HEALTH_CHECK_INTERVAL) {
      // Health check is stale
      return false;
    }

    return health.healthy;
  }

  /**
   * Mark a session as unhealthy
   */
  markSessionUnhealthy(sessionId: string): void {
    this.sessionHealthMap.set(sessionId, {
      lastChecked: new Date(),
      healthy: false,
    });
    this.logger.warn(`Session ${sessionId} marked as unhealthy`);
  }

  /**
   * Clean up session validation data
   */
  cleanupSession(sessionId: string): void {
    this.sessionReadyMap.delete(sessionId);
    this.sessionHealthMap.delete(sessionId);
  }

  /**
   * Get validation statistics
   */
  getValidationStats(): {
    totalSessions: number;
    healthySessions: number;
    unhealthySessions: number;
    pendingValidations: number;
  } {
    const healthy = Array.from(this.sessionHealthMap.values()).filter(
      (h) => h.healthy
    ).length;
    const unhealthy = this.sessionHealthMap.size - healthy;

    return {
      totalSessions: this.sessionHealthMap.size,
      healthySessions: healthy,
      unhealthySessions: unhealthy,
      pendingValidations: this.sessionReadyMap.size,
    };
  }
}
