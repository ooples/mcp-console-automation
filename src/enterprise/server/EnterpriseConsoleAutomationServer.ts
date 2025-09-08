/**
 * Enterprise Console Automation Server
 * Main server class that integrates all enterprise features
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

// Core components
import { ConsoleManager } from '../../core/ConsoleManager.js';

// Enterprise components
import { SSOManager } from '../auth/SSOManager.js';
import { RBACManager } from '../auth/RBACManager.js';
import { AuditManager } from '../audit/AuditManager.js';
import { SecretManager } from '../secrets/SecretManager.js';
import { ChangeManager } from '../change/ChangeManager.js';

// Types
import {
  EnterpriseConfig,
  EnterpriseConsoleSession,
  User,
  AuditEvent
} from '../types/enterprise.js';
import { SessionOptions } from '../../types/index.js';
import { Logger } from '../../utils/logger.js';

export class EnterpriseConsoleAutomationServer {
  private server: Server;
  private consoleManager: ConsoleManager;
  private ssoManager: SSOManager;
  private rbacManager: RBACManager;
  private auditManager: AuditManager;
  private secretManager: SecretManager;
  private changeManager: ChangeManager;
  private logger: Logger;
  private config: EnterpriseConfig;

  constructor(config: EnterpriseConfig) {
    this.logger = new Logger('EnterpriseServer');
    this.config = config;

    // Initialize core components
    this.consoleManager = new ConsoleManager();

    // Initialize enterprise components
    this.ssoManager = new SSOManager(config.sso, process.env.JWT_SECRET || 'default-secret');
    this.rbacManager = new RBACManager(config.rbac);
    this.auditManager = new AuditManager(config.audit, process.env.ENCRYPTION_KEY || 'default-key');
    this.secretManager = new SecretManager(config.secrets, process.env.SECRET_ENCRYPTION_KEY || 'default-key');
    this.changeManager = new ChangeManager(config.changeManagement);

    this.server = new Server(
      {
        name: 'enterprise-console-automation',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupEventHandlers();
    this.setupCleanup();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        
        // Extract authentication info if present
        const authToken = (args as any).authToken;
        const user = await this.authenticateRequest(authToken);

        switch (name) {
          // Authentication and SSO
          case 'sso_authenticate':
            return await this.handleSSOAuthenticate(args as any);
          case 'sso_logout':
            return await this.handleSSOLogout(args as any);
          case 'sso_refresh_token':
            return await this.handleSSORefreshToken(args as any);

          // RBAC Management
          case 'rbac_check_access':
            return await this.handleRBACCheckAccess(args as any, user);
          case 'rbac_get_user_permissions':
            return await this.handleRBACGetUserPermissions(args as any, user);

          // Enhanced Console Operations (with enterprise features)
          case 'enterprise_console_create_session':
            return await this.handleEnterpriseCreateSession(args as any, user);
          case 'enterprise_console_authorize_session':
            return await this.handleEnterpriseAuthorizeSession(args as any, user);

          // Audit and Compliance
          case 'audit_query_events':
            return await this.handleAuditQueryEvents(args as any, user);
          case 'audit_generate_compliance_report':
            return await this.handleAuditGenerateComplianceReport(args as any, user);

          // Secret Management
          case 'secrets_get':
            return await this.handleSecretsGet(args as any, user);
          case 'secrets_store':
            return await this.handleSecretsStore(args as any, user);
          case 'secrets_rotate':
            return await this.handleSecretsRotate(args as any, user);

          // Change Management
          case 'change_create_request':
            return await this.handleChangeCreateRequest(args as any, user);
          case 'change_submit_request':
            return await this.handleChangeSubmitRequest(args as any, user);
          case 'change_approve':
            return await this.handleChangeApprove(args as any, user);
          case 'change_get_metrics':
            return await this.handleChangeGetMetrics(args as any, user);

          // Standard console operations with enterprise audit
          case 'console_create_session':
            return await this.handleCreateSessionWithAudit(args as any, user);
          case 'console_send_input':
            return await this.handleSendInputWithAudit(args as any, user);
          case 'console_get_output':
            return await this.handleGetOutputWithAudit(args as any, user);
          case 'console_stop_session':
            return await this.handleStopSessionWithAudit(args as any, user);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error: any) {
        this.logger.error(`Tool execution error: ${error.message}`);
        throw new McpError(ErrorCode.InternalError, error.message);
      }
    });
  }

  private async authenticateRequest(authToken?: string): Promise<User | null> {
    if (!authToken) {
      return null; // Allow unauthenticated requests for some operations
    }

    const validationResult = await this.ssoManager.validateToken(authToken);
    return validationResult.valid ? validationResult.user || null : null;
  }

  private requireUser(user: User | null): User {
    if (!user) {
      throw new McpError(ErrorCode.InvalidRequest, 'Authentication required');
    }
    return user;
  }

  // Tool definitions
  private getTools(): Tool[] {
    return [
      // SSO Authentication
      {
        name: 'sso_authenticate',
        description: 'Authenticate user with SSO provider',
        inputSchema: {
          type: 'object',
          properties: {
            provider: { type: 'string', description: 'SSO provider name' },
            credentials: { type: 'object', description: 'Authentication credentials' }
          },
          required: ['provider']
        }
      },
      {
        name: 'sso_logout',
        description: 'Logout user session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to logout' }
          },
          required: ['sessionId']
        }
      },

      // RBAC
      {
        name: 'rbac_check_access',
        description: 'Check user access permissions',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'Action to check' },
            resource: { type: 'string', description: 'Resource to access' },
            context: { type: 'object', description: 'Additional context' },
            authToken: { type: 'string', description: 'Authentication token' }
          },
          required: ['action', 'resource', 'authToken']
        }
      },

      // Enterprise Console Session
      {
        name: 'enterprise_console_create_session',
        description: 'Create enterprise console session with full compliance and governance',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
            changeRequestId: { type: 'string', description: 'Associated change request ID' },
            businessJustification: { type: 'string', description: 'Business justification' },
            riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            recordingEnabled: { type: 'boolean', description: 'Enable session recording' },
            authToken: { type: 'string', description: 'Authentication token' }
          },
          required: ['command', 'authToken']
        }
      },

      // Audit
      {
        name: 'audit_query_events',
        description: 'Query audit events with filters',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            action: { type: 'string' },
            resource: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            limit: { type: 'number' },
            authToken: { type: 'string', description: 'Authentication token' }
          },
          required: ['authToken']
        }
      },
      {
        name: 'audit_generate_compliance_report',
        description: 'Generate compliance report for specified standard',
        inputSchema: {
          type: 'object',
          properties: {
            standard: { type: 'string', enum: ['SOC2', 'HIPAA', 'PCI-DSS', 'ISO27001'] },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            authToken: { type: 'string', description: 'Authentication token' }
          },
          required: ['standard', 'startDate', 'endDate', 'authToken']
        }
      },

      // Secrets
      {
        name: 'secrets_get',
        description: 'Retrieve secret from secure storage',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Secret path' },
            version: { type: 'string', description: 'Secret version' },
            provider: { type: 'string', description: 'Specific provider to use' },
            authToken: { type: 'string', description: 'Authentication token' }
          },
          required: ['path', 'authToken']
        }
      },
      {
        name: 'secrets_store',
        description: 'Store secret in secure storage',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Secret path' },
            data: { type: 'object', description: 'Secret data' },
            provider: { type: 'string', description: 'Specific provider to use' },
            authToken: { type: 'string', description: 'Authentication token' }
          },
          required: ['path', 'data', 'authToken']
        }
      },

      // Change Management
      {
        name: 'change_create_request',
        description: 'Create new change request',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['standard', 'normal', 'emergency'] },
            category: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            implementationPlan: { type: 'string' },
            rollbackPlan: { type: 'string' },
            businessJustification: { type: 'string' },
            affectedSystems: { type: 'array', items: { type: 'string' } },
            scheduledStart: { type: 'string' },
            scheduledEnd: { type: 'string' },
            authToken: { type: 'string', description: 'Authentication token' }
          },
          required: ['title', 'description', 'type', 'category', 'implementationPlan', 'rollbackPlan', 'affectedSystems', 'authToken']
        }
      },
      {
        name: 'change_approve',
        description: 'Approve change request',
        inputSchema: {
          type: 'object',
          properties: {
            changeId: { type: 'string' },
            comments: { type: 'string' },
            authToken: { type: 'string', description: 'Authentication token' }
          },
          required: ['changeId', 'authToken']
        }
      }
    ];
  }

  // SSO Handlers
  private async handleSSOAuthenticate(args: { provider: string; credentials?: any }) {
    const result = await this.ssoManager.authenticate(args.provider, args.credentials);
    
    // Audit authentication attempt
    await this.auditManager.logEvent({
      userId: result.user?.id || 'unknown',
      action: 'sso_authenticate',
      resource: 'authentication',
      details: { provider: args.provider },
      outcome: result.success ? 'success' : 'failure',
      riskLevel: 'medium',
      ipAddress: 'unknown'
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleSSOLogout(args: { sessionId: string }) {
    const result = await this.ssoManager.logout(args.sessionId);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: result }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleSSORefreshToken(args: { sessionId: string }) {
    const token = await this.ssoManager.refreshToken(args.sessionId);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ token }, null, 2)
        } as TextContent
      ]
    };
  }

  // RBAC Handlers
  private async handleRBACCheckAccess(args: { action: string; resource: string; context?: any }, user: User | null) {
    const requiredUser = this.requireUser(user);
    
    const result = await this.rbacManager.checkAccess({
      userId: requiredUser.id,
      action: args.action,
      resource: args.resource,
      context: args.context
    });

    // Audit access check
    await this.auditManager.logEvent({
      userId: requiredUser.id,
      action: 'rbac_check_access',
      resource: args.resource,
      details: { action: args.action, granted: result.granted },
      outcome: 'success',
      riskLevel: 'low',
      ipAddress: 'unknown'
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleRBACGetUserPermissions(args: any, user: User | null) {
    const requiredUser = this.requireUser(user);
    
    const permissions = await this.rbacManager.getUserPermissions(requiredUser.id);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ permissions }, null, 2)
        } as TextContent
      ]
    };
  }

  // Enterprise Console Handlers
  private async handleEnterpriseCreateSession(args: any, user: User | null) {
    const requiredUser = this.requireUser(user);

    // Check RBAC permissions
    const accessResult = await this.rbacManager.checkAccess({
      userId: requiredUser.id,
      action: 'create',
      resource: 'console:session',
      context: args
    });

    if (!accessResult.granted) {
      throw new McpError(ErrorCode.InvalidRequest, accessResult.reason || 'Access denied');
    }

    // Create enterprise session with enhanced options
    const enterpriseOptions: SessionOptions & Partial<EnterpriseConsoleSession> = {
      ...args,
      userId: requiredUser.id,
      changeRequestId: args.changeRequestId,
      riskLevel: args.riskLevel || 'medium',
      recordingEnabled: args.recordingEnabled !== false,
      businessJustification: args.businessJustification
    };

    const sessionId = await this.consoleManager.createSession(enterpriseOptions);

    // Audit session creation
    await this.auditManager.logEvent({
      userId: requiredUser.id,
      action: 'console_session_create',
      resource: 'console:session',
      details: { 
        sessionId, 
        command: args.command,
        changeRequestId: args.changeRequestId,
        riskLevel: args.riskLevel
      },
      outcome: 'success',
      riskLevel: args.riskLevel || 'medium',
      ipAddress: 'unknown'
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            sessionId,
            message: `Enterprise console session created`,
            userId: requiredUser.id,
            changeRequestId: args.changeRequestId,
            riskLevel: args.riskLevel,
            recordingEnabled: args.recordingEnabled !== false
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleEnterpriseAuthorizeSession(args: { sessionOptions: any }, user: User | null) {
    const requiredUser = this.requireUser(user);
    
    const result = await this.rbacManager.authorizeSession(requiredUser.id, args.sessionOptions);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        } as TextContent
      ]
    };
  }

  // Audit Handlers
  private async handleAuditQueryEvents(args: any, user: User | null) {
    const requiredUser = this.requireUser(user);

    // Check audit read permissions
    const accessResult = await this.rbacManager.checkAccess({
      userId: requiredUser.id,
      action: 'read',
      resource: 'audit:log'
    });

    if (!accessResult.granted) {
      throw new McpError(ErrorCode.InvalidRequest, 'Access denied to audit logs');
    }

    const query = {
      userId: args.userId,
      action: args.action,
      resource: args.resource,
      startDate: args.startDate ? new Date(args.startDate) : undefined,
      endDate: args.endDate ? new Date(args.endDate) : undefined,
      limit: args.limit
    };

    const result = await this.auditManager.queryEvents(query);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleAuditGenerateComplianceReport(args: { standard: string; startDate: string; endDate: string }, user: User | null) {
    const requiredUser = this.requireUser(user);

    // Check audit read permissions
    const accessResult = await this.rbacManager.checkAccess({
      userId: requiredUser.id,
      action: 'read',
      resource: 'audit:log'
    });

    if (!accessResult.granted) {
      throw new McpError(ErrorCode.InvalidRequest, 'Access denied to audit logs');
    }

    const report = await this.auditManager.generateComplianceReport(
      args.standard,
      new Date(args.startDate),
      new Date(args.endDate)
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(report, null, 2)
        } as TextContent
      ]
    };
  }

  // Secret Handlers
  private async handleSecretsGet(args: { path: string; version?: string; provider?: string }, user: User | null) {
    const requiredUser = this.requireUser(user);

    const secret = await this.secretManager.getSecret({
      path: args.path,
      version: args.version,
      provider: args.provider
    }, requiredUser.id);

    if (!secret) {
      throw new McpError(ErrorCode.InvalidRequest, `Secret not found: ${args.path}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            path: secret.metadata.path,
            provider: secret.metadata.provider,
            version: secret.metadata.version,
            data: secret.data // In production, consider masking sensitive data
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleSecretsStore(args: { path: string; data: Record<string, any>; provider?: string }, user: User | null) {
    const requiredUser = this.requireUser(user);

    const metadata = await this.secretManager.storeSecret(
      args.path,
      args.data,
      args.provider,
      requiredUser.id
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Secret stored successfully',
            metadata: {
              id: metadata.id,
              path: metadata.path,
              provider: metadata.provider,
              version: metadata.version
            }
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleSecretsRotate(args: { path: string; newData: Record<string, any> }, user: User | null) {
    const requiredUser = this.requireUser(user);

    const metadata = await this.secretManager.rotateSecret(
      args.path,
      args.newData,
      requiredUser.id
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Secret rotated successfully',
            metadata: {
              id: metadata.id,
              path: metadata.path,
              provider: metadata.provider,
              version: metadata.version
            }
          }, null, 2)
        } as TextContent
      ]
    };
  }

  // Change Management Handlers
  private async handleChangeCreateRequest(args: any, user: User | null) {
    const requiredUser = this.requireUser(user);

    const changeRequest = await this.changeManager.createChangeRequest({
      ...args,
      requester: requiredUser.id,
      scheduledStart: args.scheduledStart ? new Date(args.scheduledStart) : undefined,
      scheduledEnd: args.scheduledEnd ? new Date(args.scheduledEnd) : undefined
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Change request created successfully',
            changeRequest: {
              id: changeRequest.id,
              title: changeRequest.title,
              status: changeRequest.status,
              type: changeRequest.type,
              priority: changeRequest.priority,
              riskLevel: changeRequest.riskLevel
            }
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleChangeSubmitRequest(args: { changeId: string }, user: User | null) {
    const requiredUser = this.requireUser(user);

    await this.changeManager.submitChangeRequest(args.changeId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Change request submitted for approval',
            changeId: args.changeId
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleChangeApprove(args: { changeId: string; comments?: string }, user: User | null) {
    const requiredUser = this.requireUser(user);

    await this.changeManager.approveChangeRequest(args.changeId, requiredUser.id, args.comments);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Change request approved',
            changeId: args.changeId,
            approver: requiredUser.id
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleChangeGetMetrics(args: { startDate?: string; endDate?: string }, user: User | null) {
    const requiredUser = this.requireUser(user);

    const metrics = this.changeManager.getChangeMetrics(
      args.startDate ? new Date(args.startDate) : undefined,
      args.endDate ? new Date(args.endDate) : undefined
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(metrics, null, 2)
        } as TextContent
      ]
    };
  }

  // Enhanced console operations with audit
  private async handleCreateSessionWithAudit(args: SessionOptions, user: User | null) {
    if (user) {
      // Log session creation attempt
      await this.auditManager.logEvent({
        userId: user.id,
        action: 'console_session_create',
        resource: 'console:session',
        details: { command: args.command, cwd: args.cwd },
        outcome: 'success',
        riskLevel: 'medium',
        ipAddress: 'unknown'
      });
    }

    const sessionId = await this.consoleManager.createSession(args);
    const session = this.consoleManager.getSession(sessionId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            sessionId,
            message: `Session created for command: ${args.command}`,
            pid: session?.pid,
            consoleType: session?.type,
            streaming: session?.streaming
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleSendInputWithAudit(args: { sessionId: string; input: string }, user: User | null) {
    if (user) {
      await this.auditManager.logEvent({
        userId: user.id,
        action: 'console_send_input',
        resource: 'console:session',
        details: { sessionId: args.sessionId, input: args.input.substring(0, 100) }, // Truncate for security
        outcome: 'success',
        riskLevel: 'low',
        ipAddress: 'unknown'
      });
    }

    await this.consoleManager.sendInput(args.sessionId, args.input);

    return {
      content: [
        {
          type: 'text',
          text: `Input sent to session ${args.sessionId}`
        } as TextContent
      ]
    };
  }

  private async handleGetOutputWithAudit(args: { sessionId: string; limit?: number }, user: User | null) {
    if (user) {
      await this.auditManager.logEvent({
        userId: user.id,
        action: 'console_get_output',
        resource: 'console:session',
        details: { sessionId: args.sessionId },
        outcome: 'success',
        riskLevel: 'low',
        ipAddress: 'unknown'
      });
    }

    const output = this.consoleManager.getOutput(args.sessionId, args.limit);
    const text = output.map(o => o.data).join('');

    return {
      content: [
        {
          type: 'text',
          text: text || 'No output available'
        } as TextContent
      ]
    };
  }

  private async handleStopSessionWithAudit(args: { sessionId: string }, user: User | null) {
    if (user) {
      await this.auditManager.logEvent({
        userId: user.id,
        action: 'console_session_stop',
        resource: 'console:session',
        details: { sessionId: args.sessionId },
        outcome: 'success',
        riskLevel: 'medium',
        ipAddress: 'unknown'
      });
    }

    await this.consoleManager.stopSession(args.sessionId);

    return {
      content: [
        {
          type: 'text',
          text: `Session ${args.sessionId} stopped`
        } as TextContent
      ]
    };
  }

  private setupEventHandlers() {
    // SSO Events
    this.ssoManager.on('authentication', (event) => {
      this.logger.info(`SSO Authentication: ${event.success ? 'success' : 'failure'} for provider ${event.provider}`);
    });

    // RBAC Events
    this.rbacManager.on('access:check', (event) => {
      this.logger.debug(`Access check: ${event.granted ? 'granted' : 'denied'} for user ${event.userId}`);
    });

    // Audit Events
    this.auditManager.on('compliance:violation', (event) => {
      this.logger.warn(`Compliance violation detected:`, event.violations);
    });

    // Secret Events
    this.secretManager.on('secret:rotation-needed', (event) => {
      this.logger.info(`Secret rotation needed for ${event.path}`);
    });

    // Change Management Events
    this.changeManager.on('change:created', (event) => {
      this.logger.info(`Change request created: ${event.changeRequest.id}`);
    });

    this.changeManager.on('change:approved', (event) => {
      this.logger.info(`Change request approved: ${event.changeRequest.id}`);
    });
  }

  private setupCleanup() {
    process.on('SIGINT', async () => {
      this.logger.info('Shutting down enterprise console automation server...');
      await this.consoleManager.stopAllSessions();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Shutting down enterprise console automation server...');
      await this.consoleManager.stopAllSessions();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception:', error);
      this.consoleManager.destroy();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error(`Unhandled rejection: ${reason}`);
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('Enterprise Console Automation Server started with full enterprise features');
    this.logger.info('Features enabled:');
    this.logger.info(`  - SSO: ${this.config.sso.enabled}`);
    this.logger.info(`  - RBAC: ${this.config.rbac.enabled}`);
    this.logger.info(`  - Audit: ${this.config.audit.enabled}`);
    this.logger.info(`  - Secrets: ${this.config.secrets.enabled}`);
    this.logger.info(`  - Change Management: ${this.config.changeManagement.enabled}`);
  }

  // Health check and monitoring
  async getHealthStatus() {
    const secretsHealth = await this.secretManager.healthCheck();
    
    return {
      server: 'healthy',
      components: {
        console: 'healthy',
        sso: this.config.sso.enabled ? 'healthy' : 'disabled',
        rbac: this.config.rbac.enabled ? 'healthy' : 'disabled',
        audit: this.config.audit.enabled ? 'healthy' : 'disabled',
        secrets: secretsHealth.healthy ? 'healthy' : 'degraded',
        changeManagement: this.config.changeManagement.enabled ? 'healthy' : 'disabled'
      },
      metrics: {
        activeSessions: this.consoleManager.getAllSessions().length,
        ssoSessions: this.ssoManager.getSessionStats().total,
        auditEvents: this.auditManager.getStatistics().totalEvents,
        secretProviders: this.secretManager.getStatistics().providers.total
      }
    };
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  // Load configuration from environment or config file
  const config: EnterpriseConfig = {
    rbac: {
      enabled: process.env.RBAC_ENABLED === 'true',
      defaultRole: process.env.RBAC_DEFAULT_ROLE || 'console:viewer',
      inheritanceEnabled: true,
      cacheTimeout: 3600,
      adminUsers: process.env.RBAC_ADMIN_USERS?.split(',') || ['admin']
    },
    sso: {
      enabled: process.env.SSO_ENABLED === 'true',
      providers: [],
      fallbackToLocal: true,
      sessionTimeout: 28800, // 8 hours
      multiFactorRequired: false
    },
    audit: {
      enabled: process.env.AUDIT_ENABLED === 'true',
      retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || '365'),
      destinations: ['file'],
      encryptionEnabled: true,
      tamperProtection: true,
      realTimeAnalysis: true
    },
    compliance: {
      enabled: true,
      standards: ['SOC2', 'ISO27001'],
      rules: [],
      reportingSchedule: '0 0 * * 0', // Weekly
      autoRemediation: false
    },
    secrets: {
      enabled: process.env.SECRETS_ENABLED === 'true',
      providers: [],
      cacheTimeout: 300, // 5 minutes
      rotationEnabled: false,
      auditAccess: true
    },
    changeManagement: {
      enabled: process.env.CHANGE_MGMT_ENABLED === 'true',
      defaultApprovers: process.env.CHANGE_DEFAULT_APPROVERS?.split(',') || ['manager'],
      emergencyBypass: false,
      integrationEnabled: false,
      notificationChannels: ['email']
    },
    integrations: {
      enabled: false,
      integrations: [],
      retryAttempts: 3,
      timeout: 30000
    },
    governance: {
      enabled: false,
      policies: [],
      enforcementMode: 'advisory',
      appealProcess: true
    },
    backup: {
      enabled: false,
      schedule: '0 2 * * *', // Daily at 2 AM
      retention: {
        daily: 7,
        weekly: 4,
        monthly: 12,
        yearly: 7
      },
      destinations: [],
      encryption: {
        enabled: true,
        algorithm: 'AES-256',
        keyProvider: 'local'
      },
      compression: true
    },
    monitoring: {
      enabled: false,
      metricsRetention: 30,
      alertRules: [],
      dashboardEnabled: false,
      exporters: []
    }
  };

  const server = new EnterpriseConsoleAutomationServer(config);
  server.start().catch((error) => {
    console.error('Failed to start enterprise server:', error);
    process.exit(1);
  });
}