# Telnet Protocol Documentation

## Overview

The Telnet Protocol provides comprehensive support for Telnet connections to network devices, servers, and legacy systems. This implementation includes full RFC 854 compliance, device-specific patterns for major network equipment vendors, automatic option negotiation, and robust error handling with reconnection capabilities.

## Features

- **RFC 854 Compliance**: Full Telnet protocol implementation with command interpretation
- **Device Recognition**: Built-in patterns for Cisco, Juniper, Huawei, and generic devices
- **Option Negotiation**: Automatic handling of Telnet options (ECHO, NAWS, Terminal Type, etc.)
- **Connection Management**: Automatic reconnection, keep-alive, and timeout handling  
- **Prompt Detection**: Smart prompt recognition for different device types and modes
- **Command Queuing**: Asynchronous command execution with timeout and retry support
- **Privileged Mode**: Automatic elevation to enable/config mode for network devices
- **Binary Mode**: Support for binary data transfer when needed
- **ANSI Processing**: Optional ANSI color code stripping and processing

## Configuration

### Basic Configuration

```javascript
const telnetOptions = {
  // Connection settings
  host: '192.168.1.1',
  port: 23,
  timeout: 30000,
  
  // Authentication
  username: 'admin',
  password: 'password',
  
  // Device type (affects prompt detection and commands)
  deviceType: 'cisco', // 'cisco', 'juniper', 'huawei', 'generic'
  
  // Terminal settings
  terminalType: 'VT100',
  windowSize: { width: 80, height: 24 },
  
  // Protocol options
  negotiateOptions: true,
  stripAnsiColors: true,
  encoding: 'utf8'
};
```

### Advanced Configuration

```javascript
const advancedOptions = {
  // Connection resilience
  maxReconnectAttempts: 5,
  keepAlive: true,
  keepAliveInterval: 30000,
  
  // Command execution
  execTimeout: 10000,
  sendTimeout: 5000,
  maxBuffer: 2048 * 1024, // 2MB buffer
  
  // Device-specific settings
  enableMode: true,
  enablePassword: 'enable_secret',
  
  // Custom prompts (overrides device patterns)
  shellPrompt: /[\w\-_.]+[>#]\s*$/,
  loginPrompt: /Username:/i,
  passwordPrompt: /Password:/i,
  
  // Protocol fine-tuning
  initialLFCR: true,
  echoLines: 1,
  stripShellPrompt: true,
  binaryMode: false,
  
  // Error handling
  failedLoginMatch: /Login incorrect|Authentication failed/i,
  pageSeparator: '--More--',
  
  // Debugging
  debug: true
};
```

### Device-Specific Configuration

```javascript
// Cisco device configuration
const ciscoConfig = {
  host: '192.168.1.10',
  deviceType: 'cisco',
  username: 'admin',
  password: 'cisco123',
  enableMode: true,
  enablePassword: 'enable_secret',
  execTimeout: 15000
};

// Juniper device configuration  
const juniperConfig = {
  host: '192.168.1.20',
  deviceType: 'juniper',
  username: 'root',
  password: 'juniper123',
  shellPrompt: /[\w\-_.]+[@%>]\s*$/,
  configPrompt: /[\w\-_.]+#\s*$/
};

// Huawei device configuration
const huaweiConfig = {
  host: '192.168.1.30',
  deviceType: 'huawei',
  username: 'admin',
  password: 'huawei123',
  enableMode: true,
  shellPrompt: /<[\w\-_.]+>/
};
```

## Usage Examples

### Basic Telnet Connection

```javascript
import { TelnetProtocol } from './protocols/TelnetProtocol.js';

const telnet = new TelnetProtocol({
  host: '192.168.1.1',
  username: 'admin',
  password: 'password',
  deviceType: 'cisco'
});

// Listen for connection events
telnet.on('connected', () => {
  console.log('Telnet connection established');
});

telnet.on('output', (output) => {
  console.log(`Output: ${output.data}`);
});

telnet.on('error', (error) => {
  console.error(`Error: ${error.message}`);
});

// Connect and execute commands
await telnet.connect();

// Execute basic commands
const version = await telnet.send('show version');
console.log('Device version:', version);

const interfaces = await telnet.send('show interfaces');
console.log('Interface status:', interfaces);

await telnet.disconnect();
```

### Network Device Configuration

```javascript
// Cisco router configuration example
const ciscoRouter = new TelnetProtocol({
  host: '192.168.1.1',
  username: 'admin',
  password: 'cisco123',
  deviceType: 'cisco',
  enableMode: true,
  enablePassword: 'enable_secret'
});

await ciscoRouter.connect();

// Enter privileged mode
await ciscoRouter.enablePrivilegedMode();

// Enter configuration mode
await ciscoRouter.enterConfigMode();

// Configure interface
await ciscoRouter.send('interface FastEthernet0/1');
await ciscoRouter.send('ip address 192.168.100.1 255.255.255.0');
await ciscoRouter.send('no shutdown');
await ciscoRouter.send('exit');

// Configure OSPF
await ciscoRouter.send('router ospf 1');
await ciscoRouter.send('network 192.168.100.0 0.0.0.255 area 0');
await ciscoRouter.send('exit');

// Save configuration
await ciscoRouter.saveConfiguration();

await ciscoRouter.disconnect();
```

### Batch Device Management

```javascript
// Manage multiple network devices
class NetworkDeviceManager {
  constructor() {
    this.devices = new Map();
  }
  
  async connectToDevices(deviceList) {
    const connections = deviceList.map(device => 
      this.connectDevice(device)
    );
    
    await Promise.all(connections);
  }
  
  async connectDevice(device) {
    const telnet = new TelnetProtocol({
      host: device.ip,
      username: device.username,
      password: device.password,
      deviceType: device.type,
      enablePassword: device.enablePassword
    });
    
    telnet.on('error', (error) => {
      console.error(`Device ${device.name} error:`, error.message);
    });
    
    try {
      await telnet.connect();
      await telnet.enablePrivilegedMode();
      this.devices.set(device.name, telnet);
      console.log(`Connected to ${device.name}`);
    } catch (error) {
      console.error(`Failed to connect to ${device.name}:`, error.message);
    }
  }
  
  async executeOnAllDevices(command) {
    const results = new Map();
    
    for (const [name, telnet] of this.devices) {
      try {
        const output = await telnet.send(command);
        results.set(name, output);
        console.log(`${name}: Command executed successfully`);
      } catch (error) {
        console.error(`${name}: Command failed -`, error.message);
        results.set(name, { error: error.message });
      }
    }
    
    return results;
  }
  
  async backupConfigurations() {
    const backups = new Map();
    
    for (const [name, telnet] of this.devices) {
      try {
        const config = await telnet.send('show running-config');
        backups.set(name, config);
        
        // Save to file
        const fs = require('fs').promises;
        const filename = `backup-${name}-${Date.now()}.txt`;
        await fs.writeFile(filename, config);
        console.log(`Configuration backed up: ${filename}`);
      } catch (error) {
        console.error(`Failed to backup ${name}:`, error.message);
      }
    }
    
    return backups;
  }
  
  async disconnectAll() {
    const disconnections = Array.from(this.devices.values()).map(
      telnet => telnet.disconnect()
    );
    
    await Promise.all(disconnections);
    this.devices.clear();
  }
}

// Usage example
const manager = new NetworkDeviceManager();

const devices = [
  { name: 'core-router', ip: '192.168.1.1', type: 'cisco', username: 'admin', password: 'cisco123', enablePassword: 'secret' },
  { name: 'edge-router', ip: '192.168.1.2', type: 'cisco', username: 'admin', password: 'cisco123', enablePassword: 'secret' },
  { name: 'switch-1', ip: '192.168.1.10', type: 'cisco', username: 'admin', password: 'cisco123', enablePassword: 'secret' }
];

await manager.connectToDevices(devices);

// Execute commands on all devices
await manager.executeOnAllDevices('show version');
await manager.executeOnAllDevices('show ip interface brief');

// Backup all configurations
await manager.backupConfigurations();

await manager.disconnectAll();
```

### Legacy System Access

```javascript
// Connect to legacy Unix/Linux system
const legacySystem = new TelnetProtocol({
  host: '10.0.1.100',
  port: 23,
  username: 'operator',
  password: 'legacy_pass',
  deviceType: 'generic',
  shellPrompt: /[$#>]\s*$/,
  loginPrompt: /login:/i,
  timeout: 45000
});

await legacySystem.connect();

// System administration commands
const uptime = await legacySystem.send('uptime');
console.log('System uptime:', uptime);

const diskUsage = await legacySystem.send('df -h');
console.log('Disk usage:', diskUsage);

const processes = await legacySystem.send('ps aux | grep -v grep');
console.log('Running processes:', processes);

// Log file analysis
const logTail = await legacySystem.send('tail -50 /var/log/messages');
console.log('Recent log entries:', logTail);

await legacySystem.disconnect();
```

## Advanced Features

### Custom Device Patterns

```javascript
// Define custom device pattern
const customDevicePattern = {
  type: 'custom-router',
  loginPrompt: [/User Name:/i],
  passwordPrompt: [/Password:/i],
  shellPrompt: [/MyRouter>/],
  enablePrompt: [/MyRouter#/],
  configPrompt: [/MyRouter\(config\)#/],
  morePrompt: [/--More--/, /Continue\?/],
  errorPatterns: [
    /Error:/i,
    /Invalid command/i,
    /Syntax error/i
  ],
  commands: {
    enable: 'enable',
    config: 'configure',
    exit: 'exit',
    save: 'write memory',
    show: ['show version', 'show status']
  }
};

// Register custom pattern
const customTelnet = new TelnetProtocol({
  host: '192.168.1.50',
  username: 'admin',
  password: 'password',
  deviceType: 'custom-router'
});

// Override device patterns at runtime
customTelnet.devicePattern = customDevicePattern;
```

### Option Negotiation Handling

```javascript
// Handle specific Telnet option negotiations
const telnetWithOptions = new TelnetProtocol({
  host: '192.168.1.1',
  username: 'admin',
  password: 'password',
  negotiateOptions: true,
  terminalType: 'XTERM-256COLOR',
  windowSize: { width: 132, height: 43 },
  binaryMode: false
});

// Listen for option negotiation events
telnetWithOptions.on('optionNegotiated', (option) => {
  console.log(`Negotiated option: ${option.name} (${option.code}) = ${option.enabled}`);
});

// Monitor negotiated options
telnetWithOptions.on('connected', () => {
  const options = telnetWithOptions.negotiatedOptions;
  for (const [code, option] of options) {
    console.log(`Option ${option.name}: Local=${option.localState}, Remote=${option.remoteState}`);
  }
});
```

### Connection Resilience

```javascript
// Robust connection with automatic recovery
const resilientTelnet = new TelnetProtocol({
  host: '192.168.1.1',
  username: 'admin',
  password: 'password',
  maxReconnectAttempts: 10,
  keepAlive: true,
  keepAliveInterval: 30000,
  timeout: 60000
});

// Handle reconnection events
resilientTelnet.on('reconnecting', (attempt) => {
  console.log(`Reconnection attempt ${attempt}`);
});

resilientTelnet.on('maxReconnectAttemptsReached', () => {
  console.error('Max reconnection attempts reached, connection lost');
});

// Implement custom reconnection logic
resilientTelnet.on('disconnected', () => {
  console.log('Connection lost, implementing custom recovery...');
  
  setTimeout(async () => {
    try {
      await resilientTelnet.connect();
      console.log('Custom reconnection successful');
    } catch (error) {
      console.error('Custom reconnection failed:', error.message);
    }
  }, 10000);
});
```

### Binary Data Handling

```javascript
// Handle binary data transfer
const binaryTelnet = new TelnetProtocol({
  host: '192.168.1.1',
  username: 'admin',
  password: 'password',
  binaryMode: true,
  stripAnsiColors: false,
  encoding: 'binary'
});

// Handle raw binary data
binaryTelnet.on('output', (output) => {
  if (output.raw) {
    const binaryData = Buffer.from(output.raw, 'hex');
    console.log('Binary data received:', binaryData);
    
    // Process binary data as needed
    processBinaryData(binaryData);
  }
});

function processBinaryData(data) {
  // Custom binary data processing logic
  console.log(`Received ${data.length} bytes of binary data`);
}
```

## Device-Specific Examples

### Cisco IOS Configuration

```javascript
const ciscoSwitch = new TelnetProtocol({
  host: '192.168.1.10',
  deviceType: 'cisco',
  username: 'admin',
  password: 'cisco123',
  enablePassword: 'enable_secret'
});

await ciscoSwitch.connect();
await ciscoSwitch.enablePrivilegedMode();
await ciscoSwitch.enterConfigMode();

// VLAN configuration
await ciscoSwitch.send('vlan 100');
await ciscoSwitch.send('name SERVERS');
await ciscoSwitch.send('exit');

await ciscoSwitch.send('vlan 200');
await ciscoSwitch.send('name WORKSTATIONS');
await ciscoSwitch.send('exit');

// Interface configuration
await ciscoSwitch.send('interface range FastEthernet0/1-10');
await ciscoSwitch.send('switchport mode access');
await ciscoSwitch.send('switchport access vlan 100');
await ciscoSwitch.send('spanning-tree portfast');
await ciscoSwitch.send('exit');

await ciscoSwitch.saveConfiguration();
await ciscoSwitch.disconnect();
```

### Juniper JunOS Configuration

```javascript
const juniperRouter = new TelnetProtocol({
  host: '192.168.1.20',
  deviceType: 'juniper',
  username: 'root',
  password: 'juniper123'
});

await juniperRouter.connect();
await juniperRouter.enterConfigMode();

// Interface configuration
await juniperRouter.send('set interfaces ge-0/0/0 unit 0 family inet address 192.168.100.1/24');
await juniperRouter.send('set interfaces ge-0/0/1 unit 0 family inet address 10.0.0.1/30');

// BGP configuration
await juniperRouter.send('set protocols bgp group external type external');
await juniperRouter.send('set protocols bgp group external peer-as 65001');
await juniperRouter.send('set protocols bgp group external neighbor 10.0.0.2');

// Commit configuration
await juniperRouter.send('commit check');
await juniperRouter.send('commit');

await juniperRouter.disconnect();
```

### Huawei VRP Configuration

```javascript
const huaweiRouter = new TelnetProtocol({
  host: '192.168.1.30',
  deviceType: 'huawei',
  username: 'admin',
  password: 'huawei123'
});

await huaweiRouter.connect();
await huaweiRouter.enterConfigMode();

// Interface configuration
await huaweiRouter.send('interface GigabitEthernet0/0/1');
await huaweiRouter.send('ip address 192.168.10.1 255.255.255.0');
await huaweiRouter.send('undo shutdown');
await huaweiRouter.send('quit');

// OSPF configuration
await huaweiRouter.send('ospf 1');
await huaweiRouter.send('area 0');
await huaweiRouter.send('network 192.168.10.0 0.0.0.255');
await huaweiRouter.send('quit');
await huaweiRouter.send('quit');

await huaweiRouter.saveConfiguration();
await huaweiRouter.disconnect();
```

## Error Handling

### Connection Error Management

```javascript
const telnet = new TelnetProtocol({
  host: '192.168.1.1',
  username: 'admin',
  password: 'password'
});

// Comprehensive error handling
telnet.on('error', (error) => {
  console.error('Telnet error:', error.message);
  
  switch (error.code) {
    case 'ECONNREFUSED':
      console.error('Connection refused - check if telnet service is running');
      break;
    case 'ETIMEDOUT':
      console.error('Connection timeout - check network connectivity');
      break;
    case 'EHOSTUNREACH':
      console.error('Host unreachable - check routing');
      break;
    default:
      console.error('Unknown error occurred');
  }
});

telnet.on('loginFailed', () => {
  console.error('Authentication failed - check credentials');
});

telnet.on('timeout', () => {
  console.warn('Connection timeout - may indicate slow response');
});

// Graceful error recovery
telnet.on('disconnected', async () => {
  console.log('Connection lost, attempting recovery...');
  
  try {
    await new Promise(resolve => setTimeout(resolve, 5000));
    await telnet.connect();
    console.log('Recovery successful');
  } catch (error) {
    console.error('Recovery failed:', error.message);
  }
});
```

### Command Execution Errors

```javascript
// Handle command-specific errors
async function executeCommandSafely(telnet, command, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await telnet.send(command, {
        timeout: 15000,
        retryCount: 0
      });
      
      // Check for device error patterns
      if (result.includes('% Invalid input') || 
          result.includes('Syntax error') || 
          result.includes('Unknown command')) {
        throw new Error(`Command syntax error: ${command}`);
      }
      
      return result;
    } catch (error) {
      console.warn(`Attempt ${attempt} failed for command "${command}":`, error.message);
      
      if (attempt === maxRetries) {
        throw new Error(`Command failed after ${maxRetries} attempts: ${command}`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Usage
try {
  const result = await executeCommandSafely(telnet, 'show running-config');
  console.log('Command successful:', result);
} catch (error) {
  console.error('Command ultimately failed:', error.message);
}
```

## Performance Optimization

### Connection Pooling

```javascript
class TelnetConnectionPool {
  constructor(maxConnections = 10) {
    this.pool = [];
    this.maxConnections = maxConnections;
    this.activeConnections = new Set();
  }
  
  async getConnection(options) {
    // Look for available connection
    const available = this.pool.find(conn => 
      conn.host === options.host && 
      !this.activeConnections.has(conn.id) &&
      conn.telnet.isConnected()
    );
    
    if (available) {
      this.activeConnections.add(available.id);
      return available.telnet;
    }
    
    // Create new connection if under limit
    if (this.pool.length < this.maxConnections) {
      const telnet = new TelnetProtocol(options);
      await telnet.connect();
      
      const connection = {
        id: Date.now() + Math.random(),
        host: options.host,
        telnet,
        created: Date.now()
      };
      
      this.pool.push(connection);
      this.activeConnections.add(connection.id);
      
      return telnet;
    }
    
    throw new Error('Connection pool exhausted');
  }
  
  releaseConnection(telnet) {
    const connection = this.pool.find(conn => conn.telnet === telnet);
    if (connection) {
      this.activeConnections.delete(connection.id);
    }
  }
  
  async cleanup() {
    const disconnections = this.pool.map(conn => 
      conn.telnet.disconnect()
    );
    
    await Promise.all(disconnections);
    this.pool = [];
    this.activeConnections.clear();
  }
}
```

### Batch Command Execution

```javascript
// Efficient batch command execution
async function executeBatchCommands(telnet, commands, options = {}) {
  const results = [];
  const batchSize = options.batchSize || 5;
  const delayBetweenBatches = options.delay || 1000;
  
  for (let i = 0; i < commands.length; i += batchSize) {
    const batch = commands.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async (command) => {
        try {
          const result = await telnet.send(command);
          return { command, result, success: true };
        } catch (error) {
          return { command, error: error.message, success: false };
        }
      })
    );
    
    results.push(...batchResults);
    
    // Delay between batches to prevent overwhelming the device
    if (i + batchSize < commands.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  return results;
}

// Usage
const commands = [
  'show version',
  'show interfaces',
  'show ip route',
  'show arp',
  'show mac address-table'
];

const results = await executeBatchCommands(telnet, commands, {
  batchSize: 3,
  delay: 500
});

results.forEach(result => {
  if (result.success) {
    console.log(`✓ ${result.command}: Success`);
  } else {
    console.error(`✗ ${result.command}: ${result.error}`);
  }
});
```

## Security Best Practices

### Secure Connection Management

```javascript
const secureTelnet = new TelnetProtocol({
  host: '192.168.1.1',
  username: process.env.TELNET_USERNAME,
  password: process.env.TELNET_PASSWORD,
  enablePassword: process.env.TELNET_ENABLE_PASSWORD,
  
  // Security settings
  timeout: 30000, // Shorter timeout
  maxReconnectAttempts: 3, // Limit reconnection attempts
  keepAliveInterval: 60000, // Longer keep-alive interval
  
  // Don't log sensitive data
  debug: false
});

// Clear sensitive data after use
process.on('exit', () => {
  delete process.env.TELNET_PASSWORD;
  delete process.env.TELNET_ENABLE_PASSWORD;
});
```

### Command Validation

```javascript
// Validate commands before execution
function validateCommand(command, allowedCommands) {
  const commandStart = command.trim().toLowerCase().split(' ')[0];
  
  if (!allowedCommands.includes(commandStart)) {
    throw new Error(`Command not allowed: ${commandStart}`);
  }
  
  // Check for dangerous patterns
  const dangerousPatterns = [
    /rm\s+-rf/i,
    /format/i,
    /delete\s+.*all/i,
    /erase\s+.*all/i
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      throw new Error(`Potentially dangerous command blocked: ${command}`);
    }
  }
  
  return true;
}

// Safe command execution
async function executeSecureCommand(telnet, command) {
  const allowedCommands = ['show', 'display', 'get', 'status'];
  
  try {
    validateCommand(command, allowedCommands);
    const result = await telnet.send(command);
    return result;
  } catch (error) {
    console.error('Command validation failed:', error.message);
    throw error;
  }
}
```

## Troubleshooting

### Debug Mode

```javascript
// Enable comprehensive debugging
const debugTelnet = new TelnetProtocol({
  host: '192.168.1.1',
  username: 'admin',
  password: 'password',
  debug: true
});

// Monitor all events
debugTelnet.on('connected', () => console.log('DEBUG: Connected'));
debugTelnet.on('disconnected', () => console.log('DEBUG: Disconnected'));
debugTelnet.on('timeout', () => console.log('DEBUG: Timeout'));
debugTelnet.on('prompt', (prompt) => console.log('DEBUG: Prompt detected:', prompt));
debugTelnet.on('output', (output) => console.log('DEBUG: Raw output:', output.raw));

// Get connection information
const connInfo = debugTelnet.getConnectionInfo();
console.log('Connection info:', connInfo);
```

### Common Issues and Solutions

```javascript
// Issue 1: Connection timeout
// Solution: Increase timeout and check network connectivity
const timeoutTelnet = new TelnetProtocol({
  host: '192.168.1.1',
  timeout: 60000, // Increase timeout
  keepAlive: true,
  keepAliveInterval: 30000
});

// Issue 2: Prompt not detected
// Solution: Customize prompt patterns
const customPromptTelnet = new TelnetProtocol({
  host: '192.168.1.1',
  shellPrompt: /[\w\-_.]+[>#$]\s*$/,
  loginPrompt: /[Ll]ogin:|[Uu]sername:/,
  passwordPrompt: /[Pp]assword:/
});

// Issue 3: Command execution hangs
// Solution: Implement command timeout and retry
async function executeWithTimeout(telnet, command, timeout = 10000) {
  return Promise.race([
    telnet.send(command),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Command timeout')), timeout)
    )
  ]);
}
```

## API Reference

### Class: TelnetProtocol

#### Constructor Options

- `host` - Target hostname or IP address
- `port` - Port number (default: 23)
- `username` - Authentication username
- `password` - Authentication password
- `deviceType` - Device type ('cisco', 'juniper', 'huawei', 'generic')
- `enablePassword` - Enable mode password
- `timeout` - Connection timeout in milliseconds
- `terminalType` - Terminal type (default: 'VT100')
- `windowSize` - Terminal dimensions { width, height }

#### Methods

- `connect()` - Establish connection
- `disconnect()` - Close connection
- `send(command, options?)` - Execute command
- `enablePrivilegedMode()` - Enter enable mode
- `enterConfigMode()` - Enter configuration mode
- `saveConfiguration()` - Save device configuration
- `isConnected()` - Check connection status
- `isAuthenticated()` - Check authentication status
- `getConnectionInfo()` - Get connection details

#### Events

- `connected` - Connection established
- `disconnected` - Connection lost
- `error` - Error occurred
- `output` - Output received
- `prompt` - Prompt detected
- `timeout` - Operation timeout
- `loginFailed` - Authentication failed

This comprehensive documentation covers all aspects of the Telnet Protocol implementation for production use with network devices and legacy systems.