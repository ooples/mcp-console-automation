# Serial Protocol

## Overview

The Serial Protocol enables AI assistants to communicate with embedded devices, IoT sensors, Arduino boards, and other hardware via serial/COM ports. It provides comprehensive device management, data parsing, and hardware integration capabilities through the MCP Console Automation server.

## Features

- **Multi-Device Support**: Connect to multiple serial devices simultaneously
- **Device Auto-Detection**: Automatically detect and configure common devices (Arduino, ESP32, FTDI)
- **Protocol Profiles**: Pre-configured settings for popular platforms
- **Data Parsing**: Built-in parsers for common data formats (JSON, CSV, delimited)
- **Real-time Monitoring**: Live data streaming and monitoring
- **Device Management**: Hot-plug detection and automatic reconnection
- **Hardware Integration**: Support for various USB-to-serial adapters
- **Error Recovery**: Robust error handling and recovery mechanisms

## Supported Hardware

### Development Boards
- **Arduino**: Uno, Nano, Mega, Leonardo, Pro Micro
- **ESP32/ESP8266**: Various development boards
- **Raspberry Pi Pico**: Serial communication support
- **STM32**: Development boards with USB-CDC
- **Teensy**: 3.x and 4.x series

### USB-to-Serial Adapters
- **FTDI**: FT232, FT2232H, FT4232H
- **CH340/CH341**: Common Chinese USB-serial chips
- **CP2102/CP2104**: Silicon Labs adapters
- **PL2303**: Prolific adapters

## Prerequisites

- Serial device connected via USB or RS232
- Appropriate device drivers installed
- Device permissions configured (Linux/macOS)

### Driver Installation

#### Windows
- Most devices work with built-in drivers
- For CH340: Download from manufacturer
- For custom devices: Install device-specific drivers

#### Linux
```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Install common drivers
sudo apt-get install dkms linux-headers-$(uname -r)

# For CH340 devices
sudo modprobe usbserial vendor=0x1a86 product=0x7523
```

#### macOS
```bash
# Install drivers via Homebrew
brew install --cask ch340g-ch34g-ch34x-mac-os-x-driver

# Or download from manufacturer websites
```

## Configuration

### Basic Configuration

```typescript
const serialConfig: SerialProtocolConfig = {
  connection: {
    path: '/dev/ttyUSB0', // Linux
    // path: 'COM3',      // Windows  
    // path: '/dev/cu.usbserial-1420', // macOS
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    flowControl: 'none'
  },
  monitoring: {
    enabled: true,
    dataLogging: true,
    autoReconnect: true,
    reconnectDelay: 5000
  },
  parsing: {
    delimiter: '\n',
    encoding: 'utf8',
    bufferSize: 1024,
    timeout: 1000
  }
};
```

### Device-Specific Profiles

```typescript
const deviceProfiles = {
  arduino: {
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    dtr: true,
    rts: false,
    autoOpen: true,
    parser: 'readline',
    delimiter: '\n',
    vendorIds: ['2341', '2A03', '1B4F']
  },
  esp32: {
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    dtr: false,
    rts: true,
    autoOpen: true,
    parser: 'readline',
    delimiter: '\n',
    vendorIds: ['303A', '1A86', '0403']
  },
  modbus: {
    baudRate: 9600,
    dataBits: 8,
    parity: 'even',
    stopBits: 1,
    dtr: false,
    rts: false,
    parser: 'byte-length',
    timeout: 1000
  }
};
```

## Usage Examples

### 1. Arduino Communication

```javascript
// Connect to Arduino
const arduinoSession = await console_create_session({
  command: 'serial-connect',
  consoleType: 'serial',
  serialOptions: {
    path: 'COM3', // or '/dev/ttyUSB0' on Linux
    profile: 'arduino',
    baudRate: 115200
  },
  streaming: true
});

// Wait for Arduino to initialize
await console_wait_for_output({
  sessionId: arduinoSession.sessionId,
  pattern: 'Arduino Ready',
  timeout: 10000
});

// Send commands to Arduino
await console_send_input({
  sessionId: arduinoSession.sessionId,
  input: 'LED_ON\n'
});

// Read sensor data
await console_send_input({
  sessionId: arduinoSession.sessionId,
  input: 'READ_SENSORS\n'
});

// Monitor for sensor data
protocol.on('data-received', (data, session) => {
  if (data.includes('TEMP:')) {
    const temperature = parseFloat(data.split('TEMP:')[1]);
    console.log(`Temperature: ${temperature}°C`);
    
    if (temperature > 30) {
      // Send cooling command
      console_send_input({
        sessionId: session.sessionId,
        input: 'FAN_ON\n'
      });
    }
  }
});
```

### 2. ESP32 IoT Device Management

```javascript
// Connect to ESP32 WiFi module
const esp32Session = await console_create_session({
  command: 'serial-connect',
  consoleType: 'serial',
  serialOptions: {
    path: '/dev/cu.usbserial-1420',
    profile: 'esp32',
    baudRate: 115200
  }
});

// Configure WiFi
await console_send_input({
  sessionId: esp32Session.sessionId,
  input: 'AT+CWMODE=1\r\n' // Station mode
});

await console_wait_for_output({
  sessionId: esp32Session.sessionId,
  pattern: 'OK',
  timeout: 5000
});

// Connect to WiFi
await console_send_input({
  sessionId: esp32Session.sessionId,
  input: 'AT+CWJAP="MyWiFi","password123"\r\n'
});

await console_wait_for_output({
  sessionId: esp32Session.sessionId,
  pattern: 'WIFI CONNECTED',
  timeout: 30000
});

// Get IP address
await console_send_input({
  sessionId: esp32Session.sessionId,
  input: 'AT+CIFSR\r\n'
});

// Start TCP server
await console_send_input({
  sessionId: esp32Session.sessionId,
  input: 'AT+CIPMUX=1\r\n' // Multiple connections
});

await console_send_input({
  sessionId: esp32Session.sessionId,
  input: 'AT+CIPSERVER=1,80\r\n' // Start server on port 80
});

console.log('ESP32 web server started');
```

### 3. Industrial Sensor Data Collection

```javascript
// Connect to Modbus RTU sensor
const sensorSession = await console_create_session({
  command: 'serial-connect',
  consoleType: 'serial',
  serialOptions: {
    path: '/dev/ttyRS485-1',
    profile: 'modbus',
    baudRate: 9600,
    parity: 'even'
  }
});

// Function to read holding registers
async function readModbusRegisters(deviceId, startAddress, count) {
  const command = Buffer.from([
    deviceId,          // Device ID
    0x03,              // Function code (Read Holding Registers)
    (startAddress >> 8) & 0xFF,  // Start address high byte
    startAddress & 0xFF,         // Start address low byte
    (count >> 8) & 0xFF,         // Number of registers high byte
    count & 0xFF               // Number of registers low byte
  ]);
  
  // Calculate and append CRC
  const crc = calculateCRC16(command);
  const fullCommand = Buffer.concat([command, crc]);
  
  // Send command
  await console_send_input({
    sessionId: sensorSession.sessionId,
    input: fullCommand
  });
  
  // Wait for response
  const response = await console_wait_for_output({
    sessionId: sensorSession.sessionId,
    pattern: /[\x00-\xFF]+/, // Binary data pattern
    timeout: 2000
  });
  
  return parseModbusResponse(response);
}

// Read temperature and humidity sensors
async function collectSensorData() {
  try {
    const temperature = await readModbusRegisters(1, 0x0000, 1);
    const humidity = await readModbusRegisters(1, 0x0001, 1);
    
    console.log(`Temperature: ${temperature / 10}°C`);
    console.log(`Humidity: ${humidity / 10}%`);
    
    // Store data or trigger actions based on values
    if (temperature > 250) { // 25.0°C
      console.warn('High temperature detected!');
    }
    
  } catch (error) {
    console.error('Failed to read sensor data:', error);
  }
}

// Collect data every 30 seconds
setInterval(collectSensorData, 30000);
```

### 4. GPS Data Processing

```javascript
// Connect to GPS module
const gpsSession = await console_create_session({
  command: 'serial-connect',
  consoleType: 'serial',
  serialOptions: {
    path: '/dev/ttyAMA0', // Raspberry Pi UART
    baudRate: 9600,
    parser: 'readline',
    delimiter: '\n'
  }
});

// Parse NMEA sentences
function parseNMEA(sentence) {
  if (sentence.startsWith('$GPRMC')) {
    // Recommended Minimum Course data
    const parts = sentence.split(',');
    if (parts[2] === 'A') { // Valid fix
      const latitude = convertDMSToDD(parts[3], parts[4]);
      const longitude = convertDMSToDD(parts[5], parts[6]);
      const speed = parseFloat(parts[7]) * 1.852; // Convert knots to km/h
      const course = parseFloat(parts[8]);
      
      return {
        latitude,
        longitude,
        speed,
        course,
        timestamp: new Date()
      };
    }
  }
  return null;
}

// Monitor GPS data
protocol.on('data-received', (data, session) => {
  const lines = data.split('\n');
  for (const line of lines) {
    if (line.startsWith('$GP')) {
      const gpsData = parseNMEA(line);
      if (gpsData) {
        console.log(`Location: ${gpsData.latitude}, ${gpsData.longitude}`);
        console.log(`Speed: ${gpsData.speed.toFixed(1)} km/h`);
        
        // Trigger geofence alerts
        if (isOutsideGeofence(gpsData.latitude, gpsData.longitude)) {
          console.warn('Vehicle outside designated area!');
        }
      }
    }
  }
});

function convertDMSToDD(dms, direction) {
  const degrees = Math.floor(dms / 100);
  const minutes = dms - (degrees * 100);
  let dd = degrees + (minutes / 60);
  
  if (direction === 'S' || direction === 'W') {
    dd = dd * -1;
  }
  
  return dd;
}
```

### 5. Multi-Device Monitoring System

```javascript
// Connect to multiple sensors
const devices = [
  {
    name: 'temperature-sensor',
    path: '/dev/ttyUSB0',
    baudRate: 9600,
    type: 'temperature'
  },
  {
    name: 'pressure-sensor', 
    path: '/dev/ttyUSB1',
    baudRate: 115200,
    type: 'pressure'
  },
  {
    name: 'flow-meter',
    path: '/dev/ttyUSB2', 
    baudRate: 38400,
    type: 'flow'
  }
];

const sessions = new Map();

// Connect to all devices
for (const device of devices) {
  try {
    const session = await console_create_session({
      command: 'serial-connect',
      consoleType: 'serial',
      serialOptions: {
        path: device.path,
        baudRate: device.baudRate,
        autoReconnect: true
      },
      metadata: {
        deviceName: device.name,
        deviceType: device.type
      }
    });
    
    sessions.set(device.name, session);
    console.log(`Connected to ${device.name}`);
    
  } catch (error) {
    console.error(`Failed to connect to ${device.name}:`, error);
  }
}

// Unified data processing
protocol.on('data-received', (data, session) => {
  const deviceName = session.metadata?.deviceName;
  const deviceType = session.metadata?.deviceType;
  
  try {
    let parsedData;
    
    switch (deviceType) {
      case 'temperature':
        parsedData = parseTemperatureData(data);
        break;
      case 'pressure':
        parsedData = parsePressureData(data);
        break;
      case 'flow':
        parsedData = parseFlowData(data);
        break;
    }
    
    if (parsedData) {
      // Store in database or send to monitoring system
      storeMetrics(deviceName, deviceType, parsedData);
      
      // Check for alerts
      checkAlertConditions(deviceName, deviceType, parsedData);
    }
    
  } catch (error) {
    console.error(`Failed to process data from ${deviceName}:`, error);
  }
});

// Health monitoring for all devices
setInterval(async () => {
  for (const [deviceName, session] of sessions) {
    try {
      // Send heartbeat command
      await console_send_input({
        sessionId: session.sessionId,
        input: 'STATUS?\n'
      });
      
      // Check if device responds within timeout
      const response = await console_wait_for_output({
        sessionId: session.sessionId,
        pattern: 'OK',
        timeout: 5000
      });
      
      console.log(`${deviceName}: Healthy`);
      
    } catch (error) {
      console.error(`${deviceName}: No response - may need attention`);
    }
  }
}, 60000); // Check every minute
```

### 6. Firmware Update via Serial

```javascript
// Update Arduino firmware via serial bootloader
async function updateArduinoFirmware(firmwarePath) {
  // Reset Arduino to bootloader mode
  const bootloaderSession = await console_create_session({
    command: 'serial-connect',
    consoleType: 'serial',
    serialOptions: {
      path: 'COM3',
      baudRate: 57600, // Arduino bootloader baud rate
      dtr: true,
      rts: false
    }
  });

  console.log('Entering bootloader mode...');
  
  // Toggle DTR to reset Arduino
  await toggleDTR(bootloaderSession.sessionId);
  
  // Wait for bootloader ready signal
  await console_wait_for_output({
    sessionId: bootloaderSession.sessionId,
    pattern: 'STK500',
    timeout: 10000
  });

  console.log('Bootloader ready, uploading firmware...');

  // Read firmware file
  const firmwareData = require('fs').readFileSync(firmwarePath);
  const firmwareHex = firmwareData.toString();

  // Send firmware data using Intel HEX format
  const hexLines = firmwareHex.split('\n');
  for (const line of hexLines) {
    if (line.trim().startsWith(':')) {
      await console_send_input({
        sessionId: bootloaderSession.sessionId,
        input: line.trim() + '\n'
      });
      
      // Wait for acknowledgment
      await console_wait_for_output({
        sessionId: bootloaderSession.sessionId,
        pattern: /[\x14\x10]/, // ACK or response
        timeout: 2000
      });
    }
  }

  console.log('Firmware upload completed');
  
  // Exit bootloader and reset to application
  await console_send_input({
    sessionId: bootloaderSession.sessionId,
    input: 'Q' // Quit command
  });

  await console_stop_session({
    sessionId: bootloaderSession.sessionId
  });

  // Reconnect to application
  setTimeout(async () => {
    const appSession = await console_create_session({
      command: 'serial-connect',
      consoleType: 'serial',
      serialOptions: {
        path: 'COM3',
        baudRate: 115200 // Application baud rate
      }
    });

    await console_wait_for_output({
      sessionId: appSession.sessionId,
      pattern: 'Firmware updated successfully',
      timeout: 10000
    });

    console.log('Firmware update complete and verified');
  }, 3000);
}

async function toggleDTR(sessionId) {
  // This would be implemented at the protocol level
  // to manipulate DTR line for Arduino reset
  await protocol.setDTR(sessionId, false);
  await new Promise(resolve => setTimeout(resolve, 100));
  await protocol.setDTR(sessionId, true);
  await new Promise(resolve => setTimeout(resolve, 100));
  await protocol.setDTR(sessionId, false);
}
```

## Advanced Features

### Custom Data Parsers

```javascript
// Register custom parser for binary protocol
protocol.registerParser('custom-binary', {
  parse: (buffer) => {
    const messages = [];
    let offset = 0;
    
    while (offset < buffer.length) {
      if (buffer[offset] === 0xAA && buffer[offset + 1] === 0x55) {
        const length = buffer[offset + 2];
        if (offset + 3 + length <= buffer.length) {
          const payload = buffer.slice(offset + 3, offset + 3 + length);
          const checksum = buffer[offset + 3 + length];
          
          if (calculateChecksum(payload) === checksum) {
            messages.push({
              type: 'data',
              payload: payload,
              timestamp: new Date()
            });
          }
          
          offset += 4 + length;
        } else {
          break;
        }
      } else {
        offset++;
      }
    }
    
    return messages;
  }
});
```

### Device Auto-Discovery

```javascript
// Automatically detect connected devices
async function discoverSerialDevices() {
  const availablePorts = await SerialPort.list();
  const detectedDevices = [];
  
  for (const port of availablePorts) {
    const deviceInfo = {
      path: port.path,
      manufacturer: port.manufacturer,
      serialNumber: port.serialNumber,
      vendorId: port.vendorId,
      productId: port.productId,
      profile: detectDeviceProfile(port)
    };
    
    // Test connection to verify device type
    try {
      const testSession = await console_create_session({
        command: 'serial-connect',
        consoleType: 'serial',
        serialOptions: {
          path: port.path,
          baudRate: deviceInfo.profile.baudRate,
          timeout: 2000
        }
      });
      
      // Send identification command
      await console_send_input({
        sessionId: testSession.sessionId,
        input: deviceInfo.profile.identificationCommand || 'AT\r\n'
      });
      
      const response = await console_wait_for_output({
        sessionId: testSession.sessionId,
        pattern: deviceInfo.profile.identificationResponse || 'OK',
        timeout: 3000
      });
      
      deviceInfo.verified = true;
      deviceInfo.response = response;
      
      await console_stop_session({
        sessionId: testSession.sessionId
      });
      
    } catch (error) {
      deviceInfo.verified = false;
      deviceInfo.error = error.message;
    }
    
    detectedDevices.push(deviceInfo);
  }
  
  return detectedDevices;
}

function detectDeviceProfile(port) {
  // Arduino detection
  if (['2341', '2A03', '1B4F'].includes(port.vendorId)) {
    return {
      name: 'Arduino',
      baudRate: 115200,
      identificationCommand: 'AT\n',
      identificationResponse: /Arduino|Ready/
    };
  }
  
  // ESP32 detection
  if (['303A', '1A86'].includes(port.vendorId)) {
    return {
      name: 'ESP32',
      baudRate: 115200,
      identificationCommand: 'AT\r\n',
      identificationResponse: 'OK'
    };
  }
  
  // Default profile
  return {
    name: 'Generic',
    baudRate: 9600,
    identificationCommand: null,
    identificationResponse: null
  };
}
```

### Signal Control

```javascript
// Control hardware flow control signals
async function controlSerialSignals(sessionId) {
  // Set RTS high
  await protocol.setRTS(sessionId, true);
  
  // Set DTR low  
  await protocol.setDTR(sessionId, false);
  
  // Read signal states
  const signals = await protocol.getSignals(sessionId);
  console.log('Signal states:', {
    cts: signals.cts,
    dsr: signals.dsr,
    dcd: signals.dcd,
    ri: signals.ri
  });
  
  // Wait for CTS to go high
  await protocol.waitForSignal(sessionId, 'cts', true, 5000);
}
```

## Error Handling

### Connection Issues

```javascript
protocol.on('connection-error', (error, devicePath) => {
  console.error(`Connection failed to ${devicePath}:`, error.message);
  
  if (error.code === 'ENOENT') {
    console.log('Device not found - may have been unplugged');
  } else if (error.code === 'EACCES') {
    console.log('Permission denied - check user permissions');
  } else if (error.code === 'EBUSY') {
    console.log('Port busy - another application may be using it');
  }
});

protocol.on('device-disconnected', (devicePath, session) => {
  console.warn(`Device ${devicePath} disconnected unexpectedly`);
  
  // Attempt reconnection
  if (session.autoReconnect) {
    setTimeout(() => {
      protocol.reconnectDevice(session.sessionId);
    }, session.reconnectDelay || 5000);
  }
});
```

### Data Parsing Errors

```javascript
protocol.on('parse-error', (error, rawData, session) => {
  console.error('Failed to parse data:', error.message);
  console.log('Raw data:', rawData.toString('hex'));
  
  // Log to file for debugging
  require('fs').appendFileSync('parse-errors.log', 
    `${new Date().toISOString()}: ${error.message}\n` +
    `Device: ${session.devicePath}\n` +
    `Raw: ${rawData.toString('hex')}\n\n`
  );
});

// Implement error recovery
protocol.on('communication-error', async (error, session) => {
  console.warn('Communication error, attempting recovery:', error.message);
  
  try {
    // Clear buffers
    await protocol.clearBuffers(session.sessionId);
    
    // Send reset command if device supports it
    await console_send_input({
      sessionId: session.sessionId,
      input: 'RST\n'
    });
    
    // Wait for device to respond
    await console_wait_for_output({
      sessionId: session.sessionId,
      pattern: 'READY',
      timeout: 10000
    });
    
    console.log('Device recovery successful');
    
  } catch (recoveryError) {
    console.error('Device recovery failed:', recoveryError.message);
    
    // Close and reopen connection
    await protocol.reconnectDevice(session.sessionId);
  }
});
```

## Best Practices

### 1. Connection Management

```javascript
// Always set appropriate timeouts
const connectionOptions = {
  path: '/dev/ttyUSB0',
  baudRate: 115200,
  autoOpen: false,
  lock: true, // Prevent other processes from opening
  highWaterMark: 16 * 1024, // 16KB buffer
  endOnClose: true
};

// Use connection pooling for multiple devices
class SerialConnectionPool {
  constructor() {
    this.connections = new Map();
    this.maxConnections = 10;
  }
  
  async getConnection(devicePath, options) {
    if (this.connections.has(devicePath)) {
      return this.connections.get(devicePath);
    }
    
    if (this.connections.size >= this.maxConnections) {
      throw new Error('Maximum connections exceeded');
    }
    
    const connection = await this.createConnection(devicePath, options);
    this.connections.set(devicePath, connection);
    return connection;
  }
}
```

### 2. Data Validation

```javascript
// Implement checksums for critical data
function validateData(data) {
  if (data.length < 4) {
    throw new Error('Data too short');
  }
  
  const payload = data.slice(0, -2);
  const receivedChecksum = data.readUInt16LE(data.length - 2);
  const calculatedChecksum = calculateCRC16(payload);
  
  if (receivedChecksum !== calculatedChecksum) {
    throw new Error('Checksum mismatch');
  }
  
  return payload;
}

// Use timeouts for all operations
async function sendCommandWithTimeout(sessionId, command, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Command timeout'));
    }, timeout);
    
    protocol.sendCommand(sessionId, command)
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
```

### 3. Resource Cleanup

```javascript
// Proper cleanup on application exit
process.on('SIGINT', async () => {
  console.log('Shutting down serial connections...');
  
  for (const sessionId of protocol.getActiveSessions()) {
    try {
      await console_stop_session({ sessionId });
    } catch (error) {
      console.error(`Failed to close session ${sessionId}:`, error.message);
    }
  }
  
  process.exit(0);
});

// Monitor connection health
setInterval(() => {
  const activeSessions = protocol.getActiveSessions();
  
  for (const sessionId of activeSessions) {
    const session = protocol.getSession(sessionId);
    
    if (session.lastActivity < Date.now() - 60000) { // 1 minute
      console.warn(`Session ${sessionId} appears inactive`);
      
      // Send keepalive
      protocol.sendKeepAlive(sessionId);
    }
  }
}, 30000); // Check every 30 seconds
```

## Troubleshooting

### Common Issues

#### 1. Permission Denied (Linux/macOS)
```bash
# Add user to appropriate group
sudo usermod -a -G dialout $USER  # Linux
sudo usermod -a -G uucp $USER     # Some Linux distributions

# Or change device permissions
sudo chmod 666 /dev/ttyUSB0
```

#### 2. Device Not Found
```javascript
// List available ports
const ports = await SerialPort.list();
console.log('Available ports:', ports);

// Check if device is enumerated
const targetDevice = ports.find(p => p.vendorId === '2341');
if (!targetDevice) {
  console.log('Arduino not found - check USB connection');
}
```

#### 3. Communication Issues
```javascript
// Test basic communication
async function testCommunication(sessionId) {
  try {
    // Send simple command
    await console_send_input({
      sessionId: sessionId,
      input: 'AT\r\n'
    });
    
    // Wait for response
    const response = await console_wait_for_output({
      sessionId: sessionId,
      pattern: 'OK',
      timeout: 5000
    });
    
    console.log('Communication test passed');
    return true;
    
  } catch (error) {
    console.error('Communication test failed:', error.message);
    return false;
  }
}
```

## Migration Guide

### From Direct Serial Communication

#### Before (Direct Node.js)
```javascript
const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');

const port = new SerialPort('/dev/ttyUSB0', {
  baudRate: 115200
});

const parser = port.pipe(new Readline({ delimiter: '\n' }));

parser.on('data', (data) => {
  console.log('Received:', data);
});

port.write('Hello\n');
```

#### After (MCP Serial Protocol)
```javascript
// Create session
const session = await console_create_session({
  command: 'serial-connect',
  consoleType: 'serial',
  serialOptions: {
    path: '/dev/ttyUSB0',
    baudRate: 115200,
    parser: 'readline'
  },
  streaming: true
});

// Send data
await console_send_input({
  sessionId: session.sessionId,
  input: 'Hello\n'
});

// Receive data through events
protocol.on('data-received', (data, session) => {
  console.log('Received:', data);
});
```

## Performance Tuning

### Buffer Management
```javascript
// Optimize buffer sizes
const performanceOptions = {
  highWaterMark: 64 * 1024, // 64KB for high-speed devices
  lowWaterMark: 1024,       // 1KB minimum
  objectMode: false,
  decodeStrings: true
};

// Use binary mode for high-speed data
const binaryOptions = {
  parser: 'byte-length',
  length: 1024,
  encoding: null // Raw binary
};
```

### Batch Processing
```javascript
// Process data in batches for better performance
const dataBuffer = [];
const BATCH_SIZE = 100;

protocol.on('data-received', (data, session) => {
  dataBuffer.push(data);
  
  if (dataBuffer.length >= BATCH_SIZE) {
    processBatch(dataBuffer.splice(0, BATCH_SIZE));
  }
});

// Process remaining data periodically
setInterval(() => {
  if (dataBuffer.length > 0) {
    processBatch(dataBuffer.splice(0));
  }
}, 1000);
```

## API Reference

### Events
- `connection-established`: Connection successful
- `connection-error`: Connection failed  
- `device-disconnected`: Device unplugged
- `data-received`: Data received from device
- `parse-error`: Data parsing failed
- `communication-error`: Communication error

### Methods
- `createSession(options)`: Create serial session
- `listDevices()`: List available devices
- `discoverDevices()`: Auto-discover devices
- `sendData(sessionId, data)`: Send data to device
- `setSignals(sessionId, signals)`: Control hardware signals
- `getSignals(sessionId)`: Read hardware signals
- `registerParser(name, parser)`: Register custom parser
- `reconnectDevice(sessionId)`: Reconnect device

### Configuration Options
See the TypeScript interfaces in the source code for complete configuration options including `SerialConnectionOptions`, `SerialProtocolProfile`, and `SerialDeviceInfo`.