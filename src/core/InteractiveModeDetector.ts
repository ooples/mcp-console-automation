/**
 * Detector for interactive terminal programs that require direct input
 */
export class InteractiveModeDetector {
  // Common interactive programs that need direct input
  private static readonly INTERACTIVE_PROGRAMS = [
    'nano',
    'vim',
    'vi',
    'emacs',
    'pico',
    'joe',
    'jed',
    'less',
    'more',
    'man',
    'top',
    'htop',
    'iotop',
    'iftop',
    'nethogs',
    'mysql',
    'psql',
    'sqlite3',
    'mongo',
    'python',
    'python3',
    'node',
    'irb',
    'php -a',
    'ssh',
    'telnet',
    'ftp',
    'sftp',
    'screen',
    'tmux',
    'gdb',
    'pdb',
    'lldb',
    'crontab -e',
    'visudo',
    'apt-get install',
    'yum install',
    'pacman',
    'passwd',
    'su',
    'sudo -S',
  ];

  // Terminal control sequences that indicate interactive mode
  private static readonly INTERACTIVE_SEQUENCES = [
    /\x1b\[2J/, // Clear screen
    /\x1b\[H/, // Move cursor home
    /\x1b\[\d+;\d+H/, // Move cursor to position
    /\x1b\[\?1049h/, // Alternative screen buffer (used by vim, less, etc)
    /\x1b\[6n/, // Request cursor position
    /\x1b\[\d+m/, // Set graphics mode
  ];

  private interactiveSessions: Set<string> = new Set();
  private sessionCommands: Map<string, string> = new Map();

  /**
   * Check if a command will launch an interactive program
   */
  isInteractiveCommand(command: string): boolean {
    const cmdLower = command.toLowerCase().trim();

    // Check for exact matches or command starts with interactive program
    return InteractiveModeDetector.INTERACTIVE_PROGRAMS.some((prog) => {
      return (
        cmdLower === prog ||
        cmdLower.startsWith(prog + ' ') ||
        cmdLower.includes('/' + prog + ' ') ||
        cmdLower.endsWith('/' + prog)
      );
    });
  }

  /**
   * Detect interactive mode from output
   */
  detectInteractiveMode(sessionId: string, output: string): boolean {
    // Check for terminal control sequences
    const hasControlSequences =
      InteractiveModeDetector.INTERACTIVE_SEQUENCES.some((pattern) =>
        pattern.test(output)
      );

    if (hasControlSequences) {
      this.interactiveSessions.add(sessionId);
      return true;
    }

    // Check for common interactive prompts
    const interactivePrompts = [
      /\(END\)$/, // less/more
      /^:/, // vi command mode
      /\[yes\/no\]/i, // confirmation prompts
      /password:/i, // password prompts
      /\(y\/n\)/i, // yes/no prompts
      /Press any key/i, // pause prompts
      /\x1b\[\d+;\d+r/, // Set scrolling region (used by editors)
    ];

    const hasInteractivePrompt = interactivePrompts.some((pattern) =>
      pattern.test(output)
    );

    if (hasInteractivePrompt) {
      this.interactiveSessions.add(sessionId);
      return true;
    }

    return false;
  }

  /**
   * Track command for session
   */
  trackCommand(sessionId: string, command: string): void {
    this.sessionCommands.set(sessionId, command);

    // If it's an interactive command, mark session as interactive
    if (this.isInteractiveCommand(command)) {
      this.interactiveSessions.add(sessionId);
    }
  }

  /**
   * Check if session is currently in interactive mode
   */
  isInteractive(sessionId: string): boolean {
    return this.interactiveSessions.has(sessionId);
  }

  /**
   * Clear interactive mode for session (e.g., when program exits)
   */
  clearInteractiveMode(sessionId: string): void {
    this.interactiveSessions.delete(sessionId);
    this.sessionCommands.delete(sessionId);
  }

  /**
   * Detect when interactive program has exited
   */
  detectInteractiveExit(sessionId: string, output: string): boolean {
    // Common patterns that indicate return to shell prompt
    const exitPatterns = [
      /\$ $/, // Bash prompt
      /# $/, // Root prompt
      /> $/, // Generic prompt
      /\x1b\[\?1049l/, // Exit alternative screen buffer
      /logout|exit|bye/i, // Exit commands
      /Process exited/i,
    ];

    const hasExited = exitPatterns.some((pattern) => pattern.test(output));

    if (hasExited && this.interactiveSessions.has(sessionId)) {
      this.interactiveSessions.delete(sessionId);
      return true;
    }

    return false;
  }

  /**
   * Get interactive status for all sessions
   */
  getInteractiveSessions(): string[] {
    return Array.from(this.interactiveSessions);
  }
}
