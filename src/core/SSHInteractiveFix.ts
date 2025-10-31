/**
 * Complete fix for SSH interactive mode
 * This bypasses the command queue entirely for interactive sessions
 */

import { ClientChannel } from 'ssh2';
import { Logger } from '../utils/logger.js';

export class SSHInteractiveFix {
  private static logger = new Logger('SSHInteractiveFix');
  private static interactiveSessions = new Set<string>();

  /**
   * Mark a session as interactive
   */
  static markInteractive(sessionId: string): void {
    this.interactiveSessions.add(sessionId);
    this.logger.info(`Session ${sessionId} marked as interactive`);
  }

  /**
   * Check if a session is interactive
   */
  static isInteractive(sessionId: string): boolean {
    return this.interactiveSessions.has(sessionId);
  }

  /**
   * Clear interactive state
   */
  static clearInteractive(sessionId: string): void {
    this.interactiveSessions.delete(sessionId);
    this.logger.info(`Session ${sessionId} cleared from interactive mode`);
  }

  /**
   * Send input directly to SSH channel, bypassing all queues
   */
  static async sendDirectToSSH(
    channel: ClientChannel,
    input: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`Sending direct to SSH: ${input.substring(0, 50)}...`);

      channel.write(input, (error) => {
        if (error) {
          this.logger.error('Failed to send to SSH channel:', error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Send a key sequence directly to SSH channel
   */
  static async sendKeyDirect(
    channel: ClientChannel,
    key: string
  ): Promise<void> {
    const keyMap: Record<string, string> = {
      enter: '\r',
      tab: '\t',
      escape: '\x1b',
      backspace: '\x7f',
      delete: '\x1b[3~',
      'ctrl+c': '\x03',
      'ctrl+d': '\x04',
      'ctrl+z': '\x1a',
      'ctrl+l': '\x0c',
      'ctrl+x': '\x18',
      'ctrl+o': '\x0f',
      'ctrl+s': '\x13',
      'ctrl+q': '\x11',
      'ctrl+a': '\x01',
      'ctrl+e': '\x05',
      'ctrl+k': '\x0b',
      'ctrl+u': '\x15',
      'ctrl+w': '\x17',
      'ctrl+break': '\x03',
      up: '\x1b[A',
      down: '\x1b[B',
      right: '\x1b[C',
      left: '\x1b[D',
      home: '\x1b[H',
      end: '\x1b[F',
      pageup: '\x1b[5~',
      pagedown: '\x1b[6~',
      f1: '\x1bOP',
      f2: '\x1bOQ',
      f3: '\x1bOR',
      f4: '\x1bOS',
      f5: '\x1b[15~',
      f6: '\x1b[17~',
      f7: '\x1b[18~',
      f8: '\x1b[19~',
      f9: '\x1b[20~',
      f10: '\x1b[21~',
    };

    const sequence = keyMap[key.toLowerCase()] || key;
    return this.sendDirectToSSH(channel, sequence);
  }

  /**
   * Detect interactive programs from command
   */
  static isInteractiveCommand(command: string): boolean {
    const interactivePrograms = [
      'nano',
      'vim',
      'vi',
      'emacs',
      'pico',
      'joe',
      'less',
      'more',
      'man',
      'top',
      'htop',
      'iotop',
      'iftop',
      'mysql',
      'psql',
      'sqlite3',
      'mongo',
      'redis-cli',
      'python',
      'python3',
      'node',
      'irb',
      'php -a',
      'julia',
      'ssh',
      'telnet',
      'ftp',
      'sftp',
      'screen',
      'tmux',
      'byobu',
      'gdb',
      'pdb',
      'lldb',
      'crontab -e',
      'visudo',
      'passwd',
      'su -',
      'sudo -i',
      'mc',
      'ranger',
      'nnn', // file managers
      'tig',
      'gitui', // git interfaces
      'ncdu',
      'btop',
      'glances', // system monitors
    ];

    const cmd = command.toLowerCase().trim();
    return interactivePrograms.some(
      (prog) =>
        cmd === prog ||
        cmd.startsWith(prog + ' ') ||
        cmd.includes('/' + prog + ' ') ||
        cmd.endsWith('/' + prog)
    );
  }

  /**
   * Patch ConsoleManager to handle interactive SSH properly
   */
  static patchConsoleManager(consoleManager: any): void {
    const originalSendInput = consoleManager.sendInput.bind(consoleManager);
    const originalSendKey = consoleManager.sendKey.bind(consoleManager);
    const originalExecuteCommand =
      consoleManager.executeCommand.bind(consoleManager);

    // Track when interactive commands are executed
    consoleManager.executeCommand = async function (
      sessionId: string,
      command: string,
      args?: string[]
    ): Promise<void> {
      const fullCommand =
        args && args.length > 0 ? `${command} ${args.join(' ')}` : command;

      // Check if this is an interactive command
      if (SSHInteractiveFix.isInteractiveCommand(fullCommand)) {
        SSHInteractiveFix.markInteractive(sessionId);
        SSHInteractiveFix.logger.info(
          `Executing interactive command in session ${sessionId}: ${fullCommand}`
        );
      }

      // For SSH sessions with interactive commands, send directly
      const sshChannel = this.sshChannels?.get(sessionId);
      if (sshChannel && SSHInteractiveFix.isInteractive(sessionId)) {
        SSHInteractiveFix.logger.info(
          `Sending interactive command directly to SSH channel: ${fullCommand}`
        );
        await SSHInteractiveFix.sendDirectToSSH(sshChannel, fullCommand + '\n');
        return;
      }

      return originalExecuteCommand.call(this, sessionId, command, args);
    };

    // Override sendInput for interactive sessions
    consoleManager.sendInput = async function (
      sessionId: string,
      input: string
    ): Promise<void> {
      const sshChannel = this.sshChannels?.get(sessionId);

      // If it's an SSH session and it's interactive, bypass everything
      if (sshChannel && SSHInteractiveFix.isInteractive(sessionId)) {
        SSHInteractiveFix.logger.info(
          `Sending input directly to interactive SSH session ${sessionId}`
        );
        await SSHInteractiveFix.sendDirectToSSH(sshChannel, input);
        return;
      }

      return originalSendInput.call(this, sessionId, input);
    };

    // Override sendKey for interactive sessions
    consoleManager.sendKey = async function (
      sessionId: string,
      key: string
    ): Promise<void> {
      const sshChannel = this.sshChannels?.get(sessionId);

      // If it's an SSH session and it's interactive, send key directly
      if (sshChannel && SSHInteractiveFix.isInteractive(sessionId)) {
        SSHInteractiveFix.logger.info(
          `Sending key '${key}' directly to interactive SSH session ${sessionId}`
        );
        await SSHInteractiveFix.sendKeyDirect(sshChannel, key);
        return;
      }

      return originalSendKey.call(this, sessionId, key);
    };

    // Clean up on session close
    const originalCleanupSession =
      consoleManager.cleanupSession?.bind(consoleManager);
    if (originalCleanupSession) {
      consoleManager.cleanupSession = function (sessionId: string) {
        SSHInteractiveFix.clearInteractive(sessionId);
        return originalCleanupSession.call(this, sessionId);
      };
    }

    this.logger.info('ConsoleManager patched with SSHInteractiveFix');
  }
}
