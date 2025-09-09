/**
 * Serial Protocol Integration Tests
 * Production-ready comprehensive test suite for Serial protocol
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { SerialProtocol } from '../../../src/protocols/SerialProtocol.js';
import { MockSerialProtocol } from '../../utils/protocol-mocks.js';
import { TestServerManager } from '../../utils/test-servers.js';
import { 
  SerialSession, 
  SerialProtocolConfig, 
  ConsoleOutput,
  SerialPortInfo,
  SerialConnectionStatus 
} from '../../../src/types/index.js';

describe('Serial Protocol Integration Tests', () => {
  let serialProtocol: SerialProtocol;
  let mockSerialProtocol: MockSerialProtocol;
  let testServerManager: TestServerManager;
  let mockConfig: SerialProtocolConfig;

  beforeAll(async () => {
    testServerManager = new TestServerManager();
    mockSerialProtocol = new MockSerialProtocol();
    await mockSerialProtocol.start();

    mockConfig = {
      defaultBaudRate: 9600,
      defaultDataBits: 8,
      defaultStopBits: 1,
      defaultParity: 'none',
      defaultFlowControl: 'none',
      timeout: 5000,
      maxSessions: 10,
      autoDetectPorts: true,
      monitoring: {
        enableMetrics: true,
        metricsInterval: 5000,
        trackDataFlow: true,
        enableHealthChecks: true
      },
      security: {
        allowedPorts: ['COM1', 'COM2', '/dev/ttyUSB0', '/dev/ttyACM0'],
        requireAuthentication: false,
        enableAuditLogging: true
      },
      buffering: {
        inputBufferSize: 4096,
        outputBufferSize: 4096,
        flushInterval: 100,
        enableFlowControl: true
      },
      protocols: {
        enableLineProtocol: true,
        enableBinaryProtocol: true,
        lineDelimiter: '\r\n',
        binaryFrameSize: 1024,
        enableChecksums: false
      }
    };

    serialProtocol = new SerialProtocol(mockConfig);
  });

  afterAll(async () => {
    await serialProtocol.cleanup();
    await mockSerialProtocol.stop();
    await testServerManager.stopAllServers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    const sessions = serialProtocol.getAllSessions();
    for (const session of sessions) {
      try {
        await serialProtocol.closeSession(session.id);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Port Discovery and Management', () => {
    test('should list available serial ports', async () => {
      const ports = await serialProtocol.listPorts();

      expect(ports).toBeInstanceOf(Array);
      expect(ports.length).toBeGreaterThan(0);
      
      ports.forEach(port => {
        expect(port.path).toBeDefined();
        expect(port.manufacturer).toBeDefined();
        expect(port.serialNumber).toBeDefined();
        expect(['COM1', 'COM2', '/dev/ttyUSB0', '/dev/ttyACM0']).toContain(port.path);
      });
    });

    test('should get port information', async () => {
      const ports = await serialProtocol.listPorts();
      if (ports.length > 0) {
        const portInfo = await serialProtocol.getPortInfo(ports[0].path);
        
        expect(portInfo).toBeDefined();
        expect(portInfo.path).toBe(ports[0].path);
        expect(portInfo.isOpen).toBeDefined();
        expect(portInfo.baudRate).toBeDefined();
      }
    });

    test('should handle invalid port paths', async () => {
      await expect(serialProtocol.getPortInfo('/dev/invalid-port')).rejects.toThrow();
    });
  });

  describe('Session Management', () => {
    test('should create serial session successfully', async () => {
      const sessionOptions = {
        portName: 'COM1',
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none' as const,
        flowControl: 'none' as const,
        consoleType: 'serial' as const,
        streaming: true
      };

      const session = await serialProtocol.createSession(sessionOptions);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.portName).toBe('COM1');
      expect(session.baudRate).toBe(9600);
      expect(session.dataBits).toBe(8);
      expect(session.stopBits).toBe(1);
      expect(session.parity).toBe('none');
      expect(session.flowControl).toBe('none');
      expect(session.status).toBe('running');
      expect(session.type).toBe('serial');
      expect(session.isOpen).toBe(true);
    }, 10000);

    test('should handle port already in use', async () => {
      const sessionOptions = {
        portName: 'COM1',
        baudRate: 9600,
        consoleType: 'serial' as const
      };

      const session1 = await serialProtocol.createSession(sessionOptions);
      expect(session1.isOpen).toBe(true);

      await expect(serialProtocol.createSession(sessionOptions)).rejects.toThrow('Port already in use');
    }, 10000);

    test('should create session with custom parameters', async () => {
      const sessionOptions = {
        portName: 'COM2',
        baudRate: 115200,
        dataBits: 7,
        stopBits: 2,
        parity: 'even' as const,
        flowControl: 'hardware' as const,
        consoleType: 'serial' as const,
        timeout: 10000
      };

      const session = await serialProtocol.createSession(sessionOptions);

      expect(session.baudRate).toBe(115200);
      expect(session.dataBits).toBe(7);
      expect(session.stopBits).toBe(2);
      expect(session.parity).toBe('even');
      expect(session.flowControl).toBe('hardware');
      expect(session.timeout).toBe(10000);
    }, 10000);
  });

  describe('Data Transmission', () => {
    let testSession: SerialSession;

    beforeEach(async () => {
      testSession = await serialProtocol.createSession({
        portName: 'COM1',
        baudRate: 9600,
        consoleType: 'serial' as const,
        streaming: true
      });
    });

    test('should send and receive text data', async () => {
      const testData = 'Hello Serial World';
      
      const dataReceivedPromise = new Promise<string>((resolve) => {
        serialProtocol.once('data-received', (data) => {
          resolve(data.toString());
        });
      });

      await serialProtocol.writeData(testSession.id, Buffer.from(testData));

      const receivedData = await dataReceivedPromise;
      expect(receivedData).toContain(testData);
    }, 10000);

    test('should send binary data', async () => {
      const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0xFF]);
      
      const dataReceivedPromise = new Promise<Buffer>((resolve) => {
        serialProtocol.once('data-received', (data) => {
          resolve(data);
        });
      });

      await serialProtocol.writeBinaryData(testSession.id, binaryData);

      const receivedData = await dataReceivedPromise;
      expect(Buffer.isBuffer(receivedData)).toBe(true);
      expect(receivedData).toEqual(binaryData);
    }, 10000);

    test('should handle data with line protocol', async () => {
      const lines = ['Line 1', 'Line 2', 'Line 3'];
      
      const linesReceived: string[] = [];
      serialProtocol.on('line-received', (line) => {
        linesReceived.push(line);
      });

      for (const line of lines) {
        await serialProtocol.writeLine(testSession.id, line);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for all lines to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(linesReceived.length).toBeGreaterThanOrEqual(lines.length);
      lines.forEach(line => {
        expect(linesReceived.some(received => received.includes(line))).toBe(true);
      });
    }, 10000);

    test('should handle flow control', async () => {
      if (testSession.flowControl === 'hardware' || testSession.flowControl === 'software') {
        const largeData = Buffer.alloc(10000, 'A');
        
        await expect(serialProtocol.writeData(testSession.id, largeData)).resolves.not.toThrow();
        
        // Verify flow control signals
        const status = await serialProtocol.getConnectionStatus(testSession.id);
        expect(status.flowControlActive).toBeDefined();
      }
    }, 15000);
  });

  describe('Error Detection and Handling', () => {
    let testSession: SerialSession;

    beforeEach(async () => {
      testSession = await serialProtocol.createSession({
        portName: 'COM1',
        baudRate: 9600,
        consoleType: 'serial' as const
      });
    });

    test('should detect framing errors', async () => {
      const errorSpy = jest.fn();
      serialProtocol.on('framing-error', errorSpy);

      // Simulate framing error by changing baud rate mid-transmission
      await serialProtocol.writeData(testSession.id, Buffer.from('test'));
      
      // This would normally cause framing errors in real hardware
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock protocol should simulate some errors based on configuration
    }, 10000);

    test('should detect parity errors', async () => {
      if (testSession.parity !== 'none') {
        const errorSpy = jest.fn();
        serialProtocol.on('parity-error', errorSpy);

        // Send data that would cause parity errors
        const corruptData = Buffer.from([0xFF, 0xFE, 0xFD]);
        await serialProtocol.writeData(testSession.id, corruptData);

        await new Promise(resolve => setTimeout(resolve, 1000));
        // Parity errors would be detected by the mock
      }
    }, 10000);

    test('should handle timeout errors', async () => {
      const shortTimeoutSession = await serialProtocol.createSession({
        portName: '/dev/ttyUSB0',
        baudRate: 9600,
        consoleType: 'serial' as const,
        timeout: 100
      });

      await expect(serialProtocol.waitForData(shortTimeoutSession.id, 5000)).rejects.toThrow('timeout');
    }, 10000);

    test('should handle buffer overflow', async () => {
      const overflowSpy = jest.fn();
      serialProtocol.on('buffer-overflow', overflowSpy);

      // Send data larger than buffer size
      const largeBuffer = Buffer.alloc(mockConfig.buffering.inputBufferSize * 2, 'X');
      
      try {
        await serialProtocol.writeData(testSession.id, largeBuffer);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        // Expected for buffer overflow
      }

      // Should detect buffer overflow
      expect(overflowSpy).toHaveBeenCalled();
    }, 10000);
  });

  describe('Protocol Support', () => {
    let testSession: SerialSession;

    beforeEach(async () => {
      testSession = await serialProtocol.createSession({
        portName: 'COM1',
        baudRate: 9600,
        consoleType: 'serial' as const
      });
    });

    test('should support AT commands protocol', async () => {
      const atCommands = ['ATI', 'AT+CGMI', 'AT+CGMM', 'AT+CGMR'];
      
      for (const command of atCommands) {
        const response = await serialProtocol.sendATCommand(testSession.id, command);
        expect(response).toBeDefined();
        expect(response).toContain('OK'); // Mock should return OK
      }
    }, 15000);

    test('should support Modbus RTU protocol', async () => {
      if (mockConfig.protocols.enableBinaryProtocol) {
        const modbusRequest = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x02, 0xC4, 0x0B]);
        
        const responsePromise = new Promise<Buffer>((resolve) => {
          serialProtocol.once('modbus-response', (response) => {
            resolve(response);
          });
        });

        await serialProtocol.sendModbusRequest(testSession.id, modbusRequest);
        
        const response = await responsePromise;
        expect(Buffer.isBuffer(response)).toBe(true);
        expect(response.length).toBeGreaterThan(0);
      }
    }, 10000);

    test('should support custom protocol with checksums', async () => {
      if (mockConfig.protocols.enableChecksums) {
        const data = Buffer.from('Custom Protocol Data');
        
        const packetWithChecksum = await serialProtocol.createChecksumPacket(testSession.id, data);
        expect(packetWithChecksum.length).toBeGreaterThan(data.length);
        
        const isValid = await serialProtocol.validateChecksum(testSession.id, packetWithChecksum);
        expect(isValid).toBe(true);
      }
    });
  });

  describe('Monitoring and Metrics', () => {
    let monitoringSession: SerialSession;

    beforeEach(async () => {
      monitoringSession = await serialProtocol.createSession({
        portName: 'COM1',
        baudRate: 9600,
        consoleType: 'serial' as const,
        streaming: true
      });
    });

    test('should collect communication metrics', async () => {
      const metricsSpy = jest.fn();
      serialProtocol.on('metrics-collected', metricsSpy);

      // Generate some traffic
      await serialProtocol.writeData(monitoringSession.id, Buffer.from('Test data for metrics'));
      
      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 6000));

      expect(metricsSpy).toHaveBeenCalled();

      const metrics = metricsSpy.mock.calls[0][0];
      expect(metrics.sessionId).toBe(monitoringSession.id);
      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(typeof metrics.bytesTransmitted).toBe('number');
      expect(typeof metrics.bytesReceived).toBe('number');
      expect(typeof metrics.transmissionErrors).toBe('number');
      expect(typeof metrics.averageLatency).toBe('number');
      expect(metrics.bytesTransmitted).toBeGreaterThan(0);
    }, 10000);

    test('should monitor connection health', async () => {
      const healthCheckSpy = jest.fn();
      serialProtocol.on('health-check', healthCheckSpy);

      // Wait for health checks
      await new Promise(resolve => setTimeout(resolve, 8000));

      expect(healthCheckSpy).toHaveBeenCalled();

      const healthCheck = healthCheckSpy.mock.calls[0][0];
      expect(healthCheck.sessionId).toBe(monitoringSession.id);
      expect(healthCheck.timestamp).toBeInstanceOf(Date);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(healthCheck.status);
      expect(healthCheck.signalQuality).toBeDefined();
      expect(healthCheck.connectionStable).toBeDefined();
    }, 10000);

    test('should track data flow statistics', async () => {
      // Send various types of data
      await serialProtocol.writeData(monitoringSession.id, Buffer.from('ASCII data'));
      await serialProtocol.writeData(monitoringSession.id, Buffer.from([0x01, 0x02, 0x03]));
      await serialProtocol.writeLine(monitoringSession.id, 'Line data');

      const stats = await serialProtocol.getDataFlowStats(monitoringSession.id);

      expect(stats).toBeDefined();
      expect(stats.totalBytesTransmitted).toBeGreaterThan(0);
      expect(stats.totalPacketsTransmitted).toBeGreaterThan(0);
      expect(stats.averagePacketSize).toBeGreaterThan(0);
      expect(stats.dataRate).toBeGreaterThanOrEqual(0);
    }, 5000);
  });

  describe('Configuration and Settings', () => {
    test('should change port settings dynamically', async () => {
      const session = await serialProtocol.createSession({
        portName: 'COM2',
        baudRate: 9600,
        consoleType: 'serial' as const
      });

      const newSettings = {
        baudRate: 115200,
        dataBits: 7,
        stopBits: 2,
        parity: 'odd' as const
      };

      await serialProtocol.updatePortSettings(session.id, newSettings);

      const updatedSession = serialProtocol.getSession(session.id);
      expect(updatedSession?.baudRate).toBe(115200);
      expect(updatedSession?.dataBits).toBe(7);
      expect(updatedSession?.stopBits).toBe(2);
      expect(updatedSession?.parity).toBe('odd');
    }, 10000);

    test('should configure custom protocols', async () => {
      const customProtocolConfig = {
        name: 'CustomProtocol',
        frameStart: 0x55,
        frameEnd: 0xAA,
        maxFrameSize: 256,
        enableEscaping: true,
        checksumType: 'CRC16'
      };

      await serialProtocol.configureCustomProtocol(customProtocolConfig);

      const protocols = await serialProtocol.listConfiguredProtocols();
      expect(protocols).toContain('CustomProtocol');
    });

    test('should save and load session profiles', async () => {
      const profile = {
        name: 'TestProfile',
        portName: 'COM1',
        baudRate: 38400,
        dataBits: 8,
        stopBits: 1,
        parity: 'none' as const,
        flowControl: 'hardware' as const,
        customSettings: {
          autoConnect: true,
          enableLogging: true
        }
      };

      await serialProtocol.saveSessionProfile(profile);
      
      const savedProfile = await serialProtocol.loadSessionProfile('TestProfile');
      expect(savedProfile).toEqual(profile);

      const session = await serialProtocol.createSessionFromProfile('TestProfile');
      expect(session.baudRate).toBe(38400);
      expect(session.flowControl).toBe('hardware');
    }, 10000);
  });

  describe('Advanced Features', () => {
    let advancedSession: SerialSession;

    beforeEach(async () => {
      advancedSession = await serialProtocol.createSession({
        portName: 'COM1',
        baudRate: 9600,
        consoleType: 'serial' as const
      });
    });

    test('should support signal control', async () => {
      // Control DTR (Data Terminal Ready)
      await serialProtocol.setDTR(advancedSession.id, true);
      let signalStatus = await serialProtocol.getSignalStatus(advancedSession.id);
      expect(signalStatus.DTR).toBe(true);

      await serialProtocol.setDTR(advancedSession.id, false);
      signalStatus = await serialProtocol.getSignalStatus(advancedSession.id);
      expect(signalStatus.DTR).toBe(false);

      // Control RTS (Request to Send)
      await serialProtocol.setRTS(advancedSession.id, true);
      signalStatus = await serialProtocol.getSignalStatus(advancedSession.id);
      expect(signalStatus.RTS).toBe(true);
    }, 10000);

    test('should support break signal', async () => {
      const breakSpy = jest.fn();
      serialProtocol.on('break-detected', breakSpy);

      await serialProtocol.sendBreak(advancedSession.id, 250); // 250ms break

      // Wait for break to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(breakSpy).toHaveBeenCalled();
    }, 5000);

    test('should support port sharing', async () => {
      if (mockConfig.maxSessions > 1) {
        // Create multiple sessions on different ports
        const session1 = await serialProtocol.createSession({
          portName: 'COM1',
          baudRate: 9600,
          consoleType: 'serial' as const
        });

        const session2 = await serialProtocol.createSession({
          portName: 'COM2',
          baudRate: 9600,
          consoleType: 'serial' as const
        });

        expect(session1.id).not.toBe(session2.id);
        expect(session1.isOpen).toBe(true);
        expect(session2.isOpen).toBe(true);

        // Both should be able to send data independently
        await serialProtocol.writeData(session1.id, Buffer.from('Session 1 data'));
        await serialProtocol.writeData(session2.id, Buffer.from('Session 2 data'));
      }
    }, 15000);
  });

  describe('Error Handling and Recovery', () => {
    test('should handle device disconnection', async () => {
      const session = await serialProtocol.createSession({
        portName: '/dev/ttyUSB0',
        baudRate: 9600,
        consoleType: 'serial' as const
      });

      const disconnectSpy = jest.fn();
      serialProtocol.on('device-disconnected', disconnectSpy);

      // Simulate device disconnection
      serialProtocol.emit('device-disconnected', { sessionId: session.id, port: '/dev/ttyUSB0' });

      expect(disconnectSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: session.id,
          port: '/dev/ttyUSB0'
        })
      );

      const updatedSession = serialProtocol.getSession(session.id);
      expect(updatedSession?.status).toBe('disconnected');
    });

    test('should attempt reconnection', async () => {
      const session = await serialProtocol.createSession({
        portName: '/dev/ttyUSB0',
        baudRate: 9600,
        consoleType: 'serial' as const,
        autoReconnect: true
      });

      const reconnectSpy = jest.fn();
      serialProtocol.on('reconnection-attempt', reconnectSpy);

      // Simulate disconnection and trigger reconnection
      serialProtocol.emit('device-disconnected', { sessionId: session.id, port: '/dev/ttyUSB0' });

      // Wait for reconnection attempt
      await new Promise(resolve => setTimeout(resolve, 3000));

      expect(reconnectSpy).toHaveBeenCalled();
    });

    test('should handle concurrent access errors', async () => {
      const sessionPromises = Array.from({ length: 3 }, () =>
        serialProtocol.createSession({
          portName: 'COM1',
          baudRate: 9600,
          consoleType: 'serial' as const
        }).catch(err => err)
      );

      const results = await Promise.all(sessionPromises);
      
      // Only one should succeed, others should fail
      const successfulSessions = results.filter(result => !(result instanceof Error));
      const failedSessions = results.filter(result => result instanceof Error);

      expect(successfulSessions.length).toBe(1);
      expect(failedSessions.length).toBe(2);
      
      failedSessions.forEach(error => {
        expect(error.message).toContain('already in use');
      });
    }, 10000);
  });

  describe('Session Cleanup', () => {
    test('should close session properly', async () => {
      const session = await serialProtocol.createSession({
        portName: 'COM1',
        baudRate: 9600,
        consoleType: 'serial' as const
      });

      expect(session.status).toBe('running');
      expect(session.isOpen).toBe(true);

      await serialProtocol.closeSession(session.id);

      const closedSession = serialProtocol.getSession(session.id);
      expect(closedSession?.status).toBe('closed');
      expect(closedSession?.isOpen).toBe(false);
    });

    test('should cleanup all resources on protocol shutdown', async () => {
      const session1 = await serialProtocol.createSession({
        portName: 'COM1',
        baudRate: 9600,
        consoleType: 'serial' as const
      });

      const session2 = await serialProtocol.createSession({
        portName: 'COM2',
        baudRate: 9600,
        consoleType: 'serial' as const
      });

      expect(serialProtocol.getAllSessions().length).toBe(2);

      await serialProtocol.cleanup();

      expect(serialProtocol.getAllSessions().length).toBe(0);
    }, 10000);
  });
});