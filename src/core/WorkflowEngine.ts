/**
 * Advanced Workflow Orchestration Engine
 * Handles complex multi-step automation workflows with conditional execution,
 * parallel processing, and error handling
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import PQueue from 'p-queue';
import {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStatus,
  TaskExecution,
  TaskStatus,
  ExecutionContext,
  TaskCondition,
  StateMachine,
  State,
  Transition,
  ApprovalExecution,
  ExecutionError,
  ExecutionLog,
  WorkflowTask,
  ParallelExecution,
  LoopConfiguration,
  RetryPolicy,
} from '../types/workflow.js';
import { ConsoleManager } from './ConsoleManager.js';
import { Logger } from '../utils/logger.js';

export class WorkflowEngine extends EventEmitter {
  private executions: Map<string, WorkflowExecution>;
  private workflows: Map<string, WorkflowDefinition>;
  private stateMachines: Map<string, StateMachine>;
  private taskQueues: Map<string, PQueue>;
  private consoleManager: ConsoleManager;
  private logger: Logger;
  private approvalCallbacks: Map<
    string,
    (approved: boolean, comments?: string) => void
  >;

  constructor(consoleManager: ConsoleManager) {
    super();
    this.executions = new Map();
    this.workflows = new Map();
    this.stateMachines = new Map();
    this.taskQueues = new Map();
    this.consoleManager = consoleManager;
    this.logger = new Logger('WorkflowEngine');
    this.approvalCallbacks = new Map();
  }

  /**
   * Register a workflow definition
   */
  registerWorkflow(definition: WorkflowDefinition): void {
    this.workflows.set(definition.id, definition);
    this.logger.info(
      `Workflow registered: ${definition.name} (${definition.id})`
    );
    this.emit('workflow-registered', definition);
  }

  /**
   * Execute a workflow with given context
   */
  async executeWorkflow(
    workflowId: string,
    context: ExecutionContext,
    variables?: Record<string, any>
  ): Promise<string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const executionId = uuidv4();
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      status: 'pending',
      startTime: new Date(),
      triggeredBy: {
        type: 'manual',
        source: 'api',
        timestamp: new Date(),
      },
      context,
      tasks: [],
      approvals: [],
      variables: {
        ...workflow.variables.reduce(
          (acc, v) => ({ ...acc, [v.name]: v.defaultValue }),
          {}
        ),
        ...variables,
      },
      artifacts: [],
      metrics: {
        totalTasks: workflow.tasks.length,
        completedTasks: 0,
        failedTasks: 0,
        skippedTasks: 0,
        avgTaskDuration: 0,
        resourceUsage: {
          peakMemory: 0,
          avgCpu: 0,
          diskUsed: 0,
          networkTraffic: 0,
        },
        performance: {
          queueTime: 0,
          executionTime: 0,
          waitTime: 0,
          overhead: 0,
        },
      },
      logs: [],
      errors: [],
    };

    this.executions.set(executionId, execution);
    this.createTaskQueue(executionId);

    try {
      await this.startExecution(execution, workflow);
      return executionId;
    } catch (error: any) {
      await this.handleExecutionError(execution, error);
      throw error;
    }
  }

  /**
   * Start workflow execution
   */
  private async startExecution(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<void> {
    this.updateExecutionStatus(execution, 'running');
    this.addExecutionLog(
      execution,
      'info',
      'workflow',
      `Starting workflow: ${workflow.name}`
    );

    try {
      // Initialize workflow variables
      await this.initializeVariables(execution, workflow);

      // Check if workflow uses state machine
      if (workflow.metadata.dependencies?.includes('state-machine')) {
        await this.executeStateMachineWorkflow(execution, workflow);
      } else {
        await this.executeSequentialWorkflow(execution, workflow);
      }
    } catch (error: any) {
      await this.handleExecutionError(execution, error);
      throw error;
    }
  }

  /**
   * Execute workflow using state machine approach
   */
  private async executeStateMachineWorkflow(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const stateMachine = this.createStateMachine(workflow);
    this.stateMachines.set(execution.id, stateMachine);

    let currentState = stateMachine.states.find((s) => s.type === 'initial');
    if (!currentState) {
      throw new Error('No initial state found in state machine');
    }

    while (currentState && currentState.type !== 'final') {
      this.addExecutionLog(
        execution,
        'info',
        'state-machine',
        `Entering state: ${currentState.name}`
      );

      // Execute tasks in current state
      if (currentState.tasks) {
        await this.executeStateTasks(execution, workflow, currentState);
      }

      // Find next transition
      const transition = await this.findValidTransition(
        execution,
        stateMachine,
        currentState.id
      );
      if (!transition) {
        if (currentState.type === 'error') {
          throw new Error(
            `Workflow stuck in error state: ${currentState.name}`
          );
        }
        break;
      }

      // Execute transition actions
      if (transition.actions) {
        await this.executeTransitionActions(execution, transition.actions);
      }

      currentState = stateMachine.states.find((s) => s.id === transition.to);
    }

    this.updateExecutionStatus(execution, 'completed');
  }

  /**
   * Execute workflow sequentially with dependency resolution
   */
  private async executeSequentialWorkflow(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<void> {
    const taskGraph = this.buildTaskDependencyGraph(workflow.tasks);
    const readyTasks = this.getReadyTasks(taskGraph, new Set());
    const completedTasks = new Set<string>();

    while (readyTasks.length > 0 || this.hasPendingTasks(execution)) {
      // Execute ready tasks
      const taskPromises = readyTasks.map((task) =>
        this.executeTask(execution, workflow, task)
      );

      const results = await Promise.allSettled(taskPromises);

      // Process results
      for (let i = 0; i < results.length; i++) {
        const task = readyTasks[i];
        const result = results[i];

        if (result.status === 'fulfilled') {
          completedTasks.add(task.id);
          execution.metrics.completedTasks++;
        } else {
          execution.metrics.failedTasks++;
          await this.handleTaskError(execution, task, result.reason);

          if (workflow.errorHandling.global.onError === 'fail') {
            throw result.reason;
          }
        }
      }

      // Find new ready tasks
      readyTasks.length = 0;
      readyTasks.push(...this.getReadyTasks(taskGraph, completedTasks));

      // Check for deadlock
      if (
        readyTasks.length === 0 &&
        !this.allTasksCompleted(taskGraph, completedTasks)
      ) {
        throw new Error(
          'Workflow deadlock detected - circular dependencies or missing tasks'
        );
      }
    }

    this.updateExecutionStatus(execution, 'completed');
  }

  /**
   * Execute a single task with all its features
   */
  private async executeTask(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    task: WorkflowTask
  ): Promise<void> {
    const taskExecution: TaskExecution = {
      id: uuidv4(),
      taskId: task.id,
      status: 'pending',
      attempts: 0,
      input: task.input,
      metrics: {
        duration: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        diskIO: 0,
        networkIO: 0,
        outputSize: 0,
      },
      logs: [],
    };

    execution.tasks.push(taskExecution);
    this.emit('task-started', execution.id, taskExecution);

    try {
      // Check task condition
      if (
        task.condition &&
        !(await this.evaluateCondition(execution, task.condition))
      ) {
        taskExecution.status = 'skipped';
        execution.metrics.skippedTasks++;
        this.addExecutionLog(
          execution,
          'info',
          'task',
          `Task skipped: ${task.name} (condition not met)`
        );
        return;
      }

      // Handle approval requirement
      if (task.approval) {
        await this.handleTaskApproval(execution, task);
      }

      // Execute based on task type and execution mode
      taskExecution.status = 'running';
      taskExecution.startTime = new Date();

      if (task.executionMode === 'parallel' && task.parallel) {
        await this.executeParallelTask(
          execution,
          workflow,
          task,
          taskExecution
        );
      } else if (task.loop) {
        await this.executeLoopTask(execution, workflow, task, taskExecution);
      } else {
        await this.executeSingleTask(execution, workflow, task, taskExecution);
      }

      taskExecution.endTime = new Date();
      taskExecution.duration =
        taskExecution.endTime.getTime() - taskExecution.startTime!.getTime();
      taskExecution.status = 'completed';

      // Execute success actions
      if (task.onSuccess) {
        await this.executeTaskActions(execution, task.onSuccess);
      }
    } catch (error: any) {
      taskExecution.status = 'failed';
      taskExecution.error = {
        timestamp: new Date(),
        source: task.id,
        type: error.constructor.name,
        message: error.message,
        stack: error.stack,
        context: { taskId: task.id, input: task.input },
        recoverable: this.isRecoverableError(error),
      };

      // Handle retry logic
      const retryPolicy =
        task.retryPolicy || workflow.errorHandling.global.retryPolicy;
      if (retryPolicy && taskExecution.attempts < retryPolicy.maxAttempts) {
        await this.retryTask(
          execution,
          workflow,
          task,
          taskExecution,
          retryPolicy
        );
        return;
      }

      // Execute failure actions
      if (task.onFailure) {
        await this.executeTaskActions(execution, task.onFailure);
      }

      throw error;
    } finally {
      this.emit('task-completed', execution.id, taskExecution);
    }
  }

  /**
   * Execute parallel tasks with concurrency control
   */
  private async executeParallelTask(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<void> {
    if (!task.parallel) return;

    const queue = new PQueue({
      concurrency: task.parallel.maxConcurrency,
    });

    const subtasks = this.generateParallelSubtasks(task);
    const results: any[] = [];

    try {
      const promises = subtasks.map((subtask, index) =>
        queue.add(async () => {
          try {
            const result = await this.executeSingleTask(
              execution,
              workflow,
              subtask,
              taskExecution
            );
            results[index] = result;
            return result;
          } catch (error) {
            if (task.parallel!.failFast) {
              queue.clear();
              throw error;
            }
            results[index] = { error: error.message };
            return null;
          }
        })
      );

      await Promise.all(promises);

      // Aggregate results based on strategy
      taskExecution.output = this.aggregateParallelResults(
        results,
        task.parallel.aggregationStrategy
      );
    } finally {
      queue.clear();
    }
  }

  /**
   * Execute task with loop configuration
   */
  private async executeLoopTask(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<void> {
    if (!task.loop) return;

    const results: any[] = [];
    let iteration = 0;

    while (iteration < task.loop.maxIterations) {
      // Check loop condition
      if (
        task.loop.condition &&
        !(await this.evaluateCondition(execution, task.loop.condition))
      ) {
        break;
      }

      // Check break condition
      if (
        task.loop.breakCondition &&
        (await this.evaluateCondition(execution, task.loop.breakCondition))
      ) {
        break;
      }

      // Set loop variables
      if (task.loop.type === 'foreach' && task.loop.items) {
        const items = execution.variables[task.loop.items] as any[];
        if (!items || iteration >= items.length) break;
        execution.variables['loop_item'] = items[iteration];
      }

      execution.variables['loop_index'] = iteration;

      // Execute task iteration
      try {
        const result = await this.executeSingleTask(
          execution,
          workflow,
          task,
          taskExecution
        );
        results.push(result);
      } catch (error: any) {
        if (workflow.errorHandling.global.onError === 'fail') {
          throw error;
        }
        results.push({ error: error.message, iteration });
      }

      iteration++;

      // For 'for' loop, check iterations
      if (
        task.loop.type === 'for' &&
        task.loop.iterations &&
        iteration >= task.loop.iterations
      ) {
        break;
      }
    }

    taskExecution.output = { iterations: iteration, results };
  }

  /**
   * Execute a single task based on its type
   */
  private async executeSingleTask(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    const startTime = Date.now();

    try {
      let result: any;

      switch (task.type) {
        case 'command':
          result = await this.executeCommandTask(
            execution,
            task,
            taskExecution
          );
          break;
        case 'script':
          result = await this.executeScriptTask(execution, task, taskExecution);
          break;
        case 'api_call':
          result = await this.executeApiCallTask(
            execution,
            task,
            taskExecution
          );
          break;
        case 'file_operation':
          result = await this.executeFileOperationTask(
            execution,
            task,
            taskExecution
          );
          break;
        case 'condition':
          result = await this.executeConditionTask(
            execution,
            task,
            taskExecution
          );
          break;
        case 'wait':
          result = await this.executeWaitTask(execution, task, taskExecution);
          break;
        case 'notification':
          result = await this.executeNotificationTask(
            execution,
            task,
            taskExecution
          );
          break;
        case 'subworkflow':
          result = await this.executeSubworkflowTask(
            execution,
            task,
            taskExecution
          );
          break;
        default:
          throw new Error(`Unsupported task type: ${task.type}`);
      }

      // Update task output
      if (task.output && result) {
        if (task.output.variables) {
          Object.entries(task.output.variables).forEach(([key, expression]) => {
            execution.variables[key] = this.evaluateExpression(
              expression,
              result,
              execution.variables
            );
          });
        }
      }

      taskExecution.metrics.duration = Date.now() - startTime;
      return result;
    } catch (error: any) {
      taskExecution.metrics.duration = Date.now() - startTime;
      this.addExecutionLog(
        execution,
        'error',
        'task',
        `Task failed: ${task.name} - ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Execute command task using ConsoleManager
   */
  private async executeCommandTask(
    execution: WorkflowExecution,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    if (!task.input.command) {
      throw new Error('Command task requires command in input');
    }

    const command = this.interpolateVariables(
      task.input.command,
      execution.variables
    );
    const args = task.input.args?.map((arg) =>
      this.interpolateVariables(arg, execution.variables)
    );

    this.addExecutionLog(
      execution,
      'info',
      'task',
      `Executing command: ${command} ${args?.join(' ') || ''}`
    );

    try {
      const result = await this.consoleManager.executeCommand(command, args, {
        cwd: task.input.variables?.cwd as string,
        env: task.input.variables?.env as Record<string, string>,
        timeout: task.timeout,
        detectErrors: true,
      });

      taskExecution.output = result;
      taskExecution.exitCode = result.exitCode;

      return result;
    } catch (error: any) {
      throw new Error(`Command execution failed: ${error.message}`);
    }
  }

  /**
   * Execute API call task
   */
  private async executeApiCallTask(
    execution: WorkflowExecution,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    if (!task.input.url) {
      throw new Error('API call task requires URL in input');
    }

    const url = this.interpolateVariables(task.input.url, execution.variables);
    const method = task.input.method || 'GET';
    const headers = task.input.headers || {};
    const body = task.input.body;

    this.addExecutionLog(
      execution,
      'info',
      'task',
      `Making API call: ${method} ${url}`
    );

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      taskExecution.output = result;

      return result;
    } catch (error: any) {
      throw new Error(`API call failed: ${error.message}`);
    }
  }

  /**
   * Execute condition task
   */
  private async executeConditionTask(
    execution: WorkflowExecution,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    if (!task.condition) {
      throw new Error('Condition task requires condition configuration');
    }

    const result = await this.evaluateCondition(execution, task.condition);
    taskExecution.output = { result };

    this.addExecutionLog(
      execution,
      'info',
      'task',
      `Condition evaluated to: ${result}`
    );

    return { result };
  }

  /**
   * Execute wait task
   */
  private async executeWaitTask(
    execution: WorkflowExecution,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    const duration = (task.input.variables?.duration as number) || 1000;

    this.addExecutionLog(
      execution,
      'info',
      'task',
      `Waiting for ${duration}ms`
    );

    await new Promise((resolve) => setTimeout(resolve, duration));

    return { waited: duration };
  }

  /**
   * Execute notification task
   */
  private async executeNotificationTask(
    execution: WorkflowExecution,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    const message = this.interpolateVariables(
      (task.input.variables?.message as string) || 'Workflow notification',
      execution.variables
    );

    this.addExecutionLog(
      execution,
      'info',
      'task',
      `Sending notification: ${message}`
    );

    // Emit notification event
    this.emit('notification', {
      executionId: execution.id,
      taskId: task.id,
      message,
      timestamp: new Date(),
    });

    return { sent: true, message };
  }

  /**
   * Execute subworkflow task
   */
  private async executeSubworkflowTask(
    execution: WorkflowExecution,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    const subworkflowId = task.input.variables?.workflowId as string;
    if (!subworkflowId) {
      throw new Error('Subworkflow task requires workflowId');
    }

    this.addExecutionLog(
      execution,
      'info',
      'task',
      `Executing subworkflow: ${subworkflowId}`
    );

    const subExecutionId = await this.executeWorkflow(
      subworkflowId,
      { ...execution.context },
      task.input.variables as Record<string, any>
    );

    // Wait for completion
    const subExecution = await this.waitForExecution(subExecutionId);

    return {
      executionId: subExecutionId,
      status: subExecution.status,
      output: subExecution.variables,
    };
  }

  // ... Additional helper methods

  /**
   * Evaluate task condition
   */
  private async evaluateCondition(
    execution: WorkflowExecution,
    condition: TaskCondition
  ): Promise<boolean> {
    switch (condition.type) {
      case 'expression':
        return this.evaluateExpression(
          condition.expression!,
          null,
          execution.variables
        ) as boolean;

      case 'variable':
        const variable = execution.variables[condition.variables![0]];
        return this.compareValues(
          variable,
          condition.operator!,
          condition.value
        );

      case 'previous_task':
        const taskResult = execution.tasks.find(
          (t) => t.taskId === condition.variables![0]
        );
        return taskResult?.status === 'completed';

      default:
        return true;
    }
  }

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
   * Interpolate variables in string templates
   */
  private interpolateVariables(
    template: string,
    variables: Record<string, any>
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] ?? match;
    });
  }

  /**
   * Evaluate expression with context
   */
  private evaluateExpression(
    expression: string,
    data: any,
    variables: Record<string, any>
  ): any {
    // Simple expression evaluation - in production, use a proper expression engine
    try {
      const context = { ...variables, data };
      const func = new Function(
        ...Object.keys(context),
        `return ${expression}`
      );
      return func(...Object.values(context));
    } catch {
      return false;
    }
  }

  /**
   * Update execution status and emit events
   */
  private updateExecutionStatus(
    execution: WorkflowExecution,
    status: WorkflowStatus
  ): void {
    execution.status = status;
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled'
    ) {
      execution.endTime = new Date();
      execution.duration =
        execution.endTime.getTime() - execution.startTime.getTime();
    }
    this.emit('execution-status-changed', execution.id, status);
  }

  /**
   * Add execution log entry
   */
  private addExecutionLog(
    execution: WorkflowExecution,
    level: 'debug' | 'info' | 'warn' | 'error',
    source: string,
    message: string,
    data?: any
  ): void {
    const log: ExecutionLog = {
      timestamp: new Date(),
      level,
      source,
      message,
      data,
    };
    execution.logs.push(log);
    this.logger[level](`[${execution.id}] ${message}`, data);
  }

  /**
   * Execute task actions (onSuccess, onError, etc.)
   */
  private async executeTaskActions(
    execution: WorkflowExecution,
    actions: any[]
  ): Promise<void> {
    for (const action of actions) {
      this.addExecutionLog(
        execution,
        'info',
        'task-action',
        `Executing action: ${action.type || 'custom'}`
      );
      // Implementation would depend on action types defined in workflow
    }
  }

  // ... Additional utility methods for task queues, dependency graphs, approvals, etc.

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Cancel workflow execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    this.updateExecutionStatus(execution, 'cancelled');
    this.addExecutionLog(
      execution,
      'info',
      'workflow',
      'Workflow cancelled by user'
    );

    // Cancel running tasks
    const runningTasks = execution.tasks.filter((t) => t.status === 'running');
    for (const task of runningTasks) {
      if (task.sessionId) {
        await this.consoleManager.stopSession(task.sessionId);
      }
    }

    this.emit('execution-cancelled', executionId);
  }

  /**
   * Get all executions
   */
  getAllExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values());
  }

  /**
   * Clean up completed executions
   */
  cleanup(olderThanHours: number = 24): void {
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;

    Array.from(this.executions.entries()).forEach(([id, execution]) => {
      if (execution.endTime && execution.endTime.getTime() < cutoff) {
        this.executions.delete(id);
        this.taskQueues.delete(id);
        this.stateMachines.delete(id);
      }
    });
  }

  // Additional private helper methods would go here...
  private createTaskQueue(executionId: string): void {
    this.taskQueues.set(executionId, new PQueue({ concurrency: 5 }));
  }

  private async initializeVariables(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<void> {
    // Initialize workflow variables from definition
    for (const variable of workflow.variables) {
      if (!(variable.name in execution.variables)) {
        execution.variables[variable.name] = variable.defaultValue;
      }
    }
  }

  private buildTaskDependencyGraph(
    tasks: WorkflowTask[]
  ): Map<string, WorkflowTask> {
    return new Map(tasks.map((task) => [task.id, task]));
  }

  private getReadyTasks(
    taskGraph: Map<string, WorkflowTask>,
    completed: Set<string>
  ): WorkflowTask[] {
    const ready: WorkflowTask[] = [];

    Array.from(taskGraph.values()).forEach((task) => {
      const allDependenciesCompleted = task.dependsOn.every((dep) =>
        completed.has(dep)
      );
      if (allDependenciesCompleted && !completed.has(task.id)) {
        ready.push(task);
      }
    });

    return ready;
  }

  private hasPendingTasks(execution: WorkflowExecution): boolean {
    return execution.tasks.some(
      (t) => t.status === 'running' || t.status === 'pending'
    );
  }

  private allTasksCompleted(
    taskGraph: Map<string, WorkflowTask>,
    completed: Set<string>
  ): boolean {
    return taskGraph.size === completed.size;
  }

  private createStateMachine(workflow: WorkflowDefinition): StateMachine {
    // Create a basic state machine from workflow tasks
    // In practice, this would be more sophisticated
    return {
      id: workflow.id,
      name: workflow.name,
      initialState: 'start',
      states: [
        { id: 'start', name: 'Start', type: 'initial', tasks: [] },
        { id: 'end', name: 'End', type: 'final', tasks: [] },
      ],
      transitions: [
        { id: 'start-to-end', from: 'start', to: 'end', actions: [] },
      ],
      context: {},
    };
  }

  private async executeStateTasks(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    state: State
  ): Promise<void> {
    if (!state.tasks) return;

    for (const taskId of state.tasks) {
      const task = workflow.tasks.find((t) => t.id === taskId);
      if (task) {
        await this.executeTask(execution, workflow, task);
      }
    }
  }

  private async findValidTransition(
    execution: WorkflowExecution,
    stateMachine: StateMachine,
    currentStateId: string
  ): Promise<Transition | undefined> {
    const transitions = stateMachine.transitions.filter(
      (t) => t.from === currentStateId
    );

    for (const transition of transitions) {
      if (
        !transition.condition ||
        (await this.evaluateCondition(execution, transition.condition))
      ) {
        return transition;
      }
    }

    return undefined;
  }

  private async executeTransitionActions(
    execution: WorkflowExecution,
    actions: any[]
  ): Promise<void> {
    // Execute state transition actions
    for (const action of actions) {
      // Implementation depends on action types
      this.addExecutionLog(
        execution,
        'info',
        'state-machine',
        `Executing transition action: ${action.type}`
      );
    }
  }

  private async handleTaskError(
    execution: WorkflowExecution,
    task: WorkflowTask,
    error: any
  ): Promise<void> {
    const executionError: ExecutionError = {
      timestamp: new Date(),
      source: task.id,
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
      context: { taskId: task.id },
      recoverable: this.isRecoverableError(error),
    };

    execution.errors.push(executionError);
    this.addExecutionLog(
      execution,
      'error',
      'task',
      `Task error: ${task.name} - ${error.message}`
    );
  }

  private async handleExecutionError(
    execution: WorkflowExecution,
    error: any
  ): Promise<void> {
    this.updateExecutionStatus(execution, 'failed');
    this.addExecutionLog(
      execution,
      'error',
      'workflow',
      `Workflow failed: ${error.message}`
    );
  }

  private isRecoverableError(error: any): boolean {
    // Implement logic to determine if error is recoverable
    return error.code !== 'FATAL';
  }

  private generateParallelSubtasks(task: WorkflowTask): WorkflowTask[] {
    // Generate subtasks for parallel execution
    // This is a simplified implementation
    return [task]; // In practice, split task into parallel subtasks
  }

  private aggregateParallelResults(results: any[], strategy: string): any {
    switch (strategy) {
      case 'array':
        return results;
      case 'first':
        return results[0];
      case 'last':
        return results[results.length - 1];
      case 'merge':
        return Object.assign({}, ...results);
      default:
        return results;
    }
  }

  private async retryTask(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    task: WorkflowTask,
    taskExecution: TaskExecution,
    retryPolicy: RetryPolicy
  ): Promise<void> {
    taskExecution.attempts++;
    const delay = this.calculateRetryDelay(retryPolicy, taskExecution.attempts);

    this.addExecutionLog(
      execution,
      'info',
      'task',
      `Retrying task ${task.name} (attempt ${taskExecution.attempts}/${retryPolicy.maxAttempts}) after ${delay}ms`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    // Reset task status and retry
    taskExecution.status = 'running';
    await this.executeSingleTask(execution, workflow, task, taskExecution);
  }

  private calculateRetryDelay(policy: RetryPolicy, attempt: number): number {
    switch (policy.backoff) {
      case 'exponential':
        return Math.min(
          policy.initialDelay * Math.pow(policy.multiplier || 2, attempt - 1),
          policy.maxDelay || 30000
        );
      case 'linear':
        return Math.min(
          policy.initialDelay * attempt,
          policy.maxDelay || 30000
        );
      default:
        return policy.initialDelay;
    }
  }

  private async handleTaskApproval(
    execution: WorkflowExecution,
    task: WorkflowTask
  ): Promise<void> {
    if (!task.approval) return;

    const approvalExecution: ApprovalExecution = {
      id: uuidv4(),
      configId: task.approval.configId,
      status: 'pending',
      requestTime: new Date(),
      context: task.approval.context || {},
    };

    execution.approvals.push(approvalExecution);

    this.addExecutionLog(
      execution,
      'info',
      'approval',
      `Approval required for task: ${task.name}`
    );
    this.emit('approval-required', execution.id, approvalExecution);

    // Wait for approval
    return new Promise((resolve, reject) => {
      this.approvalCallbacks.set(
        approvalExecution.id,
        (approved: boolean, comments?: string) => {
          approvalExecution.status = approved ? 'approved' : 'rejected';
          approvalExecution.responseTime = new Date();
          approvalExecution.comments = comments;

          if (approved) {
            resolve();
          } else {
            reject(
              new Error(
                `Task approval rejected: ${comments || 'No comments provided'}`
              )
            );
          }
        }
      );
    });
  }

  private async executeFileOperationTask(
    execution: WorkflowExecution,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    // Implement file operations
    throw new Error('File operation task not implemented yet');
  }

  private async executeScriptTask(
    execution: WorkflowExecution,
    task: WorkflowTask,
    taskExecution: TaskExecution
  ): Promise<any> {
    // Implement script execution
    throw new Error('Script task not implemented yet');
  }

  private async waitForExecution(
    executionId: string
  ): Promise<WorkflowExecution> {
    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        const execution = this.executions.get(executionId);
        if (!execution) {
          reject(new Error(`Execution not found: ${executionId}`));
          return;
        }

        if (
          execution.status === 'completed' ||
          execution.status === 'failed' ||
          execution.status === 'cancelled'
        ) {
          resolve(execution);
        } else {
          setTimeout(checkStatus, 1000);
        }
      };

      checkStatus();
    });
  }

  /**
   * Approve a pending approval
   */
  approveTask(approvalId: string, approved: boolean, comments?: string): void {
    const callback = this.approvalCallbacks.get(approvalId);
    if (callback) {
      callback(approved, comments);
      this.approvalCallbacks.delete(approvalId);
    }
  }
}
