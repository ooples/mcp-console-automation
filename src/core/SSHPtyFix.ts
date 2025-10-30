/**
 * Fix for SSH PTY allocation to support interactive programs
 */

import { Client as SSHClient, ClientChannel } from 'ssh2';
import { Logger } from '../utils/logger.js';

export interface PTYOptions {
  term?: string;
  cols?: number;
  rows?: number;
  height?: number;
  width?: number;
  modes?: any;
}

/**
 * Create an SSH channel with proper PTY allocation
 */
export async function createSSHChannelWithPTY(
  client: SSHClient,
  sessionId: string,
  ptyOptions?: PTYOptions
): Promise<ClientChannel> {
  const logger = new Logger('SSHPtyFix');

  return new Promise((resolve, reject) => {
    // Default PTY options for interactive terminal
    const defaultPtyOptions = {
      term: process.env.TERM || 'xterm-256color',
      cols: 80,
      rows: 24,
      height: 480,
      width: 640,
      modes: {
        ECHO: 1,
        ICANON: 1,
        IEXTEN: 1,
        ISIG: 1,
        IUTF8: 1,
      },
    };

    const finalOptions = { ...defaultPtyOptions, ...ptyOptions };

    logger.debug(
      `Creating SSH channel with PTY for session ${sessionId}`,
      finalOptions
    );

    // Request a shell with PTY
    client.shell(
      {
        term: finalOptions.term,
        cols: finalOptions.cols,
        rows: finalOptions.rows,
        height: finalOptions.height,
        width: finalOptions.width,
        modes: finalOptions.modes,
      },
      (error, channel) => {
        if (error) {
          logger.error(
            `Failed to create SSH channel with PTY for session ${sessionId}:`,
            error
          );
          reject(error);
          return;
        }

        logger.debug(
          `SSH channel with PTY created successfully for session ${sessionId}`
        );

        // Set encoding
        channel.setEncoding('utf8');

        // Handle window resize if needed
        channel.on('request', (accept, reject, info) => {
          if (info === 'window-change') {
            accept();
          }
        });

        resolve(channel);
      }
    );
  });
}

/**
 * Send input to an SSH channel handling special keys properly
 */
export async function sendToSSHChannel(
  channel: ClientChannel,
  input: string,
  isInteractive: boolean = false
): Promise<void> {
  const logger = new Logger('SSHPtyFix');

  return new Promise((resolve, reject) => {
    try {
      // Special key mappings for interactive programs
      const keyMappings: Record<string, string> = {
        'ctrl+c': '\x03',
        'ctrl+d': '\x04',
        'ctrl+z': '\x1a',
        'ctrl+l': '\x0c',
        escape: '\x1b',
        tab: '\t',
        enter: '\r\n',
        backspace: '\x7f',
        delete: '\x1b[3~',
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
      };

      // Check if input is a special key
      let dataToSend = input;
      const lowerInput = input.toLowerCase().trim();

      if (keyMappings[lowerInput]) {
        dataToSend = keyMappings[lowerInput];
        logger.debug(
          `Sending special key: ${lowerInput} -> ${dataToSend.charCodeAt(0)}`
        );
      } else if (isInteractive) {
        // For interactive mode, send character by character if it's a single char
        // This helps with programs like vim that process individual keystrokes
        if (input.length === 1) {
          dataToSend = input;
        } else if (!input.endsWith('\n') && !input.endsWith('\r')) {
          // Add newline for multi-character input in interactive mode
          dataToSend = input + '\r\n';
        }
      } else {
        // Non-interactive mode - ensure commands end with newline
        if (!input.endsWith('\n') && !input.endsWith('\r')) {
          dataToSend = input + '\n';
        }
      }

      // Write to channel
      channel.write(dataToSend, (error) => {
        if (error) {
          logger.error(`Failed to send input to SSH channel:`, error);
          reject(error);
        } else {
          logger.debug(`Input sent successfully: ${input.substring(0, 20)}...`);
          resolve();
        }
      });
    } catch (error) {
      logger.error(`Error sending to SSH channel:`, error);
      reject(error);
    }
  });
}

/**
 * Patch the ConsoleManager's createSSHChannel method
 */
export function patchCreateSSHChannel(consoleManager: any): void {
  const logger = new Logger('SSHPtyFix');

  // Replace the createSSHChannel method
  consoleManager.createSSHChannel = async function (
    client: SSHClient,
    sessionId: string
  ): Promise<ClientChannel> {
    logger.info(`Patched createSSHChannel called for session ${sessionId}`);
    return createSSHChannelWithPTY(client, sessionId);
  };

  logger.info('ConsoleManager.createSSHChannel patched for PTY support');
}

/**
 * Check if a command requires interactive mode
 */
export function isInteractiveCommand(command: string): boolean {
  const interactiveCommands = [
    'nano',
    'vim',
    'vi',
    'emacs',
    'pico',
    'less',
    'more',
    'man',
    'top',
    'htop',
    'iotop',
    'ssh',
    'telnet',
    'ftp',
    'python',
    'node',
    'irb',
    'mysql',
    'psql',
    'mongo',
  ];

  const cmdLower = command.toLowerCase().trim();
  return interactiveCommands.some(
    (cmd) =>
      cmdLower === cmd ||
      cmdLower.startsWith(cmd + ' ') ||
      cmdLower.includes('/' + cmd + ' ') ||
      cmdLower.endsWith('/' + cmd)
  );
}
