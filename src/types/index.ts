export type ConsoleType = 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'zsh' | 'sh' | 'auto';

export interface ConsoleSession {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  createdAt: Date;
  pid?: number;
  status: 'running' | 'stopped' | 'crashed';
  exitCode?: number;
  type?: ConsoleType;
  streaming?: boolean;
}

export interface ConsoleOutput {
  sessionId: string;
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
  raw?: string;
}

export interface ErrorPattern {
  pattern: RegExp;
  type: 'error' | 'warning' | 'exception';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ConsoleEvent {
  sessionId: string;
  type: 'started' | 'stopped' | 'error' | 'input' | 'output';
  timestamp: Date;
  data?: any;
}

export interface SessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  rows?: number;
  cols?: number;
  detectErrors?: boolean;
  patterns?: ErrorPattern[];
  timeout?: number;
  shell?: boolean | string;
  consoleType?: ConsoleType;
  streaming?: boolean;
  maxBuffer?: number;
}