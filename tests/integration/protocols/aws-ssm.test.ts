/**
 * AWS Systems Manager (SSM) Protocol Integration Tests
 * 
 * Comprehensive testing suite for AWS SSM protocol implementation including:
 * - Session Manager connections
 * - Run Command operations  
 * - Parameter Store integration
 * - CloudWatch logging
 * - IAM role assumptions
 * - Cross-region operations
 * - Port forwarding
 * - Hybrid activation
 */

import { AWSSSMProtocol } from '../../../src/protocols/AWSSSMProtocol.js';
import { SessionOptions } from '../../../src/types/index.js';
import { MockTestServerFactory } from '../../utils/protocol-mocks.js';
import { TestServerManager } from '../../utils/test-servers.js';
import { PerformanceBenchmark } from '../../performance/protocol-benchmarks.js';
import { SecurityTester } from '../../security/protocol-security.js';

// Mock AWS SDK
jest.mock('@aws-sdk/client-ssm');
jest.mock('@aws-sdk/client-ec2');
jest.mock('@aws-sdk/client-sts');
jest.mock('@aws-sdk/client-cloudwatch-logs');

const mockSSMClient = {
  send: jest.fn<any>(),
  config: {
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret'
    }
  }
};

const mockEC2Client = {
  send: jest.fn<any>()
};

const mockSTSClient = {
  send: jest.fn<any>()
};

const mockCloudWatchLogsClient = {
  send: jest.fn<any>()
};

// Mock WebSocket for Session Manager
class MockWebSocket {
  private eventListeners: { [key: string]: Function[] } = {};
  
  constructor(public url: string, public protocols?: string[]) {
    setTimeout(() => this.dispatchEvent({ type: 'open' }), 10);
  }

  addEventListener(event: string, handler: Function): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(handler);
  }

  send(data: string | ArrayBuffer): void {
    // Mock sending data
    setTimeout(() => {
      this.dispatchEvent({ 
        type: 'message', 
        data: `Echo: ${data}` 
      });
    }, 10);
  }

  close(): void {
    this.dispatchEvent({ type: 'close' });
  }

  private dispatchEvent(event: any): void {
    const handlers = this.eventListeners[event.type] || [];
    handlers.forEach(handler => handler(event));
  }
}

// Skip cloud protocol tests if SKIP_HARDWARE_TESTS is set (requires AWS infrastructure)
const describeIfCloud = process.env.SKIP_HARDWARE_TESTS ? describe.skip : describe;

describeIfCloud('AWSSSMProtocol Integration Tests', () => {
  let protocol: AWSSSMProtocol;
  let mockFactory: MockTestServerFactory;
  let testServerManager: TestServerManager;
  let performanceBenchmark: PerformanceBenchmark;
  let securityTester: SecurityTester;

  beforeAll(async () => {
    // Setup test infrastructure
    mockFactory = new MockTestServerFactory();
    testServerManager = new TestServerManager();

    performanceBenchmark = new PerformanceBenchmark();
    securityTester = new SecurityTester();

    // Setup AWS SDK mocks
    jest.doMock('@aws-sdk/client-ssm', () => ({
      SSMClient: jest.fn(() => mockSSMClient),
      StartSessionCommand: jest.fn<any>(),
      TerminateSessionCommand: jest.fn<any>(),
      SendCommandCommand: jest.fn<any>(),
      GetCommandInvocationCommand: jest.fn<any>(),
      DescribeInstanceInformationCommand: jest.fn<any>(),
      GetParameterCommand: jest.fn<any>(),
      PutParameterCommand: jest.fn<any>()
    }));

    jest.doMock('@aws-sdk/client-ec2', () => ({
      EC2Client: jest.fn(() => mockEC2Client),
      DescribeInstancesCommand: jest.fn<any>()
    }));

    jest.doMock('@aws-sdk/client-sts', () => ({
      STSClient: jest.fn(() => mockSTSClient),
      AssumeRoleCommand: jest.fn<any>()
    }));

    jest.doMock('@aws-sdk/client-cloudwatch-logs', () => ({
      CloudWatchLogsClient: jest.fn(() => mockCloudWatchLogsClient),
      CreateLogGroupCommand: jest.fn<any>(),
      CreateLogStreamCommand: jest.fn<any>(),
      PutLogEventsCommand: jest.fn<any>()
    }));

    // Mock WebSocket for Session Manager
    (global as any).WebSocket = MockWebSocket;
  });

  beforeEach(async () => {
    protocol = new AWSSSMProtocol('aws-ssm');
    
    // Setup successful mock responses
    setupSuccessfulMockResponses();
    
    await protocol.initialize();
  });

  afterEach(async () => {
    await protocol.dispose();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await testServerManager.stopAllServers();
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with proper AWS configuration', async () => {
      expect(protocol.type).toBe('aws-ssm');
      expect(protocol.capabilities.supportsAuthentication).toBe(true);
      expect(protocol.capabilities.supportsEncryption).toBe(true);
      expect(protocol.capabilities.maxConcurrentSessions).toBe(10);
    });

    it('should validate AWS credentials during initialization', async () => {
      mockSTSClient.send.mockResolvedValueOnce({
        Account: '123456789012',
        UserId: 'AIDACKCEVSQ6C2EXAMPLE',
        Arn: 'arn:aws:sts::123456789012:assumed-role/test-role/test-session'
      });

      const newProtocol = new AWSSSMProtocol('aws-ssm');
      await expect(newProtocol.initialize()).resolves.not.toThrow();
    });

    it('should handle missing AWS credentials gracefully', async () => {
      mockSTSClient.send.mockRejectedValueOnce(new Error('No credentials found'));

      const newProtocol = new AWSSSMProtocol('aws-ssm');
      await expect(newProtocol.initialize()).rejects.toThrow('AWS credentials validation failed');
    });

    it('should support multiple AWS regions', async () => {
      const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];
      
      for (const region of regions) {
        const regionProtocol = new AWSSSMProtocol('aws-ssm', { region });
        await regionProtocol.initialize();
        expect(regionProtocol.healthStatus.isHealthy).toBe(true);
        await regionProtocol.dispose();
      }
    });

    it('should validate IAM permissions', async () => {
      mockSSMClient.send.mockResolvedValueOnce({
        InstanceInformationList: [
          {
            InstanceId: 'i-1234567890abcdef0',
            IPAddress: '10.0.0.100',
            PlatformType: 'Linux',
            PlatformName: 'Amazon Linux',
            PlatformVersion: '2',
            AgentVersion: '3.1.1732.0',
            IsLatestVersion: true,
            PingStatus: 'Online',
            LastPingDateTime: new Date()
          }
        ]
      });

      const healthStatus = await protocol.getHealthStatus();
      expect(healthStatus.isHealthy).toBe(true);
      expect(mockSSMClient.send).toHaveBeenCalled();
    });
  });

  describe('Session Manager Operations', () => {
    const testInstanceId = 'i-1234567890abcdef0';
    
    it('should create Session Manager session successfully', async () => {
      const sessionOptions: SessionOptions = {
        command: 'session-manager',
        args: [testInstanceId],
        streaming: true,
        sshOptions: {
          host: testInstanceId
        }
      };

      mockSSMClient.send.mockResolvedValueOnce({
        SessionId: 'test-session-12345',
        TokenValue: 'test-token-67890',
        StreamUrl: 'wss://ssmmessages.us-east-1.amazonaws.com/v1/data-channel/test-session-12345'
      });

      const session = await protocol.createSession(sessionOptions);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.command).toBe('session-manager');
      expect(session.status).toBe('running');
      expect(session.type).toBe('aws-ssm');
    });

    it('should handle Session Manager connection failures', async () => {
      mockSSMClient.send.mockRejectedValueOnce(new Error('InvalidInstanceId'));

      const sessionOptions: SessionOptions = {
        command: 'session-manager',
        args: ['i-invalid'],
        streaming: true
      };

      await expect(protocol.createSession(sessionOptions)).rejects.toThrow('InvalidInstanceId');
    });

    it('should support interactive shell sessions', async () => {
      const sessionId = await createTestSession();
      
      await protocol.executeCommand(sessionId, 'ls -la');
      await protocol.sendInput(sessionId, 'echo "Hello World"');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const output = await protocol.getOutput(sessionId);
      expect(output).toContain('Echo:');
    });

    it('should manage session lifecycle properly', async () => {
      const sessionId = await createTestSession();
      
      // Session should be running
      const sessions = await protocol.getActiveSessions();
      expect(sessions).toContain(sessionId);

      // Close session
      await protocol.closeSession(sessionId);

      // Verify session is terminated
      mockSSMClient.send.mockResolvedValueOnce({});
      expect(mockSSMClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            SessionId: expect.any(String)
          })
        })
      );
    });

    it('should support port forwarding through Session Manager', async () => {
      const sessionOptions: SessionOptions = {
        command: 'port-forward',
        args: [testInstanceId, '3389'],
        streaming: true,
        sshOptions: {
          host: testInstanceId,
          localForwards: [{ local: 13389, remote: 3389 }]
        }
      };

      mockSSMClient.send.mockResolvedValueOnce({
        SessionId: 'port-forward-session-12345',
        TokenValue: 'port-forward-token-67890',
        StreamUrl: 'wss://ssmmessages.us-east-1.amazonaws.com/v1/data-channel/port-forward-session-12345'
      });

      const session = await protocol.createSession(sessionOptions);

      expect(session.command).toBe('port-forward');
      expect(session.args).toEqual([testInstanceId, '3389']);
    });
  });

  describe('Run Command Operations', () => {
    const testInstanceId = 'i-1234567890abcdef0';
    
    it('should execute commands via SSM Run Command', async () => {
      const sessionOptions: SessionOptions = {
        command: 'run-command',
        args: ['AWS-RunShellScript', '--parameters', 'commands=["ls -la"]'],
        streaming: false,
        env: {
          AWS_SSM_INSTANCE_ID: testInstanceId
        }
      };

      mockSSMClient.send
        .mockResolvedValueOnce({
          Command: {
            CommandId: 'cmd-12345',
            Status: 'InProgress',
            InstanceIds: [testInstanceId]
          }
        })
        .mockResolvedValueOnce({
          Status: 'Success',
          StandardOutputContent: 'total 4\ndrwxr-xr-x 2 ec2-user ec2-user 4096 Jan 1 00:00 test',
          StandardErrorContent: '',
          ResponseCode: 0
        });

      const session = await protocol.createSession(sessionOptions);
      await protocol.executeCommand(session.id, 'check-status');
      
      const output = await protocol.getOutput(session.id);
      expect(output).toContain('total 4');
    });

    it('should handle Run Command failures', async () => {
      const sessionOptions: SessionOptions = {
        command: 'run-command',
        args: ['AWS-RunShellScript', '--parameters', 'commands=["invalid-command"]'],
        streaming: false,
        env: { AWS_SSM_INSTANCE_ID: testInstanceId }
      };

      mockSSMClient.send
        .mockResolvedValueOnce({
          Command: {
            CommandId: 'cmd-12345',
            Status: 'InProgress'
          }
        })
        .mockResolvedValueOnce({
          Status: 'Failed',
          StandardOutputContent: '',
          StandardErrorContent: 'invalid-command: command not found',
          ResponseCode: 127
        });

      const session = await protocol.createSession(sessionOptions);
      await protocol.executeCommand(session.id, 'check-status');
      
      const output = await protocol.getOutput(session.id);
      expect(output).toContain('command not found');
    });

    it('should support custom document execution', async () => {
      const sessionOptions: SessionOptions = {
        command: 'run-command',
        args: ['Custom-Document', '--parameters', 'param1=value1'],
        streaming: false,
        env: { AWS_SSM_INSTANCE_ID: testInstanceId }
      };

      mockSSMClient.send.mockResolvedValueOnce({
        Command: {
          CommandId: 'cmd-custom-12345',
          DocumentName: 'Custom-Document',
          Status: 'Success'
        }
      });

      const session = await protocol.createSession(sessionOptions);
      expect(session.args).toContain('Custom-Document');
    });

    it('should handle multi-instance command execution', async () => {
      const instanceIds = ['i-1234567890abcdef0', 'i-0987654321fedcba0'];
      
      const sessionOptions: SessionOptions = {
        command: 'run-command',
        args: ['AWS-RunShellScript', '--parameters', 'commands=["uptime"]'],
        streaming: false,
        env: { 
          AWS_SSM_INSTANCE_IDS: instanceIds.join(',')
        }
      };

      mockSSMClient.send.mockResolvedValueOnce({
        Command: {
          CommandId: 'cmd-multi-12345',
          Status: 'InProgress',
          InstanceIds: instanceIds
        }
      });

      const session = await protocol.createSession(sessionOptions);
      expect(session.env?.AWS_SSM_INSTANCE_IDS).toBe(instanceIds.join(','));
    });
  });

  describe('Parameter Store Integration', () => {
    it('should retrieve parameters from Parameter Store', async () => {
      const sessionOptions: SessionOptions = {
        command: 'parameter-store',
        args: ['get-parameter', '/app/database/password'],
        streaming: false
      };

      mockSSMClient.send.mockResolvedValueOnce({
        Parameter: {
          Name: '/app/database/password',
          Value: 'encrypted-password-value',
          Type: 'SecureString',
          Version: 1
        }
      });

      const session = await protocol.createSession(sessionOptions);
      await protocol.executeCommand(session.id, 'get-value');
      
      const output = await protocol.getOutput(session.id);
      expect(output).toContain('encrypted-password-value');
    });

    it('should put parameters to Parameter Store', async () => {
      const sessionOptions: SessionOptions = {
        command: 'parameter-store',
        args: ['put-parameter', '/app/config/setting', 'new-value'],
        streaming: false
      };

      mockSSMClient.send.mockResolvedValueOnce({
        Version: 2,
        Tier: 'Standard'
      });

      const session = await protocol.createSession(sessionOptions);
      await protocol.executeCommand(session.id, 'put-value');
      
      expect(mockSSMClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Name: '/app/config/setting',
            Value: 'new-value'
          })
        })
      );
    });

    it('should handle parameter hierarchies', async () => {
      const sessionOptions: SessionOptions = {
        command: 'parameter-store',
        args: ['get-parameters-by-path', '/app/', '--recursive'],
        streaming: false
      };

      mockSSMClient.send.mockResolvedValueOnce({
        Parameters: [
          {
            Name: '/app/database/host',
            Value: 'db.example.com',
            Type: 'String'
          },
          {
            Name: '/app/database/password',
            Value: 'encrypted-value',
            Type: 'SecureString'
          }
        ]
      });

      const session = await protocol.createSession(sessionOptions);
      await protocol.executeCommand(session.id, 'get-hierarchy');
      
      const output = await protocol.getOutput(session.id);
      expect(output).toContain('db.example.com');
      expect(output).toContain('encrypted-value');
    });
  });

  describe('CloudWatch Integration', () => {
    it('should create CloudWatch log groups for sessions', async () => {
      const sessionOptions: SessionOptions = {
        command: 'session-manager',
        args: ['i-1234567890abcdef0'],
        streaming: true,
        env: {
          AWS_SSM_LOG_GROUP: '/aws/ssm/test-sessions'
        }
      };

      mockCloudWatchLogsClient.send.mockResolvedValueOnce({});

      await createTestSessionWithLogging(sessionOptions);

      expect(mockCloudWatchLogsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            logGroupName: '/aws/ssm/test-sessions'
          })
        })
      );
    });

    it('should stream session logs to CloudWatch', async () => {
      const sessionId = await createTestSession();
      
      await protocol.executeCommand(sessionId, 'echo "test log message"');
      
      // Simulate log streaming
      setTimeout(() => {
        expect(mockCloudWatchLogsClient.send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              logEvents: expect.arrayContaining([
                expect.objectContaining({
                  message: expect.stringContaining('test log message')
                })
              ])
            })
          })
        );
      }, 100);
    });
  });

  describe('Security and Compliance', () => {
    it('should enforce IAM role-based access', async () => {
      const sessionOptions: SessionOptions = {
        command: 'session-manager',
        args: ['i-1234567890abcdef0'],
        streaming: true,
        env: {
          AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/SSMRole'
        }
      };

      mockSTSClient.send.mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'ASIATEMP123',
          SecretAccessKey: 'tempSecret',
          SessionToken: 'tempToken'
        }
      });

      const session = await protocol.createSession(sessionOptions);
      expect(session.env?.AWS_ROLE_ARN).toBe('arn:aws:iam::123456789012:role/SSMRole');
    });

    it('should validate instance permissions', async () => {
      mockSSMClient.send.mockRejectedValueOnce(new Error('AccessDenied'));

      const sessionOptions: SessionOptions = {
        command: 'session-manager',
        args: ['i-unauthorized'],
        streaming: true
      };

      await expect(protocol.createSession(sessionOptions)).rejects.toThrow('AccessDenied');
    });

    it('should encrypt session data in transit', async () => {
      const sessionId = await createTestSession();
      
      await protocol.sendInput(sessionId, 'sensitive data');
      
      // Verify WebSocket connection uses secure protocol
      const mockWS = (global as any).WebSocket;
      const lastCreatedWS = mockWS.mock.instances[mockWS.mock.instances.length - 1];
      expect(lastCreatedWS.url).toMatch(/^wss:/);
    });

    it('should audit session activities', async () => {
      const sessionId = await createTestSession();
      
      await protocol.executeCommand(sessionId, 'whoami');
      await protocol.executeCommand(sessionId, 'pwd');
      
      const auditLogs = await protocol.getAuditLogs(sessionId);
      expect(auditLogs).toContain('whoami');
      expect(auditLogs).toContain('pwd');
    });
  });

  describe('Performance Testing', () => {
    it('should handle concurrent session creation efficiently', async () => {
      const benchmark = await performanceBenchmark.measureOperation(
        'concurrent-session-creation',
        async () => {
          const sessionPromises = Array.from({ length: 5 }, () =>
            createTestSession()
          );
          
          const sessionIds = await Promise.all(sessionPromises);
          
          // Cleanup
          await Promise.all(sessionIds.map(id => protocol.closeSession(id)));
          
          return sessionIds.length;
        },
        { iterations: 3, timeout: 30000 }
      );

      expect(benchmark.averageTime).toBeLessThan(5000);
      expect(benchmark.successRate).toBe(100);
    });

    it('should maintain performance under load', async () => {
      const sessionId = await createTestSession();
      
      const benchmark = await performanceBenchmark.measureOperation(
        'command-execution-load',
        async () => {
          const commands = Array.from({ length: 10 }, (_, i) => 
            `echo "Command ${i}"`
          );
          
          for (const command of commands) {
            await protocol.executeCommand(sessionId, command);
          }
          
          return commands.length;
        },
        { iterations: 3 }
      );

      expect(benchmark.averageTime).toBeLessThan(2000);
      await protocol.closeSession(sessionId);
    });

    it('should monitor memory usage during long sessions', async () => {
      const sessionId = await createTestSession();
      
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Simulate long-running session
      for (let i = 0; i < 100; i++) {
        await protocol.sendInput(sessionId, `echo "Message ${i}"`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;
      
      // Memory growth should be reasonable (less than 50MB)
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
      
      await protocol.closeSession(sessionId);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle AWS service outages gracefully', async () => {
      mockSSMClient.send.mockRejectedValueOnce(new Error('ServiceUnavailable'));
      
      const healthStatus = await protocol.getHealthStatus();
      expect(healthStatus.isHealthy).toBe(false);
      expect(healthStatus.errors).toContain('ServiceUnavailable');
    });

    it('should retry failed operations with exponential backoff', async () => {
      let attemptCount = 0;
      mockSSMClient.send.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.reject(new Error('ThrottlingException'));
        }
        return Promise.resolve({ SessionId: 'retry-success' });
      });

      const sessionOptions: SessionOptions = {
        command: 'session-manager',
        args: ['i-1234567890abcdef0'],
        streaming: true
      };

      const session = await protocol.createSession(sessionOptions);
      expect(session).toBeDefined();
      expect(attemptCount).toBe(3);
    });

    it('should handle network connectivity issues', async () => {
      // Mock network error
      const networkError = new Error('ECONNREFUSED');
      mockSSMClient.send.mockRejectedValueOnce(networkError);

      const sessionOptions: SessionOptions = {
        command: 'session-manager',
        args: ['i-1234567890abcdef0'],
        streaming: true
      };

      await expect(protocol.createSession(sessionOptions)).rejects.toThrow('ECONNREFUSED');
    });

    it('should recover from WebSocket disconnections', async () => {
      const sessionId = await createTestSession();
      
      // Simulate WebSocket disconnection
      const mockWS = (global as any).WebSocket;
      const wsInstance = mockWS.mock.instances[mockWS.mock.instances.length - 1];
      wsInstance.dispatchEvent({ type: 'close', code: 1006 });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should attempt to reconnect
      await protocol.executeCommand(sessionId, 'test reconnect');
      expect(mockSSMClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          constructor: { name: 'StartSessionCommand' }
        })
      );
    });
  });

  describe('Cross-Region Operations', () => {
    it('should support operations across multiple AWS regions', async () => {
      const regions = ['us-east-1', 'us-west-2', 'eu-west-1'];
      const sessions: string[] = [];

      for (const region of regions) {
        const regionProtocol = new AWSSSMProtocol('aws-ssm', { region });
        await regionProtocol.initialize();
        
        const sessionId = await createTestSessionWithProtocol(regionProtocol);
        sessions.push(sessionId);
        
        await regionProtocol.dispose();
      }

      expect(sessions).toHaveLength(3);
    });

    it('should handle region-specific failures', async () => {
      mockSSMClient.send.mockRejectedValueOnce(new Error('RegionDisabledException'));

      const regionProtocol = new AWSSSMProtocol('aws-ssm', { region: 'ap-northeast-3' });
      await expect(regionProtocol.initialize()).rejects.toThrow('RegionDisabledException');
    });
  });

  describe('Integration with Other AWS Services', () => {
    it('should integrate with EC2 for instance discovery', async () => {
      mockEC2Client.send.mockResolvedValueOnce({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: 'i-1234567890abcdef0',
                State: { Name: 'running' },
                PublicIpAddress: '203.0.113.12',
                PrivateIpAddress: '10.0.1.12',
                Tags: [
                  { Key: 'Name', Value: 'Test Instance' }
                ]
              }
            ]
          }
        ]
      });

      const instances = await protocol.discoverInstances();
      expect(instances).toHaveLength(1);
      expect(instances[0].InstanceId).toBe('i-1234567890abcdef0');
    });

    it('should support hybrid activation for on-premises servers', async () => {
      const sessionOptions: SessionOptions = {
        command: 'session-manager',
        args: ['mi-1234567890abcdef0'], // Managed instance ID
        streaming: true,
        env: {
          AWS_SSM_HYBRID: 'true'
        }
      };

      mockSSMClient.send.mockResolvedValueOnce({
        SessionId: 'hybrid-session-12345',
        TokenValue: 'hybrid-token-67890',
        StreamUrl: 'wss://ssmmessages.us-east-1.amazonaws.com/v1/data-channel/hybrid-session-12345'
      });

      const session = await protocol.createSession(sessionOptions);
      expect(session.args?.[0]).toBe('mi-1234567890abcdef0');
    });
  });

  // Helper functions
  function setupSuccessfulMockResponses(): void {
    mockSSMClient.send.mockImplementation((command: any) => {
      const commandName = command.constructor.name;
      
      switch (commandName) {
        case 'StartSessionCommand':
          return Promise.resolve({
            SessionId: 'test-session-12345',
            TokenValue: 'test-token-67890',
            StreamUrl: 'wss://ssmmessages.us-east-1.amazonaws.com/v1/data-channel/test-session-12345'
          });
        
        case 'DescribeInstanceInformationCommand':
          return Promise.resolve({
            InstanceInformationList: [
              {
                InstanceId: 'i-1234567890abcdef0',
                PingStatus: 'Online',
                PlatformType: 'Linux'
              }
            ]
          });
        
        case 'GetParameterCommand':
          return Promise.resolve({
            Parameter: {
              Name: command.input.Name,
              Value: 'test-value',
              Type: 'String'
            }
          });
        
        default:
          return Promise.resolve({});
      }
    });

    mockSTSClient.send.mockResolvedValue({
      Account: '123456789012',
      UserId: 'AIDACKCEVSQ6C2EXAMPLE'
    });

    mockEC2Client.send.mockResolvedValue({
      Reservations: []
    });

    mockCloudWatchLogsClient.send.mockResolvedValue({});
  }

  async function createTestSession(): Promise<string> {
    const sessionOptions: SessionOptions = {
      command: 'session-manager',
      args: ['i-1234567890abcdef0'],
      streaming: true
    };

    const session = await protocol.createSession(sessionOptions);
    return session.id;
  }

  async function createTestSessionWithProtocol(testProtocol: AWSSSMProtocol): Promise<string> {
    const sessionOptions: SessionOptions = {
      command: 'session-manager',
      args: ['i-1234567890abcdef0'],
      streaming: true
    };

    const session = await testProtocol.createSession(sessionOptions);
    return session.id;
  }

  async function createTestSessionWithLogging(options: SessionOptions): Promise<string> {
    const session = await protocol.createSession(options);
    return session.id;
  }
});