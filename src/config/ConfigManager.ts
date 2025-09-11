import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Logger } from '../utils/logger.js';
import { SSHConnectionOptions } from '../types/index.js';

/**
 * Configuration Manager for persistent settings
 * Handles loading and saving of connection profiles and application settings
 */
export interface ConnectionProfile {
  name: string;
  type: 'ssh' | 'wsl' | 'docker' | 'azure' | 'aws' | 'gcp' | 'kubernetes';
  sshOptions?: SSHConnectionOptions;
  dockerOptions?: {
    containerName?: string;
    imageName?: string;
  };
  azureOptions?: {
    subscriptionId?: string;
    resourceGroup?: string;
    vmName?: string;
  };
  awsOptions?: {
    region?: string;
    instanceId?: string;
    profile?: string;
  };
  gcpOptions?: {
    project?: string;
    zone?: string;
    instance?: string;
  };
  kubernetesOptions?: {
    context?: string;
    namespace?: string;
    pod?: string;
    container?: string;
  };
  isDefault?: boolean;
}

export interface DotNetOptions {
  enabled: boolean;
  sdkPath?: string;
  defaultFramework?: 'net6.0' | 'net7.0' | 'net8.0' | 'net9.0' | 'netcoreapp3.1';
  buildConfiguration?: 'Debug' | 'Release';
  enableHotReload?: boolean;
  environmentVariables?: Record<string, string>;
}

export interface ApplicationProfile {
  name: string;
  type: 'node' | 'python' | 'dotnet' | 'java' | 'go' | 'rust' | 'custom';
  command?: string;
  args?: string[];
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  dotnetOptions?: DotNetOptions;
}

export interface MCPConfig {
  connectionProfiles: ConnectionProfile[];
  applicationProfiles: ApplicationProfile[];
  defaultConnectionProfile?: string;
  settings: {
    autoReconnect: boolean;
    keepAliveInterval: number;
    commandTimeout: number;
    maxRetries: number;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    enableMetrics: boolean;
    enableHealthChecks: boolean;
  };
  dotnet: DotNetOptions;
}

export class ConfigManager {
  private static instance: ConfigManager;
  private config: MCPConfig;
  private configPath: string;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('ConfigManager');
    this.configPath = this.getConfigPath();
    this.config = this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private getConfigPath(): string {
    const configDir = join(homedir(), '.mcp-console-automation');
    const configFile = join(configDir, 'config.json');

    // Create directory if it doesn't exist
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
      this.logger.info(`Created config directory: ${configDir}`);
    }

    return configFile;
  }

  private getDefaultConfig(): MCPConfig {
    return {
      connectionProfiles: [],
      applicationProfiles: [
        {
          name: 'node-default',
          type: 'node',
          command: 'node',
          args: []
        },
        {
          name: 'python-default',
          type: 'python',
          command: 'python',
          args: []
        },
        {
          name: 'dotnet-default',
          type: 'dotnet',
          command: 'dotnet',
          args: ['run'],
          dotnetOptions: {
            enabled: true,
            defaultFramework: 'net8.0',
            buildConfiguration: 'Debug',
            enableHotReload: true
          }
        }
      ],
      settings: {
        autoReconnect: true,
        keepAliveInterval: 30000,
        commandTimeout: 30000,
        maxRetries: 3,
        logLevel: 'info',
        enableMetrics: true,
        enableHealthChecks: true
      },
      dotnet: {
        enabled: true,
        defaultFramework: 'net8.0',
        buildConfiguration: 'Debug',
        enableHotReload: true,
        environmentVariables: {
          'DOTNET_CLI_TELEMETRY_OPTOUT': '1',
          'DOTNET_NOLOGO': 'true'
        }
      }
    };
  }

  private loadConfig(): MCPConfig {
    try {
      if (existsSync(this.configPath)) {
        const configData = readFileSync(this.configPath, 'utf-8');
        const loadedConfig = JSON.parse(configData) as MCPConfig;
        
        // Merge with defaults to ensure all fields exist
        const defaultConfig = this.getDefaultConfig();
        return {
          ...defaultConfig,
          ...loadedConfig,
          settings: { ...defaultConfig.settings, ...loadedConfig.settings },
          dotnet: { ...defaultConfig.dotnet, ...loadedConfig.dotnet }
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to load config from ${this.configPath}: ${error}`);
    }

    // Return default config if file doesn't exist or failed to load
    const defaultConfig = this.getDefaultConfig();
    this.saveConfig(defaultConfig);
    return defaultConfig;
  }

  private saveConfig(config?: MCPConfig): void {
    try {
      const configToSave = config || this.config;
      writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2));
      this.logger.debug(`Config saved to ${this.configPath}`);
    } catch (error) {
      this.logger.error(`Failed to save config: ${error}`);
    }
  }

  // Connection Profile Management
  public addConnectionProfile(profile: ConnectionProfile): void {
    // Check if profile with same name exists
    const existingIndex = this.config.connectionProfiles.findIndex(p => p.name === profile.name);
    
    if (existingIndex >= 0) {
      this.config.connectionProfiles[existingIndex] = profile;
      this.logger.info(`Updated connection profile: ${profile.name}`);
    } else {
      this.config.connectionProfiles.push(profile);
      this.logger.info(`Added connection profile: ${profile.name}`);
    }

    // Set as default if it's the only profile or marked as default
    if (this.config.connectionProfiles.length === 1 || profile.isDefault) {
      this.config.defaultConnectionProfile = profile.name;
      // Clear other defaults
      this.config.connectionProfiles.forEach(p => {
        if (p.name !== profile.name) {
          p.isDefault = false;
        }
      });
    }

    this.saveConfig();
  }

  public getConnectionProfile(name?: string): ConnectionProfile | undefined {
    if (!name) {
      // Return default profile
      name = this.config.defaultConnectionProfile;
      if (!name && this.config.connectionProfiles.length > 0) {
        return this.config.connectionProfiles[0];
      }
    }

    return this.config.connectionProfiles.find(p => p.name === name);
  }

  public removeConnectionProfile(name: string): boolean {
    const index = this.config.connectionProfiles.findIndex(p => p.name === name);
    if (index >= 0) {
      this.config.connectionProfiles.splice(index, 1);
      
      // Update default if necessary
      if (this.config.defaultConnectionProfile === name) {
        this.config.defaultConnectionProfile = this.config.connectionProfiles[0]?.name;
      }
      
      this.saveConfig();
      this.logger.info(`Removed connection profile: ${name}`);
      return true;
    }
    return false;
  }

  public listConnectionProfiles(): ConnectionProfile[] {
    return this.config.connectionProfiles;
  }

  // Application Profile Management
  public addApplicationProfile(profile: ApplicationProfile): void {
    const existingIndex = this.config.applicationProfiles.findIndex(p => p.name === profile.name);
    
    if (existingIndex >= 0) {
      this.config.applicationProfiles[existingIndex] = profile;
      this.logger.info(`Updated application profile: ${profile.name}`);
    } else {
      this.config.applicationProfiles.push(profile);
      this.logger.info(`Added application profile: ${profile.name}`);
    }

    this.saveConfig();
  }

  public getApplicationProfile(name: string): ApplicationProfile | undefined {
    return this.config.applicationProfiles.find(p => p.name === name);
  }

  public getApplicationProfileByType(type: string): ApplicationProfile | undefined {
    return this.config.applicationProfiles.find(p => p.type === type);
  }

  // .NET specific methods
  public getDotNetConfig(): DotNetOptions {
    return this.config.dotnet;
  }

  public updateDotNetConfig(options: Partial<DotNetOptions>): void {
    this.config.dotnet = { ...this.config.dotnet, ...options };
    this.saveConfig();
    this.logger.info('Updated .NET configuration');
  }

  // Settings Management
  public getSettings() {
    return this.config.settings;
  }

  public updateSettings(settings: Partial<MCPConfig['settings']>): void {
    this.config.settings = { ...this.config.settings, ...settings };
    this.saveConfig();
    this.logger.info('Updated settings');
  }

  // Helper method to get SSH options with defaults applied
  public getSSHOptionsWithDefaults(profileName?: string): SSHConnectionOptions | undefined {
    const profile = this.getConnectionProfile(profileName);
    if (!profile || profile.type !== 'ssh' || !profile.sshOptions) {
      return undefined;
    }

    const sshOptions = profile.sshOptions;
    
    // Apply defaults
    return {
      ...sshOptions,
      port: sshOptions.port || 22,
      username: sshOptions.username || 'root',
      keepAliveInterval: sshOptions.keepAliveInterval || this.config.settings.keepAliveInterval,
      readyTimeout: sshOptions.readyTimeout || this.config.settings.commandTimeout,
      // Add reconnection settings
      reconnect: this.config.settings.autoReconnect,
      maxReconnectAttempts: this.config.settings.maxRetries
    } as SSHConnectionOptions;
  }

  // Export/Import configuration
  public exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  public importConfig(configJson: string): void {
    try {
      const importedConfig = JSON.parse(configJson) as MCPConfig;
      this.config = importedConfig;
      this.saveConfig();
      this.logger.info('Configuration imported successfully');
    } catch (error) {
      this.logger.error(`Failed to import configuration: ${error}`);
      throw new Error(`Invalid configuration format: ${error}`);
    }
  }

  // Get config file path (useful for debugging)
  public getConfigFilePath(): string {
    return this.configPath;
  }
}