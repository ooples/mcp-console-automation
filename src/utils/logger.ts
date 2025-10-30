import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

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

    // Always use file logging for MCP servers
    if (isMCPServer || process.env.NODE_ENV === 'production') {
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'mcp-error.log'),
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'mcp-combined.log'),
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
        winston.format.json()
      ),
      defaultMeta: { service: 'mcp-console', context, mcpMode: isMCPServer },
      transports,
      // CRITICAL: Prevent any console output in MCP mode
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
