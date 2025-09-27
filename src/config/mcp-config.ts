export interface MCPConfig {
  maxSessions: number;
  sessionCleanupInterval: number;
  sessionTimeout: number;
  enableAutoCleanup: boolean;
}

// Load configuration from environment variables or use defaults
export const getMCPConfig = (): MCPConfig => {
  return {
    maxSessions: parseInt(process.env.MCP_MAX_SESSIONS || '100', 10),
    sessionCleanupInterval: parseInt(process.env.MCP_CLEANUP_INTERVAL || '300000', 10), // 5 minutes
    sessionTimeout: parseInt(process.env.MCP_SESSION_TIMEOUT || '3600000', 10), // 1 hour
    enableAutoCleanup: process.env.MCP_AUTO_CLEANUP !== 'false'
  };
};

export const config = getMCPConfig();