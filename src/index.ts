#!/usr/bin/env node

/**
 * Main entry point for the MCP Console Automation Server
 * 
 * This file initializes the comprehensive protocol system, registers all available
 * protocols, and starts the MCP server with full monitoring and health checking.
 */

import { ConsoleAutomationServer } from './mcp/server.js';
import { ConsoleManager } from './core/ConsoleManager.js';
import { protocolFactory } from './core/ProtocolFactory.js';
import { Logger } from './utils/logger.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { platform } from 'os';

// Create ConsoleManager instance
const consoleManager = new ConsoleManager();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('log-level', {
    type: 'string',
    description: 'Set the logging level',
    default: 'info',
    choices: ['error', 'warn', 'info', 'debug']
  })
  .option('enable-protocols', {
    type: 'array',
    description: 'Enable specific protocols (defaults to all available)',
    default: []
  })
  .option('disable-protocols', {
    type: 'array',
    description: 'Disable specific protocols',
    default: []
  })
  .option('health-check-interval', {
    type: 'number',
    description: 'Health check interval in seconds',
    default: 60
  })
  .option('max-sessions', {
    type: 'number',
    description: 'Maximum concurrent sessions',
    default: 100
  })
  .option('enable-monitoring', {
    type: 'boolean',
    description: 'Enable comprehensive monitoring',
    default: true
  })
  .help()
  .parseSync();

// Set environment variables
process.env.LOG_LEVEL = argv['log-level'];

// Initialize logger
const logger = Logger.getInstance();

/**
 * Register all available protocols with platform-specific configurations
 */
async function registerProtocols(): Promise<void> {
  logger.info('Registering console protocols...');
  
  const currentPlatform = platform();
  
  // Protocol configurations based on platform and availability
  const protocolConfigs = {
    // Local shell protocols - always available
    'local': {
      enabled: true,
      maxSessions: 20,
      defaultTimeout: 30000,
      retryAttempts: 3,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
    
    // Remote access protocols
    'ssh': {
      enabled: !argv['disable-protocols'].includes('ssh'),
      maxSessions: 30,
      defaultTimeout: 60000,
      retryAttempts: 5,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        keepAliveInterval: 30000,
        compression: true,
      },
    },
    
    'telnet': {
      enabled: !argv['disable-protocols'].includes('telnet'),
      maxSessions: 10,
      defaultTimeout: 30000,
      retryAttempts: 3,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
    
    // Container protocols
    'docker': {
      enabled: !argv['disable-protocols'].includes('docker'),
      maxSessions: 50,
      defaultTimeout: 45000,
      retryAttempts: 3,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        attachStdout: true,
        attachStderr: true,
        attachStdin: true,
      },
    },
    
    'kubernetes': {
      enabled: !argv['disable-protocols'].includes('kubernetes'),
      maxSessions: 40,
      defaultTimeout: 60000,
      retryAttempts: 3,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        namespace: 'default',
      },
    },
    
    // Cloud protocols
    'azure-shell': {
      enabled: !argv['disable-protocols'].includes('azure-shell'),
      maxSessions: 15,
      defaultTimeout: 90000,
      retryAttempts: 3,
      healthCheckInterval: 120000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
    
    'gcp-shell': {
      enabled: !argv['disable-protocols'].includes('gcp-shell'),
      maxSessions: 15,
      defaultTimeout: 90000,
      retryAttempts: 3,
      healthCheckInterval: 120000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
    
    'aws-ssm': {
      enabled: !argv['disable-protocols'].includes('aws-ssm'),
      maxSessions: 20,
      defaultTimeout: 90000,
      retryAttempts: 3,
      healthCheckInterval: 120000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
    
    // Virtualization protocols
    'wsl': {
      enabled: currentPlatform === 'win32' && !argv['disable-protocols'].includes('wsl'),
      maxSessions: 25,
      defaultTimeout: 45000,
      retryAttempts: 3,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
    
    // Hardware protocols
    'serial': {
      enabled: !argv['disable-protocols'].includes('serial'),
      maxSessions: 5,
      defaultTimeout: 30000,
      retryAttempts: 5,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      },
    },
    
    // Remote desktop protocols
    'rdp': {
      enabled: !argv['disable-protocols'].includes('rdp'),
      maxSessions: 10,
      defaultTimeout: 60000,
      retryAttempts: 3,
      healthCheckInterval: 120000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        width: 1024,
        height: 768,
        colorDepth: 16,
      },
    },
    
    'vnc': {
      enabled: !argv['disable-protocols'].includes('vnc'),
      maxSessions: 10,
      defaultTimeout: 60000,
      retryAttempts: 3,
      healthCheckInterval: 120000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
    
    // Windows remote management
    'winrm': {
      enabled: !argv['disable-protocols'].includes('winrm'),
      maxSessions: 15,
      defaultTimeout: 60000,
      retryAttempts: 3,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        port: 5985,
        useSSL: false,
      },
    },
    
    // Network terminal protocols
    'websocket-term': {
      enabled: !argv['disable-protocols'].includes('websocket-term'),
      maxSessions: 25,
      defaultTimeout: 30000,
      retryAttempts: 3,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
    
    // Hardware management protocols
    'ipmi': {
      enabled: !argv['disable-protocols'].includes('ipmi'),
      maxSessions: 25,
      defaultTimeout: 120000, // 2 minutes for IPMI operations
      retryAttempts: 5,
      healthCheckInterval: 90000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        defaultPort: 623,
        defaultInterface: 'lan',
        defaultCipherSuite: 17,
        defaultPrivilegeLevel: 'admin',
        enableSOL: true,
        enableSensorMonitoring: true,
        enableEventLog: true,
        sensorPollingInterval: 30000,
        eventLogPollingInterval: 60000,
      },
    },
    
    'bmc': {
      enabled: !argv['disable-protocols'].includes('bmc'),
      maxSessions: 20,
      defaultTimeout: 90000,
      retryAttempts: 4,
      healthCheckInterval: 90000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        defaultPort: 623,
        defaultInterface: 'lan',
        enableVirtualMedia: true,
        enableFirmwareUpdate: true,
      },
    },
    
    'idrac': {
      enabled: !argv['disable-protocols'].includes('idrac'),
      maxSessions: 15,
      defaultTimeout: 150000, // 2.5 minutes for Dell iDRAC operations
      retryAttempts: 4,
      healthCheckInterval: 120000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {
        defaultPort: 623,
        defaultInterface: 'lan',
        enableDellExtensions: true,
        enableVirtualConsole: true,
        enableVirtualMedia: true,
        enableLCLogging: true,
      },
    },
    
    // Automation protocols
    'ansible': {
      enabled: !argv['disable-protocols'].includes('ansible'),
      maxSessions: 10,
      defaultTimeout: 300000, // 5 minutes for long-running playbooks
      retryAttempts: 2,
      healthCheckInterval: 120000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    },
  };
  
  // Register each protocol
  let registeredCount = 0;
  let enabledCount = 0;
  
  for (const [protocolType, config] of Object.entries(protocolConfigs)) {
    try {
      // Update protocol configuration
      protocolFactory.updateProtocolConfig(protocolType as any, config);
      registeredCount++;
      
      if (config.enabled) {
        enabledCount++;
        logger.debug(`Protocol registered and enabled: ${protocolType}`);
      } else {
        logger.debug(`Protocol registered but disabled: ${protocolType}`);
      }
      
    } catch (error) {
      logger.warn(`Failed to register protocol ${protocolType}: ${error}`);
    }
  }
  
  logger.info(`Protocol registration complete: ${registeredCount} registered, ${enabledCount} enabled`);
}

/**
 * Perform system health check and report status
 */
async function performSystemHealthCheck(): Promise<void> {
  try {
    logger.info('Performing initial system health check...');
    
    const healthStatus = await consoleManager.getHealthStatus();
    
    logger.info(`System health status: ${healthStatus.systemHealth ? 'healthy' : 'unknown'}`);
    logger.info(`Active sessions: ${healthStatus.sessionHealth.size}`);
    logger.info(`Active connections: ${healthStatus.connectionHealth.size}`);
    
    if (healthStatus.systemHealth && typeof healthStatus.systemHealth === 'object') {
      logger.info(`System metrics available: ${!!healthStatus.metrics}`);
      logger.info(`Healing stats: ${JSON.stringify(healthStatus.healingStats)}`);
    }
    
  } catch (error) {
    logger.error('Health check failed:', error);
  }
}

/**
 * Setup graceful shutdown handling
 */
function setupGracefulShutdown(): void {
  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);
    
    try {
      // Stop accepting new connections
      logger.info('Stopping server...');
      
      // Dispose of console manager and all sessions
      await consoleManager.destroy();
      
      logger.info('Graceful shutdown complete');
      process.exit(0);
      
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };
  
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    gracefulShutdown('uncaughtException').catch(() => process.exit(1));
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { promise, reason });
    gracefulShutdown('unhandledRejection').catch(() => process.exit(1));
  });
}

/**
 * Main application startup
 */
async function main(): Promise<void> {
  try {
    logger.info('Starting MCP Console Automation Server...');
    logger.info(`Platform: ${platform()}`);
    logger.info(`Node.js version: ${process.version}`);
    logger.info(`Log level: ${process.env.LOG_LEVEL}`);
    
    // Setup graceful shutdown
    setupGracefulShutdown();
    
    // Register all protocols
    await registerProtocols();
    
    // Initialize console manager
    logger.info('Console manager ready...');
    
    // Create and start MCP server
    logger.info('Starting MCP server...');
    const server = new ConsoleAutomationServer();
    await server.start();
    
    // Perform initial health check
    await performSystemHealthCheck();
    
    // Setup periodic health checks if monitoring is enabled
    if (argv['enable-monitoring']) {
      setInterval(async () => {
        await performSystemHealthCheck();
      }, (argv['health-check-interval'] as number) * 1000);
    }
    
    logger.info('MCP Console Automation Server started successfully');
    logger.info(`Max concurrent sessions: ${argv['max-sessions']}`);
    logger.info(`Health check interval: ${argv['health-check-interval']}s`);
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});