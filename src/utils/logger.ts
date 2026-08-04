import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const SENSITIVE_KEY =
  /pass(word|phrase)?|private.?key|token|secret|credential|authorization|api.?key/i;

function redactLogValue(
  value: unknown,
  key = '',
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
      /\b(?:basic|bearer)\s+[a-z0-9._~+/=-]+/i.test(value)
    ) {
      return '[REDACTED]';
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  if (depth >= 6 || seen.has(value)) return '[TRUNCATED]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, key, seen, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactLogValue(childValue, childKey, seen, depth + 1),
    ])
  );
}

const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key !== 'level') {
      info[key] = redactLogValue(info[key], key);
    }
  }

  const splat = Symbol.for('splat');
  if (Array.isArray(info[splat])) {
    info[splat] = info[splat].map((value: unknown) => redactLogValue(value));
  }
  return info;
});

export class Logger {
  private static instance: Logger;
  private logger: winston.Logger;

  constructor(context: string) {
    // Detect if we're running as an MCP server (stdio transport)
    const isMCPServer =
      process.env.MCP_SERVER_MODE === 'true' ||
      process.argv.includes('--mcp-server') ||
      this.detectStdioMCPMode();

    const transports: winston.transport[] = [];

    // CRITICAL: Never log to console/stdout/stderr in MCP mode to avoid stdio corruption
    if (!isMCPServer) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        })
      );
    }

    // MCP file logging is deliberately opt-in. Console commands and SSH
    // failures can contain sensitive values, so a stdio server must not leave
    // persistent logs merely because it was started.
    const configuredLogDir = process.env.MCP_LOG_DIR?.trim();
    if (configuredLogDir) {
      const logDir = path.resolve(configuredLogDir);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
      }

      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'mcp-error.log'),
          level: 'error',
          options: { mode: 0o600 },
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'mcp-combined.log'),
          options: { mode: 0o600 },
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        })
      );
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        redactFormat(),
        winston.format.json()
      ),
      defaultMeta: { service: 'mcp-console', context, mcpMode: isMCPServer },
      transports,
      // Never write application logs to stdout in MCP mode. Stdout belongs
      // exclusively to the JSON-RPC transport.
      silent: isMCPServer && transports.length === 0,
    });
  }

  private detectStdioMCPMode(): boolean {
    // Detect if we're likely running as an MCP server via stdio
    return process.stdin.isTTY === false && process.stdout.isTTY === false;
  }

  info(message: string, meta?: any) {
    this.logger.info(message, meta);
  }

  error(message: string, meta?: any) {
    this.logger.error(message, meta);
  }

  warn(message: string, meta?: any) {
    this.logger.warn(message, meta);
  }

  debug(message: string, meta?: any) {
    this.logger.debug(message, meta);
  }

  getWinstonLogger(): winston.Logger {
    return this.logger;
  }

  static getInstance(context: string = 'default'): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(context);
    }
    return Logger.instance;
  }
}
