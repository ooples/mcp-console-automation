/**
 * Protocol Modules Export Index
 * 
 * This file provides a centralized export point for all protocol implementations
 * in the console automation system. It enables lazy loading and dynamic protocol
 * discovery while maintaining clean imports throughout the application.
 */

// Core Protocol Interfaces and Base Classes
export { IProtocol, ProtocolCapabilities, ProtocolHealthStatus } from '../core/ProtocolFactory.js';

// Local Shell Protocols
export { LocalProtocol } from './LocalProtocol.js';

// Remote Access Protocols  
export { SSHProtocol } from './SSHProtocol.js';
export { TelnetProtocol } from './TelnetProtocol.js';
export { SFTPProtocol } from './SFTPProtocol.js';

// Container and Orchestration Protocols
export { DockerProtocol } from './DockerProtocol.js';
export { KubernetesProtocol } from './KubernetesProtocol.js';
export { PodmanProtocol } from './PodmanProtocol.js';
export { ContainerdProtocol } from './ContainerdProtocol.js';
export { LXCProtocol } from './LXCProtocol.js';

// Cloud Platform Protocols
export { AzureProtocol } from './AzureProtocol.js';
export { GCPProtocol } from './GCPProtocol.js';
export { AWSSSMProtocol } from './AWSSSMProtocol.js';

// Virtualization Protocols
export { WSLProtocol } from './WSLProtocol.js';
export { HyperVProtocol } from './HyperVProtocol.js';
export { VMwareProtocol } from './VMwareProtocol.js';
export { VirtualBoxProtocol } from './VirtualBoxProtocol.js';
export { QEMUProtocol } from './QEMUProtocol.js';
export { XenProtocol } from './XenProtocol.js';

// Hardware Access Protocols
export { SerialProtocol } from './SerialProtocol.js';
export { IPMIProtocol } from './IPMIProtocol.js';
export { BMCProtocol } from './BMCProtocol.js';
export { iDRACProtocol } from './iDRACProtocol.js';
export { ILOProtocol } from './ILOProtocol.js';
export { JTAGProtocol } from './JTAGProtocol.js';

// Remote Desktop Protocols
export { RDPProtocol } from './RDPProtocol.js';
export { VNCProtocol } from './VNCProtocol.js';
export { SPICEProtocol } from './SPICEProtocol.js';
export { X11VNCProtocol } from './X11VNCProtocol.js';

// Network Terminal Protocols
export { WebSocketTerminalProtocol } from './WebSocketTerminalProtocol.js';
export { GoTTYProtocol } from './GoTTYProtocol.js';
export { WeTTYProtocol } from './WeTTYProtocol.js';
export { TTYDProtocol } from './TTYDProtocol.js';
export { GuacamoleProtocol } from './GuacamoleProtocol.js';

// Windows Remote Management Protocols
export { WinRMProtocol } from './WinRMProtocol.js';
export { PSRemotingProtocol } from './PSRemotingProtocol.js';
export { WMIProtocol } from './WMIProtocol.js';
export { PSExecProtocol } from './PSExecProtocol.js';
export { PowerShellDirectProtocol } from './PowerShellDirectProtocol.js';

// IPC and Local Communication Protocols
export { NamedPipeProtocol } from './NamedPipeProtocol.js';
export { UnixSocketProtocol } from './UnixSocketProtocol.js';
export { IPCProtocol } from './IPCProtocol.js';
export { DBusProtocol } from './DBusProtocol.js';
export { MessageQueueProtocol } from './MessageQueueProtocol.js';

// Automation and Configuration Management Protocols
export { AnsibleProtocol } from './AnsibleProtocol.js';
export { PuppetProtocol } from './PuppetProtocol.js';
export { ChefProtocol } from './ChefProtocol.js';
export { SaltStackProtocol } from './SaltStackProtocol.js';
export { TerraformProtocol } from './TerraformProtocol.js';
export { VagrantProtocol } from './VagrantProtocol.js';

// Database Access Protocols
export { MySQLProtocol } from './MySQLProtocol.js';
export { PostgreSQLProtocol } from './PostgreSQLProtocol.js';
export { SQLiteProtocol } from './SQLiteProtocol.js';
export { MongoDBProtocol } from './MongoDBProtocol.js';
export { RedisProtocol } from './RedisProtocol.js';
export { CassandraProtocol } from './CassandraProtocol.js';

// Application Runtime Protocols
export { JavaProtocol } from './JavaProtocol.js';
export { PythonProtocol } from './PythonProtocol.js';
export { NodeProtocol } from './NodeProtocol.js';
export { RubyProtocol } from './RubyProtocol.js';
export { DotNetProtocol } from './DotNetProtocol.js';
export { PHPProtocol } from './PHPProtocol.js';
export { GoLangProtocol } from './GoLangProtocol.js';
export { RustProtocol } from './RustProtocol.js';

// Protocol Registry and Discovery
export interface ProtocolModule {
  name: string;
  type: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies?: string[];
  platformSupport: {
    windows: boolean;
    linux: boolean;
    macos: boolean;
    freebsd: boolean;
  };
  capabilities: {
    streaming: boolean;
    fileTransfer: boolean;
    authentication: boolean;
    encryption: boolean;
    compression: boolean;
    multiplexing: boolean;
    keepAlive: boolean;
    reconnection: boolean;
  };
  configuration?: {
    required: string[];
    optional: string[];
    defaults: Record<string, any>;
  };
}

// Protocol metadata registry
export const PROTOCOL_MODULES: Record<string, ProtocolModule> = {
  local: {
    name: 'Local Shell Protocol',
    type: 'local',
    description: 'Native local shell access (cmd, powershell, bash, etc.)',
    version: '1.0.0',
    platformSupport: { windows: true, linux: true, macos: true, freebsd: true },
    capabilities: {
      streaming: true,
      fileTransfer: false,
      authentication: false,
      encryption: false,
      compression: false,
      multiplexing: false,
      keepAlive: false,
      reconnection: false,
    },
  },

  ssh: {
    name: 'SSH Protocol',
    type: 'remote',
    description: 'Secure Shell remote access protocol',
    version: '1.0.0',
    platformSupport: { windows: true, linux: true, macos: true, freebsd: true },
    capabilities: {
      streaming: true,
      fileTransfer: true,
      authentication: true,
      encryption: true,
      compression: true,
      multiplexing: true,
      keepAlive: true,
      reconnection: true,
    },
    configuration: {
      required: ['host'],
      optional: ['port', 'username', 'password', 'privateKey'],
      defaults: { port: 22, username: 'root' },
    },
  },

  docker: {
    name: 'Docker Protocol',
    type: 'container',
    description: 'Docker container management and execution',
    version: '1.0.0',
    platformSupport: { windows: true, linux: true, macos: true, freebsd: false },
    capabilities: {
      streaming: true,
      fileTransfer: true,
      authentication: false,
      encryption: false,
      compression: false,
      multiplexing: true,
      keepAlive: false,
      reconnection: false,
    },
    configuration: {
      required: ['image'],
      optional: ['containerName', 'workingDir', 'environment'],
      defaults: { workingDir: '/', environment: {} },
    },
  },

  kubernetes: {
    name: 'Kubernetes Protocol',
    type: 'container',
    description: 'Kubernetes pod execution and management',
    version: '1.0.0',
    platformSupport: { windows: true, linux: true, macos: true, freebsd: true },
    capabilities: {
      streaming: true,
      fileTransfer: true,
      authentication: true,
      encryption: true,
      compression: false,
      multiplexing: true,
      keepAlive: true,
      reconnection: true,
    },
    configuration: {
      required: ['namespace', 'pod'],
      optional: ['container', 'kubeconfig', 'context'],
      defaults: { namespace: 'default', container: '' },
    },
  },

  wsl: {
    name: 'WSL Protocol',
    type: 'virtualization',
    description: 'Windows Subsystem for Linux access',
    version: '1.0.0',
    platformSupport: { windows: true, linux: false, macos: false, freebsd: false },
    capabilities: {
      streaming: true,
      fileTransfer: true,
      authentication: false,
      encryption: false,
      compression: false,
      multiplexing: false,
      keepAlive: false,
      reconnection: false,
    },
    configuration: {
      required: [],
      optional: ['distribution', 'user', 'workingDirectory'],
      defaults: { distribution: 'Ubuntu', user: 'root' },
    },
  },

  winrm: {
    name: 'WinRM Protocol',
    type: 'windows-remote',
    description: 'Windows Remote Management protocol',
    version: '1.0.0',
    platformSupport: { windows: true, linux: false, macos: false, freebsd: false },
    capabilities: {
      streaming: true,
      fileTransfer: false,
      authentication: true,
      encryption: true,
      compression: false,
      multiplexing: false,
      keepAlive: true,
      reconnection: true,
    },
    configuration: {
      required: ['host', 'username', 'password'],
      optional: ['port', 'useSSL', 'domain'],
      defaults: { port: 5985, useSSL: false },
    },
  },

  'azure-shell': {
    name: 'Azure Cloud Shell Protocol',
    type: 'cloud',
    description: 'Azure Cloud Shell access',
    version: '1.0.0',
    platformSupport: { windows: true, linux: true, macos: true, freebsd: true },
    capabilities: {
      streaming: true,
      fileTransfer: true,
      authentication: true,
      encryption: true,
      compression: false,
      multiplexing: false,
      keepAlive: true,
      reconnection: true,
    },
    configuration: {
      required: ['subscriptionId'],
      optional: ['tenantId', 'resourceGroup'],
      defaults: {},
    },
  },

  'aws-ssm': {
    name: 'AWS SSM Protocol',
    type: 'cloud',
    description: 'AWS Systems Manager Session Manager',
    version: '1.0.0',
    platformSupport: { windows: true, linux: true, macos: true, freebsd: true },
    capabilities: {
      streaming: true,
      fileTransfer: false,
      authentication: true,
      encryption: true,
      compression: false,
      multiplexing: false,
      keepAlive: true,
      reconnection: true,
    },
    configuration: {
      required: ['instanceId'],
      optional: ['region', 'profile', 'documentName'],
      defaults: { documentName: 'SSM-SessionManagerRunShell' },
    },
  },

  rdp: {
    name: 'RDP Protocol',
    type: 'remote-desktop',
    description: 'Remote Desktop Protocol',
    version: '1.0.0',
    platformSupport: { windows: true, linux: true, macos: true, freebsd: false },
    capabilities: {
      streaming: true,
      fileTransfer: true,
      authentication: true,
      encryption: true,
      compression: true,
      multiplexing: false,
      keepAlive: true,
      reconnection: true,
    },
    configuration: {
      required: ['host', 'username', 'password'],
      optional: ['port', 'domain', 'width', 'height'],
      defaults: { port: 3389, width: 1024, height: 768 },
    },
  },

  serial: {
    name: 'Serial Protocol',
    type: 'hardware',
    description: 'Serial port communication',
    version: '1.0.0',
    platformSupport: { windows: true, linux: true, macos: true, freebsd: true },
    capabilities: {
      streaming: true,
      fileTransfer: false,
      authentication: false,
      encryption: false,
      compression: false,
      multiplexing: false,
      keepAlive: false,
      reconnection: true,
    },
    configuration: {
      required: ['port'],
      optional: ['baudRate', 'dataBits', 'stopBits', 'parity'],
      defaults: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
    },
  },
};

// Protocol loading utilities
export interface ProtocolLoader {
  loadProtocol(type: string): Promise<any>;
  isProtocolAvailable(type: string): boolean;
  getProtocolInfo(type: string): ProtocolModule | undefined;
  listAvailableProtocols(): string[];
  validateProtocolConfig(type: string, config: any): boolean;
}

export class DefaultProtocolLoader implements ProtocolLoader {
  private loadedProtocols: Map<string, any> = new Map();

  async loadProtocol(type: string): Promise<any> {
    if (this.loadedProtocols.has(type)) {
      return this.loadedProtocols.get(type);
    }

    try {
      const module = await this.dynamicImport(type);
      this.loadedProtocols.set(type, module);
      return module;
    } catch (error) {
      throw new Error(`Failed to load protocol '${type}': ${error}`);
    }
  }

  private async dynamicImport(type: string): Promise<any> {
    const protocolMap: Record<string, () => Promise<any>> = {
      'local': () => import('./LocalProtocol.js'),
      'ssh': () => import('./SSHProtocol.js'),
      'telnet': () => import('./TelnetProtocol.js'),
      'docker': () => import('./DockerProtocol.js'),
      'kubernetes': () => import('./KubernetesProtocol.js'),
      'wsl': () => import('./WSLProtocol.js'),
      'azure-shell': () => import('./AzureProtocol.js'),
      'gcp-shell': () => import('./GCPProtocol.js'),
      'aws-ssm': () => import('./AWSSSMProtocol.js'),
      'serial': () => import('./SerialProtocol.js'),
      'rdp': () => import('./RDPProtocol.js'),
      'vnc': () => import('./VNCProtocol.js'),
      'winrm': () => import('./WinRMProtocol.js'),
    };

    const loader = protocolMap[type];
    if (!loader) {
      throw new Error(`Unknown protocol type: ${type}`);
    }

    return await loader();
  }

  isProtocolAvailable(type: string): boolean {
    return type in PROTOCOL_MODULES;
  }

  getProtocolInfo(type: string): ProtocolModule | undefined {
    return PROTOCOL_MODULES[type];
  }

  listAvailableProtocols(): string[] {
    return Object.keys(PROTOCOL_MODULES);
  }

  validateProtocolConfig(type: string, config: any): boolean {
    const info = this.getProtocolInfo(type);
    if (!info || !info.configuration) {
      return true; // No validation rules defined
    }

    // Check required fields
    for (const required of info.configuration.required) {
      if (!(required in config)) {
        return false;
      }
    }

    return true;
  }
}

// Export default loader instance
export const protocolLoader = new DefaultProtocolLoader();