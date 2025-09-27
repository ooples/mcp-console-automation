/**
 * Patch for ConsoleManager to fix interactive program support
 * This modifies the sendInput behavior for SSH sessions
 */

import { InteractiveModeDetector } from './InteractiveModeDetector.js';

export class ConsoleManagerInteractivePatch {
  private interactiveDetector: InteractiveModeDetector;

  constructor() {
    this.interactiveDetector = new InteractiveModeDetector();
  }

  /**
   * Enhanced sendInput that handles interactive programs correctly
   * This should replace the existing sendInput method in ConsoleManager
   */
  async sendInputEnhanced(
    sessionId: string,
    input: string,
    session: any,
    sshChannel: any,
    addCommandToQueue: (sessionId: string, input: string) => Promise<void>,
    logger: any
  ): Promise<void> {
    // Check if this is an interactive command or session
    const isInteractiveCommand = this.interactiveDetector.isInteractiveCommand(input);
    const isInteractiveSession = this.interactiveDetector.isInteractive(sessionId);
    
    logger.debug(`Session ${sessionId} - Interactive command: ${isInteractiveCommand}, Interactive session: ${isInteractiveSession}`);

    // Track the command
    this.interactiveDetector.trackCommand(sessionId, input);

    // For SSH sessions
    if (sshChannel) {
      // If in interactive mode or executing an interactive command, send directly
      if (isInteractiveSession || isInteractiveCommand) {
        logger.debug(`Sending input directly to interactive SSH session ${sessionId}`);
        
        return new Promise<void>((resolve, reject) => {
          // Send input directly to SSH channel without queuing
          const writeCallback = (error?: Error) => {
            if (error) {
              logger.error(`Failed to send input to SSH session ${sessionId}:`, error);
              reject(error);
            } else {
              logger.debug(`Input sent successfully to interactive SSH session ${sessionId}`);
              resolve();
            }
          };

          // Write the input directly to the SSH stream
          // For interactive programs, we usually don't add \n automatically
          // as they handle their own input processing
          if (isInteractiveSession && !input.endsWith('\n') && !input.endsWith('\r')) {
            // For most interactive programs, we still need to send Enter
            // but some special keys should be sent as-is
            const specialKeys = ['\x03', '\x04', '\x1b', '\t']; // Ctrl-C, Ctrl-D, ESC, TAB
            if (!specialKeys.some(key => input.includes(key))) {
              sshChannel.write(input + '\n', writeCallback);
            } else {
              sshChannel.write(input, writeCallback);
            }
          } else {
            sshChannel.write(input, writeCallback);
          }
        });
      } else {
        // Use the existing command queue for non-interactive commands
        logger.debug(`Using command queue for non-interactive SSH session ${sessionId}`);
        return addCommandToQueue(sessionId, input);
      }
    }

    // For non-SSH sessions, throw error (caller should handle other session types)
    throw new Error(`Session ${sessionId} is not an SSH session`);
  }

  /**
   * Process output to detect interactive mode transitions
   */
  processOutput(sessionId: string, output: string): void {
    // Detect if we've entered interactive mode
    if (this.interactiveDetector.detectInteractiveMode(sessionId, output)) {
      console.log(`Session ${sessionId} entered interactive mode`);
    }

    // Detect if we've exited interactive mode
    if (this.interactiveDetector.detectInteractiveExit(sessionId, output)) {
      console.log(`Session ${sessionId} exited interactive mode`);
    }
  }

  /**
   * Clean up when session ends
   */
  cleanupSession(sessionId: string): void {
    this.interactiveDetector.clearInteractiveMode(sessionId);
  }

  /**
   * Get the interactive detector instance
   */
  getDetector(): InteractiveModeDetector {
    return this.interactiveDetector;
  }
}

/**
 * Function to patch the existing ConsoleManager
 * This should be called during initialization
 */
export function patchConsoleManagerForInteractive(consoleManager: any): void {
  const patch = new ConsoleManagerInteractivePatch();
  const originalSendInput = consoleManager.sendInput.bind(consoleManager);
  const originalCleanup = consoleManager.cleanupSession.bind(consoleManager);

  // Replace sendInput method
  consoleManager.sendInput = async function(sessionId: string, input: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const sshChannel = this.sshChannels.get(sessionId);
    
    if (sshChannel) {
      try {
        // Use the enhanced input handler for SSH sessions
        return await patch.sendInputEnhanced(
          sessionId,
          input,
          session,
          sshChannel,
          this.addCommandToQueue.bind(this),
          this.logger
        );
      } catch (error) {
        // Fall back to original behavior if patch fails
        this.logger.warn(`Interactive patch failed, using original sendInput:`, error);
        return originalSendInput(sessionId, input);
      }
    }
    
    // Use original implementation for non-SSH sessions
    return originalSendInput(sessionId, input);
  };

  // Hook into output processing
  const originalAddToBuffer = consoleManager.addToBuffer?.bind(consoleManager);
  if (originalAddToBuffer) {
    consoleManager.addToBuffer = function(sessionId: string, output: any) {
      // Process output for interactive mode detection
      if (output && output.data) {
        patch.processOutput(sessionId, output.data);
      }
      return originalAddToBuffer(sessionId, output);
    };
  }

  // Hook into cleanup
  consoleManager.cleanupSession = function(sessionId: string) {
    patch.cleanupSession(sessionId);
    return originalCleanup(sessionId);
  };

  // Add method to check interactive status
  consoleManager.isInteractiveSession = function(sessionId: string): boolean {
    return patch.getDetector().isInteractive(sessionId);
  };

  console.log('ConsoleManager patched for interactive program support');
}