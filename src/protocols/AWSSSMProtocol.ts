import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ProtocolCapabilities,
  SessionState as BaseSessionState,
} from '../core/IProtocol.js';
import { Logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';

// AWS SDK v3 types and imports - made optional to handle missing dependencies
interface SSMClientType {
  send(command: any): Promise<any>;
}

interface EC2ClientType {
  send(command: any): Promise<any>;
}

interface STSClientType {
  send(command: any): Promise<any>;
}

interface S3ClientType {
  send(command: any): Promise<any>;
}

interface CloudWatchLogsClientType {
  send(command: any): Promise<any>;
}

interface StartSessionCommandInput {
  Target: string;
  DocumentName?: string;
  Parameters?: Record<string, string[]>;
}

interface StartSessionCommandOutput {
  SessionId?: string;
  Token?: string;
  StreamUrl?: string;
}

interface SendCommandCommandInput {
  DocumentName: string;
  Parameters?: Record<string, string[]>;
  Comment?: string;
  TimeoutSeconds?: number;
  MaxConcurrency?: string;
  MaxErrors?: string;
  InstanceIds?: string[];
  Targets?: Array<{
    key: string;
    values: string[];
  }>;
  OutputS3BucketName?: string;
  OutputS3KeyPrefix?: string;
  CloudWatchOutputConfig?: {
    cloudWatchLogGroupName: string;
    cloudWatchOutputEnabled: boolean;
  };
}

interface LogEvent {
  timestamp: number;
  message: string;
}

type AwsCredentialProvider = () => Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}>;

enum CommandStatus {
  Success = 'Success',
  Failed = 'Failed',
  Cancelled = 'Cancelled',
  TimedOut = 'TimedOut',
  InProgress = 'InProgress',
  Pending = 'Pending',
}

enum SessionStatus {
  Connected = 'Connected',
  Connecting = 'Connecting',
  Disconnected = 'Disconnected',
  Failed = 'Failed',
  Terminated = 'Terminated',
  Terminating = 'Terminating',
}

enum SessionState {
  Active = 'Active',
  History = 'History',
}

let SSMClient: any,
  StartSessionCommand: any,
  TerminateSessionCommand: any,
  DescribeSessionsCommand: any,
  ResumeSessionCommand: any,
  SendCommandCommand: any,
  ListCommandInvocationsCommand: any,
  GetCommandInvocationCommand: any,
  DescribeInstanceInformationCommand: any,
  GetParametersCommand: any,
  PutParameterCommand: any,
  ListDocumentsCommand: any,
  DescribeDocumentCommand: any,
  CreateDocumentCommand: any,
  UpdateDocumentCommand: any,
  DeleteDocumentCommand: any,
  SessionStatusValues: any,
  SessionStateValues: any,
  DocumentStatusValues: any,
  CommandStatusValues: any;

try {
  const ssmModule = require('@aws-sdk/client-ssm');
  SSMClient = ssmModule.SSMClient;
  StartSessionCommand = ssmModule.StartSessionCommand;
  TerminateSessionCommand = ssmModule.TerminateSessionCommand;
  DescribeSessionsCommand = ssmModule.DescribeSessionsCommand;
  ResumeSessionCommand = ssmModule.ResumeSessionCommand;
  SendCommandCommand = ssmModule.SendCommandCommand;
  ListCommandInvocationsCommand = ssmModule.ListCommandInvocationsCommand;
  GetCommandInvocationCommand = ssmModule.GetCommandInvocationCommand;
  DescribeInstanceInformationCommand =
    ssmModule.DescribeInstanceInformationCommand;
  GetParametersCommand = ssmModule.GetParametersCommand;
  PutParameterCommand = ssmModule.PutParameterCommand;
  ListDocumentsCommand = ssmModule.ListDocumentsCommand;
  DescribeDocumentCommand = ssmModule.DescribeDocumentCommand;
  CreateDocumentCommand = ssmModule.CreateDocumentCommand;
  UpdateDocumentCommand = ssmModule.UpdateDocumentCommand;
  DeleteDocumentCommand = ssmModule.DeleteDocumentCommand;
  SessionStatusValues = ssmModule.SessionStatus || {};
  SessionStateValues = ssmModule.SessionState || {};
  DocumentStatusValues = ssmModule.DocumentStatus || {};
  CommandStatusValues = ssmModule.CommandStatus || {};
} catch (error) {
  console.warn(
    '@aws-sdk/client-ssm not available, AWS SSM functionality will be disabled'
  );
}

// EC2 SDK imports - made optional
let EC2Client: any, DescribeInstancesCommand: any, DescribeTagsCommand: any;

try {
  const ec2Module = require('@aws-sdk/client-ec2');
  EC2Client = ec2Module.EC2Client;
  DescribeInstancesCommand = ec2Module.DescribeInstancesCommand;
  DescribeTagsCommand = ec2Module.DescribeTagsCommand;
} catch (error) {
  console.warn(
    '@aws-sdk/client-ec2 not available, EC2 functionality will be disabled'
  );
}

// STS SDK imports - made optional
let STSClient: any,
  AssumeRoleCommand: any,
  GetCallerIdentityCommand: any,
  GetSessionTokenCommand: any;

try {
  const stsModule = require('@aws-sdk/client-sts');
  STSClient = stsModule.STSClient;
  AssumeRoleCommand = stsModule.AssumeRoleCommand;
  GetCallerIdentityCommand = stsModule.GetCallerIdentityCommand;
  GetSessionTokenCommand = stsModule.GetSessionTokenCommand;
} catch (error) {
  console.warn(
    '@aws-sdk/client-sts not available, STS functionality will be disabled'
  );
}

// S3 SDK imports - made optional
let S3Client: any,
  HeadBucketCommand: any,
  PutObjectCommand: any,
  GetObjectCommand: any;

try {
  const s3Module = require('@aws-sdk/client-s3');
  S3Client = s3Module.S3Client;
  HeadBucketCommand = s3Module.HeadBucketCommand;
  PutObjectCommand = s3Module.PutObjectCommand;
  GetObjectCommand = s3Module.GetObjectCommand;
} catch (error) {
  console.warn(
    '@aws-sdk/client-s3 not available, S3 functionality will be disabled'
  );
}

// CloudWatch Logs SDK imports - made optional
let CloudWatchLogsClient: any,
  CreateLogGroupCommand: any,
  CreateLogStreamCommand: any,
  PutLogEventsCommand: any,
  DescribeLogGroupsCommand: any;

try {
  const logsModule = require('@aws-sdk/client-cloudwatch-logs');
  CloudWatchLogsClient = logsModule.CloudWatchLogsClient;
  CreateLogGroupCommand = logsModule.CreateLogGroupCommand;
  CreateLogStreamCommand = logsModule.CreateLogStreamCommand;
  PutLogEventsCommand = logsModule.PutLogEventsCommand;
  DescribeLogGroupsCommand = logsModule.DescribeLogGroupsCommand;
} catch (error) {
  console.warn(
    '@aws-sdk/client-cloudwatch-logs not available, CloudWatch Logs functionality will be disabled'
  );
}

// AWS Credential Providers - made optional
let fromEnv: any,
  fromIni: any,
  fromInstanceMetadata: any,
  fromContainerMetadata: any,
  fromNodeProviderChain: any,
  fromWebToken: any;

try {
  const credModule = require('@aws-sdk/credential-providers');
  fromEnv = credModule.fromEnv;
  fromIni = credModule.fromIni;
  fromInstanceMetadata = credModule.fromInstanceMetadata;
  fromContainerMetadata = credModule.fromContainerMetadata;
  fromNodeProviderChain = credModule.fromNodeProviderChain;
  fromWebToken = credModule.fromWebToken;
} catch (error) {
  console.warn(
    '@aws-sdk/credential-providers not available, credential provider functionality will be disabled'
  );
}

import {
  AWSSSMConnectionOptions,
  AWSSSMSession,
  AWSSSMTarget,
  AWSSSMDocument,
  AWSSSMCommandExecution,
  AWSSSMPortForwardingSession,
  AWSSSMError,
  AWSSSMSessionLog,
  AWSSSMSessionManagerConfig,
  AWSCredentials,
  AWSSTSAssumedRole,
  AWSSSMRetryConfig,
  ConsoleOutput,
  ConsoleSession,
  ConsoleEvent,
  SessionOptions,
  ConsoleType,
} from '../types/index.js';

import { RetryManager } from '../core/RetryManager.js';
import { ErrorRecovery } from '../core/ErrorRecovery.js';

/**
 * AWS Systems Manager Session Manager Protocol Implementation
 *
 * This class provides comprehensive support for AWS SSM Session Manager including:
 * - Interactive shell sessions
 * - Port forwarding tunnels
 * - Command execution
 * - Session logging to S3/CloudWatch
 * - Multi-region support
 * - IAM role assumption and credential management
 * - Advanced retry logic with exponential backoff
 * - Session recording and audit capabilities
 */
export class AWSSSMProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'aws-ssm';
  public readonly capabilities: ProtocolCapabilities;
  private ssmClient!: SSMClientType;
  private ec2Client!: EC2ClientType;
  private stsClient!: STSClientType;
  private s3Client?: S3ClientType;
  private cloudWatchLogsClient?: CloudWatchLogsClientType;

  private retryManager: RetryManager;
  private errorRecovery: ErrorRecovery;

  private awsSSMSessions: Map<string, AWSSSMSession> = new Map();
  private portForwardingSessions: Map<string, AWSSSMPortForwardingSession> =
    new Map();
  private webSockets: Map<string, WebSocket> = new Map();

  private config: AWSSSMSessionManagerConfig;
  private connectionOptions: AWSSSMConnectionOptions;
  private credentials?: AWSCredentials;
  private assumedRole?: AWSSTSAssumedRole;

  private sessionLogs: Map<string, AWSSSMSessionLog[]> = new Map();
  private activeCommands: Map<string, AWSSSMCommandExecution> = new Map();

  // Health monitoring
  private healthCheckInterval?: NodeJS.Timeout;
  private connectionHealthy: boolean = false;
  private lastHealthCheck: Date = new Date();
  private reconnectAttempts: number = 0;

  constructor(
    options: AWSSSMConnectionOptions,
    config?: Partial<AWSSSMSessionManagerConfig>
  ) {
    super('AWSSSMProtocol');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 10,
      defaultTimeout: 60000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['aws-credentials', 'iam-role', 'instance-profile'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: false,
      },
    };

    this.connectionOptions = options;
    this.retryManager = new RetryManager();
    this.errorRecovery = new ErrorRecovery();

    // Initialize configuration with defaults
    this.config = this.initializeConfig(config);

    // Initialize AWS clients with configuration
    this.initializeAWSClients();

    // Setup error recovery handlers
    this.setupErrorRecoveryHandlers();

    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Initialize configuration with sensible defaults
   */
  private initializeConfig(
    config?: Partial<AWSSSMSessionManagerConfig>
  ): AWSSSMSessionManagerConfig {
    return {
      regionConfig: {
        defaultRegion: this.connectionOptions.region,
        allowedRegions: [this.connectionOptions.region],
        regionPriority: [this.connectionOptions.region],
      },
      authConfig: {
        credentialChain: [
          'environment',
          'profile',
          'iam-role',
          'instance-profile',
          'ecs-task-role',
        ],
        assumeRoleConfig: this.connectionOptions.roleArn
          ? {
              roleArn: this.connectionOptions.roleArn,
              roleSessionName:
                this.connectionOptions.roleSessionName ||
                `ssm-session-${Date.now()}`,
              externalId: this.connectionOptions.externalId,
              durationSeconds: this.connectionOptions.durationSeconds || 3600,
            }
          : undefined,
        mfaConfig: this.connectionOptions.mfaSerial
          ? {
              mfaSerial: this.connectionOptions.mfaSerial,
              tokenCodeCallback: async () =>
                this.connectionOptions.mfaTokenCode || '',
            }
          : undefined,
      },
      sessionConfig: {
        defaultDocumentName: 'SSM-SessionManagerRunShell',
        defaultShellProfile: this.connectionOptions.shellProfile || 'bash',
        defaultWorkingDirectory: this.connectionOptions.workingDirectory,
        defaultEnvironmentVariables:
          this.connectionOptions.environmentVariables || {},
        sessionTimeout: this.connectionOptions.sessionTimeout || 1800000, // 30 minutes
        maxSessionDuration:
          this.connectionOptions.maxSessionDuration || 7200000, // 2 hours
        keepAliveInterval: this.connectionOptions.keepAliveInterval || 30000, // 30 seconds
        maxConcurrentSessions: 10,
      },
      loggingConfig: {
        enabled: !!(
          this.connectionOptions.s3BucketName ||
          this.connectionOptions.cloudWatchLogGroupName
        ),
        s3Config: this.connectionOptions.s3BucketName
          ? {
              bucketName: this.connectionOptions.s3BucketName,
              keyPrefix:
                this.connectionOptions.s3KeyPrefix || 'ssm-session-logs',
              encryptionEnabled:
                this.connectionOptions.s3EncryptionEnabled !== false,
            }
          : undefined,
        cloudWatchConfig: this.connectionOptions.cloudWatchLogGroupName
          ? {
              logGroupName: this.connectionOptions.cloudWatchLogGroupName,
              encryptionEnabled:
                this.connectionOptions.cloudWatchEncryptionEnabled !== false,
              streamingEnabled:
                this.connectionOptions.cloudWatchStreamingEnabled !== false,
            }
          : undefined,
        localLogging: {
          enabled: true,
          logLevel: 'INFO',
          maxFileSize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        },
      },
      connectionConfig: {
        connectionTimeout: this.connectionOptions.connectionTimeout || 30000,
        retryAttempts: this.connectionOptions.retryAttempts || 3,
        backoffMultiplier: this.connectionOptions.backoffMultiplier || 2,
        jitterEnabled: this.connectionOptions.jitterEnabled !== false,
        customEndpoints: this.connectionOptions.customEndpoint
          ? {
              ssm: this.connectionOptions.customEndpoint,
            }
          : undefined,
        useIMDSv2: this.connectionOptions.useIMDSv2 !== false,
      },
      securityConfig: {
        sessionRecordingEnabled: true,
        complianceMode: false,
        encryptionInTransit: true,
        encryptionAtRest: true,
      },
      monitoringConfig: {
        metricsEnabled: true,
        cloudWatchMetrics: true,
        customMetrics: false,
        healthCheckInterval: 60000, // 1 minute
        alertingEnabled: false,
      },
      ...config,
    };
  }

  /**
   * Initialize AWS SDK clients with appropriate configuration
   */
  private initializeAWSClients(): void {
    const clientConfig = {
      region: this.connectionOptions.region,
      maxAttempts: this.config.connectionConfig.retryAttempts,
      retryMode: 'adaptive' as const,
      credentials: this.getCredentialProvider(),
      endpoint: this.config.connectionConfig.customEndpoints?.ssm,
      requestHandler: {
        connectionTimeout: this.config.connectionConfig.connectionTimeout,
        socketTimeout: this.config.connectionConfig.connectionTimeout * 2,
      },
    };

    if (!SSMClient) {
      throw new Error('@aws-sdk/client-ssm is required but not available');
    }
    this.ssmClient = new SSMClient(clientConfig);
    this.ec2Client = new EC2Client(clientConfig);
    this.stsClient = new STSClient(clientConfig);

    if (this.config.loggingConfig.s3Config && S3Client) {
      this.s3Client = new S3Client(clientConfig);
    }

    if (this.config.loggingConfig.cloudWatchConfig && CloudWatchLogsClient) {
      this.cloudWatchLogsClient = new CloudWatchLogsClient(clientConfig);
    }
  }

  /**
   * Convert environment variables to SSM parameters format
   */
  private convertEnvironmentToParameters(
    env: Record<string, string>
  ): Record<string, string[]> {
    const parameters: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(env)) {
      parameters[key] = [value];
    }
    return parameters;
  }

  /**
   * Convert SSM parameters to environment variables format
   */
  private convertParametersToEnvironment(
    params: Record<string, string[]>
  ): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, values] of Object.entries(params)) {
      env[key] = values[0] || '';
    }
    return env;
  }

  /**
   * Get appropriate credential provider based on configuration
   */
  private getCredentialProvider(): AwsCredentialProvider {
    // If explicit credentials provided
    if (
      this.connectionOptions.accessKeyId &&
      this.connectionOptions.secretAccessKey
    ) {
      return async () => ({
        accessKeyId: this.connectionOptions.accessKeyId!,
        secretAccessKey: this.connectionOptions.secretAccessKey!,
        sessionToken: this.connectionOptions.sessionToken,
      });
    }

    // If profile specified
    if (this.connectionOptions.profile) {
      return fromIni({ profile: this.connectionOptions.profile });
    }

    // Use credential chain based on configuration
    const providers: AwsCredentialProvider[] = [];

    for (const providerType of this.config.authConfig.credentialChain) {
      switch (providerType) {
        case 'environment':
          providers.push(fromEnv());
          break;
        case 'profile':
          providers.push(fromIni());
          break;
        case 'instance-profile':
          providers.push(fromInstanceMetadata());
          break;
        case 'ecs-task-role':
          providers.push(fromContainerMetadata());
          break;
        case 'web-identity':
          providers.push(fromWebToken());
          break;
      }
    }

    return fromNodeProviderChain({
      providers,
    });
  }

  /**
   * Setup error recovery event handlers
   */
  private setupErrorRecoveryHandlers(): void {
    this.errorRecovery.on('recovery-attempted', (data) => {
      this.logger.info(`SSM error recovery attempted: ${data.strategy}`);
      this.emit('recovery-attempted', data);
    });

    this.errorRecovery.on('degradation-enabled', (data) => {
      this.logger.warn(`SSM degraded mode enabled: ${data.reason}`);
      this.emit('degradation-enabled', data);
    });

    this.errorRecovery.on('require-reauth', async (data) => {
      this.logger.warn('SSM re-authentication required');
      await this.refreshCredentials();
      this.emit('require-reauth', data);
    });
  }

  /**
   * Start health monitoring for connections and sessions
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.monitoringConfig.healthCheckInterval);
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // Test basic connectivity
      const identity = await this.stsClient.send(
        new GetCallerIdentityCommand({})
      );
      this.connectionHealthy = true;
      this.lastHealthCheck = new Date();
      this.reconnectAttempts = 0;

      this.logger.debug(
        `Health check passed - Account: ${identity.Account}, User: ${identity.Arn}`
      );

      // Check active sessions
      for (const [sessionId, session] of Array.from(
        this.awsSSMSessions.entries()
      )) {
        if (session.status === 'Connected' || session.status === 'Connecting') {
          await this.checkSessionHealth(sessionId);
        }
      }

      this.emit('health-check', {
        status: 'healthy',
        timestamp: this.lastHealthCheck,
      });
    } catch (error) {
      this.connectionHealthy = false;
      this.reconnectAttempts++;

      this.logger.error(
        `Health check failed (attempt ${this.reconnectAttempts}):`,
        error
      );
      this.emit('health-check', {
        status: 'unhealthy',
        error,
        timestamp: new Date(),
        reconnectAttempts: this.reconnectAttempts,
      });

      // Attempt recovery if configured
      if (
        this.reconnectAttempts <= this.config.connectionConfig.retryAttempts
      ) {
        await this.attemptReconnection({ error: 'Health check failed' });
      }
    }
  }

  /**
   * Check health of a specific session
   */
  private async checkSessionHealth(sessionId: string): Promise<void> {
    try {
      const response = await this.ssmClient.send(
        new DescribeSessionsCommand({
          State: SessionStateValues.Active || 'Active',
          Filters: [
            {
              key: 'SessionId', // Use string instead of enum since AWS SDK is optional
              value: sessionId,
            },
          ],
        })
      );

      const sessionInfo = response.Sessions?.find(
        (s: any) => s.SessionId === sessionId
      );
      if (
        !sessionInfo ||
        sessionInfo.Status !== (SessionStatusValues.Connected || 'Connected')
      ) {
        await this.handleSessionDisconnect(sessionId, 'Health check failed');
      }
    } catch (error) {
      this.logger.error(`Session health check failed for ${sessionId}:`, error);
      await this.handleSessionDisconnect(
        sessionId,
        `Health check error: ${error}`
      );
    }
  }

  /**
   * Attempt to reconnect and recover sessions
   */
  protected async attemptReconnection(context: any): Promise<boolean> {
    try {
      this.logger.info(
        `Attempting reconnection (${this.reconnectAttempts}/${this.config.connectionConfig.retryAttempts})`
      );

      // Refresh credentials if needed
      await this.refreshCredentials();

      // Re-initialize clients
      this.initializeAWSClients();

      // Attempt to reconnect active sessions
      for (const [sessionId, session] of Array.from(
        this.awsSSMSessions.entries()
      )) {
        if (session.status === 'Disconnected' || session.status === 'Failed') {
          await this.attemptSessionRecovery(sessionId);
        }
      }

      return true; // Reconnection succeeded
    } catch (error) {
      this.logger.error('Reconnection attempt failed:', error);
      return false; // Reconnection failed
    }
  }

  /**
   * Ensure AWS credentials are available and valid
   */
  private async ensureCredentials(): Promise<void> {
    // Basic credential validation - AWS SDK will handle loading
    if (!this.connectionOptions.region) {
      throw new Error('AWS region is required');
    }
  }

  /**
   * Refresh AWS credentials (for assume role scenarios)
   */
  private async refreshCredentials(): Promise<void> {
    if (this.config.authConfig.assumeRoleConfig) {
      try {
        const assumeRoleResponse = await this.stsClient.send(
          new AssumeRoleCommand({
            RoleArn: this.config.authConfig.assumeRoleConfig.roleArn,
            RoleSessionName:
              this.config.authConfig.assumeRoleConfig.roleSessionName,
            ExternalId: this.config.authConfig.assumeRoleConfig.externalId,
            DurationSeconds:
              this.config.authConfig.assumeRoleConfig.durationSeconds,
            Policy: this.config.authConfig.assumeRoleConfig.policy,
            PolicyArns: this.config.authConfig.assumeRoleConfig.policyArns?.map(
              (arn) => ({ arn })
            ),
            SerialNumber: this.config.authConfig.mfaConfig?.mfaSerial,
            TokenCode: this.config.authConfig.mfaConfig
              ? await this.config.authConfig.mfaConfig.tokenCodeCallback()
              : undefined,
          })
        );

        if (assumeRoleResponse.Credentials) {
          this.credentials = {
            accessKeyId: assumeRoleResponse.Credentials.AccessKeyId!,
            secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey!,
            sessionToken: assumeRoleResponse.Credentials.SessionToken,
            expiration: assumeRoleResponse.Credentials.Expiration,
          };

          this.assumedRole = {
            credentials: this.credentials,
            assumedRoleUser: assumeRoleResponse.AssumedRoleUser!,
            packedPolicySize: assumeRoleResponse.PackedPolicySize,
            sourceIdentity: assumeRoleResponse.SourceIdentity,
          };

          this.logger.info('Credentials refreshed successfully');
        }
      } catch (error) {
        this.logger.error('Failed to refresh credentials:', error);
        throw error;
      }
    }
  }

  /**
   * Start an interactive SSM session
   */
  async startSession(
    options: Partial<AWSSSMConnectionOptions> = {}
  ): Promise<string> {
    const sessionOptions = { ...this.connectionOptions, ...options };

    if (!sessionOptions.instanceId) {
      throw new Error('Instance ID is required for SSM sessions');
    }

    const sessionId = uuidv4();

    try {
      // Validate instance accessibility
      await this.validateTarget(
        sessionOptions.instanceId,
        sessionOptions.targetType || 'instance'
      );

      // Prepare session parameters
      const sessionParams: StartSessionCommandInput = {
        Target: sessionOptions.instanceId,
        DocumentName:
          sessionOptions.documentName ||
          this.config.sessionConfig.defaultDocumentName,
        Parameters: this.convertEnvironmentToParameters({
          ...this.config.sessionConfig.defaultEnvironmentVariables,
          ...sessionOptions.environmentVariables,
        }),
      };

      // Start the session
      const response = (await this.retryManager.executeWithRetry(
        async () =>
          await this.ssmClient.send(new StartSessionCommand(sessionParams)),
        {
          sessionId,
          operationName: 'start_ssm_session',
          strategyName: 'ssm',
          context: {
            instanceId: sessionOptions.instanceId,
            documentName: sessionParams.DocumentName,
          },
        }
      )) as StartSessionCommandOutput;

      // Create session object
      const session: AWSSSMSession = {
        sessionId: response.SessionId!,
        sessionToken: response.Token!,
        tokenValue: response.Token!,
        streamUrl: response.StreamUrl!,
        instanceId: sessionOptions.instanceId,
        targetType: sessionOptions.targetType || 'instance',
        documentName: sessionParams.DocumentName!,
        parameters: sessionParams.Parameters || {},
        status: 'Connecting',
        creationDate: new Date(),
        lastAccessedDate: new Date(),
        owner: 'session-manager',
        sessionTimeout: this.config.sessionConfig.sessionTimeout,
        maxSessionDuration: this.config.sessionConfig.maxSessionDuration,
        shellProfile: sessionOptions.shellProfile,
        workingDirectory: sessionOptions.workingDirectory,
        environmentVariables: this.convertParametersToEnvironment(
          sessionParams.Parameters || {}
        ),
        region: this.connectionOptions.region,
        accountId: await this.getAccountId(),
        tags: sessionOptions.tags || {},
        complianceInfo: {
          recordingEnabled: this.config.securityConfig.sessionRecordingEnabled,
          encryptionEnabled: this.config.securityConfig.encryptionInTransit,
          retentionPolicy: 'default',
          auditLogEnabled: this.config.loggingConfig.enabled,
        },
      };

      // Add S3 logging if configured
      if (this.config.loggingConfig.s3Config) {
        session.s3OutputLocation = {
          outputS3BucketName: this.config.loggingConfig.s3Config.bucketName,
          outputS3KeyPrefix: this.config.loggingConfig.s3Config.keyPrefix,
          outputS3Region: this.connectionOptions.region,
        };
      }

      // Add CloudWatch logging if configured
      if (this.config.loggingConfig.cloudWatchConfig) {
        session.cloudWatchOutputConfig = {
          cloudWatchLogGroupName:
            this.config.loggingConfig.cloudWatchConfig.logGroupName,
          cloudWatchEncryptionEnabled:
            this.config.loggingConfig.cloudWatchConfig.encryptionEnabled,
        };
      }

      this.awsSSMSessions.set(sessionId, session);

      // Initialize WebSocket connection
      await this.initializeWebSocketConnection(sessionId, response.StreamUrl!);

      // Setup session logging
      await this.setupSessionLogging(sessionId);

      // Start session monitoring
      this.startSessionMonitoring(sessionId);

      this.logger.info(
        `SSM session started: ${sessionId} for instance ${sessionOptions.instanceId}`
      );
      this.emit('session-started', {
        sessionId,
        instanceId: sessionOptions.instanceId,
      });

      return sessionId;
    } catch (error) {
      this.logger.error(`Failed to start SSM session:`, error);
      await this.handleSessionError(sessionId, error as Error);
      throw this.createSSMError(error as Error, 'StartSessionFailed', true);
    }
  }

  /**
   * Start a port forwarding session
   */
  async startPortForwardingSession(
    targetId: string,
    portNumber: number,
    localPortNumber?: number
  ): Promise<string> {
    const sessionId = uuidv4();

    try {
      // Validate target
      await this.validateTarget(targetId, 'instance');

      const actualLocalPort = localPortNumber || portNumber;

      // Start port forwarding session
      const sessionParams: StartSessionCommandInput = {
        Target: targetId,
        DocumentName: 'AWS-StartPortForwardingSession',
        Parameters: {
          portNumber: [portNumber.toString()],
          localPortNumber: [actualLocalPort.toString()],
        },
      };

      const response = (await this.retryManager.executeWithRetry(
        async () =>
          await this.ssmClient.send(new StartSessionCommand(sessionParams)),
        {
          sessionId,
          operationName: 'start_port_forwarding',
          strategyName: 'ssm',
          context: { targetId, portNumber, localPortNumber: actualLocalPort },
        }
      )) as StartSessionCommandOutput;

      // Create port forwarding session object
      const portForwardingSession: AWSSSMPortForwardingSession = {
        sessionId: response.SessionId!,
        targetId,
        targetType: 'instance',
        portNumber,
        localPortNumber: actualLocalPort,
        protocol: 'TCP',
        status: 'Connecting',
        creationDate: new Date(),
        lastAccessedDate: new Date(),
        owner: 'session-manager',
        sessionToken: response.Token!,
        streamUrl: response.StreamUrl!,
        region: this.connectionOptions.region,
        tags: this.connectionOptions.tags || {},
      };

      this.portForwardingSessions.set(sessionId, portForwardingSession);

      // Initialize WebSocket connection for port forwarding
      await this.initializeWebSocketConnection(
        sessionId,
        response.StreamUrl!,
        true
      );

      this.logger.info(
        `Port forwarding session started: ${sessionId} (${targetId}:${portNumber} -> localhost:${actualLocalPort})`
      );
      this.emit('port-forwarding-started', {
        sessionId,
        targetId,
        portNumber,
        localPortNumber: actualLocalPort,
      });

      return sessionId;
    } catch (error) {
      this.logger.error(`Failed to start port forwarding session:`, error);
      throw this.createSSMError(
        error as Error,
        'StartPortForwardingFailed',
        true
      );
    }
  }

  /**
   * Send command to multiple targets
   */
  async sendCommand(
    documentName: string,
    parameters: Record<string, string[]>,
    targets?: AWSSSMTarget[]
  ): Promise<string> {
    const commandId = uuidv4();

    try {
      const commandInput: SendCommandCommandInput = {
        DocumentName: documentName,
        Parameters: parameters,
        Comment: `Command executed via SSM Protocol - ${new Date().toISOString()}`,
        TimeoutSeconds: this.connectionOptions.sessionTimeout
          ? Math.floor(this.connectionOptions.sessionTimeout / 1000)
          : 3600,
        MaxConcurrency: '10',
        MaxErrors: '1',
      };

      // Set targets
      if (targets && targets.length > 0) {
        if (targets.every((t) => t.type === 'instance')) {
          commandInput.InstanceIds = targets.map((t) => t.id);
        } else {
          commandInput.Targets = targets.map((t) => ({
            key: t.type === 'tag' ? `tag:${t.name}` : t.type,
            values: [t.id],
          }));
        }
      } else if (this.connectionOptions.instanceId) {
        commandInput.InstanceIds = [this.connectionOptions.instanceId];
      }

      // Add logging configuration
      if (this.config.loggingConfig.s3Config) {
        commandInput.OutputS3BucketName =
          this.config.loggingConfig.s3Config.bucketName;
        commandInput.OutputS3KeyPrefix =
          this.config.loggingConfig.s3Config.keyPrefix;
      }

      if (this.config.loggingConfig.cloudWatchConfig) {
        commandInput.CloudWatchOutputConfig = {
          cloudWatchLogGroupName:
            this.config.loggingConfig.cloudWatchConfig.logGroupName,
          cloudWatchOutputEnabled: true,
        };
      }

      const response = await this.retryManager.executeWithRetry(
        async () =>
          await this.ssmClient.send(new SendCommandCommand(commandInput)),
        {
          sessionId: commandId,
          operationName: 'send_command',
          strategyName: 'ssm',
          context: {
            documentName,
            parametersCount: Object.keys(parameters).length,
          },
        }
      );

      // Create command execution object
      const commandExecution: AWSSSMCommandExecution = {
        commandId: response.Command!.CommandId!,
        documentName,
        parameters,
        instanceIds: commandInput.InstanceIds,
        targets: commandInput.Targets,
        requestedDateTime: new Date(),
        status: 'Pending',
        statusDetails: 'Command sent successfully',
        outputS3Region: this.connectionOptions.region,
        outputS3BucketName: commandInput.OutputS3BucketName,
        outputS3KeyPrefix: commandInput.OutputS3KeyPrefix,
        maxConcurrency: commandInput.MaxConcurrency,
        maxErrors: commandInput.MaxErrors,
        timeoutSeconds: commandInput.TimeoutSeconds,
        cloudWatchOutputConfig: commandInput.CloudWatchOutputConfig,
      };

      this.activeCommands.set(commandId, commandExecution);

      // Start monitoring command execution
      this.monitorCommandExecution(commandId);

      this.logger.info(`Command sent: ${commandId} (${documentName})`);
      this.emit('command-sent', { commandId, documentName });

      return commandId;
    } catch (error) {
      this.logger.error(`Failed to send command:`, error);
      throw this.createSSMError(error as Error, 'SendCommandFailed', true);
    }
  }

  /**
   * Initialize WebSocket connection for session
   */
  private async initializeWebSocketConnection(
    sessionId: string,
    streamUrl: string,
    isPortForwarding: boolean = false
  ): Promise<void> {
    try {
      const ws = new WebSocket(streamUrl);

      ws.on('open', () => {
        this.logger.debug(
          `WebSocket connection opened for session: ${sessionId}`
        );

        if (isPortForwarding) {
          const session = this.portForwardingSessions.get(sessionId);
          if (session) {
            session.status = 'Connected';
            this.portForwardingSessions.set(sessionId, session);
          }
        } else {
          const session = this.awsSSMSessions.get(sessionId);
          if (session) {
            session.status = 'Connected';
            this.awsSSMSessions.set(sessionId, session);
          }
        }

        this.emit('websocket-connected', { sessionId, isPortForwarding });
      });

      ws.on('message', (data: Buffer) => {
        this.handleWebSocketMessage(sessionId, data, isPortForwarding);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this.logger.debug(
          `WebSocket closed for session ${sessionId}: ${code} - ${reason.toString()}`
        );
        this.handleWebSocketClose(
          sessionId,
          code,
          reason.toString(),
          isPortForwarding
        );
      });

      ws.on('error', (error: Error) => {
        this.logger.error(`WebSocket error for session ${sessionId}:`, error);
        this.handleWebSocketError(sessionId, error, isPortForwarding);
      });

      this.webSockets.set(sessionId, ws);
    } catch (error) {
      this.logger.error(
        `Failed to initialize WebSocket for session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Handle WebSocket messages
   */
  private async handleWebSocketMessage(
    sessionId: string,
    data: Buffer,
    isPortForwarding: boolean
  ): Promise<void> {
    try {
      const message = data.toString('utf8');

      // Create console output event
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: message,
        timestamp: new Date(),
        raw: data.toString('base64'),
      };

      // Log session data
      await this.logSessionData(sessionId, message, 'stdout');

      // Update session statistics
      this.updateSessionStatistics(sessionId, data.length, 'in');

      // Emit output event
      this.emit('output', output);
      this.emit('data', { sessionId, data: message, type: 'stdout' });
    } catch (error) {
      this.logger.error(
        `Error handling WebSocket message for session ${sessionId}:`,
        error
      );
    }
  }

  /**
   * Handle WebSocket close events
   */
  private async handleWebSocketClose(
    sessionId: string,
    code: number,
    reason: string,
    isPortForwarding: boolean
  ): Promise<void> {
    if (isPortForwarding) {
      const session = this.portForwardingSessions.get(sessionId);
      if (session) {
        session.status = 'Disconnected';
        this.portForwardingSessions.set(sessionId, session);
      }
    } else {
      await this.handleSessionDisconnect(
        sessionId,
        `WebSocket closed: ${code} - ${reason}`
      );
    }

    this.webSockets.delete(sessionId);
    this.emit('websocket-closed', {
      sessionId,
      code,
      reason,
      isPortForwarding,
    });
  }

  /**
   * Handle WebSocket errors
   */
  private async handleWebSocketError(
    sessionId: string,
    error: Error,
    isPortForwarding: boolean
  ): Promise<void> {
    if (isPortForwarding) {
      const session = this.portForwardingSessions.get(sessionId);
      if (session) {
        session.status = 'Failed';
        session.reason = error.message;
        this.portForwardingSessions.set(sessionId, session);
      }
    } else {
      await this.handleSessionError(sessionId, error);
    }

    this.emit('websocket-error', { sessionId, error, isPortForwarding });
  }

  /**
   * Send input to a session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    const ws = this.webSockets.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    try {
      // Send input to WebSocket
      ws.send(Buffer.from(input, 'utf8'));

      // Log session data
      await this.logSessionData(sessionId, input, 'stdin');

      // Update session statistics
      this.updateSessionStatistics(sessionId, Buffer.byteLength(input), 'out');

      this.emit('input-sent', { sessionId, input });
    } catch (error) {
      this.logger.error(`Failed to send input to session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Terminate a session
   */
  async terminateSession(sessionId: string): Promise<void> {
    try {
      const session =
        this.awsSSMSessions.get(sessionId) ||
        this.portForwardingSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Terminate the session via AWS API
      await this.ssmClient.send(
        new TerminateSessionCommand({
          SessionId: sessionId,
        })
      );

      // Close WebSocket connection
      const ws = this.webSockets.get(sessionId);
      if (ws) {
        ws.close();
        this.webSockets.delete(sessionId);
      }

      // Update session status
      if (this.awsSSMSessions.has(sessionId)) {
        const ssmSession = this.awsSSMSessions.get(sessionId)!;
        ssmSession.status = 'Terminated';
        this.awsSSMSessions.set(sessionId, ssmSession);
      } else {
        const portSession = this.portForwardingSessions.get(sessionId)!;
        portSession.status = 'Terminated';
        this.portForwardingSessions.set(sessionId, portSession);
      }

      // Finalize session logging
      await this.finalizeSessionLogging(sessionId);

      this.logger.info(`Session terminated: ${sessionId}`);
      this.emit('session-terminated', { sessionId });
    } catch (error) {
      this.logger.error(`Failed to terminate session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Validate target accessibility
   */
  private async validateTarget(
    targetId: string,
    targetType: string
  ): Promise<void> {
    try {
      if (targetType === 'instance') {
        // Check if instance exists and is SSM-managed
        const instanceInfo = await this.ssmClient.send(
          new DescribeInstanceInformationCommand({
            InstanceInformationFilterList: [
              {
                key: 'InstanceIds',
                valueSet: [targetId],
              },
            ],
          })
        );

        if (
          !instanceInfo.InstanceInformationList ||
          instanceInfo.InstanceInformationList.length === 0
        ) {
          throw new Error(
            `Instance ${targetId} is not managed by SSM or does not exist`
          );
        }

        const instance = instanceInfo.InstanceInformationList[0];
        if (instance.PingStatus !== 'Online') {
          throw new Error(
            `Instance ${targetId} is not online (status: ${instance.PingStatus})`
          );
        }
      }
    } catch (error) {
      this.logger.error(`Target validation failed for ${targetId}:`, error);
      throw error;
    }
  }

  /**
   * Setup session logging
   */
  private async setupSessionLogging(sessionId: string): Promise<void> {
    if (!this.config.loggingConfig.enabled) {
      return;
    }

    try {
      // Initialize session log array
      this.sessionLogs.set(sessionId, []);

      // Create CloudWatch log stream if configured
      if (
        this.config.loggingConfig.cloudWatchConfig &&
        this.cloudWatchLogsClient
      ) {
        const logStreamName = `ssm-session-${sessionId}`;

        try {
          await this.cloudWatchLogsClient.send(
            new CreateLogStreamCommand({
              logGroupName:
                this.config.loggingConfig.cloudWatchConfig.logGroupName,
              logStreamName,
            })
          );
        } catch (error: any) {
          // Log stream might already exist, which is fine
          if (error.name !== 'ResourceAlreadyExistsException') {
            throw error;
          }
        }
      }

      // Log session start event
      await this.logSessionEvent(
        sessionId,
        'SessionStart',
        'system',
        'Session started'
      );
    } catch (error) {
      this.logger.error(
        `Failed to setup session logging for ${sessionId}:`,
        error
      );
    }
  }

  /**
   * Log session data
   */
  private async logSessionData(
    sessionId: string,
    data: string,
    dataType: 'stdin' | 'stdout' | 'stderr'
  ): Promise<void> {
    if (!this.config.loggingConfig.enabled) {
      return;
    }

    const sessionLog: AWSSSMSessionLog = {
      sessionId,
      timestamp: new Date(),
      eventType: 'DataStreamEvent',
      source: dataType === 'stdin' ? 'client' : 'target',
      data,
      dataType,
      byteCount: Buffer.byteLength(data),
      sequenceNumber: this.getNextSequenceNumber(sessionId),
      accountId: await this.getAccountId(),
      region: this.connectionOptions.region,
      sessionOwner: 'session-manager',
      targetId: this.awsSSMSessions.get(sessionId)?.instanceId,
      targetType: this.awsSSMSessions.get(sessionId)?.targetType,
    };

    // Add to in-memory log
    const logs = this.sessionLogs.get(sessionId) || [];
    logs.push(sessionLog);
    this.sessionLogs.set(sessionId, logs);

    // Send to CloudWatch Logs if configured
    if (
      this.config.loggingConfig.cloudWatchConfig?.streamingEnabled &&
      this.cloudWatchLogsClient
    ) {
      await this.sendToCloudWatchLogs(sessionId, sessionLog);
    }
  }

  /**
   * Log session events
   */
  private async logSessionEvent(
    sessionId: string,
    eventType: AWSSSMSessionLog['eventType'],
    source: AWSSSMSessionLog['source'],
    data: string
  ): Promise<void> {
    if (!this.config.loggingConfig.enabled) {
      return;
    }

    const sessionLog: AWSSSMSessionLog = {
      sessionId,
      timestamp: new Date(),
      eventType,
      source,
      data,
      dataType: 'system',
      byteCount: Buffer.byteLength(data),
      sequenceNumber: this.getNextSequenceNumber(sessionId),
      accountId: await this.getAccountId(),
      region: this.connectionOptions.region,
      sessionOwner: 'session-manager',
      targetId: this.awsSSMSessions.get(sessionId)?.instanceId,
      targetType: this.awsSSMSessions.get(sessionId)?.targetType,
    };

    // Add to in-memory log
    const logs = this.sessionLogs.get(sessionId) || [];
    logs.push(sessionLog);
    this.sessionLogs.set(sessionId, logs);

    // Send to CloudWatch Logs if configured
    if (
      this.config.loggingConfig.cloudWatchConfig &&
      this.cloudWatchLogsClient
    ) {
      await this.sendToCloudWatchLogs(sessionId, sessionLog);
    }
  }

  /**
   * Send log entry to CloudWatch Logs
   */
  private async sendToCloudWatchLogs(
    sessionId: string,
    logEntry: AWSSSMSessionLog
  ): Promise<void> {
    if (
      !this.cloudWatchLogsClient ||
      !this.config.loggingConfig.cloudWatchConfig
    ) {
      return;
    }

    try {
      const logEvent: LogEvent = {
        timestamp: logEntry.timestamp.getTime(),
        message: JSON.stringify(logEntry),
      };

      await this.cloudWatchLogsClient.send(
        new PutLogEventsCommand({
          logGroupName: this.config.loggingConfig.cloudWatchConfig.logGroupName,
          logStreamName: `ssm-session-${sessionId}`,
          logEvents: [logEvent],
        })
      );
    } catch (error) {
      this.logger.error(
        `Failed to send log to CloudWatch for session ${sessionId}:`,
        error
      );
    }
  }

  /**
   * Finalize session logging
   */
  private async finalizeSessionLogging(sessionId: string): Promise<void> {
    if (!this.config.loggingConfig.enabled) {
      return;
    }

    try {
      // Log session end event
      await this.logSessionEvent(
        sessionId,
        'SessionEnd',
        'system',
        'Session ended'
      );

      // Upload to S3 if configured
      if (this.config.loggingConfig.s3Config && this.s3Client) {
        const logs = this.sessionLogs.get(sessionId) || [];
        const logData = JSON.stringify(logs, null, 2);
        const key = `${this.config.loggingConfig.s3Config.keyPrefix}/${sessionId}/${new Date().toISOString()}.json`;

        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.config.loggingConfig.s3Config.bucketName,
            Key: key,
            Body: logData,
            ContentType: 'application/json',
            ServerSideEncryption: this.config.loggingConfig.s3Config
              .encryptionEnabled
              ? 'AES256'
              : undefined,
            Metadata: {
              sessionId,
              region: this.connectionOptions.region,
              timestamp: new Date().toISOString(),
            },
          })
        );

        this.logger.info(
          `Session logs uploaded to S3: s3://${this.config.loggingConfig.s3Config.bucketName}/${key}`
        );
      }

      // Clean up in-memory logs
      this.sessionLogs.delete(sessionId);
    } catch (error) {
      this.logger.error(
        `Failed to finalize session logging for ${sessionId}:`,
        error
      );
    }
  }

  /**
   * Get next sequence number for session logs
   */
  private getNextSequenceNumber(sessionId: string): number {
    const logs = this.sessionLogs.get(sessionId) || [];
    return logs.length + 1;
  }

  /**
   * Update session statistics
   */
  private updateSessionStatistics(
    sessionId: string,
    bytes: number,
    direction: 'in' | 'out'
  ): void {
    const session = this.awsSSMSessions.get(sessionId);
    if (!session) return;

    if (!session.statistics) {
      session.statistics = {
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0,
        commandsExecuted: 0,
        errorsCount: 0,
        lastActivityTime: new Date(),
      };
    }

    if (direction === 'in') {
      session.statistics.bytesIn += bytes;
      session.statistics.packetsIn += 1;
    } else {
      session.statistics.bytesOut += bytes;
      session.statistics.packetsOut += 1;
    }

    session.statistics.lastActivityTime = new Date();
    session.lastAccessedDate = new Date();

    this.awsSSMSessions.set(sessionId, session);
  }

  /**
   * Handle session disconnect
   */
  private async handleSessionDisconnect(
    sessionId: string,
    reason: string
  ): Promise<void> {
    const session = this.awsSSMSessions.get(sessionId);
    if (!session) return;

    session.status = 'Disconnected';
    session.reason = reason;
    this.awsSSMSessions.set(sessionId, session);

    // Close WebSocket if still open
    const ws = this.webSockets.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

    this.logger.warn(`Session ${sessionId} disconnected: ${reason}`);
    this.emit('session-disconnected', { sessionId, reason });
  }

  /**
   * Handle session errors
   */
  private async handleSessionError(
    sessionId: string,
    error: Error
  ): Promise<void> {
    const session = this.awsSSMSessions.get(sessionId);
    if (session) {
      session.status = 'Failed';
      session.reason = error.message;
      this.awsSSMSessions.set(sessionId, session);
    }

    // Log error event
    await this.logSessionEvent(
      sessionId,
      'ErrorEvent',
      'system',
      `Error: ${error.message}`
    );

    this.logger.error(`Session ${sessionId} error:`, error);
    this.emit('session-error', { sessionId, error });
  }

  /**
   * Attempt session recovery
   */
  private async attemptSessionRecovery(sessionId: string): Promise<void> {
    try {
      const session = this.awsSSMSessions.get(sessionId);
      if (!session) return;

      this.logger.info(`Attempting recovery for session: ${sessionId}`);

      // Try to resume the session
      await this.ssmClient.send(
        new ResumeSessionCommand({
          SessionId: sessionId,
        })
      );

      session.status = 'Connected';
      this.awsSSMSessions.set(sessionId, session);

      this.logger.info(`Session recovery successful: ${sessionId}`);
      this.emit('session-recovered', { sessionId });
    } catch (error) {
      this.logger.error(`Session recovery failed for ${sessionId}:`, error);
      await this.handleSessionError(sessionId, error as Error);
    }
  }

  /**
   * Start session monitoring
   */
  private startSessionMonitoring(sessionId: string): void {
    // Check session status periodically
    const monitorInterval = setInterval(async () => {
      const session = this.awsSSMSessions.get(sessionId);
      if (!session || session.status === 'Terminated') {
        clearInterval(monitorInterval);
        return;
      }

      try {
        await this.checkSessionHealth(sessionId);
      } catch (error) {
        this.logger.error(`Session monitoring error for ${sessionId}:`, error);
      }
    }, this.config.sessionConfig.keepAliveInterval);
  }

  /**
   * Monitor command execution
   */
  private monitorCommandExecution(commandId: string): void {
    const checkStatus = async () => {
      try {
        const response = await this.ssmClient.send(
          new ListCommandInvocationsCommand({
            CommandId: commandId,
          })
        );

        const command = this.activeCommands.get(commandId);
        if (!command || !response.CommandInvocations) return;

        // Update command status based on invocations
        const invocations = response.CommandInvocations;
        const statuses = invocations.map(
          (inv: any) => inv.Status as keyof typeof CommandStatus
        );

        if (statuses.every((status: any) => status === CommandStatus.Success)) {
          command.status = 'Success';
        } else if (
          statuses.some((status: any) => status === CommandStatus.Failed)
        ) {
          command.status = 'Failed';
        } else if (
          statuses.some((status: any) => status === CommandStatus.Cancelled)
        ) {
          command.status = 'Cancelled';
        } else if (
          statuses.some((status: any) => status === CommandStatus.TimedOut)
        ) {
          command.status = 'TimedOut';
        } else if (
          statuses.some((status: any) => status === CommandStatus.InProgress)
        ) {
          command.status = 'InProgress';
        }

        this.activeCommands.set(commandId, command);

        if (
          ['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(
            command.status
          )
        ) {
          this.emit('command-completed', { commandId, status: command.status });
          // Stop monitoring
          return;
        }

        // Continue monitoring
        setTimeout(checkStatus, 5000);
      } catch (error) {
        this.logger.error(`Command monitoring error for ${commandId}:`, error);
      }
    };

    // Start monitoring after a short delay
    setTimeout(checkStatus, 2000);
  }

  /**
   * Get AWS account ID
   */
  private async getAccountId(): Promise<string> {
    try {
      const identity = await this.stsClient.send(
        new GetCallerIdentityCommand({})
      );
      return identity.Account!;
    } catch (error) {
      this.logger.error('Failed to get account ID:', error);
      return 'unknown';
    }
  }

  /**
   * Create standardized SSM error
   */
  private createSSMError(
    originalError: Error,
    code: string,
    retryable: boolean
  ): AWSSSMError {
    return {
      code,
      message: originalError.message,
      retryable,
      originalError,
      region: this.connectionOptions.region,
      time: new Date(),
    };
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): AWSSSMSession | undefined {
    return this.awsSSMSessions.get(sessionId);
  }

  /**
   * Get port forwarding session information
   */
  getPortForwardingSession(
    sessionId: string
  ): AWSSSMPortForwardingSession | undefined {
    return this.portForwardingSessions.get(sessionId);
  }

  /**
   * List all active sessions
   */
  listSessions(): AWSSSMSession[] {
    return Array.from(this.awsSSMSessions.values());
  }

  /**
   * List all active port forwarding sessions
   */
  listPortForwardingSessions(): AWSSSMPortForwardingSession[] {
    return Array.from(this.portForwardingSessions.values());
  }

  /**
   * Get session logs
   */
  getSessionLogs(sessionId: string): AWSSSMSessionLog[] {
    return this.sessionLogs.get(sessionId) || [];
  }

  /**
   * Get command execution status
   */
  getCommandExecution(commandId: string): AWSSSMCommandExecution | undefined {
    return this.activeCommands.get(commandId);
  }

  /**
   * Check if protocol is healthy
   */
  isHealthy(): boolean {
    return this.connectionHealthy;
  }

  /**
   * Get protocol configuration
   */
  getConfig(): AWSSSMSessionManagerConfig {
    return { ...this.config };
  }

  /**
   * Update protocol configuration
   */
  updateConfig(newConfig: Partial<AWSSSMSessionManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Update health check interval if changed
    if (newConfig.monitoringConfig?.healthCheckInterval) {
      this.startHealthMonitoring();
    }

    this.emit('config-updated', this.config);
  }

  /**
   * Clean up and destroy the protocol instance
   */
  async destroy(): Promise<void> {
    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      // Terminate all active sessions
      const terminationPromises: Promise<void>[] = [];

      for (const sessionId of Array.from(this.awsSSMSessions.keys())) {
        terminationPromises.push(
          this.terminateSession(sessionId).catch((err) =>
            this.logger.error(
              `Failed to terminate session ${sessionId} during cleanup:`,
              err
            )
          )
        );
      }

      for (const sessionId of Array.from(this.portForwardingSessions.keys())) {
        terminationPromises.push(
          this.terminateSession(sessionId).catch((err) =>
            this.logger.error(
              `Failed to terminate port forwarding session ${sessionId} during cleanup:`,
              err
            )
          )
        );
      }

      await Promise.allSettled(terminationPromises);

      // Close all WebSocket connections
      for (const [sessionId, ws] of Array.from(this.webSockets.entries())) {
        try {
          ws.close();
        } catch (error) {
          this.logger.error(
            `Failed to close WebSocket for session ${sessionId}:`,
            error
          );
        }
      }

      // Clear all collections
      this.awsSSMSessions.clear();
      this.portForwardingSessions.clear();
      this.webSockets.clear();
      this.sessionLogs.clear();
      this.activeCommands.clear();

      this.logger.info('AWS SSM Protocol destroyed successfully');
      this.emit('destroyed');
    } catch (error) {
      this.logger.error('Error during protocol destruction:', error);
      throw error;
    }
  }

  // ==========================================
  // BaseProtocol Integration Methods
  // ==========================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Validate configuration and credentials
      await this.ensureCredentials();

      // Setup authentication
      if (this.connectionOptions.roleArn) {
        await this.refreshCredentials();
      }

      this.isInitialized = true;
      this.logger.info(
        'AWS SSM protocol initialized with session management fixes'
      );
    } catch (error: any) {
      this.logger.error('Failed to initialize AWS SSM protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const sessionId = `aws-ssm-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Use session management fixes from BaseProtocol
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: BaseSessionState
  ): Promise<ConsoleSession> {
    try {
      if (!options.awsSSMOptions) {
        throw new Error('AWS SSM options are required');
      }

      // Create AWS SSM session using existing method
      const awsSessionId = await this.startSession({
        instanceId: options.awsSSMOptions.instanceId,
        documentName:
          options.awsSSMOptions.documentName || 'AWS-StartSSHSession',
        parameters: options.awsSSMOptions.parameters,
      });

      const consoleSession: ConsoleSession = {
        id: sessionId,
        command: options.command || 'sh',
        args: options.args || [],
        cwd: options.cwd || '/home/ssm-user',
        env: options.env || {},
        createdAt: new Date(),
        status: sessionState.isOneShot ? 'initializing' : 'running',
        type: this.type,
        streaming: options.streaming ?? false,
        awsSSMOptions: options.awsSSMOptions,
        executionState: 'idle',
        activeCommands: new Map(),
        lastActivity: new Date(),
        pid: undefined, // AWS SSM sessions don't have local PIDs
      };

      this.sessions.set(sessionId, consoleSession);
      this.outputBuffers.set(sessionId, []);

      this.logger.info(
        `AWS SSM session ${sessionId} created (${sessionState.isOneShot ? 'one-shot' : 'persistent'})`
      );
      return consoleSession;
    } catch (error) {
      this.logger.error(`Failed to create AWS SSM session: ${error}`);

      // Cleanup on failure
      const awsSession = this.awsSSMSessions.get(sessionId);
      if (awsSession) {
        this.awsSSMSessions.delete(sessionId);
      }

      throw error;
    }
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const awsSession = this.awsSSMSessions.get(sessionId);
    const sessionState = await this.getSessionState(sessionId);

    if (!awsSession) {
      throw new Error(`AWS SSM session ${sessionId} not found`);
    }

    try {
      // For one-shot sessions, ensure connection first
      if (sessionState.isOneShot && awsSession.status !== 'Connected') {
        // Session should already be connected through doCreateSession
        // This is a fallback
        await this.initialize();
      }

      // Build full command
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;

      // Send command via existing method
      await this.sendInput(sessionId, fullCommand + '\n');

      // For one-shot sessions, mark as complete when command is sent
      if (sessionState.isOneShot) {
        setTimeout(() => {
          this.markSessionComplete(sessionId, 0);
        }, 1000); // Give time for output to be captured
      }

      this.emit('commandExecuted', {
        sessionId,
        command: fullCommand,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to execute AWS SSM command: ${error}`);
      throw error;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      // Use existing AWS SSM session termination
      await this.terminateSession(sessionId);

      // Remove from base class tracking
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);

      this.emit('sessionClosed', sessionId);
      this.logger.info('Session closed', { sessionId });
    } catch (error: any) {
      this.logger.error('Failed to close session', { sessionId, error });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing AWS SSM protocol');

    // Close all sessions
    const sessionIds = Array.from(this.awsSSMSessions.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.closeSession(sessionId);
      } catch (error) {
        this.logger.warn(
          `Error closing session ${sessionId} during dispose:`,
          error
        );
      }
    }

    // Use existing destroy method
    await this.destroy();

    await this.cleanup();
  }
}
