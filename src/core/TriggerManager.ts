/**
 * Event-Driven Automation Trigger Manager
 * Handles various types of triggers for workflow automation
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as cron from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer } from 'ws';
import {
  WorkflowTrigger,
  TriggerConfig,
  ScheduleConfig,
  EventConfig,
  WebhookConfig,
  FileWatchConfig,
  ConditionConfig,
  TriggerCondition,
  WorkflowExecution,
  ExecutionTrigger,
} from '../types/workflow.js';
import { Logger } from '../utils/logger.js';
import { WorkflowEngine } from './WorkflowEngine.js';

export interface TriggerExecution {
  id: string;
  triggerId: string;
  timestamp: Date;
  data: any;
  workflowExecutionId?: string;
  status: 'pending' | 'executed' | 'failed' | 'skipped';
  error?: string;
}

export interface TriggerMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  skippedExecutions: number;
  averageExecutionTime: number;
  lastExecution?: Date;
  nextExecution?: Date;
}

export class TriggerManager extends EventEmitter {
  private triggers: Map<string, WorkflowTrigger>;
  private cronJobs: Map<string, cron.ScheduledTask>;
  private fileWatchers: Map<string, fs.FSWatcher>;
  private conditionCheckers: Map<string, NodeJS.Timeout>;
  private webhookServer?: WebSocketServer;
  private eventListeners: Map<string, EventListener>;
  private triggerExecutions: Map<string, TriggerExecution[]>;
  private triggerMetrics: Map<string, TriggerMetrics>;
  private workflowEngine: WorkflowEngine;
  private logger: Logger;
  private webhookPort: number;

  constructor(workflowEngine: WorkflowEngine, webhookPort: number = 3001) {
    super();
    this.triggers = new Map();
    this.cronJobs = new Map();
    this.fileWatchers = new Map();
    this.conditionCheckers = new Map();
    this.eventListeners = new Map();
    this.triggerExecutions = new Map();
    this.triggerMetrics = new Map();
    this.workflowEngine = workflowEngine;
    this.logger = new Logger('TriggerManager');
    this.webhookPort = webhookPort;

    this.setupWebhookServer();
  }

  /**
   * Register a workflow trigger
   */
  registerTrigger(workflowId: string, trigger: WorkflowTrigger): void {
    const triggerId = `${workflowId}:${trigger.id}`;
    this.triggers.set(triggerId, { ...trigger, id: triggerId });

    if (!this.triggerExecutions.has(triggerId)) {
      this.triggerExecutions.set(triggerId, []);
    }

    if (!this.triggerMetrics.has(triggerId)) {
      this.triggerMetrics.set(triggerId, {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        skippedExecutions: 0,
        averageExecutionTime: 0,
      });
    }

    if (trigger.enabled) {
      this.activateTrigger(workflowId, trigger);
    }

    this.logger.info(`Trigger registered: ${triggerId} (${trigger.type})`);
    this.emit('trigger-registered', workflowId, trigger);
  }

  /**
   * Activate a trigger based on its type
   */
  private activateTrigger(workflowId: string, trigger: WorkflowTrigger): void {
    const triggerId = `${workflowId}:${trigger.id}`;

    switch (trigger.type) {
      case 'schedule':
        this.activateScheduleTrigger(workflowId, triggerId, trigger);
        break;

      case 'event':
        this.activateEventTrigger(workflowId, triggerId, trigger);
        break;

      case 'webhook':
        this.activateWebhookTrigger(workflowId, triggerId, trigger);
        break;

      case 'file_watch':
        this.activateFileWatchTrigger(workflowId, triggerId, trigger);
        break;

      case 'condition':
        this.activateConditionTrigger(workflowId, triggerId, trigger);
        break;

      case 'dependency':
        this.activateDependencyTrigger(workflowId, triggerId, trigger);
        break;

      default:
        this.logger.warn(`Unsupported trigger type: ${trigger.type}`);
    }
  }

  /**
   * Activate schedule-based trigger using cron
   */
  private activateScheduleTrigger(
    workflowId: string,
    triggerId: string,
    trigger: WorkflowTrigger
  ): void {
    const schedule = trigger.config.schedule!;

    if (!cron.validate(schedule.cron)) {
      throw new Error(`Invalid cron expression: ${schedule.cron}`);
    }

    const task = cron.schedule(
      schedule.cron,
      async () => {
        await this.executeTrigger(workflowId, triggerId, {
          type: 'schedule',
          cron: schedule.cron,
          timezone: schedule.timezone,
        });
      },
      {
        scheduled: true,
        timezone: schedule.timezone || 'UTC',
      }
    );

    this.cronJobs.set(triggerId, task);

    // Update metrics with next execution time
    const metrics = this.triggerMetrics.get(triggerId)!;
    const nextRun = task.getStatus().nextExecution;
    if (nextRun) {
      metrics.nextExecution = nextRun;
    }

    this.logger.info(
      `Schedule trigger activated: ${triggerId} with cron ${schedule.cron}`
    );
  }

  /**
   * Activate event-based trigger
   */
  private activateEventTrigger(
    workflowId: string,
    triggerId: string,
    trigger: WorkflowTrigger
  ): void {
    if (!trigger.config.events) return;

    for (const eventConfig of trigger.config.events) {
      const listener: EventListener = async (eventData: any) => {
        // Check if event matches filters
        if (this.matchesEventFilters(eventData, eventConfig.filters)) {
          await this.executeTrigger(workflowId, triggerId, {
            type: 'event',
            source: eventConfig.source,
            eventType: eventConfig.type,
            data: eventData,
          });
        }
      };

      const listenerId = `${triggerId}:${eventConfig.source}:${eventConfig.type}`;
      this.eventListeners.set(listenerId, listener);

      // Subscribe to events from the specified source
      this.subscribeToEventSource(
        eventConfig.source,
        eventConfig.type,
        listener
      );
    }

    this.logger.info(`Event trigger activated: ${triggerId}`);
  }

  /**
   * Activate webhook-based trigger
   */
  private activateWebhookTrigger(
    workflowId: string,
    triggerId: string,
    trigger: WorkflowTrigger
  ): void {
    const webhook = trigger.config.webhook!;

    // Register webhook endpoint
    this.registerWebhookEndpoint(workflowId, triggerId, webhook);

    this.logger.info(
      `Webhook trigger activated: ${triggerId} at ${webhook.path}`
    );
  }

  /**
   * Activate file watch trigger
   */
  private activateFileWatchTrigger(
    workflowId: string,
    triggerId: string,
    trigger: WorkflowTrigger
  ): void {
    const fileWatch = trigger.config.fileWatch!;
    const watchers: fs.FSWatcher[] = [];

    for (const watchPath of fileWatch.paths) {
      try {
        const watcher = fs.watch(
          watchPath,
          { recursive: fileWatch.recursive },
          async (eventType, filename) => {
            if (!filename) return;

            // Check if file matches patterns
            if (fileWatch.patterns.length > 0) {
              const matches = fileWatch.patterns.some((pattern) =>
                new RegExp(pattern).test(filename)
              );
              if (!matches) return;
            }

            // Check if event type is monitored
            if (!fileWatch.events.includes(eventType as any)) return;

            // Apply debounce if configured
            if (fileWatch.debounce) {
              clearTimeout(this.conditionCheckers.get(`${triggerId}:debounce`));
              const timeout = setTimeout(async () => {
                await this.executeTrigger(workflowId, triggerId, {
                  type: 'file_watch',
                  path: watchPath,
                  filename,
                  eventType,
                });
              }, fileWatch.debounce);
              this.conditionCheckers.set(`${triggerId}:debounce`, timeout);
            } else {
              await this.executeTrigger(workflowId, triggerId, {
                type: 'file_watch',
                path: watchPath,
                filename,
                eventType,
              });
            }
          }
        );

        watchers.push(watcher);
      } catch (error: any) {
        this.logger.error(
          `Failed to watch path ${watchPath}: ${error.message}`
        );
      }
    }

    if (watchers.length > 0) {
      this.fileWatchers.set(triggerId, watchers[0]); // Store first watcher for cleanup
    }

    this.logger.info(
      `File watch trigger activated: ${triggerId} watching ${fileWatch.paths.length} paths`
    );
  }

  /**
   * Activate condition-based trigger
   */
  private activateConditionTrigger(
    workflowId: string,
    triggerId: string,
    trigger: WorkflowTrigger
  ): void {
    const condition = trigger.config.condition!;
    let checkCount = 0;

    const checkCondition = async () => {
      try {
        const result = await this.evaluateCondition(condition.expression);

        if (result) {
          await this.executeTrigger(workflowId, triggerId, {
            type: 'condition',
            expression: condition.expression,
            result,
          });

          // Stop checking if condition is met (one-time trigger)
          clearInterval(intervalId);
          this.conditionCheckers.delete(triggerId);
        } else {
          checkCount++;
          if (condition.maxChecks && checkCount >= condition.maxChecks) {
            this.logger.info(
              `Condition trigger stopped after ${checkCount} checks: ${triggerId}`
            );
            clearInterval(intervalId);
            this.conditionCheckers.delete(triggerId);
          }
        }
      } catch (error: any) {
        this.logger.error(
          `Error evaluating condition for ${triggerId}: ${error.message}`
        );
      }
    };

    const intervalId = setInterval(checkCondition, condition.checkInterval);
    this.conditionCheckers.set(triggerId, intervalId);

    this.logger.info(
      `Condition trigger activated: ${triggerId} checking every ${condition.checkInterval}ms`
    );
  }

  /**
   * Activate dependency-based trigger
   */
  private activateDependencyTrigger(
    workflowId: string,
    triggerId: string,
    trigger: WorkflowTrigger
  ): void {
    // Listen for workflow completion events
    this.workflowEngine.on(
      'execution-status-changed',
      async (executionId: string, status: string) => {
        if (status === 'completed') {
          const execution = this.workflowEngine.getExecution(executionId);
          if (
            execution &&
            this.matchesDependencyConditions(execution, trigger.conditions)
          ) {
            await this.executeTrigger(workflowId, triggerId, {
              type: 'dependency',
              dependentExecutionId: executionId,
              dependentWorkflowId: execution.workflowId,
            });
          }
        }
      }
    );

    this.logger.info(`Dependency trigger activated: ${triggerId}`);
  }

  /**
   * Execute a trigger and start workflow
   */
  private async executeTrigger(
    workflowId: string,
    triggerId: string,
    triggerData: any
  ): Promise<void> {
    const trigger = this.triggers.get(triggerId);
    if (!trigger || !trigger.enabled) {
      this.recordTriggerExecution(
        triggerId,
        triggerData,
        'skipped',
        undefined,
        'Trigger disabled or not found'
      );
      return;
    }

    const executionId = uuidv4();
    const startTime = Date.now();

    try {
      this.logger.info(
        `Executing trigger: ${triggerId} for workflow: ${workflowId}`
      );

      // Check trigger conditions
      if (
        trigger.conditions &&
        !this.evaluateTriggerConditions(triggerData, trigger.conditions)
      ) {
        this.recordTriggerExecution(
          triggerId,
          triggerData,
          'skipped',
          undefined,
          'Trigger conditions not met'
        );
        return;
      }

      // Execute workflow
      const workflowExecutionId = await this.workflowEngine.executeWorkflow(
        workflowId,
        {
          environment: 'production',
          user: 'system',
          inputs: triggerData,
          metadata: { triggerId, triggerType: trigger.type },
        },
        triggerData
      );

      const duration = Date.now() - startTime;
      this.recordTriggerExecution(
        triggerId,
        triggerData,
        'executed',
        workflowExecutionId
      );
      this.updateTriggerMetrics(triggerId, true, duration);

      this.emit('trigger-executed', {
        triggerId,
        workflowId,
        workflowExecutionId,
        triggerData,
        duration,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.recordTriggerExecution(
        triggerId,
        triggerData,
        'failed',
        undefined,
        error.message
      );
      this.updateTriggerMetrics(triggerId, false, duration);

      this.logger.error(
        `Trigger execution failed: ${triggerId} - ${error.message}`
      );
      this.emit('trigger-failed', {
        triggerId,
        workflowId,
        triggerData,
        error: error.message,
        duration,
      });
    }
  }

  /**
   * Record trigger execution for audit and metrics
   */
  private recordTriggerExecution(
    triggerId: string,
    data: any,
    status: TriggerExecution['status'],
    workflowExecutionId?: string,
    error?: string
  ): void {
    const execution: TriggerExecution = {
      id: uuidv4(),
      triggerId,
      timestamp: new Date(),
      data,
      workflowExecutionId,
      status,
      error,
    };

    const executions = this.triggerExecutions.get(triggerId) || [];
    executions.push(execution);

    // Keep only last 1000 executions per trigger
    if (executions.length > 1000) {
      executions.splice(0, executions.length - 1000);
    }

    this.triggerExecutions.set(triggerId, executions);
  }

  /**
   * Update trigger metrics
   */
  private updateTriggerMetrics(
    triggerId: string,
    success: boolean,
    duration: number
  ): void {
    const metrics = this.triggerMetrics.get(triggerId);
    if (!metrics) return;

    metrics.totalExecutions++;
    if (success) {
      metrics.successfulExecutions++;
    } else {
      metrics.failedExecutions++;
    }

    metrics.lastExecution = new Date();

    // Update average execution time
    metrics.averageExecutionTime =
      (metrics.averageExecutionTime * (metrics.totalExecutions - 1) +
        duration) /
      metrics.totalExecutions;
  }

  /**
   * Setup webhook server for HTTP triggers
   */
  private setupWebhookServer(): void {
    // This would typically be an Express.js server
    // For simplicity, we'll emit webhook events
    this.logger.info(
      `Webhook server would be running on port ${this.webhookPort}`
    );
  }

  /**
   * Register webhook endpoint
   */
  private registerWebhookEndpoint(
    workflowId: string,
    triggerId: string,
    webhook: WebhookConfig
  ): void {
    // Register the webhook path and associate it with the trigger
    this.emit('webhook-registered', {
      workflowId,
      triggerId,
      path: webhook.path,
      method: webhook.method,
      authentication: webhook.authentication,
    });
  }

  /**
   * Evaluate condition expression
   */
  private async evaluateCondition(expression: string): Promise<boolean> {
    try {
      // Simple expression evaluation
      // In production, use a proper expression engine with security considerations
      const func = new Function(`return ${expression}`);
      return Boolean(func());
    } catch {
      return false;
    }
  }

  /**
   * Check if event data matches filters
   */
  private matchesEventFilters(
    eventData: any,
    filters?: Record<string, any>
  ): boolean {
    if (!filters) return true;

    for (const [key, expectedValue] of Object.entries(filters)) {
      const actualValue = this.getNestedValue(eventData, key);
      if (actualValue !== expectedValue) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate trigger conditions
   */
  private evaluateTriggerConditions(
    data: any,
    conditions: TriggerCondition[]
  ): boolean {
    for (const condition of conditions) {
      let value: any;

      switch (condition.type) {
        case 'header':
          value = data.headers?.[condition.field];
          break;
        case 'body':
          value = data.body?.[condition.field];
          break;
        case 'query':
          value = data.query?.[condition.field];
          break;
        case 'path':
          value = data.path?.[condition.field];
          break;
        case 'environment':
          value = process.env[condition.field];
          break;
        default:
          value = this.getNestedValue(data, condition.field);
      }

      if (!this.compareValues(value, condition.operator, condition.value)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if execution matches dependency conditions
   */
  private matchesDependencyConditions(
    execution: WorkflowExecution,
    conditions?: TriggerCondition[]
  ): boolean {
    if (!conditions) return true;
    return this.evaluateTriggerConditions(execution, conditions);
  }

  /**
   * Subscribe to event source
   */
  private subscribeToEventSource(
    source: string,
    eventType: string,
    listener: EventListener
  ): void {
    // This would connect to external event sources like:
    // - Message queues (RabbitMQ, Kafka)
    // - Cloud events (AWS EventBridge, Azure Event Grid)
    // - Database change streams
    // - Custom event emitters

    this.logger.info(`Subscribed to event source: ${source}:${eventType}`);
  }

  /**
   * Compare values using operator
   */
  private compareValues(actual: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'eq':
        return actual === expected;
      case 'ne':
        return actual !== expected;
      case 'gt':
        return actual > expected;
      case 'lt':
        return actual < expected;
      case 'gte':
        return actual >= expected;
      case 'lte':
        return actual <= expected;
      case 'contains':
        return String(actual).includes(String(expected));
      case 'matches':
        return new RegExp(expected).test(String(actual));
      case 'exists':
        return actual !== undefined && actual !== null;
      default:
        return false;
    }
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Enable a trigger
   */
  enableTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId);
    if (trigger) {
      trigger.enabled = true;
      const [workflowId] = triggerId.split(':');
      this.activateTrigger(workflowId, trigger);
      this.logger.info(`Trigger enabled: ${triggerId}`);
    }
  }

  /**
   * Disable a trigger
   */
  disableTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId);
    if (trigger) {
      trigger.enabled = false;
      this.deactivateTrigger(triggerId);
      this.logger.info(`Trigger disabled: ${triggerId}`);
    }
  }

  /**
   * Deactivate a trigger and clean up resources
   */
  private deactivateTrigger(triggerId: string): void {
    // Clean up cron jobs
    const cronJob = this.cronJobs.get(triggerId);
    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(triggerId);
    }

    // Clean up file watchers
    const watcher = this.fileWatchers.get(triggerId);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(triggerId);
    }

    // Clean up condition checkers
    const checker = this.conditionCheckers.get(triggerId);
    if (checker) {
      clearInterval(checker);
      this.conditionCheckers.delete(triggerId);
    }

    // Clean up event listeners
    for (const [listenerId, listener] of this.eventListeners.entries()) {
      if (listenerId.startsWith(triggerId)) {
        this.eventListeners.delete(listenerId);
      }
    }
  }

  /**
   * Remove a trigger
   */
  removeTrigger(triggerId: string): void {
    this.deactivateTrigger(triggerId);
    this.triggers.delete(triggerId);
    this.triggerExecutions.delete(triggerId);
    this.triggerMetrics.delete(triggerId);
    this.logger.info(`Trigger removed: ${triggerId}`);
  }

  /**
   * Get trigger metrics
   */
  getTriggerMetrics(triggerId: string): TriggerMetrics | undefined {
    return this.triggerMetrics.get(triggerId);
  }

  /**
   * Get all trigger metrics
   */
  getAllTriggerMetrics(): Map<string, TriggerMetrics> {
    return this.triggerMetrics;
  }

  /**
   * Get trigger execution history
   */
  getTriggerExecutions(triggerId: string, limit?: number): TriggerExecution[] {
    const executions = this.triggerExecutions.get(triggerId) || [];
    return limit ? executions.slice(-limit) : executions;
  }

  /**
   * Get all triggers
   */
  getAllTriggers(): WorkflowTrigger[] {
    return Array.from(this.triggers.values());
  }

  /**
   * Manually trigger a workflow (for testing)
   */
  async manualTrigger(workflowId: string, data?: any): Promise<string> {
    return await this.workflowEngine.executeWorkflow(
      workflowId,
      {
        environment: 'manual',
        user: 'manual',
        inputs: data || {},
        metadata: { triggerId: 'manual', triggerType: 'manual' },
      },
      data
    );
  }

  /**
   * Clean up old trigger executions
   */
  cleanup(olderThanHours: number = 168): void {
    // Default: 1 week
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;

    for (const [triggerId, executions] of this.triggerExecutions.entries()) {
      const filtered = executions.filter(
        (exec) => exec.timestamp.getTime() > cutoff
      );
      this.triggerExecutions.set(triggerId, filtered);
    }

    this.logger.info(
      `Cleaned up trigger executions older than ${olderThanHours} hours`
    );
  }

  /**
   * Shutdown trigger manager and clean up all resources
   */
  shutdown(): void {
    // Stop all cron jobs
    for (const job of this.cronJobs.values()) {
      job.stop();
    }

    // Close all file watchers
    for (const watcher of this.fileWatchers.values()) {
      watcher.close();
    }

    // Clear all condition checkers
    for (const checker of this.conditionCheckers.values()) {
      clearInterval(checker);
    }

    // Close webhook server
    if (this.webhookServer) {
      this.webhookServer.close();
    }

    this.removeAllListeners();
    this.logger.info('Trigger manager shutdown completed');
  }
}

// Type for event listeners
type EventListener = (data: any) => Promise<void>;
