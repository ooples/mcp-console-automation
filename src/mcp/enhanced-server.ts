#!/usr/bin/env node
/**
 * Enhanced MCP Server with Advanced Workflow Automation Capabilities
 * Provides comprehensive workflow orchestration, data pipelines, triggers, and automation
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

// Import core automation components
import { ConsoleManager } from '../core/ConsoleManager.js';
import { WorkflowEngine } from '../core/WorkflowEngine.js';
import { DataPipelineManager } from '../core/DataPipelineManager.js';
import { TriggerManager } from '../core/TriggerManager.js';
import { WorkflowTemplateLibrary } from '../templates/WorkflowTemplates.js';

// Import types
import { 
  SessionOptions, 
  WorkflowDefinition, 
  WorkflowExecution,
  WorkflowTemplate,
  DataFlowDefinition,
  WorkflowTrigger
} from '../types/index.js';
import { Logger } from '../utils/logger.js';

export class EnhancedConsoleAutomationServer {
  private server: Server;
  private consoleManager: ConsoleManager;
  private workflowEngine: WorkflowEngine;
  private dataManager: DataPipelineManager;
  private triggerManager: TriggerManager;
  private templateLibrary: WorkflowTemplateLibrary;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('EnhancedMCPServer');
    
    // Initialize core components
    this.consoleManager = new ConsoleManager();
    this.workflowEngine = new WorkflowEngine(this.consoleManager);
    this.dataManager = new DataPipelineManager();
    this.triggerManager = new TriggerManager(this.workflowEngine);
    this.templateLibrary = new WorkflowTemplateLibrary();
    
    this.server = new Server(
      {
        name: 'enhanced-console-automation',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupCleanup();
    this.setupEventHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        
        // Original console automation tools
        switch (name) {
          case 'console_create_session':
            return await this.handleCreateSession(args as any);
          case 'console_send_input':
            return await this.handleSendInput(args as any);
          case 'console_send_key':
            return await this.handleSendKey(args as any);
          case 'console_get_output':
            return await this.handleGetOutput(args as any);
          case 'console_get_stream':
            return await this.handleGetStream(args as any);
          case 'console_wait_for_output':
            return await this.handleWaitForOutput(args as any);
          case 'console_stop_session':
            return await this.handleStopSession(args as any);
          case 'console_list_sessions':
            return await this.handleListSessions();
          case 'console_execute_command':
            return await this.handleExecuteCommand(args as any);
          case 'console_detect_errors':
            return await this.handleDetectErrors(args as any);
          case 'console_get_resource_usage':
            return await this.handleGetResourceUsage();
          case 'console_clear_output':
            return await this.handleClearOutput(args as any);

          // Workflow orchestration tools
          case 'workflow_register':
            return await this.handleWorkflowRegister(args as any);
          case 'workflow_execute':
            return await this.handleWorkflowExecute(args as any);
          case 'workflow_get_execution':
            return await this.handleWorkflowGetExecution(args as any);
          case 'workflow_list_executions':
            return await this.handleWorkflowListExecutions(args as any);
          case 'workflow_cancel':
            return await this.handleWorkflowCancel(args as any);
          case 'workflow_approve_task':
            return await this.handleWorkflowApproveTask(args as any);
          case 'workflow_get_status':
            return await this.handleWorkflowGetStatus(args as any);

          // Data pipeline tools
          case 'data_pipeline_register':
            return await this.handleDataPipelineRegister(args as any);
          case 'data_pipeline_execute':
            return await this.handleDataPipelineExecute(args as any);
          case 'data_pipeline_get_execution':
            return await this.handleDataPipelineGetExecution(args as any);
          case 'data_pipeline_list_executions':
            return await this.handleDataPipelineListExecutions(args as any);
          case 'data_pipeline_cancel':
            return await this.handleDataPipelineCancel(args as any);

          // Trigger management tools
          case 'trigger_register':
            return await this.handleTriggerRegister(args as any);
          case 'trigger_enable':
            return await this.handleTriggerEnable(args as any);
          case 'trigger_disable':
            return await this.handleTriggerDisable(args as any);
          case 'trigger_remove':
            return await this.handleTriggerRemove(args as any);
          case 'trigger_list':
            return await this.handleTriggerList(args as any);
          case 'trigger_get_metrics':
            return await this.handleTriggerGetMetrics(args as any);
          case 'trigger_get_executions':
            return await this.handleTriggerGetExecutions(args as any);
          case 'trigger_manual_execute':
            return await this.handleTriggerManualExecute(args as any);

          // Template management tools
          case 'template_list':
            return await this.handleTemplateList(args as any);
          case 'template_get':
            return await this.handleTemplateGet(args as any);
          case 'template_generate_workflow':
            return await this.handleTemplateGenerateWorkflow(args as any);
          case 'template_export':
            return await this.handleTemplateExport(args as any);
          case 'template_import':
            return await this.handleTemplateImport(args as any);
          case 'template_search':
            return await this.handleTemplateSearch(args as any);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error: any) {
        this.logger.error(`Tool execution error: ${error.message}`);
        throw new McpError(ErrorCode.InternalError, error.message);
      }
    });
  }

  private getTools(): Tool[] {
    return [
      // Original console automation tools (keeping for backward compatibility)
      {
        name: 'console_create_session',
        description: 'Create a new console session for running a command',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The command to execute' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
            cwd: { type: 'string', description: 'Working directory' },
            env: { type: 'object', description: 'Environment variables' },
            detectErrors: { type: 'boolean', description: 'Enable automatic error detection' },
            timeout: { type: 'number', description: 'Session timeout in milliseconds' },
            consoleType: { 
              type: 'string', 
              enum: ['cmd', 'powershell', 'pwsh', 'bash', 'zsh', 'sh', 'auto'],
              description: 'Type of console to use' 
            },
            streaming: { type: 'boolean', description: 'Enable streaming for long-running processes' }
          },
          required: ['command']
        }
      },
      {
        name: 'console_execute_command',
        description: 'Execute a command and wait for completion',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
            cwd: { type: 'string', description: 'Working directory' },
            env: { type: 'object', description: 'Environment variables' },
            timeout: { type: 'number', description: 'Execution timeout in milliseconds' },
            consoleType: { 
              type: 'string', 
              enum: ['cmd', 'powershell', 'pwsh', 'bash', 'zsh', 'sh', 'auto'],
              description: 'Type of console to use' 
            }
          },
          required: ['command']
        }
      },

      // Workflow orchestration tools
      {
        name: 'workflow_register',
        description: 'Register a new workflow definition for execution',
        inputSchema: {
          type: 'object',
          properties: {
            workflow: {
              type: 'object',
              description: 'Complete workflow definition including tasks, triggers, and configuration'
            }
          },
          required: ['workflow']
        }
      },
      {
        name: 'workflow_execute',
        description: 'Execute a registered workflow with parameters',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'ID of the workflow to execute' },
            context: {
              type: 'object',
              properties: {
                environment: { type: 'string', description: 'Execution environment' },
                user: { type: 'string', description: 'User executing the workflow' },
                inputs: { type: 'object', description: 'Input parameters for the workflow' },
                metadata: { type: 'object', description: 'Additional metadata' }
              },
              required: ['environment']
            },
            variables: { type: 'object', description: 'Variable overrides for the workflow' }
          },
          required: ['workflowId', 'context']
        }
      },
      {
        name: 'workflow_get_execution',
        description: 'Get details of a specific workflow execution',
        inputSchema: {
          type: 'object',
          properties: {
            executionId: { type: 'string', description: 'Workflow execution ID' }
          },
          required: ['executionId']
        }
      },
      {
        name: 'workflow_list_executions',
        description: 'List all workflow executions with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'Filter by workflow ID' },
            status: { 
              type: 'string', 
              enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'paused'],
              description: 'Filter by execution status' 
            },
            limit: { type: 'number', description: 'Maximum number of results' },
            since: { type: 'string', description: 'ISO date to filter executions since' }
          }
        }
      },
      {
        name: 'workflow_cancel',
        description: 'Cancel a running workflow execution',
        inputSchema: {
          type: 'object',
          properties: {
            executionId: { type: 'string', description: 'Workflow execution ID to cancel' }
          },
          required: ['executionId']
        }
      },
      {
        name: 'workflow_approve_task',
        description: 'Approve or reject a pending task approval',
        inputSchema: {
          type: 'object',
          properties: {
            approvalId: { type: 'string', description: 'Approval request ID' },
            approved: { type: 'boolean', description: 'Whether to approve (true) or reject (false)' },
            comments: { type: 'string', description: 'Optional approval comments' }
          },
          required: ['approvalId', 'approved']
        }
      },

      // Data pipeline tools
      {
        name: 'data_pipeline_register',
        description: 'Register a data processing pipeline definition',
        inputSchema: {
          type: 'object',
          properties: {
            pipelineId: { type: 'string', description: 'Unique pipeline identifier' },
            definition: {
              type: 'object',
              description: 'Data pipeline definition with inputs, transformations, and outputs'
            }
          },
          required: ['pipelineId', 'definition']
        }
      },
      {
        name: 'data_pipeline_execute',
        description: 'Execute a data processing pipeline',
        inputSchema: {
          type: 'object',
          properties: {
            pipelineId: { type: 'string', description: 'ID of the pipeline to execute' },
            inputs: { type: 'object', description: 'Input data for the pipeline' },
            context: { type: 'object', description: 'Execution context and metadata' }
          },
          required: ['pipelineId', 'inputs']
        }
      },
      {
        name: 'data_pipeline_get_execution',
        description: 'Get details of a data pipeline execution',
        inputSchema: {
          type: 'object',
          properties: {
            executionId: { type: 'string', description: 'Pipeline execution ID' }
          },
          required: ['executionId']
        }
      },

      // Trigger management tools
      {
        name: 'trigger_register',
        description: 'Register a workflow trigger (schedule, event, webhook, file watch, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'ID of the workflow to trigger' },
            trigger: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique trigger identifier' },
                type: { 
                  type: 'string', 
                  enum: ['manual', 'schedule', 'event', 'webhook', 'file_watch', 'condition', 'dependency'],
                  description: 'Type of trigger'
                },
                name: { type: 'string', description: 'Human-readable trigger name' },
                enabled: { type: 'boolean', description: 'Whether trigger is enabled' },
                config: { type: 'object', description: 'Trigger-specific configuration' },
                conditions: { type: 'array', description: 'Optional trigger conditions' }
              },
              required: ['id', 'type', 'name', 'config']
            }
          },
          required: ['workflowId', 'trigger']
        }
      },
      {
        name: 'trigger_list',
        description: 'List all registered triggers with their status and metrics',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'Filter by workflow ID' },
            type: { 
              type: 'string',
              enum: ['manual', 'schedule', 'event', 'webhook', 'file_watch', 'condition', 'dependency'],
              description: 'Filter by trigger type'
            },
            enabled: { type: 'boolean', description: 'Filter by enabled status' }
          }
        }
      },
      {
        name: 'trigger_manual_execute',
        description: 'Manually trigger a workflow execution for testing',
        inputSchema: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'ID of the workflow to execute' },
            data: { type: 'object', description: 'Optional trigger data' }
          },
          required: ['workflowId']
        }
      },

      // Template management tools
      {
        name: 'template_list',
        description: 'List available workflow templates',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Filter templates by category' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter templates by tags' }
          }
        }
      },
      {
        name: 'template_get',
        description: 'Get a specific workflow template by ID',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: 'Template ID to retrieve' }
          },
          required: ['templateId']
        }
      },
      {
        name: 'template_generate_workflow',
        description: 'Generate a workflow definition from a template',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: 'Template to use' },
            parameters: { type: 'object', description: 'Template parameters' },
            customizations: { type: 'object', description: 'Custom workflow modifications' }
          },
          required: ['templateId', 'parameters']
        }
      },
      {
        name: 'template_search',
        description: 'Search workflow templates by keywords, tags, or categories',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            category: { type: 'string', description: 'Filter by category' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' }
          }
        }
      },

      // System and monitoring tools
      {
        name: 'system_get_status',
        description: 'Get overall system status including all components',
        inputSchema: {
          type: 'object',
          properties: {
            includeMetrics: { type: 'boolean', description: 'Include performance metrics' },
            includeHealth: { type: 'boolean', description: 'Include health check results' }
          }
        }
      },
      {
        name: 'system_get_metrics',
        description: 'Get comprehensive system metrics and performance data',
        inputSchema: {
          type: 'object',
          properties: {
            timeRange: { type: 'string', description: 'Time range for metrics (e.g., "1h", "24h", "7d")' },
            component: { 
              type: 'string', 
              enum: ['console', 'workflow', 'pipeline', 'triggers', 'all'],
              description: 'Component to get metrics for'
            }
          }
        }
      }
    ];
  }

  // Original console automation handlers (preserved for compatibility)
  private async handleCreateSession(args: SessionOptions) {
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

  private async handleExecuteCommand(args: any) {
    const result = await this.consoleManager.executeCommand(
      args.command,
      args.args,
      {
        cwd: args.cwd,
        env: args.env,
        timeout: args.timeout,
        consoleType: args.consoleType
      }
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        } as TextContent
      ]
    };
  }

  // Workflow orchestration handlers
  private async handleWorkflowRegister(args: { workflow: WorkflowDefinition }) {
    this.workflowEngine.registerWorkflow(args.workflow);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: `Workflow registered successfully`,
            workflowId: args.workflow.id,
            name: args.workflow.name,
            version: args.workflow.version,
            tasksCount: args.workflow.tasks.length,
            triggersCount: args.workflow.triggers.length
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleWorkflowExecute(args: { workflowId: string; context: any; variables?: Record<string, any> }) {
    const executionId = await this.workflowEngine.executeWorkflow(
      args.workflowId,
      args.context,
      args.variables
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            executionId,
            message: `Workflow execution started`,
            workflowId: args.workflowId,
            context: args.context,
            variables: args.variables || {}
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleWorkflowGetExecution(args: { executionId: string }) {
    const execution = this.workflowEngine.getExecution(args.executionId);
    
    if (!execution) {
      throw new McpError(ErrorCode.InvalidParams, `Execution not found: ${args.executionId}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            execution: {
              id: execution.id,
              workflowId: execution.workflowId,
              status: execution.status,
              startTime: execution.startTime,
              endTime: execution.endTime,
              duration: execution.duration,
              triggeredBy: execution.triggeredBy,
              context: execution.context,
              variables: execution.variables,
              metrics: execution.metrics,
              tasksCompleted: execution.tasks.filter(t => t.status === 'completed').length,
              tasksFailed: execution.tasks.filter(t => t.status === 'failed').length,
              totalTasks: execution.tasks.length,
              errors: execution.errors,
              logs: execution.logs.slice(-10) // Last 10 log entries
            }
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleWorkflowListExecutions(args: any) {
    const executions = this.workflowEngine.getAllExecutions();
    
    let filteredExecutions = executions;
    
    if (args.workflowId) {
      filteredExecutions = filteredExecutions.filter(e => e.workflowId === args.workflowId);
    }
    
    if (args.status) {
      filteredExecutions = filteredExecutions.filter(e => e.status === args.status);
    }
    
    if (args.since) {
      const sinceDate = new Date(args.since);
      filteredExecutions = filteredExecutions.filter(e => e.startTime >= sinceDate);
    }
    
    if (args.limit) {
      filteredExecutions = filteredExecutions.slice(0, args.limit);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            executions: filteredExecutions.map(e => ({
              id: e.id,
              workflowId: e.workflowId,
              status: e.status,
              startTime: e.startTime,
              endTime: e.endTime,
              duration: e.duration,
              triggeredBy: e.triggeredBy,
              tasksCompleted: e.tasks.filter(t => t.status === 'completed').length,
              tasksFailed: e.tasks.filter(t => t.status === 'failed').length,
              totalTasks: e.tasks.length
            })),
            total: filteredExecutions.length,
            filters: {
              workflowId: args.workflowId,
              status: args.status,
              since: args.since,
              limit: args.limit
            }
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleWorkflowCancel(args: { executionId: string }) {
    await this.workflowEngine.cancelExecution(args.executionId);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: `Workflow execution cancelled`,
            executionId: args.executionId
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleWorkflowApproveTask(args: { approvalId: string; approved: boolean; comments?: string }) {
    this.workflowEngine.approveTask(args.approvalId, args.approved, args.comments);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: `Task approval ${args.approved ? 'approved' : 'rejected'}`,
            approvalId: args.approvalId,
            comments: args.comments
          }, null, 2)
        } as TextContent
      ]
    };
  }

  // Data pipeline handlers
  private async handleDataPipelineRegister(args: { pipelineId: string; definition: DataFlowDefinition }) {
    this.dataManager.registerPipeline(args.pipelineId, args.definition);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: `Data pipeline registered successfully`,
            pipelineId: args.pipelineId,
            inputsCount: args.definition.inputs.length,
            outputsCount: args.definition.outputs.length,
            transformationsCount: args.definition.transformations.length
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleDataPipelineExecute(args: { pipelineId: string; inputs: Record<string, any>; context?: any }) {
    const executionId = await this.dataManager.executePipeline(args.pipelineId, args.inputs, args.context);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            executionId,
            message: `Data pipeline execution started`,
            pipelineId: args.pipelineId
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleDataPipelineGetExecution(args: { executionId: string }) {
    const execution = this.dataManager.getExecution(args.executionId);
    
    if (!execution) {
      throw new McpError(ErrorCode.InvalidParams, `Pipeline execution not found: ${args.executionId}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(execution, null, 2)
        } as TextContent
      ]
    };
  }

  // Trigger management handlers
  private async handleTriggerRegister(args: { workflowId: string; trigger: WorkflowTrigger }) {
    this.triggerManager.registerTrigger(args.workflowId, args.trigger);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: `Trigger registered successfully`,
            triggerId: `${args.workflowId}:${args.trigger.id}`,
            type: args.trigger.type,
            enabled: args.trigger.enabled
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleTriggerList(args: any) {
    const triggers = this.triggerManager.getAllTriggers();
    
    let filteredTriggers = triggers;
    
    if (args.workflowId) {
      filteredTriggers = filteredTriggers.filter(t => t.id.startsWith(args.workflowId));
    }
    
    if (args.type) {
      filteredTriggers = filteredTriggers.filter(t => t.type === args.type);
    }
    
    if (args.enabled !== undefined) {
      filteredTriggers = filteredTriggers.filter(t => t.enabled === args.enabled);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            triggers: filteredTriggers.map(t => ({
              id: t.id,
              name: t.name,
              type: t.type,
              enabled: t.enabled,
              workflowId: t.id.split(':')[0]
            })),
            total: filteredTriggers.length
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleTriggerManualExecute(args: { workflowId: string; data?: any }) {
    const executionId = await this.triggerManager.manualTrigger(args.workflowId, args.data);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            executionId,
            message: `Manual trigger executed`,
            workflowId: args.workflowId
          }, null, 2)
        } as TextContent
      ]
    };
  }

  // Template management handlers
  private async handleTemplateList(args: any) {
    let templates = this.templateLibrary.getAllTemplates();
    
    if (args.category) {
      templates = this.templateLibrary.getTemplatesByCategory(args.category);
    }
    
    if (args.tags && args.tags.length > 0) {
      templates = this.templateLibrary.searchTemplatesByTags(args.tags);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            templates: templates.map(t => ({
              id: t.id,
              name: t.name,
              description: t.description,
              category: t.category,
              version: t.version,
              tags: t.tags,
              parametersCount: t.parameters.length,
              examplesCount: t.examples.length
            })),
            total: templates.length,
            categories: this.templateLibrary.getCategories(),
            allTags: this.templateLibrary.getAllTags()
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleTemplateGet(args: { templateId: string }) {
    const template = this.templateLibrary.getTemplate(args.templateId);
    
    if (!template) {
      throw new McpError(ErrorCode.InvalidParams, `Template not found: ${args.templateId}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(template, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleTemplateGenerateWorkflow(args: { templateId: string; parameters: Record<string, any>; customizations?: any }) {
    const workflow = this.templateLibrary.generateWorkflowFromTemplate(
      args.templateId,
      args.parameters,
      args.customizations
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            workflow,
            message: `Workflow generated from template`,
            templateId: args.templateId,
            workflowId: workflow.id
          }, null, 2)
        } as TextContent
      ]
    };
  }

  private async handleTemplateSearch(args: any) {
    let results = this.templateLibrary.getAllTemplates();

    if (args.category) {
      results = results.filter(t => t.category === args.category);
    }

    if (args.tags && args.tags.length > 0) {
      results = this.templateLibrary.searchTemplatesByTags(args.tags);
    }

    if (args.query) {
      const query = args.query.toLowerCase();
      results = results.filter(t => 
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: results.map(t => ({
              id: t.id,
              name: t.name,
              description: t.description,
              category: t.category,
              tags: t.tags
            })),
            total: results.length,
            query: args.query,
            filters: {
              category: args.category,
              tags: args.tags
            }
          }, null, 2)
        } as TextContent
      ]
    };
  }

  // Preserved original handlers for backward compatibility
  private async handleSendInput(args: { sessionId: string; input: string }) {
    await this.consoleManager.sendInput(args.sessionId, args.input);
    return {
      content: [{ type: 'text', text: `Input sent to session ${args.sessionId}` } as TextContent]
    };
  }

  private async handleSendKey(args: { sessionId: string; key: string }) {
    await this.consoleManager.sendKey(args.sessionId, args.key);
    return {
      content: [{ type: 'text', text: `Key '${args.key}' sent to session ${args.sessionId}` } as TextContent]
    };
  }

  private async handleGetOutput(args: { sessionId: string; limit?: number }) {
    const output = this.consoleManager.getOutput(args.sessionId, args.limit);
    const text = output.map(o => o.data).join('');
    return {
      content: [{ type: 'text', text: text || 'No output available' } as TextContent]
    };
  }

  private async handleGetStream(args: { sessionId: string; since?: string }) {
    const streamManager = this.consoleManager.getStream(args.sessionId);
    
    if (!streamManager) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Streaming not enabled for this session',
            hint: 'Create session with streaming: true'
          }, null, 2)
        } as TextContent]
      };
    }

    const since = args.since ? new Date(args.since) : undefined;
    const chunks = streamManager.getChunks(since);
    const stats = streamManager.getStats();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          chunks: chunks.map(c => ({
            data: c.data,
            timestamp: c.timestamp,
            isError: c.isError
          })),
          stats,
          fullOutput: chunks.map(c => c.data).join('')
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleWaitForOutput(args: { sessionId: string; pattern: string; timeout?: number }) {
    try {
      const output = await this.consoleManager.waitForOutput(
        args.sessionId,
        args.pattern,
        args.timeout || 5000
      );
      return {
        content: [{ type: 'text', text: output } as TextContent]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  private async handleStopSession(args: { sessionId: string }) {
    await this.consoleManager.stopSession(args.sessionId);
    return {
      content: [{ type: 'text', text: `Session ${args.sessionId} stopped` } as TextContent]
    };
  }

  private async handleListSessions() {
    const sessions = this.consoleManager.getAllSessions();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(sessions.map(s => ({
          id: s.id,
          command: s.command,
          status: s.status,
          pid: s.pid,
          type: s.type,
          streaming: s.streaming,
          createdAt: s.createdAt
        })), null, 2)
      } as TextContent]
    };
  }

  private async handleDetectErrors(args: { sessionId?: string; text?: string }) {
    const { ErrorDetector } = await import('../core/ErrorDetector.js');
    const errorDetector = new ErrorDetector();
    
    let textToAnalyze: string;
    if (args.sessionId) {
      const output = this.consoleManager.getLastOutput(args.sessionId, 100);
      textToAnalyze = output;
    } else if (args.text) {
      textToAnalyze = args.text;
    } else {
      throw new McpError(ErrorCode.InvalidParams, 'Either sessionId or text must be provided');
    }

    const errors = errorDetector.detect(textToAnalyze);
    const stackTrace = errorDetector.analyzeStackTrace(textToAnalyze);
    const severityScore = errorDetector.getSeverityScore(errors);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          errors,
          stackTrace,
          severityScore,
          hasErrors: errors.length > 0
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleGetResourceUsage() {
    const usage = this.consoleManager.getResourceUsage();
    return {
      content: [{ type: 'text', text: JSON.stringify(usage, null, 2) } as TextContent]
    };
  }

  private async handleClearOutput(args: { sessionId: string }) {
    this.consoleManager.clearOutput(args.sessionId);
    return {
      content: [{ type: 'text', text: `Output buffer cleared for session ${args.sessionId}` } as TextContent]
    };
  }

  private async handleWorkflowGetStatus(args: { executionId: string }) {
    const execution = this.workflowEngine.getExecution(args.executionId);
    if (!execution) {
      throw new McpError(ErrorCode.InvalidParams, `Execution not found: ${args.executionId}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          executionId: execution.id,
          workflowId: execution.workflowId,
          status: execution.status,
          currentTask: execution.tasks.find(t => t.status === 'running')?.taskId,
          progress: {
            totalTasks: execution.tasks.length,
            completedTasks: execution.tasks.filter(t => t.status === 'completed').length,
            failedTasks: execution.tasks.filter(t => t.status === 'failed').length,
            percentage: Math.round((execution.tasks.filter(t => t.status === 'completed').length / execution.tasks.length) * 100)
          },
          duration: execution.duration || (Date.now() - execution.startTime.getTime()),
          errors: execution.errors.length,
          pendingApprovals: execution.approvals.filter(a => a.status === 'pending').length
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleDataPipelineListExecutions(args: any) {
    const executions = this.dataManager.getAllExecutions();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          executions: executions.map(e => ({
            id: e.id,
            pipelineId: e.pipelineId,
            status: e.status,
            startTime: e.startTime,
            endTime: e.endTime,
            metrics: e.metrics
          })),
          total: executions.length
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleDataPipelineCancel(args: { executionId: string }) {
    this.dataManager.cancelExecution(args.executionId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `Data pipeline execution cancelled`,
          executionId: args.executionId
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleTriggerEnable(args: { triggerId: string }) {
    this.triggerManager.enableTrigger(args.triggerId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `Trigger enabled`,
          triggerId: args.triggerId
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleTriggerDisable(args: { triggerId: string }) {
    this.triggerManager.disableTrigger(args.triggerId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `Trigger disabled`,
          triggerId: args.triggerId
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleTriggerRemove(args: { triggerId: string }) {
    this.triggerManager.removeTrigger(args.triggerId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `Trigger removed`,
          triggerId: args.triggerId
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleTriggerGetMetrics(args: { triggerId: string }) {
    const metrics = this.triggerManager.getTriggerMetrics(args.triggerId);
    if (!metrics) {
      throw new McpError(ErrorCode.InvalidParams, `Trigger not found: ${args.triggerId}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(metrics, null, 2)
      } as TextContent]
    };
  }

  private async handleTriggerGetExecutions(args: { triggerId: string; limit?: number }) {
    const executions = this.triggerManager.getTriggerExecutions(args.triggerId, args.limit);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          executions,
          total: executions.length,
          triggerId: args.triggerId
        }, null, 2)
      } as TextContent]
    };
  }

  private async handleTemplateExport(args: { templateId: string }) {
    const exported = this.templateLibrary.exportTemplate(args.templateId);
    return {
      content: [{
        type: 'text',
        text: exported
      } as TextContent]
    };
  }

  private async handleTemplateImport(args: { templateJson: string }) {
    this.templateLibrary.importTemplate(args.templateJson);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: `Template imported successfully`
        }, null, 2)
      } as TextContent]
    };
  }

  private setupEventHandlers() {
    // Listen to workflow events
    this.workflowEngine.on('execution-status-changed', (executionId: string, status: string) => {
      this.logger.info(`Workflow execution ${executionId} status changed to ${status}`);
    });

    this.workflowEngine.on('task-started', (executionId: string, task: any) => {
      this.logger.info(`Task started in execution ${executionId}: ${task.taskId}`);
    });

    this.workflowEngine.on('approval-required', (executionId: string, approval: any) => {
      this.logger.info(`Approval required in execution ${executionId}: ${approval.id}`);
    });

    // Listen to trigger events
    this.triggerManager.on('trigger-executed', (event: any) => {
      this.logger.info(`Trigger executed: ${event.triggerId} -> ${event.workflowExecutionId}`);
    });

    this.triggerManager.on('trigger-failed', (event: any) => {
      this.logger.error(`Trigger failed: ${event.triggerId} - ${event.error}`);
    });

    // Listen to data pipeline events
    this.dataManager.on('pipeline-started', (executionId: string) => {
      this.logger.info(`Data pipeline execution started: ${executionId}`);
    });

    this.dataManager.on('pipeline-completed', (executionId: string) => {
      this.logger.info(`Data pipeline execution completed: ${executionId}`);
    });
  }

  private setupCleanup() {
    process.on('SIGINT', async () => {
      this.logger.info('Shutting down enhanced server...');
      await this.consoleManager.stopAllSessions();
      this.workflowEngine.cleanup();
      // dataManager.cleanup() method doesn't exist, using destroy if available
      if ('destroy' in this.dataManager && typeof this.dataManager.destroy === 'function') {
        (this.dataManager as any).destroy();
      }
      // triggerManager.cleanup() method doesn't exist, using destroy if available
      if ('destroy' in this.triggerManager && typeof this.triggerManager.destroy === 'function') {
        (this.triggerManager as any).destroy();
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.logger.info('Shutting down enhanced server...');
      await this.consoleManager.stopAllSessions();
      this.workflowEngine.cleanup();
      // dataManager.cleanup() method doesn't exist, using destroy if available
      if ('destroy' in this.dataManager && typeof this.dataManager.destroy === 'function') {
        (this.dataManager as any).destroy();
      }
      // triggerManager.cleanup() method doesn't exist, using destroy if available
      if ('destroy' in this.triggerManager && typeof this.triggerManager.destroy === 'function') {
        (this.triggerManager as any).destroy();
      }
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception:', error);
      this.consoleManager.destroy();
      this.triggerManager.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error(`Unhandled rejection: ${reason}`);
    });

    // Periodic cleanup
    setInterval(() => {
      this.workflowEngine.cleanup(24); // Clean up executions older than 24 hours
      // dataManager.cleanup() method doesn't exist, using destroy if available
      if ('destroy' in this.dataManager && typeof this.dataManager.destroy === 'function') {
        (this.dataManager as any).destroy();
      }
      this.triggerManager.cleanup(168); // Clean up trigger executions older than 1 week
    }, 3600000); // Every hour
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('Enhanced MCP Console Automation Server started with advanced workflow capabilities');
    
    // Log available features
    this.logger.info('Available features:');
    this.logger.info('- Console session management and command execution');
    this.logger.info('- Advanced workflow orchestration with conditional logic');
    this.logger.info('- Parallel task execution and state machines');
    this.logger.info('- Data pipeline processing and transformations');
    this.logger.info('- Event-driven automation triggers');
    this.logger.info('- Scheduled task execution');
    this.logger.info('- Human-in-the-loop approvals');
    this.logger.info('- Workflow template library');
    this.logger.info('- External API and service integration');
    this.logger.info('- Comprehensive error handling and rollback strategies');
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new EnhancedConsoleAutomationServer();
  server.start().catch((error) => {
    console.error('Failed to start enhanced server:', error);
    process.exit(1);
  });
}