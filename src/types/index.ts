export type ConsoleType = 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'zsh' | 'sh' | 'auto' | 'ssh' | 'sftp' | 'scp' | 'azure-shell' | 'azure-bastion' | 'azure-ssh' | 'gcp-shell' | 'gcp-ssh' | 'gcp-oslogin' | 'aws-ssm' | 'ssm-session' | 'ssm-tunnel' | 'serial' | 'com' | 'uart' | 'docker' | 'docker-exec' | 'kubectl' | 'k8s-exec' | 'k8s-logs' | 'k8s-port-forward' | 'telnet' | 'wsl' | 'wsl2' | 'rdp' | 'mstsc' | 'vnc' | 'winrm' | 'psremoting' | 'websocket-term' | 'xterm-ws' | 'web-terminal' | 'ipmi' | 'bmc' | 'idrac' | 'named-pipe' | 'unix-socket' | 'ipc' | 'ansible' | 'ansible-ssh' | 'ansible-winrm' | 'ansible-local' | 'lxc' | 'podman' | 'containerd' | 'chef' | 'dbus' | 'dotnet' | 'cassandra' | 'golang' | 'gotty' | 'hyperv' | 'guacamole' | 'ilo' | 'java' | 'jtag' | 'messagequeue' | 'mysql' | 'mssql' | 'mongodb' | 'php' | 'powershelldirect' | 'postgresql' | 'psexec' | 'node' | 'puppet' | 'python' | 'qemu' | 'redis' | 'ruby' | 'rust' | 'spice' | 'sqlite' | 'saltstack' | 'terraform' | 'vagrant' | 'vmware' | 'virtualbox' | 'wetty' | 'wmi' | 'xen' | 'x11vnc' | 'ttyd' | 'pulumi' | 'jenkins' | 'gitlab-runner' | 'github-actions' | 'circleci' | 'elasticsearch' | 'oracle' | 'neo4j' | 'jupyter' | 'vscode-remote' | 'code-server' | 'theia' | 'cloud9' | 'virtualization';

// Console Type Categories
export type LocalConsoleType = 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'zsh' | 'sh' | 'auto';
export type RemoteConsoleType = 'ssh' | 'sftp' | 'scp' | 'telnet' | 'winrm' | 'psremoting';
export type CloudConsoleType = 'azure-shell' | 'azure-bastion' | 'azure-ssh' | 'gcp-shell' | 'gcp-ssh' | 'gcp-oslogin' | 'aws-ssm' | 'ssm-session' | 'ssm-tunnel';
export type ContainerConsoleType = 'docker' | 'docker-exec' | 'kubectl' | 'k8s-exec' | 'lxc' | 'podman' | 'containerd';
export type VirtualizationConsoleType = 'wsl' | 'wsl2';
export type HardwareConsoleType = 'serial' | 'com' | 'uart' | 'ipmi' | 'bmc' | 'idrac';
export type RemoteDesktopType = 'rdp' | 'mstsc' | 'vnc';
export type NetworkConsoleType = 'websocket-term' | 'xterm-ws' | 'web-terminal';
export type WindowsRemoteType = 'winrm' | 'psremoting';
export type IPCConsoleType = 'named-pipe' | 'unix-socket' | 'ipc';
export type AutomationConsoleType = 'ansible' | 'ansible-ssh' | 'ansible-winrm' | 'ansible-local';
export type DatabaseConsoleType = 'mysql' | 'postgresql' | 'mongodb' | 'cassandra' | 'redis' | 'sqlite';
export type ApplicationConsoleType = 'node' | 'python' | 'java' | 'dotnet' | 'golang' | 'php' | 'ruby' | 'rust';
export type VirtualizationProtocolType = 'hyperv' | 'vmware' | 'virtualbox' | 'qemu' | 'xen';
export type AutomationToolType = 'chef' | 'puppet' | 'saltstack' | 'terraform' | 'vagrant';
export type TerminalProtocolType = 'gotty' | 'wetty' | 'ttyd' | 'guacamole' | 'spice' | 'x11vnc';
export type SystemProtocolType = 'dbus' | 'wmi' | 'messagequeue' | 'jtag' | 'psexec' | 'powershelldirect';

export interface ConsoleSession {
  id: string;
  sessionType?: 'one-shot' | 'persistent';  // Distinguish session types
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  environment?: Record<string, string>; // Alternative environment property
  createdAt: Date;
  endedAt?: Date; // Session end time
  pid?: number;
  status: 'running' | 'stopped' | 'crashed' | 'terminated' | 'failed' | 'paused' | 'initializing' | 'recovering' | 'closed';
  exitCode?: number;
  type?: ConsoleType;
  streaming?: boolean;
  timeout?: number; // Configurable timeout in milliseconds
  lastActivity?: Date; // Missing property
  sshOptions?: SSHConnectionOptions;
  telnetOptions?: TelnetConnectionOptions;
  telnetState?: TelnetSessionState;
  azureOptions?: AzureConnectionOptions;
  gcpOptions?: GCPConnectionOptions;
  serialOptions?: SerialConnectionOptions;
  rdpOptions?: RDPConnectionOptions;
  vncOptions?: VNCConnectionOptions;
  kubernetesOptions?: KubernetesConnectionOptions;
  kubernetesState?: KubernetesSessionState;
  winrmOptions?: WinRMConnectionOptions;
  winrmState?: WinRMSessionState;
  ipmiOptions?: IPMIConnectionOptions;
  ipmiState?: IPMISessionState;
  awsSSMOptions?: AWSSSMConnectionOptions;
  awsSSMSessionId?: string;
  webSocketTerminalOptions?: WebSocketTerminalConnectionOptions;
  webSocketTerminalState?: WebSocketTerminalSessionState;
  ipcOptions?: IPCConnectionOptions;
  ipcState?: IPCSessionState;
  ansibleOptions?: AnsibleConnectionOptions;
  ansibleSession?: AnsibleSession;
  wslOptions?: WSLConnectionOptions; // Missing property
  dockerOptions?: DockerConnectionOptions;
  dockerState?: DockerSession;
  // Docker-specific properties
  containerId?: string;
  containerName?: string;
  imageId?: string;
  isExecSession?: boolean;
  sftpOptions?: SFTPSessionOptions;
  sessionState?: any; // Generic session state for various connection types
  // Command execution state
  executionState: 'idle' | 'executing' | 'waiting';
  currentCommandId?: string;
  lastCommandCompletedAt?: Date;
  activeCommands: Map<string, CommandExecution>;
  metadata?: any;
}

export interface ConsoleOutput {
  sessionId: string;
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
  raw?: string;
  // Stream properties
  stream?: 'stdout' | 'stderr' | 'stdin';
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  // Command tracking
  commandId?: string;
  isCommandBoundary?: boolean;
  boundaryType?: 'start' | 'end';
  sequence?: number;
}

export interface CommandExecution {
  id: string;
  sessionId: string;
  command: string;
  args?: string[];
  startedAt: Date;
  completedAt?: Date;
  status: 'executing' | 'completed' | 'failed' | 'timeout';
  output: ConsoleOutput[];
  exitCode?: number;
  duration?: number;
  isolatedBufferStartIndex: number;
  totalOutputLines: number;
  markers: {
    startMarker?: string;
    endMarker?: string;
    promptPattern?: RegExp;
  };
}

export interface ErrorPattern {
  pattern: RegExp;
  type: 'error' | 'warning' | 'exception';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// Extended error pattern for advanced error detection
export interface ExtendedErrorPattern extends ErrorPattern {
  category: string;
  language?: string;
  remediation?: string;
  tags?: string[];
  contexts?: string[];
  retryable?: boolean;
  filePathPattern?: RegExp;
  lineNumberPattern?: RegExp;
}

// Error analysis and reporting types
export interface ErrorContext {
  beforeLines?: string[];
  afterLines?: string[];
  fullStackTrace?: string;
  environment?: Record<string, string>;
  workingDirectory?: string;
}

export interface ParsedError {
  pattern: ExtendedErrorPattern;
  match: string;
  line: number;
  context?: ErrorContext;
  extractedInfo?: {
    filePath?: string;
    lineNumber?: number;
    columnNumber?: number;
    errorCode?: string;
    stackTrace?: string[];
    suggestion?: string;
  };
}

export interface ErrorAnalysis {
  totalErrors: number;
  criticalErrors: number;
  highErrors: number;
  mediumErrors: number;
  lowErrors: number;
  categories: Record<string, number>;
  languages: Record<string, number>;
  correlatedErrors: CorrelatedError[];
  rootCauseAnalysis: RootCauseAnalysis[];
  suggestions: string[];
  retryableErrors: ParsedError[];
}

export interface CorrelatedError {
  primaryError: ParsedError;
  relatedErrors: ParsedError[];
  confidence: number;
  description: string;
}

export interface RootCauseAnalysis {
  cause: string;
  affectedErrors: ParsedError[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  remediation: string;
  confidence: number;
}

export interface ErrorReport {
  summary: {
    totalLines: number;
    errorsFound: number;
    severityBreakdown: Record<string, number>;
    categoryBreakdown: Record<string, number>;
  };
  errors: ParsedError[];
  analysis: ErrorAnalysis;
  recommendations: string[];
  structuredOutput: any;
}

export interface ReportingOptions {
  includeStackTraces?: boolean;
  includeContext?: boolean;
  includeRemediation?: boolean;
  maxContextLines?: number;
  format?: 'json' | 'markdown' | 'html' | 'plain';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  categories?: string[];
  languages?: string[];
}

export interface MonitoringIntegration {
  type: 'webhook' | 'file' | 'console' | 'custom';
  endpoint?: string;
  filePath?: string;
  customHandler?: (report: ErrorReport) => Promise<void>;
  threshold?: {
    criticalErrors?: number;
    totalErrors?: number;
    severityScore?: number;
  };
}

export interface AlertConfig {
  enabled: boolean;
  channels: ('email' | 'slack' | 'webhook' | 'console')[];
  threshold: {
    critical: number;
    high: number;
    total: number;
  };
  cooldownMinutes: number;
}

export interface ConsoleEvent {
  sessionId: string;
  type: 'started' | 'stopped' | 'error' | 'input' | 'output' | 'prompt-detected' | 'vnc-framebuffer-update' | 'vnc-message' | 'vnc-clipboard-update' | 'terminated' | 'session-closed';
  timestamp: Date;
  data?: any;
}

export interface SessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  environment?: Record<string, string>; // Alternative environment property
  rows?: number;
  cols?: number;
  detectErrors?: boolean;
  patterns?: ErrorPattern[];
  timeout?: number;
  shell?: boolean | string;
  consoleType?: ConsoleType;
  streaming?: boolean;
  maxBuffer?: number;
  monitoring?: MonitoringOptions;
  profileName?: string; // Name of saved profile to use
  connectionProfile?: string; // Alternative name for profileName
  sshOptions?: SSHConnectionOptions;
  telnetOptions?: TelnetConnectionOptions;
  connectionPooling?: ConnectionPoolingOptions;
  azureOptions?: AzureConnectionOptions;
  gcpOptions?: GCPConnectionOptions;
  wslOptions?: WSLConnectionOptions;
  serialOptions?: SerialConnectionOptions;
  rdpOptions?: RDPConnectionOptions;
  vncOptions?: VNCConnectionOptions;
  kubernetesOptions?: KubernetesConnectionOptions;
  awsSSMOptions?: AWSSSMConnectionOptions;
  winrmOptions?: WinRMConnectionOptions;
  ipmiOptions?: IPMIConnectionOptions;
  dockerOptions?: DockerConnectionOptions;
  dockerContainerOptions?: DockerContainerOptions;
  dockerExecOptions?: DockerExecOptions;
  ipcOptions?: IPCConnectionOptions;
  webSocketTerminalOptions?: WebSocketTerminalConnectionOptions;
  ansibleOptions?: AnsibleConnectionOptions;
  chefOptions?: any; // ChefConnectionOptions defined in ChefProtocol
  puppetOptions?: any; // PuppetConnectionOptions defined in PuppetProtocol

  // WMI-specific options
  wmiHost?: string;
  wmiNamespace?: string;
  wmiUsername?: string;
  wmiPassword?: string;
  wmiDomain?: string;
  wmiAuthLevel?: string;
  wmiImpersonationLevel?: string;
  wmiTimeout?: number;
  wmiLocale?: string;
  wmiEnablePrivileges?: boolean;
  wmiUseKerberos?: boolean;
  wmiUseNTLMv2?: boolean;
  // Additional protocol options for completeness
  sftpOptions?: SFTPSessionOptions;
  scpOptions?: SCPTransferOptions;
  // One-shot command flag
  isOneShot?: boolean;
}

// Connection Pooling Configuration
export interface ConnectionPoolingOptions {
  maxConnectionsPerHost?: number;
  connectionIdleTimeout?: number;
  keepAliveInterval?: number;
  connectionRetryAttempts?: number;
  enableHealthChecks?: boolean;
  poolingStrategy?: 'round-robin' | 'least-connections' | 'random';
}

// SSH Connection Options
export interface SSHConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  strictHostKeyChecking?: boolean;
  knownHostsFile?: string;
  timeout?: number;
  keepAliveCountMax?: number;
  keepAliveInterval?: number;
  readyTimeout?: number;
  serverAliveInterval?: number;
  serverAliveCountMax?: number;
  // Additional SSH options for completeness
  compress?: boolean;
  debug?: boolean;
  forceIPv4?: boolean;
  forceIPv6?: boolean;
  hostKeyAlgorithms?: string[];
  kexAlgorithms?: string[];
  ciphers?: string[];
  hmacAlgorithms?: string[];
  localAddress?: string;
  localPort?: number;
  proxyJump?: string;
  tryKeyboard?: boolean;
  agentForward?: boolean;
  x11Forward?: boolean;
}

// RDP Connection Options
export interface RDPConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  domain?: string;
  
  // Protocol settings
  protocol?: 'RDP 8.1' | 'RDP 10' | 'RDP 10.1' | 'RDP 10.2' | 'RDP 10.3' | 'RDP 10.4' | 'RDP 10.5' | 'RDP 10.6' | 'RDP 10.7';
  encryptionLevel?: 'none' | 'low' | 'medium' | 'high' | 'fips';
  enableTLS?: boolean;
  enableNLA?: boolean; // Network Level Authentication
  enableCredSSP?: boolean;
  
  // Authentication
  certificatePath?: string;
  certificatePassword?: string;
  smartCardPin?: string;
  enableSmartCardAuth?: boolean;
  kerberosRealm?: string;
  
  // Display settings
  width?: number;
  height?: number;
  colorDepth?: 8 | 15 | 16 | 24 | 32;
  fullScreen?: boolean;
  enableMultiMonitor?: boolean;
  monitors?: RDPMonitorConfig[];
  
  // Performance
  enableGPUAcceleration?: boolean;
  enableHardwareDecoding?: boolean;
  enableRemoteFX?: boolean;
  compressionLevel?: 'none' | 'low' | 'medium' | 'high';
  enableBitmapCaching?: boolean;
  enableGlyphCaching?: boolean;
  enableOffscreenBitmapCaching?: boolean;
  
  // Audio/Video
  audioMode?: 'local' | 'remote' | 'disabled';
  audioQuality?: 'low' | 'medium' | 'high' | 'dynamic';
  enableMicrophone?: boolean;
  enableWebcam?: boolean;
  videoCodec?: 'h264' | 'h265' | 'av1';
  
  // File system and clipboard
  enableClipboard?: boolean;
  clipboardDirection?: 'disabled' | 'client-to-server' | 'server-to-client' | 'bidirectional';
  enableFileTransfer?: boolean;
  enableDriveRedirection?: boolean;
  redirectedDrives?: string[];
  enablePrinterRedirection?: boolean;
  enablePortRedirection?: boolean;
  
  // RemoteApp settings
  enableRemoteApp?: boolean;
  remoteApplicationProgram?: string;
  remoteApplicationArgs?: string;
  remoteApplicationDir?: string;
  remoteApplicationName?: string;
  remoteApplicationIcon?: string;
  
  // Gateway settings
  gatewayHostname?: string;
  gatewayPort?: number;
  gatewayUsername?: string;
  gatewayPassword?: string;
  gatewayDomain?: string;
  gatewayAccessToken?: string;
  enableGatewayAuth?: boolean;
  
  // Connection settings
  timeout?: number;
  keepAliveInterval?: number;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  
  // Session recording
  enableSessionRecording?: boolean;
  recordingPath?: string;
  recordingFormat?: 'mp4' | 'avi' | 'wmv';
  recordingQuality?: 'low' | 'medium' | 'high';
  
  // Advanced settings
  loadBalanceInfo?: string;
  alternateShell?: string;
  shellWorkingDir?: string;
  keyboardLayout?: string;
  keyboardHook?: 'disabled' | 'enabled' | 'fullscreen';
  enableUnicodeKeyboard?: boolean;
  enableWindowsKey?: boolean;
  
  // Security
  enableRestrictedAdmin?: boolean;
  enableRemoteCredentialGuard?: boolean;
  enableServerAuthentication?: boolean;
  ignoreCertificateErrors?: boolean;
  
  // Custom settings
  customRDPFile?: string;
  additionalSettings?: Record<string, any>;
}

// VNC Connection Options
export interface VNCConnectionOptions {
  host: string;
  port?: number; // Default: 5900
  username?: string;
  password?: string;
  
  // Protocol settings
  rfbProtocolVersion?: '3.3' | '3.7' | '3.8' | 'auto'; // Default: auto
  sharedConnection?: boolean; // Allow shared sessions
  viewOnly?: boolean; // View-only mode
  
  // Display settings
  pixelFormat?: {
    bitsPerPixel?: 8 | 16 | 32; // Default: 32
    depth?: 8 | 16 | 24 | 32; // Default: 24
    bigEndianFlag?: boolean;
    trueColorFlag?: boolean;
    redMax?: number;
    greenMax?: number;
    blueMax?: number;
    redShift?: number;
    greenShift?: number;
    blueShift?: number;
  };
  
  // Encoding preferences (ordered by preference)
  supportedEncodings?: VNCEncoding[];
  
  // Authentication
  authMethod?: 'none' | 'vnc' | 'vencrypt' | 'tls' | 'x509' | 'plain' | 'mslogonii' | 'tight' | 'ultra' | 'ard' | 'mslogon';
  vncPassword?: string;
  tlsOptions?: {
    enabled: boolean;
    certificates?: {
      ca?: string;
      cert?: string;
      key?: string;
      passphrase?: string;
    };
    rejectUnauthorized?: boolean;
    ciphers?: string;
    secureProtocol?: string;
  };
  
  // VeNCrypt encryption
  veNCryptOptions?: {
    enabled: boolean;
    subTypes?: VeNCryptSubType[];
    x509Credentials?: {
      caFile?: string;
      certFile?: string;
      keyFile?: string;
    };
  };
  
  // Connection settings
  timeout?: number; // Connection timeout in ms
  keepAlive?: boolean;
  keepAliveInterval?: number;
  retryAttempts?: number;
  retryDelay?: number;
  
  // Input settings
  enableKeyboard?: boolean;
  enableMouse?: boolean;
  enableClipboard?: boolean;
  keyboardLayout?: string; // Keyboard layout/locale
  
  // Compression and quality
  compressionLevel?: number; // 0-9, higher = more compression
  qualityLevel?: number; // 0-9 for lossy encodings
  enableJPEGCompression?: boolean;
  jpegQuality?: number; // 1-100
  
  // Screen settings
  screenResolution?: {
    width: number;
    height: number;
  };
  colorDepth?: 8 | 16 | 24 | 32;
  autoResize?: boolean; // Automatically resize remote desktop
  
  // Multi-monitor support
  monitors?: VNCMonitorConfig[];
  primaryMonitor?: number;
  
  // File transfer
  enableFileTransfer?: boolean;
  fileTransferPath?: string; // Default transfer directory
  maxFileSize?: number; // Max file size for transfers (bytes)
  
  // Extensions and features
  enableUltraVNCExtensions?: boolean;
  enableTightVNCExtensions?: boolean;
  enableRealVNCExtensions?: boolean;
  enableAppleRemoteDesktop?: boolean; // ARD extensions
  
  // Bell/sound
  enableBell?: boolean;
  bellCommand?: string;
  
  // Cursor handling
  cursorMode?: 'local' | 'remote' | 'dot' | 'none';
  enableCursorShapeUpdates?: boolean;
  enableRichCursor?: boolean;
  
  // Session recording
  recordSession?: boolean;
  recordingPath?: string;
  recordingFormat?: 'fbs' | 'vncrec' | 'mp4';
  
  // VNC Repeater/Proxy support
  repeater?: {
    enabled: boolean;
    host?: string;
    port?: number;
    id?: string; // Repeater ID
    mode?: 'mode1' | 'mode2'; // UltraVNC repeater modes
  };
  
  // Proxy settings
  proxy?: {
    type: 'http' | 'https' | 'socks4' | 'socks5';
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
  
  // Security options
  securityTypes?: VNCSecurityType[];
  allowInsecure?: boolean; // Allow unencrypted connections
  
  // Performance optimizations
  enableFastPath?: boolean;
  bufferSize?: number;
  maxUpdateRate?: number; // Max framebuffer updates per second
  enableLazyUpdates?: boolean;
  
  // Advanced options
  debugLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  customOptions?: Record<string, any>;
  encoding?: VNCEncoding[]; // Supported encodings

  // Missing properties found in VNCProtocol usage
  mode?: 'viewer' | 'server'; // VNC mode
  initialWidth?: number; // Initial screen width
  initialHeight?: number; // Initial screen height
  vncViewer?: string; // VNC viewer executable path
  fullScreen?: boolean; // Full screen mode
  scaleFactor?: number; // Scale factor for display
  vncServer?: string; // VNC server executable path
  display?: string; // Display identifier
  daemonMode?: boolean; // Run as daemon
  geometry?: string; // Screen geometry
  depth?: number; // Color depth
}

export type VNCEncoding = 
  | 'raw'              // 0 - Raw pixel data
  | 'copyrect'         // 1 - Copy rectangle
  | 'rre'              // 2 - Rise-and-Run-length Encoding
  | 'hextile'          // 5 - Hextile encoding
  | 'trle'             // 15 - Tiled Run-Length Encoding
  | 'zrle'             // 16 - ZRLE encoding
  | 'cursor'           // -239 - Cursor pseudo-encoding
  | 'desktopsize'      // -223 - Desktop size pseudo-encoding
  | 'lastrect'         // -224 - LastRect pseudo-encoding
  | 'wmvi'             // 0x574D5649 - VMware Virtual Infrastructure
  | 'tight'            // 7 - Tight encoding
  | 'ultra'            // 6 - UltraVNC encoding
  | 'zlibhex'          // 8 - ZlibHex encoding
  | 'jpeg'             // 21 - JPEG encoding (TurboVNC)
  | 'jrle'             // 22 - JPEG+RLE encoding
  | 'continuous'       // -312 - Continuous updates
  | 'fence'            // -238 - Fence pseudo-encoding
  | 'x11cursor'        // -240 - X11 cursor
  | 'richcursor'       // -239 - Rich cursor;

export type VeNCryptSubType = 
  | 'plain'            // 256 - Plain authentication
  | 'tlsnone'          // 257 - TLS with no authentication
  | 'tlsvnc'           // 258 - TLS with VNC authentication
  | 'tlsplain'         // 259 - TLS with plain authentication
  | 'x509none'         // 260 - X509 with no authentication
  | 'x509vnc'          // 261 - X509 with VNC authentication
  | 'x509plain'        // 262 - X509 with plain authentication
  | 'tlssasl'          // 263 - TLS with SASL authentication
  | 'x509sasl';        // 264 - X509 with SASL authentication

export type VNCSecurityType =
  | 'none'             // 1 - No security
  | 'vnc'              // 2 - VNC authentication
  | 'ra2'              // 5 - RA2 authentication
  | 'ra2ne'            // 6 - RA2NE authentication
  | 'tight'            // 16 - Tight security
  | 'ultra'            // 17 - Ultra security
  | 'tls'              // 18 - TLS security
  | 'vencrypt'         // 19 - VeNCrypt security
  | 'sasl'             // 20 - SASL security
  | 'md5hash'          // 21 - MD5 hash authentication
  | 'xvp'              // 22 - Xvp authentication
  | 'x509'             // X.509 certificate authentication
  | 'plain'            // Plain text authentication
  | 'mslogonii'        // Microsoft Logon II
  | 'ard'              // Apple Remote Desktop
  | 'mslogon';         // Microsoft Logon

export interface VNCMonitorConfig {
  id: number;
  primary?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  refreshRate?: number;
}

export interface VNCSession {
  sessionId: string;
  connectionId: string;
  host: string;
  port: number;
  protocolVersion: string;
  serverName?: string;
  securityType: VNCSecurityType;
  sharedConnection: boolean;
  viewOnlyMode: boolean;
  
  // Display information
  framebufferInfo: {
    width: number;
    height: number;
    pixelFormat: {
      bitsPerPixel: number;
      depth: number;
      bigEndianFlag: boolean;
      trueColorFlag: boolean;
      redMax: number;
      greenMax: number;
      blueMax: number;
      redShift: number;
      greenShift: number;
      blueShift: number;
    };
  };
  
  // Supported features
  supportedEncodings: VNCEncoding[];
  serverCapabilities: {
    cursorShapeUpdates: boolean;
    richCursor: boolean;
    desktopResize: boolean;
    continuousUpdates: boolean;
    fence: boolean;
    fileTransfer: boolean;
    clipboardTransfer: boolean;
    audio: boolean;
  };
  
  // Session state
  status: 'connecting' | 'authenticating' | 'connected' | 'disconnected' | 'error';
  connectionTime?: Date;
  lastActivity?: Date;
  
  // Transfer statistics
  statistics: {
    bytesReceived: number;
    bytesSent: number;
    framebufferUpdates: number;
    keyboardEvents: number;
    mouseEvents: number;
    clipboardTransfers: number;
    fileTransfers: number;
    avgFrameRate: number;
    bandwidth: number; // bits per second
    compression: number; // compression ratio
    latency: number; // milliseconds
  };
  
  // Recording info
  recording?: {
    active: boolean;
    startTime: Date;
    filePath: string;
    format: string;
    fileSize: number;
  };
  
  // Error tracking
  errorCount: number;
  warnings: string[];
  lastError?: string;
  
  // Multi-monitor setup
  monitors: VNCMonitorConfig[];
  
  metadata?: Record<string, any>;
}

export interface VNCCapabilities {
  protocolVersions: string[];
  maxResolution: { width: number; height: number };
  supportedEncodings: VNCEncoding[];
  supportedSecurityTypes: VNCSecurityType[];
  supportedPixelFormats: {
    bitsPerPixel: number[];
    depths: number[];
    colorModes: ('truecolor' | 'colormap')[];
  };
  
  // Feature support
  cursorShapeUpdates: boolean;
  desktopResize: boolean;
  continuousUpdates: boolean;
  fileTransfer: boolean;
  clipboardTransfer: boolean;
  audio: boolean;
  
  // Extensions
  tightVNCExtensions: boolean;
  ultraVNCExtensions: boolean;
  realVNCExtensions: boolean;
  appleRemoteDesktop: boolean;
  tigervncExtensions: boolean;
  turbovncExtensions: boolean;
  
  // Performance features
  compressionSupport: boolean;
  jpegSupport: boolean;
  multiMonitorSupport: boolean;
  
  // Security features
  tlsSupport: boolean;
  vencryptSupport: boolean;
  saslSupport: boolean;
  x509Support: boolean;
}

export interface VNCRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  encoding: VNCEncoding;
  data: Buffer;
}

export interface VNCFramebuffer {
  width: number;
  height: number;
  pixelFormat: any;
  data: Buffer;
  lastUpdate: Date;
  encoding: VNCEncoding[];
  compressionLevel: number;
}

export interface VNCFramebufferUpdate {
  messageType: number;
  rectangles: VNCRectangle[];
  timestamp: Date;
  sequenceNumber: number;
}

export interface VNCKeyEvent {
  messageType: number;
  downFlag: boolean;
  key: number;
  timestamp: Date;
}

export interface VNCPointerEvent {
  messageType: number;
  buttonMask: number;
  x: number;
  y: number;
  timestamp: Date;
}

export interface VNCClientCutText {
  messageType: number;
  text: string;
  encoding?: string;
  timestamp: Date;
}

export interface VNCFileTransfer {
  transferId: string;
  sessionId: string;
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  fileSize: number;
  transferredBytes: number;
  progress: number;
  speed: number; // bytes per second
  status: 'queued' | 'transferring' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  error?: string;
}

export interface VNCClipboardSync {
  sessionId: string;
  direction: 'to_server' | 'to_client';
  contentType: 'text' | 'image' | 'file';
  content: string | Buffer;
  timestamp: Date;
  size: number;
}

export interface VNCPerformanceMetrics {
  sessionId: string;
  timestamp: Date;
  
  // Frame statistics
  frameRate: number;
  avgFrameTime: number;
  frameSkips: number;
  
  // Network statistics
  bandwidth: number;
  latency: number;
  packetLoss: number;
  
  // Compression statistics
  compressionRatio: number;
  uncompressedBytes: number;
  compressedBytes: number;
  
  // Resource usage
  cpuUsage: number;
  memoryUsage: number;
  networkIO: number;
  
  // Quality metrics
  pixelChanges: number;
  screenUpdateArea: number;
  cursorUpdates: number;
}

export interface VNCServerInfo {
  name: string;
  version?: string;
  build?: string;
  platform?: string;
  
  // Capabilities
  supportedEncodings: VNCEncoding[];
  supportedSecurityTypes: VNCSecurityType[];
  extensions: string[];
  
  // Limits
  maxConnections?: number;
  maxResolution: { width: number; height: number };
  maxColors?: number;
  
  // Features
  features: {
    sharedConnections: boolean;
    viewOnlyMode: boolean;
    fileTransfer: boolean;
    clipboard: boolean;
    audio: boolean;
    scaling: boolean;
    multiMonitor: boolean;
  };
}

export interface VNCRepeaterInfo {
  host: string;
  port: number;
  mode: 'mode1' | 'mode2';
  id: string;
  connectedClients: number;
  maxClients: number;
  version?: string;
}

export interface VNCProtocolConfig {
  // Default connection settings
  defaultPort: number;
  defaultProtocolVersion: string;
  connectionTimeout: number;
  readTimeout: number;
  writeTimeout: number;
  
  // Default encodings (ordered by preference)
  preferredEncodings: VNCEncoding[];
  
  // Default pixel format
  defaultPixelFormat: {
    bitsPerPixel: number;
    depth: number;
    bigEndianFlag: boolean;
    trueColorFlag: boolean;
  };
  
  // Security preferences
  allowedSecurityTypes: VNCSecurityType[];
  requireEncryption: boolean;
  
  // Performance settings
  enableCompression: boolean;
  compressionLevel: number;
  enableJPEG: boolean;
  jpegQuality: number;
  maxUpdateRate: number;
  bufferSize: number;
  
  // Feature flags
  enableCursorShapeUpdates: boolean;
  enableDesktopResize: boolean;
  enableContinuousUpdates: boolean;
  enableFileTransfer: boolean;
  enableClipboard: boolean;
  
  // Logging and debugging
  logLevel: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  enableProtocolLogging: boolean;
  enablePerformanceLogging: boolean;
  
  // Session recording
  enableSessionRecording: boolean;
  recordingPath: string;
  recordingFormat: 'fbs' | 'vncrec';
  
  // Extensions
  enableUltraVNCExtensions: boolean;
  enableTightVNCExtensions: boolean;
  enableRealVNCExtensions: boolean;
  enableTigerVNCExtensions: boolean;
  enableTurboVNCExtensions: boolean;
}

export interface RDPMonitorConfig {
  id: number;
  primary?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  orientation?: 0 | 90 | 180 | 270;
}

export interface RDPSession {
  sessionId: string;
  connectionId: string;
  host: string;
  port: number;
  username: string;
  domain?: string;
  protocol: string;
  connectionTime: Date;
  lastActivity: Date;
  status: 'connecting' | 'connected' | 'disconnected' | 'failed';
  displaySize: { width: number; height: number };
  colorDepth: number;
  compressionLevel: string;
  encryptionLevel: string;
  audioEnabled: boolean;
  clipboardEnabled: boolean;
  fileTransferEnabled: boolean;
  gatewayUsed?: boolean;
  remoteAppMode?: boolean;
  recordingActive?: boolean;
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  roundTripTime?: number;
  bandwidth?: number;
  errorCount: number;
  warnings: string[];
  metadata?: Record<string, any>;
}

export interface RDPCapabilities {
  protocolVersions: string[];
  maxResolution: { width: number; height: number };
  supportedColorDepths: number[];
  compressionSupported: boolean;
  encryptionSupported: boolean;
  audioSupported: boolean;
  videoSupported: boolean;
  clipboardSupported: boolean;
  fileTransferSupported: boolean;
  printingSupported: boolean;
  smartCardSupported: boolean;
  remoteAppSupported: boolean;
  multiMonitorSupported: boolean;
  gpuAccelerationSupported: boolean;
  h264Supported: boolean;
  remoteFXSupported: boolean;
  nlaSupported: boolean;
  credSSPSupported: boolean;
  gatewaySupported: boolean;
  sessionRecordingSupported: boolean;
}

// Kubernetes Connection Options
export interface KubernetesConnectionOptions {
  kubeconfig?: string; // Path to kubeconfig file or direct config content
  context?: string; // Kubernetes context to use
  namespace?: string; // Default namespace
  cluster?: string; // Cluster name
  user?: string; // User name
  token?: string; // Bearer token for authentication
  clientCertificate?: string; // Client certificate data
  clientKey?: string; // Client private key data
  clusterCertificateAuthority?: string; // Cluster CA certificate data
  insecureSkipTlsVerify?: boolean; // Skip TLS verification (insecure)
  timeout?: number; // Request timeout in milliseconds
  server?: string; // Kubernetes API server URL
  inCluster?: boolean; // Use in-cluster service account
}

// Kubernetes Pod Selection Options
export interface PodSelectionOptions {
  name?: string; // Specific pod name
  labelSelector?: string; // Label selector (e.g., "app=nginx")
  fieldSelector?: string; // Field selector (e.g., "status.phase=Running")
  deploymentName?: string; // Select pods from deployment
  replicaSetName?: string; // Select pods from replica set
  serviceName?: string; // Select pods backing a service
  containerName?: string; // Specific container in multi-container pod
  namespace?: string; // Override default namespace
  interactive?: boolean; // Allocate TTY for interactive sessions
  stdin?: boolean; // Keep stdin open
}

// Kubernetes Port Forward Options
export interface PortForwardOptions {
  localPort: number; // Local port to forward to
  remotePort: number; // Remote port in the pod
  podName: string; // Target pod name
  namespace?: string; // Pod namespace
  address?: string; // Local address to bind to (default: localhost)
}

// Kubernetes Copy Options
export interface KubernetesCopyOptions {
  podName: string; // Target pod name
  containerName?: string; // Container name (required for multi-container pods)
  namespace?: string; // Pod namespace
  localPath: string; // Local file/directory path
  remotePath: string; // Remote file/directory path in pod
  direction: 'upload' | 'download'; // Copy direction
  recursive?: boolean; // Recursive copy for directories
  preserveOwnership?: boolean; // Preserve file ownership and permissions
}

// Kubernetes Log Options
export interface KubernetesLogOptions {
  podName?: string; // Specific pod name
  labelSelector?: string; // Label selector for multiple pods
  containerName?: string; // Container name
  namespace?: string; // Pod namespace
  follow?: boolean; // Stream logs (equivalent to -f)
  tail?: number; // Number of lines to show from end
  since?: string; // Show logs since duration (e.g., "1h", "30m")
  sinceTime?: string; // Show logs since timestamp
  timestamps?: boolean; // Include timestamps
  previous?: boolean; // Show logs from previous container instance
  prefix?: boolean; // Add pod name prefix for multi-pod logs
}

// Kubernetes Exec Session Options
export interface KubernetesExecOptions extends PodSelectionOptions {
  command?: string[]; // Command to execute (default: ["/bin/bash"])
  workingDir?: string; // Working directory in container
  env?: Record<string, string>; // Environment variables
  timeout?: number; // Session timeout
}

// Kubernetes Session State
export interface KubernetesSessionState {
  sessionType: 'exec' | 'logs' | 'port-forward' | 'copy';
  kubeConfig: KubernetesConnectionOptions;
  podInfo?: {
    name: string;
    namespace: string;
    containerName?: string;
    status: string;
    restartCount: number;
    creationTimestamp: Date;
  };
  connectionState: {
    connected: boolean;
    lastHeartbeat?: Date;
    reconnectAttempts: number;
  };
  streamHandles?: {
    stdin?: any;
    stdout?: any;
    stderr?: any;
    status?: any;
  };
}

// Telnet Connection Options
export interface TelnetConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  timeout?: number;
  shellPrompt?: string | RegExp;
  loginPrompt?: string | RegExp;
  passwordPrompt?: string | RegExp;
  failedLoginMatch?: string | RegExp;
  initialLFCR?: boolean;
  echoLines?: number;
  stripShellPrompt?: boolean;
  pageSeparator?: string | RegExp;
  response?: string;
  irs?: string;
  ors?: string;
  stripAnsiColors?: boolean;
  terminalType?: 'VT100' | 'ANSI' | 'xterm' | 'vt220';
  windowSize?: { width: number; height: number };
  negotiateOptions?: boolean;
  binaryMode?: boolean;
  keepAlive?: boolean;
  keepAliveInterval?: number;
  encoding?: 'ascii' | 'utf8' | 'binary';
  deviceType?: 'cisco' | 'juniper' | 'huawei' | 'generic';
  enableMode?: boolean;
  enablePassword?: string;
  execTimeout?: number;
  sendTimeout?: number;
  maxBuffer?: number;
  debug?: boolean;
  // Additional telnet properties for completeness
  connectTimeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  localAddress?: string;
  localPort?: number;
  socketOptions?: {
    noDelay?: boolean;
    keepAlive?: boolean;
    keepAliveInitialDelay?: number;
  };
  // Directory settings
  initialDirectory?: string;
  workingDirectory?: string;
}

// Telnet Protocol Command Types
export interface TelnetCommand {
  id: string;
  command: string;
  expected?: string | RegExp;
  timeout?: number;
  retryCount?: number;
  suppressOutput?: boolean;
  waitForPrompt?: boolean;
  isPrivileged?: boolean;
  status?: 'pending' | 'executing' | 'completed' | 'failed' | 'timeout'; // Missing property
  timestamp?: Date; // Missing property
  startedAt?: Date;
  completedAt?: Date;
  result?: {
    output: string;
    exitCode?: number;
    error?: string;
    duration?: number;
  };
}

// Telnet Device Patterns
export interface DevicePattern {
  type: 'cisco' | 'juniper' | 'huawei' | 'generic';
  loginPrompt: RegExp[];
  passwordPrompt: RegExp[];
  shellPrompt: RegExp[];
  enablePrompt?: RegExp[];
  configPrompt?: RegExp[];
  morePrompt?: RegExp[];
  errorPatterns: RegExp[];
  commands: {
    enable?: string;
    disable?: string;
    config?: string;
    exit?: string;
    save?: string;
    show?: string[];
  };
}

// Telnet Option Negotiation
export interface TelnetOption {
  code: number;
  name: string;
  enabled: boolean;
  localState: 'NO' | 'WANTNO' | 'WANTYES' | 'YES';
  remoteState: 'NO' | 'WANTNO' | 'WANTYES' | 'YES';
}

// Serial/COM Port Connection Options
export interface SerialConnectionOptions {
  path: string; // COM1, /dev/ttyUSB0, etc.
  baudRate?: number; // 9600, 115200, etc.
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
  rtscts?: boolean; // Hardware flow control
  xon?: boolean; // Software flow control XON
  xoff?: boolean; // Software flow control XOFF
  xany?: boolean; // Software flow control XANY
  hupcl?: boolean; // Hang up on close
  autoOpen?: boolean;
  lock?: boolean;
  highWaterMark?: number;
  vmin?: number;
  vtime?: number;
  // DTR/RTS control for Arduino reset
  dtr?: boolean;
  rts?: boolean;
  // Device-specific settings
  deviceType?: 'arduino' | 'esp32' | 'generic' | 'ftdi' | 'ch340' | 'cp2102';
  resetOnConnect?: boolean;
  resetDelay?: number;
  // Protocol settings
  lineEnding?: '\n' | '\r\n' | '\r';
  encoding?: 'ascii' | 'utf8' | 'binary' | 'hex';
  timeout?: number;
  // Buffer management
  bufferSize?: number;
  maxBufferSize?: number;
  // Connection management
  reconnectOnDisconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export interface SerialDeviceInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  vendorId?: string;
  productId?: string;
  deviceType?: 'arduino' | 'esp32' | 'generic' | 'ftdi' | 'ch340' | 'cp2102';
  description?: string;
  isConnected: boolean;
  supportedBaudRates?: number[];
  capabilities?: {
    hardwareFlowControl?: boolean;
    softwareFlowControl?: boolean;
    dtrRtsControl?: boolean;
    breakSignal?: boolean;
  };
}

export interface SerialProtocolProfile {
  name: string;
  deviceType: 'arduino' | 'esp32' | 'generic';
  defaultBaudRate: number;
  supportedBaudRates: number[];
  defaultSettings: Partial<SerialConnectionOptions>;
  resetSequence?: {
    dtr?: boolean;
    rts?: boolean;
    delay?: number;
    pulseWidth?: number;
  };
  bootloaderDetection?: {
    patterns: RegExp[];
    timeout: number;
  };
  commandProtocol?: {
    commandTerminator: string;
    responseTerminator: string;
    timeout: number;
    retryCount: number;
  };
}

// Azure Connection Options
export interface AzureConnectionOptions {
  // Authentication
  tenantId?: string;
  subscriptionId?: string;
  clientId?: string;
  clientSecret?: string;
  clientCertificatePath?: string;
  clientCertificateThumbprint?: string;
  username?: string;
  password?: string;
  managedIdentity?: boolean;
  
  // Cloud Shell specific
  cloudShellType?: 'bash' | 'powershell';
  region?: string;
  resourceGroupName?: string;
  storageAccountName?: string;
  fileShareName?: string;
  
  // Bastion specific
  bastionResourceId?: string;
  bastionName?: string;
  targetVmResourceId?: string;
  targetVmName?: string;
  targetVmUser?: string;
  targetVmPassword?: string;
  targetVmPrivateKey?: string;
  protocol?: 'ssh' | 'rdp';
  
  // Arc-enabled servers
  arcResourceId?: string;
  hybridConnectionEndpoint?: string;
  
  // Key Vault integration
  keyVaultUrl?: string;
  secretName?: string;
  certificateName?: string;
  
  // Private Link
  privateLinkServiceId?: string;
  privateDnsZoneName?: string;
  
  // Connection settings
  timeout?: number;
  keepAliveInterval?: number;
  retryAttempts?: number;
  enableAutoReconnect?: boolean;
}

export interface AzureCloudShellSession {
  sessionId: string;
  webSocketUrl: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiry: Date;
  shellType: 'bash' | 'powershell';
  subscription: string;
  resourceGroup: string;
  location: string;
  storageAccount?: {
    name: string;
    resourceGroup: string;
    fileShare: string;
  };
  metadata?: Record<string, any>;
}

export interface AzureBastionSession {
  sessionId: string;
  bastionResourceId: string;
  targetVmResourceId: string;
  targetVmName: string;
  protocol: 'ssh' | 'rdp';
  connectionUrl: string;
  accessToken: string;
  tokenExpiry: Date;
  tunnelEndpoint?: string;
  portForwarding?: {
    localPort: number;
    remotePort: number;
    remoteHost: string;
  };
  metadata?: Record<string, any>;
}

export interface AzureArcSession {
  sessionId: string;
  arcResourceId: string;
  connectionEndpoint: string;
  accessToken: string;
  tokenExpiry: Date;
  hybridConnectionString: string;
  targetMachine: {
    name: string;
    osType: 'Windows' | 'Linux';
    version?: string;
  };
  metadata?: Record<string, any>;
}

export interface AzureTokenInfo {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  expiresOn: Date;
  scope: string[];
  tenantId: string;
  resource: string;
  authority: string;
}

export interface AzureResourceInfo {
  resourceId: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  name: string;
  tags?: Record<string, string>;
  properties?: Record<string, any>;
}

// Google Cloud Platform (GCP) Connection Options
export interface GCPConnectionOptions {
  // Authentication
  projectId?: string;
  keyFilename?: string; // Path to service account key file
  keyFile?: string; // Service account key JSON content
  credentials?: any; // Service account credentials object
  clientEmail?: string;
  privateKey?: string;
  scopes?: string[];
  quotaProjectId?: string;
  
  // OAuth2 authentication for user accounts
  oauth2Config?: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    accessToken?: string;
    tokenUri?: string;
    authUri?: string;
  };
  
  // Cloud Shell specific
  cloudShellType?: 'bash' | 'zsh' | 'fish';
  region?: string;
  zone?: string;
  machineType?: string;
  diskSizeGb?: number;
  imageFamily?: string;
  imageProject?: string;
  
  // VM/Compute Engine specific
  vmName?: string;
  vmZone?: string;
  vmProject?: string;
  
  // OS Login specific
  osLoginEnabled?: boolean;
  osLoginProject?: string;
  osLoginUser?: string;
  iapTunnelEnabled?: boolean;
  
  // GKE specific
  clusterName?: string;
  clusterLocation?: string;
  namespace?: string;
  podName?: string;
  containerName?: string;
  
  // IAP (Identity-Aware Proxy) settings
  iapConfig?: {
    enabled: boolean;
    clientId?: string;
    audience?: string;
    oauthToken?: string;
  };
  
  // Network and connection settings
  timeout?: number;
  keepAliveInterval?: number;
  retryAttempts?: number;
  enableAutoReconnect?: boolean;
  
  // Persistent disk settings for Cloud Shell
  persistentDisk?: {
    name?: string;
    zone?: string;
    sizeGb?: number;
    type?: 'pd-standard' | 'pd-balanced' | 'pd-ssd' | 'pd-extreme';
  };
  
  // Custom metadata
  metadata?: Record<string, string>;
  labels?: Record<string, string>;
  tags?: string[];
}

export interface GCPCloudShellSession {
  sessionId: string;
  webSocketUrl: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiry: Date;
  shellType: 'bash' | 'zsh' | 'fish';
  projectId: string;
  region: string;
  zone?: string;
  vmName?: string;
  machineType: string;
  diskSizeGb: number;
  homeDirectory: string;
  environment: {
    [key: string]: string;
  };
  capabilities: {
    cloudSdk: boolean;
    docker: boolean;
    kubectl: boolean;
    terraform: boolean;
    customTools: string[];
  };
  persistentDisk?: {
    name: string;
    mountPoint: string;
    sizeGb: number;
    type: string;
  };
  networkInfo: {
    internalIp?: string;
    externalIp?: string;
    subnetwork?: string;
    network?: string;
  };
  metadata?: Record<string, any>;
}

export interface GCPComputeSession {
  sessionId: string;
  vmName: string;
  vmZone: string;
  vmProject: string;
  instanceId: string;
  machineType: string;
  status: 'PROVISIONING' | 'STAGING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'SUSPENDING' | 'SUSPENDED' | 'TERMINATED';
  accessMethod: 'ssh' | 'iap-tunnel' | 'oslogin';
  connectionInfo: {
    internalIp?: string;
    externalIp?: string;
    username?: string;
    sshKeys?: string[];
  };
  osLogin?: {
    enabled: boolean;
    username?: string;
    uid?: number;
    gid?: number;
    homeDirectory?: string;
    shell?: string;
  };
  iapTunnel?: {
    enabled: boolean;
    localPort: number;
    targetPort: number;
    clientId?: string;
    audience?: string;
  };
  metadata?: Record<string, any>;
}

export interface GCPGKESession {
  sessionId: string;
  clusterName: string;
  clusterLocation: string;
  clusterProject: string;
  namespace: string;
  podName?: string;
  containerName?: string;
  accessToken: string;
  tokenExpiry: Date;
  kubeconfig?: {
    context: string;
    cluster: string;
    user: string;
    certificateAuthority?: string;
    clientCertificate?: string;
    clientKey?: string;
  };
  clusterInfo: {
    version: string;
    nodeCount: number;
    location: string;
    network?: string;
    subnetwork?: string;
    masterAuthorizedNetworks?: string[];
  };
  metadata?: Record<string, any>;
}

export interface GCPTokenInfo {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  expiresOn: Date;
  scope: string[];
  projectId?: string;
  clientId?: string;
  clientEmail?: string;
  serviceAccount?: boolean;
}

export interface GCPResourceInfo {
  name: string;
  project: string;
  zone?: string;
  region?: string;
  resourceType: string;
  status?: string;
  creationTimestamp?: Date;
  labels?: Record<string, string>;
  metadata?: Record<string, any>;
  selfLink?: string;
  fingerprint?: string;
}

export interface GCPQuotaInfo {
  quotaId: string;
  service: string;
  quotaName: string;
  limit: number;
  usage: number;
  remaining: number;
  resetTime?: Date;
  unit: string;
  region?: string;
  zone?: string;
}

export interface GCPRateLimitInfo {
  service: string;
  method: string;
  quotaUser?: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  currentRequests: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  resetTimes: {
    nextMinute: Date;
    nextHour: Date;
    nextDay: Date;
  };
}

export interface GCPServiceAccountInfo {
  email: string;
  displayName?: string;
  description?: string;
  projectId: string;
  uniqueId: string;
  oauth2ClientId?: string;
  keys?: {
    keyId: string;
    keyType: 'USER_MANAGED' | 'SYSTEM_MANAGED';
    algorithm: string;
    validAfterTime?: Date;
    validBeforeTime?: Date;
  }[];
  etag?: string;
  disabled?: boolean;
}

export interface GCPIAMPolicy {
  version?: number;
  bindings: {
    role: string;
    members: string[];
    condition?: {
      title?: string;
      description?: string;
      expression: string;
    };
  }[];
  auditConfigs?: {
    service: string;
    auditLogConfigs: {
      logType: 'ADMIN_READ' | 'DATA_READ' | 'DATA_WRITE';
      exemptedMembers?: string[];
    }[];
  }[];
  etag?: string;
}

// Connection Pool Types
export interface PooledConnection {
  id: string;
  host: string;
  port: number;
  username: string;
  connection: any; // SSH2 Client instance
  createdAt: Date;
  lastUsed: Date;
  activeSessionCount: number;
  isHealthy: boolean;
  healthCheckAt?: Date;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  metadata?: Record<string, any>;
}

export interface ConnectionPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  healthyConnections: number;
  unhealthyConnections: number;
  connectionsByHost: Record<string, number>;
  averageConnectionAge: number;
  totalReconnectAttempts: number;
  lastHealthCheckAt: Date;
}

export interface ConnectionPoolConfig {
  maxConnectionsPerHost: number;
  connectionIdleTimeout: number;
  keepAliveInterval: number;
  connectionRetryAttempts: number;
  healthCheckInterval: number;
  cleanupInterval: number;
  enableMetrics: boolean;
  enableLogging: boolean;
  poolingStrategy: 'round-robin' | 'least-connections' | 'random';
  connectionTimeout: number;
  maxReconnectAttempts: number;
  circuitBreakerThreshold: number;
}

// Session Management Types
export interface SessionState {
  id: string;
  status: 'initializing' | 'running' | 'paused' | 'stopped' | 'failed' | 'recovering' | 'terminated';
  type: 'local' | 'ssh' | 'azure' | 'serial' | 'kubernetes' | 'docker' | 'aws-ssm' | 'wsl' | 'sftp' | 'rdp' | 'winrm' | 'vnc' | 'ipc' | 'ipmi' | 'websocket-terminal';
  createdAt: Date;
  lastActivity: Date;
  recoveryAttempts: number;
  maxRecoveryAttempts: number;
  persistentData?: Record<string, any>;
  connectionId?: string; // For SSH sessions
  pid?: number; // For local sessions
  healthScore: number;
  metadata?: Record<string, any>;
}

export interface SessionRecoveryOptions {
  enableAutoRecovery: boolean;
  maxRecoveryAttempts: number;
  recoveryDelay: number;
  backoffMultiplier: number;
  persistSessionData: boolean;
  healthCheckInterval: number;
}

export interface SessionManagerConfig {
  maxSessions: number;
  sessionTimeout: number;
  cleanupInterval: number;
  persistenceEnabled: boolean;
  persistencePath?: string;
  recoveryOptions: SessionRecoveryOptions;
  enableMetrics: boolean;
  enableLogging: boolean;
  heartbeatInterval: number;
}

export interface SessionManagerStats {
  totalSessions: number;
  activeSessions: number;
  pausedSessions: number;
  failedSessions: number;
  recoveringSessions: number;
  sessionsByType: Record<string, number>;
  averageSessionAge: number;
  totalRecoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  lastCleanupAt: Date;
}

// Monitoring and Observability Types
export interface MonitoringOptions {
  enableMetrics?: boolean;
  enableTracing?: boolean;
  enableProfiling?: boolean;
  enableAuditing?: boolean;
  enableAnomalyDetection?: boolean;
  customTags?: Record<string, string>;
  slaConfig?: SLAConfig;
}

export interface SLAConfig {
  responseTime?: number;
  availabilityThreshold?: number;
  errorRateThreshold?: number;
  notifications?: NotificationConfig[];
}

export interface NotificationConfig {
  type: 'email' | 'webhook' | 'slack' | 'console';
  config: Record<string, any>;
  triggers: NotificationTrigger[];
}

export interface NotificationTrigger {
  event: 'sla_breach' | 'error_threshold' | 'anomaly_detected' | 'session_failure';
  condition?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    cores: number;
    load: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
  processes: ProcessMetrics[];
}

export interface ProcessMetrics {
  pid: number;
  sessionId?: string;
  name: string;
  cpu: number;
  memory: number;
  disk: {
    read: number;
    write: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
  };
  uptime: number;
  status: string;
}

export interface PerformanceProfile {
  sessionId: string;
  command: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  metrics: {
    avgCpuUsage: number;
    peakMemoryUsage: number;
    totalDiskIO: number;
    totalNetworkIO: number;
  };
  bottlenecks: Bottleneck[];
}

export interface Bottleneck {
  type: 'cpu' | 'memory' | 'disk' | 'network';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  timestamp: Date;
  duration: number;
  impact: number;
}

export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  sessionId?: string;
  userId?: string;
  source: string;
  metadata?: Record<string, any>;
  traceId?: string;
  spanId?: string;
}

export interface AuditEvent {
  timestamp: Date;
  eventType: 'session_created' | 'session_stopped' | 'command_executed' | 'error_detected' | 'sla_breach';
  sessionId?: string;
  userId?: string;
  details: Record<string, any>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  compliance?: ComplianceInfo;
}

export interface ComplianceInfo {
  standards: string[];
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
  retention: number;
  encrypted: boolean;
}

export interface Alert {
  id: string;
  timestamp: Date;
  type: 'performance' | 'error' | 'security' | 'compliance' | 'anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  sessionId?: string;
  source: string;
  resolved: boolean;
  resolvedAt?: Date;
  metadata?: Record<string, any>;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  filters: DashboardFilter[];
  refreshInterval: number;
  permissions: string[];
}

export interface DashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'table' | 'alert' | 'log';
  title: string;
  config: Record<string, any>;
  position: { x: number; y: number; width: number; height: number };
  query?: string;
}

export interface DashboardFilter {
  name: string;
  type: 'select' | 'multiselect' | 'daterange' | 'text';
  options?: string[];
  defaultValue?: any;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tags: Record<string, any>;
  logs: TraceLog[];
  status: 'ok' | 'error' | 'timeout';
}

export interface TraceLog {
  timestamp: Date;
  fields: Record<string, any>;
}

export interface Anomaly {
  id: string;
  timestamp: Date;
  type: 'statistical' | 'pattern' | 'threshold';
  metric: string;
  value: number;
  expectedValue: number;
  deviation: number;
  confidence: number;
  sessionId?: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface HealthCheckResult {
  checkId: string;
  checkType: 'session' | 'system' | 'network' | 'process' | 'custom';
  sessionId?: string;
  timestamp: Date;
  status: 'healthy' | 'warning' | 'unhealthy' | 'critical';
  metrics: Record<string, number>;
  details: {
    message: string;
    diagnosis?: string;
    recommendations?: string[];
    recoverable: boolean;
  };
  duration: number;
  nextCheck?: Date;
  // Additional properties for compatibility with monitoring systems
  checks: Record<string, {
    checkStatus: 'pass' | 'fail' | 'warn';
    value?: any;
    message?: string;
    duration?: number;
  }>;
  overallScore: number;
}

// Docker Container Management Types
export interface DockerConnectionOptions {
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: 'http' | 'https';
  ca?: string;
  cert?: string;
  key?: string;
  version?: string;
  timeout?: number;
  headers?: Record<string, string>;
  sshAuthAgent?: string;
  sshConnection?: any;
  checkServerIdentity?: boolean;
  enableKeepAlive?: boolean;
  keepAliveMsecs?: number;
  maxSockets?: number;
}

export interface DockerContainerOptions {
  image: string;
  name?: string;
  cmd?: string[];
  entrypoint?: string | string[];
  workingDir?: string;
  env?: string[] | Record<string, string>;
  exposedPorts?: Record<string, any>;
  hostConfig?: {
    binds?: string[];
    portBindings?: Record<string, Array<{ hostPort: string }>>;
    privileged?: boolean;
    publishAllPorts?: boolean;
    restartPolicy?: {
      name: 'no' | 'on-failure' | 'always' | 'unless-stopped';
      maximumRetryCount?: number;
    };
    memory?: number;
    memorySwap?: number;
    cpuShares?: number;
    cpuPeriod?: number;
    cpuQuota?: number;
    cpusetCpus?: string;
    cpusetMems?: string;
    autoRemove?: boolean;
    volumesFrom?: string[];
    capAdd?: string[];
    capDrop?: string[];
    dns?: string[];
    dnsOptions?: string[];
    dnsSearch?: string[];
    extraHosts?: string[];
    groupAdd?: string[];
    ipcMode?: string;
    networkMode?: string;
    oomKillDisable?: boolean;
    pidMode?: string;
    readonlyRootfs?: boolean;
    securityOpt?: string[];
    tmpfs?: Record<string, string>;
    ulimits?: Array<{
      name: string;
      soft: number;
      hard: number;
    }>;
    usernsMode?: string;
    shmSize?: number;
  };
  networkingConfig?: {
    endpointsConfig?: Record<string, any>;
  };
  labels?: Record<string, string>;
  stopSignal?: string;
  stopTimeout?: number;
  healthcheck?: {
    test?: string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    startPeriod?: number;
  };
  shell?: string[];
  attachStdin?: boolean;
  attachStdout?: boolean;
  attachStderr?: boolean;
  tty?: boolean;
  openStdin?: boolean;
  stdinOnce?: boolean;
  user?: string;
  platform?: string;
  macAddress?: string;
  onBuild?: string[];
  stopsignal?: string;
}

export interface DockerExecOptions {
  attachStdin?: boolean;
  attachStdout?: boolean;
  attachStderr?: boolean;
  detachKeys?: string;
  tty?: boolean;
  env?: string[];
  cmd: string[];
  privileged?: boolean;
  user?: string;
  workingDir?: string;
}

export interface DockerSession extends ConsoleSession {
  dockerOptions?: DockerConnectionOptions;
  containerOptions?: DockerContainerOptions;
  execOptions?: DockerExecOptions;
  containerId?: string;
  containerName?: string;
  execId?: string;
  imageId?: string;
  isExecSession?: boolean;
  isRunning?: boolean;
  containerState?: DockerContainerState;
  autoCleanup?: boolean;
  portMappings?: Record<string, string>;
  volumeMounts?: Array<{
    hostPath: string;
    containerPath: string;
    mode?: 'ro' | 'rw';
  }>;
  networkSettings?: {
    networks?: Record<string, any>;
    ports?: Record<string, Array<{ hostIp: string; hostPort: string }>>;
  };
}

export interface DockerContainerState {
  status: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
  running: boolean;
  paused: boolean;
  restarting: boolean;
  oomKilled: boolean;
  dead: boolean;
  pid: number;
  exitCode: number;
  error: string;
  startedAt: Date;
  finishedAt: Date;
  health?: {
    status: 'none' | 'starting' | 'healthy' | 'unhealthy';
    failingStreak: number;
    log?: Array<{
      start: Date;
      end: Date;
      exitCode: number;
      output: string;
    }>;
  };
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  imageId: string;
  command: string;
  created: Date;
  state: DockerContainerState;
  status: string;
  ports: Array<{
    ip?: string;
    privatePort: number;
    publicPort?: number;
    type: 'tcp' | 'udp';
  }>;
  labels: Record<string, string>;
  sizeRw?: number;
  sizeRootFs?: number;
  hostConfig: {
    networkMode: string;
  };
  networkSettings: {
    networks: Record<string, {
      ipamConfig?: any;
      links?: string[];
      aliases?: string[];
      networkId: string;
      endpointId: string;
      gateway: string;
      ipAddress: string;
      ipPrefixLen: number;
      ipv6Gateway: string;
      globalIPv6Address: string;
      globalIPv6PrefixLen: number;
      macAddress: string;
    }>;
  };
  mounts: Array<{
    type: 'bind' | 'volume' | 'tmpfs';
    source: string;
    destination: string;
    mode: string;
    rw: boolean;
    propagation?: string;
  }>;
}

export interface DockerHealthCheck {
  containerId: string;
  checkId: string;
  timestamp: Date;
  status: 'healthy' | 'unhealthy' | 'starting' | 'none';
  output?: string;
  duration: number;
  exitCode?: number;
  retryCount: number;
  maxRetries: number;
  nextCheck?: Date;
  consecutiveFailures: number;
  healthScore: number;
}

export interface DockerLogStreamOptions {
  follow?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  since?: number | Date;
  until?: number | Date;
  timestamps?: boolean;
  tail?: number | 'all';
  details?: boolean;
}

export interface DockerLogEntry {
  timestamp: Date;
  stream: 'stdout' | 'stderr';
  message: string;
  containerId: string;
  containerName?: string;
  raw?: Buffer;
}

export interface DockerNetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: 'local' | 'global' | 'swarm';
  ipam: {
    driver: string;
    config: Array<{
      subnet?: string;
      gateway?: string;
      ipRange?: string;
    }>;
  };
  containers: Record<string, {
    name: string;
    endpointId: string;
    macAddress: string;
    ipv4Address: string;
    ipv6Address: string;
  }>;
  options: Record<string, any>;
  labels: Record<string, string>;
  created: Date;
}

export interface DockerVolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  labels: Record<string, string>;
  scope: 'local' | 'global';
  options: Record<string, any>;
  usageData?: {
    size: number;
    refCount: number;
  };
  created: Date;
}

export interface DockerImageInfo {
  id: string;
  parentId: string;
  repoTags: string[];
  repoDigests: string[];
  created: Date;
  size: number;
  virtualSize: number;
  sharedSize: number;
  labels: Record<string, string>;
  containers: number;
}

export interface DockerRegistryAuth {
  username?: string;
  password?: string;
  email?: string;
  serveraddress?: string;
  auth?: string;
  identitytoken?: string;
  registrytoken?: string;
}

export interface DockerBuildOptions {
  context: string;
  dockerfile?: string;
  tag?: string;
  buildArgs?: Record<string, string>;
  labels?: Record<string, string>;
  target?: string;
  nocache?: boolean;
  pull?: boolean;
  rm?: boolean;
  forcerm?: boolean;
  memory?: number;
  memswap?: number;
  cpushares?: number;
  cpusetcpus?: string;
  cpuperiod?: number;
  cpuquota?: number;
  networkmode?: string;
  platform?: string;
  squash?: boolean;
  cachefrom?: string[];
}

export interface DockerComposeService {
  name: string;
  image?: string;
  build?: string | {
    context: string;
    dockerfile?: string;
    args?: Record<string, string>;
    target?: string;
  };
  command?: string | string[];
  entrypoint?: string | string[];
  environment?: Record<string, string> | string[];
  ports?: string[];
  volumes?: string[];
  depends_on?: string[] | Record<string, {
    condition?: 'service_started' | 'service_healthy' | 'service_completed_successfully';
  }>;
  networks?: string[] | Record<string, {
    aliases?: string[];
    ipv4_address?: string;
    ipv6_address?: string;
  }>;
  restart?: 'no' | 'always' | 'on-failure' | 'unless-stopped';
  user?: string;
  working_dir?: string;
  healthcheck?: {
    test: string[] | string;
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
  labels?: Record<string, string> | string[];
  scale?: number;
}

export interface DockerComposeConfig {
  version: string;
  services: Record<string, DockerComposeService>;
  networks?: Record<string, any>;
  volumes?: Record<string, any>;
  secrets?: Record<string, any>;
  configs?: Record<string, any>;
}

export interface DockerProtocolConfig {
  connection: DockerConnectionOptions;
  containerDefaults: Partial<DockerContainerOptions>;
  execDefaults: Partial<DockerExecOptions>;
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
    retries: number;
    startPeriod: number;
  };
  autoCleanup: boolean;
  logStreaming: {
    enabled: boolean;
    bufferSize: number;
    maxLines: number;
    timestamps: boolean;
  };
  networking: {
    defaultNetwork?: string;
    createNetworks: boolean;
    allowPrivileged: boolean;
  };
  security: {
    allowPrivileged: boolean;
    allowHostNetwork: boolean;
    allowHostPid: boolean;
    restrictedCapabilities: string[];
  };
  performance: {
    connectionPoolSize: number;
    requestTimeout: number;
    keepAliveTimeout: number;
    maxConcurrentOperations: number;
  };
  monitoring: {
    enableMetrics: boolean;
    enableTracing: boolean;
    enableHealthChecks: boolean;
    alertOnFailures: boolean;
  };
}

export interface DockerMetrics {
  containerId: string;
  containerName: string;
  timestamp: Date;
  cpu: {
    usage: number;
    system: number;
    user: number;
    throttledTime: number;
    throttledPeriods: number;
  };
  memory: {
    usage: number;
    limit: number;
    cache: number;
    rss: number;
    maxUsage: number;
    failCount: number;
  };
  network: {
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    rxErrors: number;
    txErrors: number;
    rxDropped: number;
    txDropped: number;
  };
  blockIO: {
    readBytes: number;
    writeBytes: number;
    readOps: number;
    writeOps: number;
  };
  pids: {
    current: number;
    limit: number;
  };
}

export interface DockerEvent {
  type: 'container' | 'image' | 'network' | 'volume' | 'daemon' | 'plugin' | 'service' | 'node' | 'secret' | 'config';
  action: string;
  actor: {
    id: string;
    attributes: Record<string, string>;
  };
  scope: 'local' | 'swarm';
  timestamp: Date;
  timeNano: number;
}

// WSL Connection Options
export interface WSLConnectionOptions {
  // Distribution selection
  distribution?: string;
  distributionVersion?: string;
  defaultDistribution?: boolean;
  
  // WSL version preference
  wslVersion?: 1 | 2 | 'auto';
  
  // User and directory settings
  user?: string;
  workingDirectory?: string;
  
  // Environment settings
  systemdEnabled?: boolean;
  interopEnabled?: boolean;
  appendWindowsPath?: boolean;
  
  // Network settings
  networkMode?: 'mirrored' | 'nat' | 'bridged';
  dnsServers?: string[];
  hostName?: string;
  
  // File system settings
  mountOptions?: string[];
  driveMountPoint?: string;
  filePermissions?: 'metadata' | 'force';
  
  // Performance and resource settings
  memory?: string; // e.g., "8GB"
  processors?: number;
  swap?: string; // e.g., "2GB"
  
  // WSL configuration
  localhostForwarding?: boolean;
  guiApplications?: boolean;
  nestedVirtualization?: boolean;
  
  // Startup settings
  bootCommand?: string;
  systemdTimeout?: number;
  
  // Debugging and logging
  debugConsole?: boolean;
  kernelCommandLine?: string;
  
  // Auto-recovery settings
  autoStart?: boolean;
  autoRestart?: boolean;
  maxRestartAttempts?: number;
  restartDelay?: number;
  
  // Path translation
  automaticPathTranslation?: boolean;
  pathTranslationRules?: PathTranslationRule[];
}

export interface PathTranslationRule {
  windowsPath: RegExp;
  linuxPath: string;
  bidirectional?: boolean;
}

export interface WSLDistribution {
  name: string;
  version: string;
  wslVersion: 1 | 2;
  state: 'Running' | 'Stopped' | 'Installing' | 'Uninstalling';
  defaultDistribution: boolean;
  lastUsed?: Date;
  location?: string;
  size?: number;
  architecture?: 'x64' | 'arm64';
  kernel?: string;
  memoryUsage?: number;
  cpuUsage?: number;
  networkAddress?: string;
}

export interface WSLSystemInfo {
  wslVersion: string;
  installedDistributions: WSLDistribution[];
  defaultDistribution?: string;
  systemdSupport: boolean;
  hyperVEnabled: boolean;
  virtualizationEnabled: boolean;
  kernelVersion: string;
  availableDistributions?: WSLAvailableDistribution[];
}

export interface WSLAvailableDistribution {
  name: string;
  friendlyName: string;
  version?: string;
  source: 'microsoft-store' | 'manual' | 'sideload';
  architecture: 'x64' | 'arm64';
  description?: string;
  size?: number;
  verified: boolean;
}

export interface WSLSession extends ConsoleSession {
  distribution: string;
  wslVersion: 1 | 2;
  systemdEnabled?: boolean;
  networkAddress?: string;
  mountedDrives: string[];
  pathTranslations: Map<string, string>;
  environmentVariables: Map<string, string>;
}

export interface WSLHealthStatus {
  distribution: string;
  status: 'healthy' | 'warning' | 'critical' | 'unavailable';
  wslServiceRunning: boolean;
  distributionResponsive: boolean;
  networkConnectivity: boolean;
  filesystemAccessible: boolean;
  systemdStatus?: 'active' | 'inactive' | 'failed' | 'not-available';
  memoryUsage: number;
  diskUsage: number;
  lastHealthCheck: Date;
  issues: WSLHealthIssue[];
}

export interface WSLHealthIssue {
  type: 'performance' | 'network' | 'filesystem' | 'systemd' | 'memory' | 'configuration';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  resolution?: string;
  autoFixAvailable?: boolean;
}

export interface WSLConfig {
  // Global WSL configuration
  global: {
    memory?: string;
    processors?: number;
    swap?: string;
    localhostForwarding?: boolean;
    networkingMode?: 'mirrored' | 'nat' | 'bridged';
    firewall?: boolean;
    dnsTunneling?: boolean;
    autoProxy?: boolean;
  };
  
  // Per-distribution configuration
  distributions: Record<string, {
    user?: string;
    systemd?: boolean;
    interop?: boolean;
    appendWindowsPath?: boolean;
    generateHosts?: boolean;
    generateResolvConf?: boolean;
    mountOptions?: string;
  }>;
}

// WSL Error Patterns
export interface WSLErrorPattern extends ExtendedErrorPattern {
  wslVersion?: 1 | 2;
  distributionSpecific?: string[];
  systemdRelated?: boolean;
  networkRelated?: boolean;
  filesystemRelated?: boolean;
}


// AWS Systems Manager (SSM) Connection Options
export interface AWSSSMConnectionOptions {
  // Authentication
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  profile?: string;
  roleArn?: string;
  roleSessionName?: string;
  mfaSerial?: string;
  mfaTokenCode?: string;
  externalId?: string;
  durationSeconds?: number;
  
  // SSM Session specific
  instanceId?: string;
  targetType?: 'instance' | 'managed-instance' | 'fargate-task';
  documentName?: string;
  parameters?: Record<string, string[]>;
  
  // Port forwarding specific (for SSM tunnel)
  portNumber?: number;
  localPortNumber?: number;
  
  // Session preferences
  sessionTimeout?: number;
  maxSessionDuration?: number;
  shellProfile?: 'bash' | 'powershell' | 'cmd';
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  
  // Logging configuration
  s3BucketName?: string;
  s3KeyPrefix?: string;
  s3EncryptionEnabled?: boolean;
  cloudWatchLogGroupName?: string;
  cloudWatchEncryptionEnabled?: boolean;
  cloudWatchStreamingEnabled?: boolean;
  
  // Connection settings
  keepAliveInterval?: number;
  connectionTimeout?: number;
  retryAttempts?: number;
  backoffMultiplier?: number;
  jitterEnabled?: boolean;
  
  // Advanced options
  enableSessionManagerPlugin?: boolean;
  customEndpoint?: string;
  useIMDSv2?: boolean;
  tags?: Record<string, string>;
}

// Windows Remote Management (WinRM) Connection Options
export interface WinRMConnectionOptions {
  // Connection settings
  host: string;
  port?: number; // Default 5985 (HTTP) or 5986 (HTTPS)
  protocol?: 'http' | 'https';
  endpoint?: string; // Custom WS-Management endpoint
  
  // Authentication
  username: string;
  password?: string;
  domain?: string; // Windows domain
  authType?: 'basic' | 'negotiate' | 'ntlm' | 'kerberos' | 'credssp' | 'certificate';
  authMethod?: 'basic' | 'negotiate' | 'ntlm' | 'kerberos' | 'credssp' | 'certificate';
  
  // Certificate authentication
  certificatePath?: string;
  certificatePassword?: string;
  clientCertificate?: string; // PEM format certificate
  clientKey?: string; // PEM format private key
  verifyCertificate?: boolean;
  
  // Kerberos settings
  kerberosRealm?: string;
  kerberosService?: string; // Default 'HTTP'
  kerberosHostname?: string;
  
  // CredSSP settings
  enableCredSSP?: boolean;
  credSSPMinVersion?: number;
  credSSPMaxVersion?: number;
  
  // SSL/TLS settings
  enableTLS?: boolean;
  useSSL?: boolean; // Alternative SSL property
  ignoreCertErrors?: boolean;
  verifySSL?: boolean;
  caCertificate?: string;
  
  // PowerShell Remoting specific
  shell?: 'cmd' | 'powershell' | 'pwsh';
  powershellVersion?: '5.1' | '7.0' | '7.1' | '7.2' | '7.3' | '7.4' | 'latest';
  executionPolicy?: 'Restricted' | 'RemoteSigned' | 'AllSigned' | 'Unrestricted' | 'Bypass' | 'Undefined';
  
  // Session configuration
  configurationName?: string; // PowerShell session configuration
  applicationName?: string; // Default 'wsman'
  maxEnvelopeSize?: number; // Max SOAP envelope size
  maxTimeoutMs?: number; // Max operation timeout
  locale?: string; // Locale for error messages
  dataLocale?: string; // Locale for data
  
  // JEA (Just Enough Administration) settings
  jeaEndpoint?: string;
  jeaRoleName?: string;
  jeaSessionType?: 'RestrictedRemoteServer' | 'EmptyShell' | 'Default';
  
  // Proxy settings
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  proxyBypass?: string[];
  
  // Connection pooling and management
  maxConnections?: number;
  timeout?: number;
  connectionTimeout?: number;
  operationTimeout?: number;
  keepAliveInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
  
  // Advanced WS-Management options
  wsmanOptions?: {
    maxEnvelopeSize?: number;
    maxTimeoutMs?: number;
    maxConcurrentOperationsPerUser?: number;
    maxShellsPerUser?: number;
    maxProcessesPerShell?: number;
    maxMemoryPerShellMB?: number;
    maxShellRunTime?: number;
    idleTimeout?: number;
    locale?: string;
    dataLocale?: string;
    allowUnencrypted?: boolean;
    basicAuthOnly?: boolean;
    compressionEnabled?: boolean;
    httpHeaders?: Record<string, string>;
    soapHeaders?: Record<string, string>;
  };
  
  // File transfer settings
  enableFileTransfer?: boolean;
  maxFileSize?: number;
  transferChunkSize?: number;
  
  // Logging and debugging
  enableLogging?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  logPath?: string;
  
  // Security settings
  allowNTLMv1?: boolean;
  requireMutualAuthentication?: boolean;
  enableEncryption?: boolean;
  encryptionLevel?: 'none' | 'sign' | 'encrypt';
  
  // PowerShell specific options
  powershellOptions?: {
    noProfile?: boolean;
    nonInteractive?: boolean;
    executionPolicy?: 'Restricted' | 'RemoteSigned' | 'AllSigned' | 'Unrestricted' | 'Bypass' | 'Undefined';
    windowStyle?: 'Normal' | 'Hidden' | 'Minimized' | 'Maximized';
    workingDirectory?: string;
    modules?: string[]; // Modules to import
    snapins?: string[]; // Snapins to add
    version?: string;
    architecture?: 'x86' | 'x64';
    threadApartmentState?: 'STA' | 'MTA';
    outputBufferingMode?: 'None' | 'Block' | 'Line' | 'Full';
  };
  
  // Custom headers
  customHeaders?: Record<string, string>;
  
  // Resource limits
  resourceLimits?: {
    maxCPUUsage?: number;
    maxMemoryMB?: number;
    maxDiskSpaceMB?: number;
    maxNetworkBandwidthKbps?: number;
    maxExecutionTimeSeconds?: number;
  };
}

// IPMI/BMC Connection Options
export interface IPMIConnectionOptions {
  host: string;
  port?: number; // Default: 623
  username: string;
  password: string;
  
  // IPMI Version Support
  ipmiVersion?: '1.5' | '2.0'; // Default: 2.0
  
  // Authentication and Privilege Levels
  privilegeLevel?: 'user' | 'operator' | 'admin'; // Default: admin
  authenticationType?: 'none' | 'md2' | 'md5' | 'password' | 'oem';
  
  // Cipher Suite Selection for IPMI 2.0
  cipherSuite?: number; // 0-17, Default: 3 (AES-128-CBC, SHA1-HMAC)
  
  // Session Settings
  sessionTimeout?: number; // Default: 30000ms
  maxRetries?: number; // Default: 3
  retryDelay?: number; // Default: 1000ms
  keepAliveInterval?: number; // Default: 10000ms
  
  // Interface Type
  interface?: 'lan' | 'lanplus' | 'serial' | 'open'; // Default: lanplus
  
  // Vendor Specific Settings
  vendor?: 'dell' | 'hp' | 'ibm' | 'supermicro' | 'generic'; // Default: generic
  
  // Serial over LAN Settings
  sol?: {
    enabled: boolean;
    payloadType?: number; // Default: 1
    port?: number; // Default: 623
    privilege?: string;
    encryption?: boolean;
    authentication?: boolean;
  };
  
  // DCMI Settings
  dcmi?: {
    enabled: boolean;
    powerCapping?: boolean;
    thermalManagement?: boolean;
    assetTag?: boolean;
  };
  
  // Advanced Settings
  bridging?: {
    enabled: boolean;
    targetChannel?: number;
    targetAddress?: number;
    transitChannel?: number;
    transitAddress?: number;
  };
  
  // Security Settings
  kg?: string; // BMC Key for enhanced security
  confidentialityAlgorithm?: 'none' | 'aes-cbc-128';
  integrityAlgorithm?: 'none' | 'hmac-sha1-96' | 'hmac-md5-128' | 'md5-128';
  
  // Protocol Timeouts
  timeouts?: {
    connection: number;
    response: number;
    session: number;
    sol: number;
  };
  
  // Monitoring Settings
  sensorPollingInterval?: number; // Default: 30000ms
  enableEventLog?: boolean; // Default: false
  eventLogPollingInterval?: number; // Default: 60000ms
}

// IPC Connection Options
export interface IPCConnectionOptions {
  // Common IPC settings
  path: string; // Named pipe path (Windows) or Unix domain socket path
  mode?: 'stream' | 'datagram'; // Communication mode
  createIfNotExists?: boolean; // Create the IPC endpoint if it doesn't exist
  
  // Named Pipe specific (Windows)
  namedPipe?: {
    pipeName: string; // e.g., '\\\\.\\pipe\\MyPipe' or 'MyPipe'
    serverName?: string; // Default: '.' (local machine)
    accessMode?: 'duplex' | 'read' | 'write'; // Pipe access mode
    pipeMode?: 'message' | 'byte'; // Message vs byte mode
    maxInstances?: number; // Maximum pipe instances
    bufferSize?: number; // Buffer size
    timeout?: number; // Connection timeout
    securityAttributes?: {
      inheritHandle?: boolean;
      securityDescriptor?: string; // Security descriptor string
    };
    flags?: ('write_through' | 'overlapped' | 'first_instance_only')[];
  };
  
  // Unix Domain Socket specific (Linux/macOS)
  unixSocket?: {
    socketPath: string; // Absolute path to socket file
    abstract?: boolean; // Use abstract namespace (Linux only)
    socketType?: 'stream' | 'dgram' | 'seqpacket'; // Socket type
    permissions?: string; // File permissions (e.g., '0755')
    uid?: number; // Owner user ID
    gid?: number; // Owner group ID
    unlink?: boolean; // Remove existing socket file
  };
  
  // Docker socket integration
  dockerSocket?: {
    socketPath?: string; // Default: '/var/run/docker.sock' (Linux) or '\\\\.\\pipe\\docker_engine' (Windows)
    apiVersion?: string; // Docker API version
    timeout?: number;
    headers?: Record<string, string>;
  };
  
  // Windows Mailslots (for broadcast communication)
  mailslot?: {
    mailslotName: string; // e.g., '\\\\.\\mailslot\\MyMailslot'
    serverName?: string; // '*' for all computers, '.' for local
    maxMessageSize?: number; // Maximum message size
    readTimeout?: number; // Read timeout in milliseconds
    broadcast?: boolean; // Enable broadcast mode
  };
  
  // D-Bus integration (Linux)
  dbus?: {
    busType?: 'system' | 'session' | 'custom'; // D-Bus bus type
    busAddress?: string; // Custom bus address
    serviceName?: string; // Service name to connect to
    objectPath?: string; // Object path
    interfaceName?: string; // Interface name
    timeout?: number; // Method call timeout
  };
  
  // COM integration (Windows)
  com?: {
    progId?: string; // Program ID (e.g., 'Excel.Application')
    clsid?: string; // Class ID (GUID)
    interfaceId?: string; // Interface ID (GUID)
    serverType?: 'in_process' | 'local_server' | 'remote_server';
    serverName?: string; // For remote server
    authentication?: {
      level?: 'none' | 'connect' | 'call' | 'packet' | 'packet_integrity' | 'packet_privacy';
      impersonation?: 'anonymous' | 'identify' | 'impersonate' | 'delegate';
    };
  };
  
  // Message framing and protocol
  messageFraming?: {
    protocol?: 'length_prefixed' | 'delimiter' | 'fixed_length' | 'json_lines' | 'custom';
    delimiter?: string; // For delimiter-based framing
    lengthBytes?: number; // Number of bytes for length prefix (1, 2, 4, 8)
    maxMessageSize?: number; // Maximum message size
    encoding?: 'utf8' | 'ascii' | 'binary' | 'base64';
    compression?: 'none' | 'gzip' | 'deflate' | 'brotli';
    encryption?: {
      algorithm?: 'aes-256-gcm' | 'aes-256-cbc' | 'chacha20-poly1305';
      key?: string | Buffer;
      iv?: string | Buffer;
    };
  };
  
  // Connection behavior
  reconnect?: boolean; // Automatically reconnect on disconnect
  reconnectInterval?: number; // Reconnection interval in ms
  maxReconnectAttempts?: number; // Maximum reconnection attempts
  keepAlive?: boolean; // Enable keep-alive
  keepAliveInterval?: number; // Keep-alive interval in ms
  
  // Security and permissions
  security?: {
    requireAuthentication?: boolean;
    allowedUsers?: string[]; // Allowed user names/IDs
    allowedGroups?: string[]; // Allowed group names/IDs
    securityContext?: string; // SELinux context (Linux)
    runAs?: {
      user?: string;
      group?: string;
    };
  };
  
  // Logging and monitoring
  logging?: {
    enabled?: boolean;
    level?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
    logFile?: string;
    maxLogSize?: number;
    rotateLogFiles?: boolean;
  };
  
  // Performance tuning
  performance?: {
    bufferSize?: number; // I/O buffer size
    queueSize?: number; // Message queue size
    workerThreads?: number; // Number of worker threads
    poolSize?: number; // Connection pool size
    batchSize?: number; // Message batch size
    flushInterval?: number; // Buffer flush interval
  };
}

export interface IPCSessionState {
  sessionId: string;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'ready' | 'error';
  ipcType: 'named-pipe' | 'unix-socket' | 'docker-socket' | 'mailslot' | 'dbus' | 'com';
  endpoint: string; // Connection endpoint/path
  
  // Connection info
  connectionInfo: {
    localEndpoint?: string;
    remoteEndpoint?: string;
    protocol: string;
    established: Date;
    lastActivity: Date;
  };
  
  // Security context
  securityContext?: {
    authenticated: boolean;
    userId?: string;
    groupId?: string;
    permissions?: string[];
    securityDescriptor?: string;
  };
  
  // Statistics
  statistics: {
    messagesReceived: number;
    messagesSent: number;
    bytesReceived: number;
    bytesSent: number;
    errors: number;
    reconnections: number;
    lastError?: string;
  };
  
  // Protocol-specific state
  namedPipeState?: {
    pipeHandle?: any; // Windows HANDLE
    serverMode: boolean;
    clientCount: number;
    instanceId: number;
  };
  
  unixSocketState?: {
    socketFd?: number; // File descriptor
    socketType: 'stream' | 'dgram' | 'seqpacket';
    abstract: boolean;
    permissions: string;
  };
  
  dockerSocketState?: {
    apiVersion: string;
    serverInfo?: any;
    containers?: string[];
  };
  
  dbusState?: {
    busType: 'system' | 'session' | 'custom';
    uniqueName?: string;
    serviceName?: string;
    ownedNames: string[];
  };
  
  comState?: {
    progId?: string;
    clsid?: string;
    interfacePointer?: any; // COM interface pointer
    threadingModel: string;
  };
}

export interface IPCMessage {
  id: string;
  type: 'command' | 'response' | 'event' | 'broadcast';
  timestamp: Date;
  sessionId?: string;
  
  // Message content
  payload: any;
  encoding?: 'utf8' | 'binary' | 'base64';
  compressed?: boolean;
  encrypted?: boolean;
  
  // Routing information
  source?: string;
  destination?: string;
  replyTo?: string;
  correlationId?: string;
  
  // Protocol-specific headers
  headers?: Record<string, any>;
  
  // Quality of service
  priority?: 'low' | 'normal' | 'high' | 'critical';
  ttl?: number; // Time to live in milliseconds
  persistent?: boolean; // Should survive restarts
  
  // Error information
  error?: {
    code: number;
    message: string;
    details?: any;
  };
}

export interface WinRMSession {
  id: string;
  sessionId: string;
  state: WinRMSessionState;
  options: WinRMConnectionOptions;
  activeCommands: Map<string, { command: string; startTime: Date; status: 'running' | 'completed' | 'failed' }>;
}

export interface WinRMSessionState {
  sessionId: string;
  shellId?: string;
  commandId?: string;
  connectionState?: 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'ready' | 'executing' | 'error';
  isConnected: boolean; // Added for consistency with other session states
  authenticationType?: 'basic' | 'negotiate' | 'ntlm' | 'kerberos' | 'credssp' | 'certificate';
  protocolVersion?: string;
  serverInfo?: {
    productVersion?: string;
    protocolVersion?: string;
    buildNumber?: string;
    maxEnvelopeSize?: number;
    maxTimeoutMs?: number;
    maxBatchItems?: number;
    maxConcurrentOperations?: number;
    supportedAuthentication?: string[];
    supportedCompression?: string[];
    supportedEncryption?: string[];
  };
  clientInfo?: {
    locale: string;
    dataLocale: string;
    userAgent: string;
    clientVersion: string;
  };
  sessionConfig?: {
    name: string;
    shellUri: string;
    resourceUri: string;
    maxIdleTimeoutMs: number;
    maxLifeTimeMs: number;
    inputStreams: string[];
    outputStreams: string[];
  };
  statistics?: {
    connectTime: Date;
    lastActivity: Date;
    commandsExecuted: number;
    bytesReceived: number;
    bytesSent: number;
    errors: number;
    timeouts: number;
  };
  // ConsoleManager compatibility properties
  username?: string;
  host?: string;
  port?: number;
  protocol?: string;
  authType?: string;
  connectedAt?: Date;
  lastActivity?: Date;
  shells?: Map<any, any>;
  activeCommands?: Map<any, any>;
  transferredFiles?: any[];
  performanceCounters?: {
    commandsExecuted: number;
    bytesTransferred: number;
    averageResponseTime: number;
    errorCount: number;
    reconnections: number;
  };
  status?: string;
  currentOperation?: {
    operationId: string;
    type: 'command' | 'receive' | 'send' | 'terminate';
    startTime: Date;
    timeout: number;
  };
  errorState?: {
    lastError: string;
    errorCode: number;
    errorDetails: string;
    faultString?: string;
    faultCode?: string;
  };
  outputBuffer?: Array<{
    data: string;
    timestamp: Date;
    stream: 'stdout' | 'stderr';
  }>;
}

export interface WinRMProtocol {
  connect(options: WinRMConnectionOptions): Promise<WinRMSession>;
  disconnect(session: WinRMSession): Promise<void>;
  executeCommand(session: WinRMSession, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  createShell(session: WinRMSession): Promise<string>;
  executeInShell(session: WinRMSession, shellId: string, command: string): Promise<string>;
  closeShell(session: WinRMSession, shellId: string): Promise<void>;
  isConnected(session: WinRMSession): boolean;
  getCapabilities(): Promise<WinRMCapabilities>;
  healthCheck(session: WinRMSession): Promise<WinRMHealthCheck>;
}

// IPMI Session State
export interface IPMISessionState {
  sessionId: string;
  ipmiSessionId?: number;
  managedSystemSessionId?: number;
  connectionState: 'disconnected' | 'connecting' | 'authenticating' | 'session-setup' | 'connected' | 'sol-active' | 'error';
  ipmiVersion: '1.5' | '2.0';
  cipherSuite: number;
  authType: number;
  privilegeLevel: 'user' | 'operator' | 'admin';
  
  // Session Keys (for IPMI 2.0)
  sik?: Buffer; // Session Integrity Key
  k1?: Buffer;  // Additional Key Generation Key 1
  k2?: Buffer;  // Additional Key Generation Key 2
  kg?: Buffer;  // BMC Key
  
  // BMC Device Info
  deviceInfo?: {
    deviceId: number;
    deviceRevision: number;
    firmwareVersion: string;
    ipmiVersion: string;
    manufacturerId: number;
    productId: number;
    deviceGuid?: string;
    vendorName?: string;
    productName?: string;
    supportedFunctions: string[];
  };
  
  // Serial over LAN State
  solState?: {
    active: boolean;
    payloadInstance: number;
    sequenceNumber: number;
    acknowledgmentNumber: number;
    characterCount: number;
    status: number;
  };
  
  // Hardware Monitoring State
  monitoringState?: {
    enabled: boolean;
    sensorCount: number;
    lastSensorUpdate: Date;
    hardwareHealth: 'ok' | 'warning' | 'critical';
    activeSensors: number[];
  };
  
  // Power State
  powerState?: {
    current: 'off' | 'on' | 'cycling' | 'unknown';
    supportedOperations: string[];
    lastPowerOperation?: Date;
  };
  
  // Virtual Media State
  virtualMediaState?: {
    mountedDevices: Array<{
      deviceId: number;
      mediaType: string;
      connected: boolean;
      writeProtected: boolean;
      imagePath?: string;
    }>;
  };
  
  // Connection Statistics
  statistics: {
    connectTime: Date;
    lastActivity: Date;
    commandsExecuted: number;
    solCharactersSent: number;
    solCharactersReceived: number;
    sensorsRead: number;
    powerOperations: number;
    errors: number;
    timeouts: number;
    reconnections: number;
  };
  
  // Current Operation
  currentOperation?: {
    operationId: string;
    type: 'command' | 'sensor-read' | 'power-control' | 'sol-data' | 'virtual-media' | 'firmware-update';
    startTime: Date;
    timeout: number;
    retryCount: number;
  };
  
  // Error State
  errorState?: {
    lastError: string;
    ipmiCompletionCode?: number;
    errorDetails: string;
    recoveryAttempts: number;
    lastRecoveryTime?: Date;
  };
  
  // Vendor Specific State
  vendorState?: {
    vendor: 'dell' | 'hp' | 'ibm' | 'supermicro' | 'generic';
    vendorExtensions: Record<string, any>;
    customCommands?: string[];
  };
}

export interface WinRMCommand {
  id: string;
  sessionId: string;
  shellId: string;
  commandId: string;
  command: string;
  arguments?: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'terminated' | 'timeout';
  startTime?: Date;
  endTime?: Date;
  exitCode?: number;
  output: {
    stdout: string[];
    stderr: string[];
    debug?: string[];
    verbose?: string[];
    warning?: string[];
    error?: string[];
    information?: string[];
  };
  streams: {
    stdin?: string;
    stdout?: string;
    stderr?: string;
  };
  // ConsoleManager compatibility properties (direct access to output)
  stdout?: string;
  stderr?: string;
  metadata: {
    executionPolicy?: string;
    runAsUser?: string;
    elevationRequired?: boolean;
    timeout?: number;
    priority?: 'low' | 'normal' | 'high' | 'realtime';
  };
}

export interface WinRMShell {
  id: string;
  sessionId: string;
  shellId: string;
  resourceUri: string;
  inputStreams: string[];
  outputStreams: string[];
  environment?: Record<string, string>;
  workingDirectory?: string;
  idleTimeoutMs?: number;
  lifetimeMs?: number;
  codePage?: number;
  profile?: string;
  status: 'created' | 'running' | 'terminated' | 'error';
  creationTime: Date;
  lastActivity: Date;
  commandCount: number;
  activeCommands: string[];
  variables: Record<string, any>;
  functions: Record<string, string>;
  aliases: Record<string, string>;
  modules: string[];
  snapins: string[];
}

export interface WinRMFileTransfer {
  id: string;
  sessionId: string;
  type: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  size: number;
  transferred: number;
  progress: number;
  status: 'queued' | 'transferring' | 'completed' | 'failed' | 'cancelled';
  startTime?: Date;
  endTime?: Date;
  speed: number; // bytes per second
  eta: number; // seconds
  checksum?: {
    algorithm: 'md5' | 'sha1' | 'sha256';
    local?: string;
    remote?: string;
    verified?: boolean;
  };
  error?: string;
  chunkSize: number;
  compression?: boolean;
  encryption?: boolean;
}

export interface WinRMCapabilities {
  protocolVersion: string;
  productVersion: string;
  authentication: string[];
  encryption: string[];
  compression: string[];
  maxEnvelopeSize: number;
  maxTimeoutMs: number;
  maxConcurrentOperations: number;
  maxShellsPerUser: number;
  maxProcessesPerShell: number;
  maxMemoryPerShellMB: number;
  supportedShells: string[];
  supportedCommands: string[];
  fileTransferSupported: boolean;
  streamingSupported: boolean;
  eventingSupported: boolean;
  subscriptionSupported: boolean;
  fragments: {
    maxReceiveSize: number;
    maxSendSize: number;
  };
  wsman: {
    version: string;
    buildNumber: string;
    features: string[];
    plugins: string[];
  };
  powershell?: {
    versions: string[];
    executionPolicies: string[];
    editions: string[];
    compatibility: string[];
    modules: string[];
    snapins: string[];
  };
}

export interface WinRMHealthCheck {
  sessionId: string;
  timestamp: Date;
  status: 'healthy' | 'warning' | 'critical' | 'error';
  responseTime: number;
  connectionStatus: 'connected' | 'disconnected' | 'timeout';
  authenticationStatus: 'success' | 'failed' | 'expired';
  protocolStatus: 'active' | 'inactive' | 'error';
  shellStatus: 'available' | 'busy' | 'error';
  memoryUsage: {
    used: number;
    available: number;
    percentage: number;
  };
  cpuUsage: {
    percentage: number;
    processes: number;
  };
  networkStatus: {
    latency: number;
    bandwidth: number;
    packetLoss: number;
  };
  errorCount: number;
  warningCount: number;
  lastError?: string;
  checks: {
    connectivity: boolean;
    authentication: boolean;
    authorization: boolean;
    shellCreation: boolean;
    commandExecution: boolean;
    fileTransfer?: boolean;
  };
  recommendations: string[];
}

export interface WinRMEventLog {
  sessionId: string;
  timestamp: Date;
  level: 'verbose' | 'information' | 'warning' | 'error' | 'critical';
  source: 'winrm' | 'wsman' | 'powershell' | 'system';
  eventId: number;
  message: string;
  details?: Record<string, any>;
  user?: string;
  computer?: string;
  processId?: number;
  threadId?: number;
  activityId?: string;
  relatedActivityId?: string;
  keywords?: string[];
  task?: string;
  opcode?: string;
  channel?: string;
  provider?: string;
}

export interface WinRMPerformanceCounters {
  sessionId: string;
  timestamp: Date;
  counters: {
    // WinRM specific counters
    connectionsPerSecond: number;
    activeConnections: number;
    totalConnections: number;
    failedConnections: number;
    
    // WS-Management counters
    requestsPerSecond: number;
    averageRequestTime: number;
    requestsQueued: number;
    requestsActive: number;
    requestsFailed: number;
    
    // PowerShell counters
    shellsCreated: number;
    shellsActive: number;
    commandsExecuted: number;
    commandsPerSecond: number;
    averageCommandTime: number;
    
    // System resources
    cpuUsage: number;
    memoryUsage: number;
    handleCount: number;
    threadCount: number;
    
    // Network
    bytesReceivedPerSecond: number;
    bytesSentPerSecond: number;
    networkLatency: number;
  };
  samples: number;
  interval: number;
}

export interface AWSSSMSession {
  sessionId: string;
  sessionToken: string;
  tokenValue: string;
  streamUrl: string;
  instanceId?: string;
  targetType: 'instance' | 'managed-instance' | 'fargate-task';
  documentName: string;
  parameters: Record<string, string[]>;
  status: 'Connected' | 'Connecting' | 'Disconnected' | 'Failed' | 'Terminated' | 'Terminating';
  creationDate: Date;
  lastAccessedDate: Date;
  owner: string;
  reason?: string;
  details?: string;
  
  // Port forwarding session info
  portNumber?: number;
  localPortNumber?: number;
  
  // Session configuration
  sessionTimeout: number;
  maxSessionDuration: number;
  shellProfile?: string;
  workingDirectory?: string;
  environmentVariables: Record<string, string>;
  
  // Logging info
  s3OutputLocation?: {
    outputS3BucketName: string;
    outputS3KeyPrefix: string;
    outputS3Region: string;
  };
  cloudWatchOutputConfig?: {
    cloudWatchLogGroupName: string;
    cloudWatchEncryptionEnabled: boolean;
  };
  
  // Connection metadata
  region: string;
  accountId: string;
  userName?: string;
  assumedRoleArn?: string;
  sourceIp?: string;
  userAgent?: string;
  clientVersion?: string;
  
  // Session statistics
  statistics?: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
    commandsExecuted: number;
    errorsCount: number;
    lastActivityTime: Date;
  };
  
  // Compliance and audit
  tags: Record<string, string>;
  complianceInfo?: {
    recordingEnabled: boolean;
    encryptionEnabled: boolean;
    retentionPolicy: string;
    auditLogEnabled: boolean;
  };
}

export interface AWSSSMDocument {
  name: string;
  owner: string;
  versionName?: string;
  platformTypes: string[];
  documentType: 'Command' | 'Policy' | 'Automation' | 'Session' | 'Package' | 'ApplicationConfiguration' | 'ApplicationConfigurationSchema' | 'DeploymentStrategy' | 'ChangeCalendar' | 'Automation.ChangeTemplate' | 'ProblemAnalysis' | 'ProblemAnalysisTemplate' | 'CloudFormation' | 'ConformancePackTemplate' | 'QuickSetup';
  schemaVersion: string;
  documentVersion: string;
  status: 'Creating' | 'Active' | 'Updating' | 'Failed' | 'Deleting';
  statusInformation?: string;
  parameters?: {
    [key: string]: {
      type: 'String' | 'StringList' | 'Integer' | 'Boolean' | 'MapStringString';
      description?: string;
      defaultValue?: any;
      allowedValues?: string[];
      allowedPattern?: string;
      maxChars?: number;
      minChars?: number;
      maxItems?: number;
      minItems?: number;
    };
  };
  description?: string;
  tags?: Array<{
    key: string;
    value: string;
  }>;
  targetType?: string;
  createdDate: Date;
  reviewStatus?: 'APPROVED' | 'NOT_REVIEWED' | 'PENDING' | 'REJECTED';
  reviewInformation?: {
    reviewedTime?: Date;
    status?: 'APPROVED' | 'NOT_REVIEWED' | 'PENDING' | 'REJECTED';
    reviewer?: string;
  }[];
  author?: string;
  displayName?: string;
  category?: string[];
  categoryEnum?: string[];
}

export interface AWSSSMCommandExecution {
  commandId: string;
  documentName: string;
  comment?: string;
  parameters: Record<string, string[]>;
  instanceIds?: string[];
  targets?: Array<{
    key: string;
    values: string[];
  }>;
  requestedDateTime: Date;
  status: 'Pending' | 'InProgress' | 'Success' | 'Cancelled' | 'Failed' | 'TimedOut' | 'Cancelling';
  statusDetails: string;
  outputS3Region?: string;
  outputS3BucketName?: string;
  outputS3KeyPrefix?: string;
  maxConcurrency?: string;
  maxErrors?: string;
  targetCount?: number;
  completedCount?: number;
  errorCount?: number;
  deliveryTimedOutCount?: number;
  serviceRole?: string;
  notificationConfig?: {
    notificationArn?: string;
    notificationEvents?: string[];
    notificationType?: 'Command' | 'Invocation';
  };
  cloudWatchOutputConfig?: {
    cloudWatchLogGroupName: string;
    cloudWatchOutputEnabled: boolean;
  };
  timeoutSeconds?: number;
  alarmConfiguration?: {
    ignorePollAlarmFailure?: boolean;
    alarms: Array<{
      name: string;
    }>;
  };
  triggeredAlarms?: Array<{
    name: string;
    state: 'UNKNOWN' | 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
  }>;
}

export interface AWSSSMPortForwardingSession {
  sessionId: string;
  targetId: string;
  targetType: 'instance' | 'managed-instance' | 'fargate-task';
  portNumber: number;
  localPortNumber: number;
  protocol: 'TCP' | 'UDP';
  status: 'Connected' | 'Connecting' | 'Disconnected' | 'Failed' | 'Terminated';
  creationDate: Date;
  lastAccessedDate: Date;
  owner: string;
  reason?: string;
  details?: string;
  
  // Connection statistics
  statistics?: {
    connectionsActive: number;
    connectionsTotal: number;
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
    errorsCount: number;
    lastActivityTime: Date;
  };
  
  // Session metadata
  sessionToken: string;
  streamUrl: string;
  region: string;
  tags: Record<string, string>;
}

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

export interface AWSSTSAssumedRole {
  credentials: AWSCredentials;
  assumedRoleUser: {
    assumedRoleId: string;
    arn: string;
  };
  packedPolicySize?: number;
  sourceIdentity?: string;
}

export interface AWSSSMTarget {
  type: 'instance' | 'managed-instance' | 'fargate-task' | 'tag' | 'resource-group';
  id: string;
  name?: string;
  platformType?: 'Windows' | 'Linux' | 'MacOS';
  platformName?: string;
  platformVersion?: string;
  architecture?: string;
  ipAddress?: string;
  status?: 'Online' | 'ConnectionLost' | 'Inactive';
  lastPingDateTime?: Date;
  lastAssociationExecutionDate?: Date;
  associationStatus?: 'Pending' | 'Success' | 'Failed';
  agentVersion?: string;
  isLatestVersion?: boolean;
  tags?: Record<string, string>;
  iamRole?: string;
  registrationDate?: Date;
  activationId?: string;
  resourceType?: string;
}

export interface AWSSSMRetryConfig {
  maxRetries: number;
  retryDelayOptions: {
    base: number;
    customBackoff?: (retryCount: number, err?: Error) => number;
  };
}

export interface AWSSSMError {
  code: string;
  message: string;
  statusCode?: number;
  retryable: boolean;
  retryDelay?: number;
  throttling?: boolean;
  requestId?: string;
  cfId?: string;
  extendedRequestId?: string;
  region?: string;
  time?: Date;
  originalError?: Error;
}

export interface AWSSSMSessionLog {
  sessionId: string;
  timestamp: Date;
  eventType: 'SessionStart' | 'SessionEnd' | 'DataStreamEvent' | 'CommandExecution' | 'ErrorEvent';
  source: 'client' | 'target' | 'system';
  data: string;
  dataType: 'stdin' | 'stdout' | 'stderr' | 'system';
  byteCount: number;
  sequenceNumber: number;
  userId?: string;
  accountId: string;
  region: string;
  sourceIp?: string;
  userAgent?: string;
  sessionOwner: string;
  targetId?: string;
  targetType?: 'instance' | 'managed-instance' | 'fargate-task';
  
  // For compliance and audit
  complianceMarkers?: {
    piiDetected?: boolean;
    sensitiveDataDetected?: boolean;
    complianceLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    tags: string[];
  };
}

export interface AWSSSMSessionManagerConfig {
  // Global settings
  regionConfig: {
    defaultRegion: string;
    allowedRegions: string[];
    regionPriority: string[];
  };
  
  // Authentication settings
  authConfig: {
    credentialChain: ('environment' | 'profile' | 'iam-role' | 'instance-profile' | 'ecs-task-role' | 'web-identity')[];
    assumeRoleConfig?: {
      roleArn: string;
      roleSessionName: string;
      externalId?: string;
      durationSeconds?: number;
      policy?: string;
      policyArns?: string[];
    };
    mfaConfig?: {
      mfaSerial: string;
      tokenCodeCallback?: () => Promise<string>;
    };
  };
  
  // Session settings
  sessionConfig: {
    defaultDocumentName: string;
    defaultShellProfile: 'bash' | 'powershell' | 'cmd';
    defaultWorkingDirectory?: string;
    defaultEnvironmentVariables: Record<string, string>;
    sessionTimeout: number;
    maxSessionDuration: number;
    keepAliveInterval: number;
    maxConcurrentSessions: number;
  };
  
  // Logging settings
  loggingConfig: {
    enabled: boolean;
    s3Config?: {
      bucketName: string;
      keyPrefix: string;
      encryptionEnabled: boolean;
      kmsKeyId?: string;
    };
    cloudWatchConfig?: {
      logGroupName: string;
      encryptionEnabled: boolean;
      kmsKeyId?: string;
      streamingEnabled: boolean;
    };
    localLogging?: {
      enabled: boolean;
      logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
      logFilePath?: string;
      maxFileSize: number;
      maxFiles: number;
    };
  };
  
  // Connection settings
  connectionConfig: {
    connectionTimeout: number;
    retryAttempts: number;
    backoffMultiplier: number;
    jitterEnabled: boolean;
    customEndpoints?: Record<string, string>;
    useIMDSv2: boolean;
  };
  
  // Security settings
  securityConfig: {
    allowedInstanceIds?: string[];
    allowedInstanceTags?: Array<{ key: string; values: string[] }>;
    restrictedCommands?: string[];
    sessionRecordingEnabled: boolean;
    complianceMode: boolean;
    encryptionInTransit: boolean;
    encryptionAtRest: boolean;
  };
  
  // Monitoring and metrics
  monitoringConfig: {
    metricsEnabled: boolean;
    cloudWatchMetrics: boolean;
    customMetrics: boolean;
    healthCheckInterval: number;
    alertingEnabled: boolean;
    alertConfig?: {
      snsTopicArn?: string;
      slackWebhook?: string;
      emailRecipients?: string[];
    };
  };
}

// SFTP/SCP File Transfer Types
export interface SFTPTransferOptions {
  source: string;
  destination: string;
  recursive?: boolean;
  preservePermissions?: boolean;
  preserveTimestamps?: boolean;
  overwrite?: boolean;
  createDirectories?: boolean;
  followSymlinks?: boolean;
  compression?: boolean;
  bandwidth?: number; // bytes per second limit
  priority?: 'low' | 'normal' | 'high' | 'critical';
  retryAttempts?: number;
  resumeSupport?: boolean;
  checksumVerification?: boolean;
}

export interface SFTPFileInfo {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'special';
  size: number;
  mode: number;
  uid: number;
  gid: number;
  atime: Date;
  mtime: Date;
  isReadable: boolean;
  isWritable: boolean;
  isExecutable: boolean;
  linkTarget?: string;
  checksum?: string;
}

export interface SFTPDirectoryListing {
  path: string;
  files: SFTPFileInfo[];
  directories: SFTPFileInfo[];
  symlinks: SFTPFileInfo[];
  totalSize: number;
  totalFiles: number;
  totalDirectories: number;
}

export interface SFTPTransferProgress {
  transferId: string;
  sessionId: string;
  operation: 'upload' | 'download' | 'sync';
  status: 'queued' | 'preparing' | 'transferring' | 'verifying' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'resumed';
  source: string;
  destination: string;
  totalBytes: number;
  transferredBytes: number;
  percentage: number;
  speed: number; // bytes per second
  eta: number; // seconds
  startTime: Date;
  endTime?: Date;
  error?: string;
  checksumMatch?: boolean;
  retryAttempt?: number;
}

export interface SFTPBatchTransfer {
  batchId: string;
  sessionId: string;
  transfers: SFTPTransferOptions[];
  concurrency: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: SFTPTransferProgress[];
  totalTransfers: number;
  completedTransfers: number;
  failedTransfers: number;
  totalBytes: number;
  transferredBytes: number;
  overallProgress: number;
  startTime?: Date;
  endTime?: Date;
  errors: string[];
}

export interface SFTPSessionOptions extends SSHConnectionOptions {
  maxConcurrentTransfers?: number;
  defaultTransferOptions?: Partial<SFTPTransferOptions>;
  transferQueue?: {
    maxSize: number;
    priorityLevels: number;
    timeoutMs: number;
  };
  bandwidth?: {
    uploadLimit?: number;
    downloadLimit?: number;
    adaptiveThrottling?: boolean;
  };
  resumeDirectory?: string;
  tempDirectory?: string;
  compressionLevel?: number;
  keepAlive?: {
    enabled: boolean;
    interval: number;
    maxMissed: number;
  };
}

// Type alias for ssh2-sftp-client FileInfoType
type FileInfoType = "d" | "-" | "l";

export interface SFTPDirectoryOperations {
  create: (path: string, mode?: number, recursive?: boolean) => Promise<void>;
  remove: (path: string, recursive?: boolean) => Promise<void>;
  list: (path: string, detailed?: boolean) => Promise<SFTPDirectoryListing>;
  exists: (path: string) => Promise<false | FileInfoType>;
  chmod: (path: string, mode: number) => Promise<void>;
  chown: (path: string, uid: number, gid: number) => Promise<void>;
  stat: (path: string) => Promise<SFTPFileInfo>;
  realpath: (path: string) => Promise<string>;
  readlink: (path: string) => Promise<string>;
  symlink: (target: string, path: string) => Promise<void>;
}

export interface SFTPFileOperations {
  upload: (localPath: string, remotePath: string, options?: Partial<SFTPTransferOptions>) => Promise<SFTPTransferProgress>;
  download: (remotePath: string, localPath: string, options?: Partial<SFTPTransferOptions>) => Promise<SFTPTransferProgress>;
  copy: (sourcePath: string, destinationPath: string, options?: Partial<SFTPTransferOptions>) => Promise<SFTPTransferProgress>;
  move: (sourcePath: string, destinationPath: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  exists: (path: string) => Promise<false | FileInfoType>;
  checksum: (path: string, algorithm?: 'md5' | 'sha1' | 'sha256') => Promise<string>;
  compare: (localPath: string, remotePath: string) => Promise<{ identical: boolean; differences: string[] }>;
}

export interface SFTPSyncOptions extends SFTPTransferOptions {
  direction: 'push' | 'pull' | 'bidirectional';
  deleteExtraneous?: boolean;
  excludePatterns?: string[];
  includePatterns?: string[];
  ignoreSymlinks?: boolean;
  ignoreHiddenFiles?: boolean;
  syncMode: 'timestamp' | 'checksum' | 'size' | 'hybrid';
  conflictResolution: 'newer' | 'larger' | 'local' | 'remote' | 'prompt' | 'skip';
  dryRun?: boolean;
}

export interface SFTPSyncResult {
  syncId: string;
  sessionId: string;
  options: SFTPSyncOptions;
  summary: {
    filesTransferred: number;
    filesSkipped: number;
    filesDeleted: number;
    directoriesCreated: number;
    directoriesDeleted: number;
    totalBytes: number;
    transferTime: number;
    conflicts: number;
  };
  details: {
    transferred: SFTPFileInfo[];
    skipped: SFTPFileInfo[];
    deleted: SFTPFileInfo[];
    conflicts: Array<{
      file: SFTPFileInfo;
      reason: string;
      resolution: string;
    }>;
  };
  errors: string[];
  warnings: string[];
}

export interface SFTPConnectionState {
  sessionId: string;
  isConnected: boolean;
  connectionTime: Date;
  lastActivity: Date;
  serverInfo: {
    version: string;
    extensions: string[];
    limits: {
      maxPacketLength: number;
      maxReadLength: number;
      maxWriteLength: number;
    };
  };
  activeTransfers: number;
  queuedTransfers: number;
  transferStats: {
    totalUploads: number;
    totalDownloads: number;
    totalBytes: number;
    averageSpeed: number;
  };
}

export interface SCPTransferOptions extends Omit<SFTPTransferOptions, 'compression'> {
  scpMode: 'source' | 'sink';
  preserveAttributes?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface FileTransferSession extends ConsoleSession {
  protocol: 'sftp' | 'scp';
  sftpOptions?: SFTPSessionOptions;
  activeTransfers: Map<string, SFTPTransferProgress>;
  transferQueue: SFTPTransferOptions[];
  connectionState?: SFTPConnectionState;
  lastSyncTime?: Date;
  transferStats: {
    totalTransfers: number;
    successfulTransfers: number;
    failedTransfers: number;
    totalBytesTransferred: number;
    averageSpeed: number;
  };
}

// WebSocket Terminal Connection Options
export interface WebSocketTerminalConnectionOptions {
  // Connection settings
  url: string; // WebSocket URL (ws:// or wss://)
  protocol?: string | string[]; // WebSocket subprotocols
  headers?: Record<string, string>; // Additional HTTP headers for connection
  
  // Authentication
  authType?: 'none' | 'basic' | 'bearer' | 'cookie' | 'query' | 'custom';
  username?: string;
  password?: string;
  token?: string; // Bearer token
  apiKey?: string;
  cookies?: Record<string, string>;
  customAuth?: Record<string, any>;
  
  // Terminal emulation
  terminalType?: 'xterm' | 'vt100' | 'vt220' | 'ansi' | 'linux' | 'screen' | 'tmux';
  terminalMode?: 'raw' | 'cooked' | 'cbreak';
  encoding?: 'utf8' | 'ascii' | 'binary' | 'base64';
  
  // Screen dimensions
  cols?: number; // Terminal width (default: 80)
  rows?: number; // Terminal height (default: 24)
  autoResize?: boolean; // Auto-resize on window changes
  
  // WebSocket options
  pingInterval?: number; // Ping interval in ms (default: 30000)
  pongTimeout?: number; // Pong timeout in ms (default: 5000)
  maxRetries?: number; // Max reconnection attempts (default: 5)
  retryDelay?: number; // Delay between retries in ms (default: 1000)
  exponentialBackoff?: boolean; // Use exponential backoff for retries
  
  // SSL/TLS options for WSS
  ssl?: {
    enabled: boolean;
    rejectUnauthorized?: boolean;
    ca?: string; // CA certificate
    cert?: string; // Client certificate
    key?: string; // Client private key
    passphrase?: string; // Private key passphrase
    ciphers?: string;
    secureProtocol?: string;
  };
  
  // Proxy settings
  proxy?: {
    type: 'http' | 'https' | 'socks4' | 'socks5';
    host: string;
    port: number;
    username?: string;
    password?: string;
    headers?: Record<string, string>;
  };
  
  // Protocol-specific options
  protocolOptions?: {
    // xterm.js protocol
    xterm?: {
      enableBell?: boolean;
      enableClipboard?: boolean;
      enableMouse?: boolean;
      enableSelection?: boolean;
      cursorBlink?: boolean;
      cursorStyle?: 'block' | 'underline' | 'bar';
      scrollback?: number;
      fontFamily?: string;
      fontSize?: number;
      theme?: Record<string, string>;
    };
    
    // ttyd protocol
    ttyd?: {
      enableReconnect?: boolean;
      enableTitleBar?: boolean;
      enableZmodem?: boolean;
      enableSixel?: boolean;
      rendererType?: 'canvas' | 'dom';
    };
    
    // wetty protocol
    wetty?: {
      base?: string;
      sshHost?: string;
      sshPort?: number;
      sshUser?: string;
      sshKey?: string;
    };
    
    // gotty protocol
    gotty?: {
      enableReconnect?: boolean;
      enableWrite?: boolean;
      titleFormat?: string;
      argument?: string;
    };
    
    // Cloud IDE terminals
    vscode?: {
      workspaceId?: string;
      instanceId?: string;
      sessionToken?: string;
    };
    
    cloud9?: {
      workspaceId?: string;
      environmentId?: string;
      region?: string;
    };
    
    gitpod?: {
      workspaceId?: string;
      instanceId?: string;
      supervisorToken?: string;
    };
    
    // Custom protocol options
    custom?: Record<string, any>;
  };
  
  // File transfer support
  fileTransfer?: {
    enabled: boolean;
    protocol?: 'xmodem' | 'ymodem' | 'zmodem' | 'kermit' | 'http';
    maxFileSize?: number; // Max file size in bytes
    chunkSize?: number; // Transfer chunk size in bytes
    timeout?: number; // Transfer timeout in ms
    retryCount?: number;
  };
  
  // Session persistence
  sessionPersistence?: {
    enabled: boolean;
    sessionId?: string;
    persistenceType?: 'memory' | 'file' | 'redis' | 'database';
    persistenceConfig?: Record<string, any>;
  };
  
  // Terminal multiplexing
  multiplexing?: {
    enabled: boolean;
    maxSessions?: number;
    sessionTimeout?: number;
    shareScreen?: boolean;
    masterSession?: string;
  };
  
  // Latency compensation
  latencyCompensation?: {
    enabled: boolean;
    bufferTime?: number; // Buffer time in ms
    adaptiveBuffer?: boolean;
    maxLatency?: number; // Max acceptable latency in ms
    measurementInterval?: number;
  };
  
  // Connection settings
  timeout?: number; // Connection timeout in ms
  keepAlive?: boolean;
  keepAliveInterval?: number;
  maxPayloadSize?: number; // Max message size in bytes
  compression?: boolean; // Enable compression
  
  // Logging and debugging
  debug?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  protocolLogging?: boolean;
  
  // Custom message handlers
  messageHandlers?: {
    [messageType: string]: (data: any) => void;
  };
  
  // Feature flags
  features?: {
    enableBinaryFrames?: boolean;
    enableTextFrames?: boolean;
    enableFragmentation?: boolean;
    enableExtensions?: boolean;
    enablePerMessageDeflate?: boolean;
  };
}

export interface WebSocketTerminalSessionState {
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  sessionId: string;
  webSocketUrl: string;
  protocol?: string;
  
  // Connection info
  connectedAt?: Date;
  lastActivity?: Date;
  reconnectCount: number;
  
  // Terminal state
  terminalSize: { cols: number; rows: number };
  currentEncoding: string;
  cursorPosition?: { x: number; y: number };
  terminalType?: string;
  encoding?: string;
  bytesTransferred?: number;
  supportsReconnection?: boolean;
  
  // WebSocket state
  webSocket?: any; // WebSocket instance
  readyState: number; // WebSocket ready state
  lastPingTime?: Date;
  lastPongTime?: Date;
  latency?: number; // Round-trip time in ms
  
  // Buffer state
  inputBuffer: Buffer[];
  outputBuffer: Buffer[];
  bufferSize: number;
  
  // Transfer state
  activeTransfers: Map<string, WebSocketFileTransfer>;
  transferQueue: WebSocketFileTransfer[];
  
  // Session persistence
  persistentSessionId?: string;
  restoredFromPersistence?: boolean;
  
  // Multiplexing state
  multiplexSessions?: Map<string, WebSocketMultiplexSession>;
  isMasterSession?: boolean;
  masterSessionId?: string;
  
  // Statistics
  statistics: {
    messagesReceived: number;
    messagesSent: number;
    bytesReceived: number;
    bytesSent: number;
    reconnections: number;
    errors: number;
    avgLatency: number;
    maxLatency: number;
    minLatency: number;
  };
  
  // Error tracking
  lastError?: string;
  errorHistory: Array<{
    timestamp: Date;
    error: string;
    code?: string;
  }>;
}

export interface WebSocketFileTransfer {
  transferId: string;
  sessionId: string;
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  fileSize: number;
  transferredBytes: number;
  progress: number; // 0-100
  speed: number; // bytes per second
  status: 'queued' | 'transferring' | 'completed' | 'failed' | 'cancelled' | 'paused';
  protocol: 'xmodem' | 'ymodem' | 'zmodem' | 'kermit' | 'http';
  startTime: Date;
  endTime?: Date;
  error?: string;
  chunks: Array<{
    index: number;
    size: number;
    checksum?: string;
    acknowledged: boolean;
  }>;
}

export interface WebSocketMultiplexSession {
  sessionId: string;
  parentSessionId: string;
  title?: string;
  active: boolean;
  createdAt: Date;
  lastActivity: Date;
  terminalSize: { cols: number; rows: number };
  cursorPosition: { x: number; y: number };
  scrollPosition: number;
  sharedScreen: boolean;
  participants: string[]; // User IDs sharing this session
}

export interface WebSocketTerminalCapabilities {
  // Protocol support
  supportedProtocols: string[];
  supportedEncodings: string[];
  supportedTerminalTypes: string[];
  
  // Feature support
  binaryFrames: boolean;
  textFrames: boolean;
  compression: boolean;
  fragmentation: boolean;
  extensions: string[];
  
  // Terminal features
  colorSupport: boolean;
  unicodeSupport: boolean;
  mouseSupport: boolean;
  clipboardSupport: boolean;
  fileTransferSupport: boolean;
  multiplexingSupport: boolean;
  
  // Authentication methods
  authMethods: string[];
  sslSupport: boolean;
  proxySupport: boolean;
  
  // Limits
  maxConnections: number;
  maxMessageSize: number;
  maxSessions: number;
  maxFileSize: number;
  
  // Version info
  protocolVersion: string;
  serverVersion?: string;
  clientVersion: string;
}

export interface WebSocketTerminalMessage {
  type: 'data' | 'resize' | 'ping' | 'pong' | 'auth' | 'control' | 'file' | 'multiplex';
  sessionId?: string;
  timestamp: Date;
  sequenceNumber?: number;
  data?: any;
  encoding?: 'utf8' | 'binary' | 'base64';
  compressed?: boolean;
  fragment?: {
    index: number;
    total: number;
    id: string;
  };
}

export interface WebSocketTerminalProtocolConfig {
  // Default connection settings
  defaultProtocol: string;
  defaultPort: number;
  connectionTimeout: number;
  readTimeout: number;
  writeTimeout: number;
  
  // Reconnection settings
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
  maxRetryDelay: number;
  
  // Keep-alive settings
  pingInterval: number;
  pongTimeout: number;
  keepAliveEnabled: boolean;
  
  // Buffer settings
  maxBufferSize: number;
  flushInterval: number;
  enableBuffering: boolean;
  
  // Terminal settings
  defaultCols: number;
  defaultRows: number;
  defaultEncoding: string;
  defaultTerminalType: string;
  
  // Security settings
  allowInsecure: boolean;
  requireAuthentication: boolean;
  maxAuthAttempts: number;
  sessionTimeout: number;
  
  // Feature flags
  enableFileTransfer: boolean;
  enableMultiplexing: boolean;
  enableSessionPersistence: boolean;
  enableLatencyCompensation: boolean;
  enableCompression: boolean;
  
  // Logging
  logLevel: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  enableProtocolLogging: boolean;
  enablePerformanceLogging: boolean;
  
  // Popular terminal configurations
  popularTerminals: {
    wetty: Partial<WebSocketTerminalConnectionOptions>;
    ttyd: Partial<WebSocketTerminalConnectionOptions>;
    gotty: Partial<WebSocketTerminalConnectionOptions>;
    vscode: Partial<WebSocketTerminalConnectionOptions>;
    cloud9: Partial<WebSocketTerminalConnectionOptions>;
    gitpod: Partial<WebSocketTerminalConnectionOptions>;
  };
}

// Ansible Protocol Configuration
export interface AnsibleConnectionOptions {
  // Connection settings
  inventory?: string;
  inventoryFile?: string;
  privateKey?: string;
  user?: string;
  password?: string;
  connectionType?: 'ssh' | 'winrm' | 'local' | 'docker' | 'kubectl';
  
  // SSH specific options
  sshPort?: number;
  sshCommonArgs?: string[];
  sshExtraArgs?: string[];
  sshExecutable?: string;
  hostKeyChecking?: boolean;
  sshTimeout?: number;
  
  // WinRM specific options
  winrmPort?: number;
  winrmScheme?: 'http' | 'https';
  winrmPath?: string;
  winrmTransport?: 'plaintext' | 'ssl' | 'kerberos' | 'ntlm' | 'basic';
  
  // Python environment
  pythonPath?: string;
  virtualEnv?: string;
  pythonInterpreter?: string;
  
  // Ansible configuration
  ansibleConfig?: string;
  playbookPath?: string;
  rolesPath?: string[];
  collectionsPath?: string[];
  
  // Vault settings
  vaultPasswordFile?: string;
  vaultIds?: string[];
  askVaultPass?: boolean;
  
  // Execution options
  forks?: number;
  strategy?: string;
  tags?: string[];
  skipTags?: string[];
  limit?: string;
  extraVars?: Record<string, any>;
  
  // Output options
  verbosity?: number;
  noColor?: boolean;
  tree?: string;
  
  // Advanced options
  moduleSearchPath?: string[];
  actionPluginPath?: string[];
  connectionPluginPath?: string[];
  lookupPluginPath?: string[];
  filterPluginPath?: string[];
  testPluginPath?: string[];
  
  // Timeout and retry settings
  timeout?: number;
  retries?: number;
  
  // AWX/Tower integration
  towerHost?: string;
  towerUsername?: string;
  towerPassword?: string;
  towerToken?: string;
  towerVerifySsl?: boolean;
  jobTemplateId?: number;
}

export interface AnsiblePlaybookOptions {
  // Playbook execution
  playbook: string;
  inventory?: string;
  limit?: string;
  tags?: string[];
  skipTags?: string[];
  startAtTask?: string;
  step?: boolean;
  check?: boolean;
  diff?: boolean;
  syntax?: boolean;
  listTasks?: boolean;
  listTags?: boolean;
  listHosts?: string;
  
  // Variables
  extraVars?: Record<string, any>;
  extraVarsFile?: string[];
  
  // Connection options
  connection?: string;
  user?: string;
  privateKey?: string;
  sshCommonArgs?: string[];
  sshExtraArgs?: string[];
  scpExtraArgs?: string[];
  sftpExtraArgs?: string[];
  
  // Execution control
  forks?: number;
  vault?: {
    passwordFile?: string;
    ids?: string[];
    askPass?: boolean;
  };
  
  // Output control
  verbosity?: number;
  oneLine?: boolean;
  tree?: string;
  
  // Callback plugins
  callbacks?: string[];
  callbackWhitelist?: string[];
  
  // Performance
  pipelining?: boolean;
  factCaching?: string;
  factCachingConnection?: string;
  factCachingTimeout?: number;
  
  // Advanced
  moduleArgs?: string;
  becomeSudo?: boolean;
  becomeUser?: string;
  becomeMethod?: string;
  askBecomePass?: boolean;
}

export interface AnsibleVaultConfig {
  vaultIds: string[];
  vaultPasswordFile?: string;
  askVaultPass?: boolean;
  vaultPasswords?: Record<string, string>;
}

export interface AnsibleInventory {
  type: 'static' | 'dynamic' | 'plugin';
  source: string;
  format?: 'ini' | 'yaml' | 'json';
  groups?: Record<string, {
    hosts?: string[];
    vars?: Record<string, any>;
    children?: string[];
  }>;
  hosts?: Record<string, {
    vars?: Record<string, any>;
    groups?: string[];
  }>;
  vars?: Record<string, any>;
}

export interface AnsibleFactCache {
  plugin: string;
  connection?: string;
  timeout?: number;
  options?: Record<string, any>;
}

export interface AnsibleCallbackPlugin {
  name: string;
  type: 'notification' | 'aggregate' | 'stdout';
  enabled: boolean;
  options?: Record<string, any>;
}

export interface AnsibleCollection {
  name: string;
  version?: string;
  source?: string;
  type?: 'galaxy' | 'git' | 'url' | 'file';
  requirements?: string;
}

export interface AnsibleRole {
  name: string;
  version?: string;
  src?: string;
  scm?: 'git' | 'hg' | 'svn';
  path?: string;
}

export interface AnsibleTask {
  name?: string;
  action: string;
  args?: Record<string, any>;
  when?: string | string[];
  tags?: string[];
  become?: boolean;
  becomeUser?: string;
  delegate?: string;
  runOnce?: boolean;
  changed?: boolean;
  failed?: boolean;
  skipped?: boolean;
  duration?: number;
}

export interface AnsiblePlay {
  name?: string;
  hosts: string;
  tasks: AnsibleTask[];
  vars?: Record<string, any>;
  become?: boolean;
  connection?: string;
  strategy?: string;
  serial?: number | string;
  maxFailPercentage?: number;
  anyErrorsFatal?: boolean;
  gatherFacts?: boolean;
}

export interface AnsiblePlaybook {
  name?: string;
  plays: AnsiblePlay[];
  vars?: Record<string, any>;
}

export interface AnsibleSession {
  id: string;
  type: 'playbook' | 'adhoc' | 'vault' | 'galaxy' | 'config';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  playbook?: AnsiblePlaybook;
  inventory?: AnsibleInventory;
  options: AnsibleConnectionOptions;
  results: AnsibleExecutionResult[];
  facts?: Record<string, any>;
  stats?: AnsibleStats;
  callbacks: AnsibleCallbackPlugin[];
}

export interface AnsibleExecutionResult {
  host: string;
  task: string;
  action: string;
  status: 'ok' | 'changed' | 'failed' | 'skipped' | 'unreachable';
  result?: any;
  msg?: string;
  changed?: boolean;
  failed?: boolean;
  skipped?: boolean;
  unreachable?: boolean;
  duration?: number;
  startTime: Date;
  endTime?: Date;
}

export interface AnsibleStats {
  processed: Record<string, number>;
  failures: Record<string, number>;
  ok: Record<string, number>;
  dark: Record<string, number>;
  changed: Record<string, number>;
  skipped: Record<string, number>;
}

export interface AnsibleTowerJob {
  id: number;
  name: string;
  description?: string;
  jobTemplateId: number;
  status: 'pending' | 'waiting' | 'running' | 'successful' | 'failed' | 'error' | 'canceled';
  created: Date;
  modified?: Date;
  started?: Date;
  finished?: Date;
  elapsed?: number;
  launchedBy?: string;
  extraVars?: Record<string, any>;
  artifacts?: Record<string, any>;
}

export interface AnsibleTowerConfig {
  host: string;
  username?: string;
  password?: string;
  token?: string;
  verifySsl: boolean;
  timeout: number;
}

export interface AnsibleProtocolConfig {
  // Default connection settings
  defaultConnectionType: 'ssh' | 'winrm' | 'local';
  defaultUser: string;
  defaultTimeout: number;
  defaultForks: number;
  
  // Python environment
  pythonPath: string;
  virtualEnvPath?: string;
  
  // Ansible configuration
  configFile?: string;
  inventoryFile?: string;
  playbookDir: string;
  rolesPath: string[];
  collectionsPath: string[];
  
  // Vault settings
  vaultConfig?: AnsibleVaultConfig;
  
  // Callback and logging
  callbackPlugins: string[];
  stdoutCallback: string;
  logPath?: string;
  logLevel: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  
  // Performance settings
  gatheringPolicy: 'implicit' | 'explicit' | 'smart';
  factCaching: string;
  factCachingTimeout: number;
  pipelining: boolean;
  
  // Security settings
  hostKeyChecking: boolean;
  requireTty: boolean;
  
  // AWX/Tower integration
  towerConfig?: AnsibleTowerConfig;
  
  // Feature flags
  enableFactGathering: boolean;
  enableCallbacks: boolean;
  enableVault: boolean;
  enableCollections: boolean;
  enableDryRun: boolean;
}

// Protocol interfaces re-exports
export type { IProtocol, ProtocolCapabilities } from '../core/ProtocolFactory.js';

// Telnet Session State Interface (missing definition)
export interface TelnetSessionState {
  sessionId: string;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'ready' | 'executing' | 'error';
  username?: string;
  host?: string;
  port?: number;
  protocol?: string;
  authType?: 'password' | 'publickey' | 'none';
  connectedAt?: Date;
  lastActivity?: Date;
  isConnected: boolean;
  currentCommand?: string;
  commandHistory: string[];
  commandQueue?: TelnetCommand[]; // Missing property
  deviceType?: 'cisco' | 'juniper' | 'huawei' | 'generic';
  privilegeLevel?: 'user' | 'privileged' | 'config';
  activeOptions?: TelnetOption[];
  options?: any; // Placeholder for protocol-specific options
  bufferSize: number;
  encoding: string;
  lineEnding: '\r\n' | '\n' | '\r';
  timeout: number;
  retryCount: number;
  statistics?: {
    bytesReceived: number;
    bytesSent: number;
    commandsExecuted: number;
    errors: number;
    reconnections: number;
    sessionDuration: number;
  };
  errorState?: {
    lastError?: string;
    errorCode?: number;
    errorMessage?: string;
    recoverable: boolean;
  };
}

// Missing interfaces for compilation error fixes
export interface ProtocolHealthStatus {
  isHealthy: boolean;
  lastCheck: Date;
  issues: string[];
  uptime: number;
  responseTime: number;
  errorCount: number;
  warningCount: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
}
export interface OutputCaptureConfig {
  maxBufferSize?: number;
  enableLogging?: boolean;
  logFile?: string;
  truncateOnOverflow?: boolean;
  preserveAnsiEscapes?: boolean;
}

export interface MonitoringConfig {
  sessionId?: string;
  enableMetrics?: boolean;
  enableTracing?: boolean;
  enableProfiling?: boolean;
  enableAuditing?: boolean;
  enableAnomalyDetection?: boolean;
  customTags?: Record<string, string>;
  slaConfig?: SLAConfig;
}

export interface ErrorDetector {
  processLine(line: string): ParsedError | null;
  getPatterns(): ErrorPattern[];
  addPattern(pattern: ErrorPattern): void;
  removePattern(patternId: string): void;
  reset(): void;
}

export interface PromptDetectionResult {
  isPrompt: boolean;
  prompt?: string;
  confidence: number;
  patternMatched?: string;
  extractedContext?: Record<string, any>;
}

// Connection pooling options
export interface ConnectionPoolingOptions {
  maxSessions?: number;
  maxIdleTime?: number;
  healthCheckInterval?: number;
  retryAttempts?: number;
}

// Extended session manager configuration
export interface ExtendedSessionManagerConfig {
  maxConcurrentSessions?: number;
  persistSessions?: boolean;
}

// Re-export workflow types for easy access
export * from './workflow.js';