# WSL (Windows Subsystem for Linux) Protocol

## Overview

The WSL Protocol enables AI assistants to interact with Windows Subsystem for Linux distributions, execute commands, manage files across Windows/Linux boundaries, and automate WSL workflows through the MCP Console Automation server.

## Features

- **Multi-Distribution Support**: Work with multiple WSL distributions simultaneously
- **Path Translation**: Automatic Windows ↔ Linux path translation
- **File System Integration**: Seamless file operations across Windows/Linux boundaries  
- **Network Configuration**: Access WSL services from Windows and vice versa
- **Performance Monitoring**: WSL-specific performance and health monitoring
- **Distribution Management**: Install, configure, and manage WSL distributions
- **Interoperability**: Run Windows commands from WSL and Linux commands from Windows

## Prerequisites

- Windows 10 version 2004+ or Windows 11
- WSL 2 installed and enabled
- At least one Linux distribution installed

### WSL Installation

```powershell
# Enable WSL and install Ubuntu (default)
wsl --install

# Install specific distribution
wsl --install -d Ubuntu-22.04

# List available distributions
wsl --list --online
```

## Configuration

### Basic Configuration

```typescript
const wslConfig: WSLProtocolConfig = {
  defaultDistribution: 'Ubuntu-22.04',
  pathTranslation: {
    enabled: true,
    cacheTimeout: 300000, // 5 minutes
    rules: [
      {
        windowsPattern: 'C:\\Users\\*',
        linuxPattern: '/mnt/c/Users/*',
        bidirectional: true
      }
    ]
  },
  healthMonitoring: {
    enabled: true,
    interval: 60000, // 1 minute
    checkServices: true,
    checkNetwork: true,
    checkFileSystem: true
  },
  networking: {
    enableDistroNetworking: true,
    portForwarding: {
      autoDetect: true,
      staticMappings: []
    }
  }
};
```

### .wslconfig Configuration

Create or edit `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
memory=4GB
processors=2
localhostForwarding=true
nestedVirtualization=true
swap=2GB
swapFile=C:\\temp\\wsl-swap.vhdx

[experimental]
autoMemoryReclaim=gradual
networkingMode=bridged
dnsTunneling=true
firewall=true
autoProxy=true
```

### Distribution-specific Configuration

Create or edit `/etc/wsl.conf` in each distribution:

```ini
[automount]
enabled=true
root=/mnt/
options="metadata,umask=22,fmask=11"
mountFsTab=false

[network]
generateHosts=true
generateResolvConf=true
hostname=my-wsl-host

[interop]
enabled=true
appendWindowsPath=true

[user]
default=myuser

[boot]
systemd=true
command="service docker start"
```

## Usage Examples

### 1. Basic WSL Command Execution

```javascript
// Execute command in default WSL distribution
const result = await console_execute_command({
  command: 'ls',
  args: ['-la', '/home'],
  consoleType: 'wsl'
});

console.log('Directory listing:', result.output);

// Execute in specific distribution
const ubuntuResult = await console_execute_command({
  command: 'uname',
  args: ['-a'],
  consoleType: 'wsl',
  wslOptions: {
    distribution: 'Ubuntu-22.04'
  }
});
```

### 2. Cross-Platform Development Environment

```javascript
// Set up development environment in WSL
const devSession = await console_create_session({
  command: 'code',
  args: ['.'],
  consoleType: 'wsl',
  cwd: '/home/user/projects/myapp',
  wslOptions: {
    distribution: 'Ubuntu-22.04',
    user: 'developer'
  },
  env: {
    'NODE_ENV': 'development',
    'PORT': '3000'
  }
});

// Install dependencies
await console_send_input({
  sessionId: devSession.sessionId,
  input: 'npm install\n'
});

// Wait for installation to complete
await console_wait_for_output({
  sessionId: devSession.sessionId,
  pattern: 'packages installed',
  timeout: 120000
});

// Start development server
await console_send_input({
  sessionId: devSession.sessionId,
  input: 'npm run dev\n'
});
```

### 3. File System Operations with Path Translation

```javascript
// Copy file from Windows to WSL
const windowsPath = 'C:\\Users\\john\\Documents\\data.json';
const linuxPath = await protocol.translatePath(windowsPath, 'windows-to-linux');

const copyResult = await console_execute_command({
  command: 'cp',
  args: [linuxPath, '/home/user/data/'],
  consoleType: 'wsl'
});

// Process file in WSL
const processSession = await console_create_session({
  command: 'python3',
  args: ['process_data.py', '/home/user/data/data.json'],
  consoleType: 'wsl',
  cwd: '/home/user/scripts'
});

// Copy results back to Windows
const resultsLinuxPath = '/home/user/results/processed_data.json';
const resultsWindowsPath = await protocol.translatePath(resultsLinuxPath, 'linux-to-windows');

await console_execute_command({
  command: 'cp',
  args: [resultsLinuxPath, resultsWindowsPath],
  consoleType: 'wsl'
});
```

### 4. Database Development with WSL

```javascript
// Start PostgreSQL in WSL
const dbSession = await console_create_session({
  command: 'sudo',
  args: ['service', 'postgresql', 'start'],
  consoleType: 'wsl',
  wslOptions: {
    distribution: 'Ubuntu-22.04'
  }
});

// Wait for database to start
await console_wait_for_output({
  sessionId: dbSession.sessionId,
  pattern: 'Starting PostgreSQL',
  timeout: 30000
});

// Connect to database
const psqlSession = await console_create_session({
  command: 'psql',
  args: ['-U', 'postgres', '-d', 'myapp'],
  consoleType: 'wsl',
  env: {
    'PGPASSWORD': 'mypassword'
  }
});

// Run database migrations
await console_send_input({
  sessionId: psqlSession.sessionId,
  input: '\\i /home/user/myapp/migrations/001_initial.sql\n'
});

// Check migration status
await console_send_input({
  sessionId: psqlSession.sessionId,
  input: 'SELECT * FROM schema_migrations;\n'
});
```

### 5. Docker Development in WSL

```javascript
// Start Docker daemon in WSL
const dockerSession = await console_create_session({
  command: 'sudo',
  args: ['service', 'docker', 'start'],
  consoleType: 'wsl'
});

// Build application image
const buildResult = await console_execute_command({
  command: 'docker',
  args: ['build', '-t', 'myapp:dev', '.'],
  consoleType: 'wsl',
  cwd: '/home/user/myapp',
  timeout: 300000
});

// Run container with port forwarding
const runSession = await console_create_session({
  command: 'docker',
  args: ['run', '-d', '-p', '3000:3000', '--name', 'myapp-dev', 'myapp:dev'],
  consoleType: 'wsl'
});

// Container will be accessible from Windows at localhost:3000
console.log('Application running at http://localhost:3000');
```

### 6. WSL Distribution Management

```javascript
// List all installed distributions
const listResult = await console_execute_command({
  command: 'wsl',
  args: ['--list', '--verbose']
});

console.log('Installed distributions:', listResult.output);

// Install new distribution
const installResult = await console_execute_command({
  command: 'wsl',
  args: ['--install', '-d', 'Alpine'],
  timeout: 600000 // 10 minutes
});

// Set default distribution
await console_execute_command({
  command: 'wsl',
  args: ['--set-default', 'Alpine']
});

// Export distribution backup
const exportResult = await console_execute_command({
  command: 'wsl',
  args: ['--export', 'Ubuntu-22.04', 'C:\\Backups\\ubuntu-backup.tar']
});
```

### 7. Network Service Integration

```javascript
// Start web server in WSL
const webServer = await console_create_session({
  command: 'python3',
  args: ['-m', 'http.server', '8080'],
  consoleType: 'wsl',
  cwd: '/home/user/website'
});

// Wait for server to start
await console_wait_for_output({
  sessionId: webServer.sessionId,
  pattern: 'Serving HTTP',
  timeout: 10000
});

// Server is automatically accessible from Windows at localhost:8080
console.log('Web server running at http://localhost:8080');

// Test connectivity from Windows
const testResult = await console_execute_command({
  command: 'curl',
  args: ['http://localhost:8080'],
  timeout: 5000
});
```

### 8. Performance Monitoring and Health Checks

```javascript
// Monitor WSL system resources
protocol.on('health-status', (status, distribution) => {
  console.log(`Health status for ${distribution}:`);
  console.log(`- CPU Usage: ${status.cpu.usage}%`);
  console.log(`- Memory: ${status.memory.used}/${status.memory.total} MB`);
  console.log(`- Disk: ${status.disk.used}/${status.disk.total} GB`);
  
  if (status.issues.length > 0) {
    console.warn('Health issues detected:', status.issues);
  }
});

// Get detailed system information
const systemInfo = await protocol.getSystemInfo(true);
console.log('WSL System Info:', {
  version: systemInfo.version,
  distributions: systemInfo.distributions.length,
  defaultDistribution: systemInfo.defaultDistribution,
  features: systemInfo.features
});
```

## Advanced Features

### Custom Path Translation Rules

```javascript
const pathRules = [
  {
    windowsPattern: 'D:\\Projects\\*',
    linuxPattern: '/mnt/d/Projects/*',
    bidirectional: true,
    priority: 1
  },
  {
    windowsPattern: '%USERPROFILE%\\*',
    linuxPattern: '/home/$USER/*',
    bidirectional: true,
    priority: 2
  }
];

// Apply custom rules
protocol.addPathTranslationRules(pathRules);

// Translate paths
const linuxPath = await protocol.translatePath('D:\\Projects\\myapp', 'windows-to-linux');
const windowsPath = await protocol.translatePath('/home/user/documents', 'linux-to-windows');
```

### Network Port Management

```javascript
// Configure port forwarding
const portConfig = {
  staticMappings: [
    { windowsPort: 8080, linuxPort: 80, protocol: 'tcp' },
    { windowsPort: 5432, linuxPort: 5432, protocol: 'tcp' }
  ],
  autoDetect: true,
  excludePorts: [22, 3389] // SSH and RDP
};

await protocol.configurePortForwarding(portConfig);

// List active port forwards
const activePorts = await protocol.getActivePortForwards();
console.log('Active port forwards:', activePorts);
```

### GPU and Hardware Access

```javascript
// Check GPU access in WSL
const gpuCheck = await console_execute_command({
  command: 'nvidia-smi',
  consoleType: 'wsl'
});

if (gpuCheck.exitCode === 0) {
  console.log('GPU access available in WSL');
  
  // Run GPU-accelerated workload
  const cudaSession = await console_create_session({
    command: 'python3',
    args: ['train_model.py', '--gpu'],
    consoleType: 'wsl',
    cwd: '/home/user/ml-project',
    env: {
      'CUDA_VISIBLE_DEVICES': '0'
    }
  });
}
```

### Systemd Service Management

```javascript
// Enable systemd in WSL distribution
const systemdConfig = `
[boot]
systemd=true
`;

await protocol.updateWSLConfig('Ubuntu-22.04', systemdConfig);

// Restart distribution to apply changes
await console_execute_command({
  command: 'wsl',
  args: ['--shutdown']
});

// Start services using systemctl
const serviceSession = await console_create_session({
  command: 'sudo',
  args: ['systemctl', 'start', 'nginx'],
  consoleType: 'wsl'
});

// Check service status
const statusResult = await console_execute_command({
  command: 'sudo',
  args: ['systemctl', 'status', 'nginx'],
  consoleType: 'wsl'
});
```

## Error Handling

### Common WSL Issues

```javascript
// Handle WSL not installed
protocol.on('wsl-not-available', () => {
  console.error('WSL is not installed. Install with: wsl --install');
});

// Handle distribution not found
protocol.on('distribution-not-found', (distroName) => {
  console.error(`Distribution ${distroName} not found`);
  // Auto-install if possible
  protocol.installDistribution(distroName);
});

// Handle path translation errors
protocol.on('path-translation-error', (originalPath, error) => {
  console.error(`Failed to translate path ${originalPath}:`, error.message);
});

// Handle network connectivity issues
protocol.on('network-error', (error) => {
  console.error('WSL network error:', error.message);
  // Attempt to restart networking
  protocol.restartNetworking();
});
```

### Error Patterns for WSL

```javascript
const wslErrorPatterns = [
  {
    pattern: /WslRegisterDistribution failed with error: (0x[0-9a-fA-F]+)/,
    type: 'registration-error',
    severity: 'error',
    description: 'WSL distribution registration failed'
  },
  {
    pattern: /The Windows Subsystem for Linux has not been enabled/,
    type: 'feature-not-enabled',
    severity: 'error',
    description: 'WSL feature not enabled'
  },
  {
    pattern: /Cannot translate between Windows and Linux paths/,
    type: 'path-translation-error',
    severity: 'warning',
    description: 'Path translation failed'
  }
];
```

## Best Practices

### 1. Performance Optimization

```javascript
// Use WSL 2 for better performance
const wslConfig = `
[wsl2]
memory=8GB
processors=4
swap=2GB
localhostForwarding=true
`;

// Configure .wslconfig for optimal performance
await protocol.updateGlobalWSLConfig(wslConfig);

// Use appropriate file system
// Keep frequently accessed files in Linux filesystem (/home/user/)
// Use /mnt/c/ only for occasional Windows file access
```

### 2. Resource Management

```javascript
// Monitor resource usage
const resources = await protocol.getResourceUsage();
if (resources.memory.percentage > 90) {
  console.warn('WSL memory usage high, consider increasing allocation');
}

// Clean up unused distributions
const unusedDistros = await protocol.getUnusedDistributions();
for (const distro of unusedDistros) {
  await protocol.unregisterDistribution(distro.name);
}
```

### 3. Security

```javascript
// Use appropriate user permissions
const secureSession = await console_create_session({
  command: 'sudo',
  args: ['-u', 'limited-user', 'application'],
  consoleType: 'wsl',
  wslOptions: {
    user: 'limited-user'
  }
});

// Secure file permissions
await console_execute_command({
  command: 'chmod',
  args: ['600', '/home/user/.ssh/id_rsa'],
  consoleType: 'wsl'
});
```

### 4. Backup and Recovery

```javascript
// Create distribution backup
const backupPath = `C:\\WSL-Backups\\${new Date().toISOString().split('T')[0]}`;
await console_execute_command({
  command: 'wsl',
  args: ['--export', 'Ubuntu-22.04', `${backupPath}-ubuntu.tar`]
});

// Restore from backup
await console_execute_command({
  command: 'wsl',
  args: ['--import', 'Ubuntu-Restored', 'C:\\WSL\\Ubuntu-Restored', `${backupPath}-ubuntu.tar`]
});
```

## Troubleshooting

### WSL Version Issues

```javascript
// Check WSL version
const versionResult = await console_execute_command({
  command: 'wsl',
  args: ['--version']
});

// Upgrade to WSL 2
await console_execute_command({
  command: 'wsl',
  args: ['--set-version', 'Ubuntu-22.04', '2']
});
```

### Memory and Disk Issues

```javascript
// Check disk usage
const diskUsage = await console_execute_command({
  command: 'df',
  args: ['-h'],
  consoleType: 'wsl'
});

// Compact WSL virtual disk
await console_execute_command({
  command: 'wsl',
  args: ['--shutdown']
});

// Manually compact VHDX file (requires diskpart)
const compactScript = `
select vdisk file="C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Packages\\CanonicalGroupLimited.Ubuntu22.04LTS_79rhkp1fndgsc\\LocalState\\ext4.vhdx"
compact vdisk
`;
```

### Network Connectivity Issues

```javascript
// Reset WSL networking
await console_execute_command({
  command: 'wsl',
  args: ['--shutdown']
});

// Restart WSL networking service (Windows)
await console_execute_command({
  command: 'powershell',
  args: ['-Command', 'Restart-Service', 'LxssManager']
});

// Check DNS resolution in WSL
const dnsCheck = await console_execute_command({
  command: 'nslookup',
  args: ['google.com'],
  consoleType: 'wsl'
});
```

## Migration Guide

### From Native Linux to WSL

```javascript
// Install WSL distribution
await console_execute_command({
  command: 'wsl',
  args: ['--install', '-d', 'Ubuntu-22.04']
});

// Transfer configuration files
const configFiles = ['.bashrc', '.vimrc', '.gitconfig'];
for (const file of configFiles) {
  const linuxPath = `/home/user/${file}`;
  const windowsPath = await protocol.translatePath(linuxPath, 'linux-to-windows');
  // Copy from backup or existing Linux system
}

// Install packages from package list
const packageList = await readFile('packages.txt', 'utf8');
const packages = packageList.split('\n').filter(p => p.trim());

await console_execute_command({
  command: 'sudo',
  args: ['apt', 'update', '&&', 'apt', 'install', '-y', ...packages],
  consoleType: 'wsl',
  timeout: 300000
});
```

### From Windows CMD/PowerShell to WSL

```javascript
// Before (Windows)
const oldWindowsSession = await console_create_session({
  command: 'python',
  args: ['script.py'],
  consoleType: 'cmd',
  cwd: 'C:\\Projects\\myapp'
});

// After (WSL)
const newWSLSession = await console_create_session({
  command: 'python3',
  args: ['script.py'],
  consoleType: 'wsl',
  cwd: '/mnt/c/Projects/myapp', // Translated path
  wslOptions: {
    distribution: 'Ubuntu-22.04'
  }
});
```

## API Reference

### Methods

- `initialize()`: Initialize WSL protocol
- `checkWSLAvailability()`: Check if WSL is available
- `getSystemInfo(forceRefresh?)`: Get WSL system information
- `listDistributions()`: List installed distributions
- `getDistributionInfo(name)`: Get specific distribution info
- `translatePath(path, direction)`: Translate Windows ↔ Linux paths
- `addPathTranslationRule(rule)`: Add custom path translation rule
- `configurePortForwarding(config)`: Configure port forwarding
- `getActivePortForwards()`: Get active port forwards
- `updateWSLConfig(distro, config)`: Update distribution config
- `updateGlobalWSLConfig(config)`: Update global WSL config
- `getResourceUsage()`: Get resource usage statistics
- `performHealthCheck(distro?)`: Perform health check
- `restartNetworking()`: Restart WSL networking

### Events

- `wsl-not-available`: WSL is not installed
- `distribution-not-found`: Distribution not found
- `path-translation-error`: Path translation failed
- `network-error`: Network connectivity issue
- `health-status`: Health check results
- `resource-warning`: Resource usage warning
- `config-updated`: Configuration updated

### Configuration Options

See the TypeScript interfaces in the source code for complete configuration options including `WSLProtocolConfig`, `WSLConnectionOptions`, and `WSLDistribution`.