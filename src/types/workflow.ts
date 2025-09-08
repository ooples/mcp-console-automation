/**
 * Comprehensive Workflow Automation Types
 * Defines the structure for advanced automation capabilities
 */

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'awaiting_approval';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'retrying';
export type TriggerType = 'manual' | 'schedule' | 'event' | 'webhook' | 'file_watch' | 'condition' | 'dependency';
export type ExecutionMode = 'sequential' | 'parallel' | 'mixed';
export type ApprovalType = 'manual' | 'automatic' | 'conditional';

// Core workflow definition interfaces
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  metadata: WorkflowMetadata;
  triggers: WorkflowTrigger[];
  variables: WorkflowVariable[];
  tasks: WorkflowTask[];
  dataFlow: DataFlowDefinition;
  errorHandling: ErrorHandlingStrategy;
  notifications: NotificationConfig[];
  approvals: ApprovalConfig[];
  timeouts: TimeoutConfig;
  retryPolicy: RetryPolicy;
  tags: string[];
  created: Date;
  updated: Date;
  author: string;
}

export interface WorkflowMetadata {
  category: string;
  environment: string[];
  requiredPermissions: string[];
  estimatedDuration: number;
  resourceRequirements: ResourceRequirements;
  dependencies: string[];
  outputs: WorkflowOutput[];
}

export interface ResourceRequirements {
  cpu?: string;
  memory?: string;
  disk?: string;
  network?: boolean;
  services?: string[];
}

export interface WorkflowOutput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file';
  description: string;
  required: boolean;
}

// Task definition and execution
export interface WorkflowTask {
  id: string;
  name: string;
  type: TaskType;
  description?: string;
  dependsOn: string[];
  condition?: TaskCondition;
  executionMode: ExecutionMode;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  rollbackStrategy?: RollbackStrategy;
  input: TaskInput;
  output?: TaskOutput;
  onSuccess?: TaskAction[];
  onFailure?: TaskAction[];
  approval?: ApprovalRequirement;
  parallel?: ParallelExecution;
  loop?: LoopConfiguration;
  metadata: TaskMetadata;
}

export type TaskType = 
  | 'command' 
  | 'script' 
  | 'api_call' 
  | 'file_operation' 
  | 'database' 
  | 'email' 
  | 'notification' 
  | 'condition' 
  | 'wait' 
  | 'parallel_group' 
  | 'subworkflow'
  | 'data_transform'
  | 'validation'
  | 'deployment'
  | 'monitoring'
  | 'backup'
  | 'restore';

export interface TaskCondition {
  type: 'expression' | 'script' | 'previous_task' | 'variable' | 'external';
  expression?: string;
  script?: string;
  variables?: string[];
  operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'matches' | 'exists';
  value?: any;
}

export interface TaskInput {
  command?: string;
  args?: string[];
  script?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  files?: FileOperation[];
  database?: DatabaseOperation;
  variables?: Record<string, any>;
  templates?: Record<string, string>;
}

export interface TaskOutput {
  variables?: Record<string, string>;
  files?: string[];
  artifacts?: Artifact[];
  metrics?: Metric[];
}

export interface TaskAction {
  type: 'set_variable' | 'call_webhook' | 'send_notification' | 'trigger_workflow' | 'rollback';
  config: any;
}

export interface TaskMetadata {
  estimatedDuration?: number;
  criticality: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  tags: string[];
}

// Parallel execution configuration
export interface ParallelExecution {
  maxConcurrency: number;
  failFast: boolean;
  collectResults: boolean;
  aggregationStrategy: 'merge' | 'array' | 'first' | 'last';
}

// Loop configuration for iterative tasks
export interface LoopConfiguration {
  type: 'for' | 'while' | 'foreach';
  iterations?: number;
  condition?: TaskCondition;
  items?: string; // Variable name containing array
  maxIterations: number;
  breakCondition?: TaskCondition;
}

// Trigger definitions
export interface WorkflowTrigger {
  id: string;
  type: TriggerType;
  name: string;
  enabled: boolean;
  config: TriggerConfig;
  conditions?: TriggerCondition[];
}

export interface TriggerConfig {
  schedule?: ScheduleConfig;
  events?: EventConfig[];
  webhook?: WebhookConfig;
  fileWatch?: FileWatchConfig;
  condition?: ConditionConfig;
}

export interface ScheduleConfig {
  cron: string;
  timezone: string;
  startDate?: Date;
  endDate?: Date;
  maxRuns?: number;
}

export interface EventConfig {
  source: string;
  type: string;
  filters?: Record<string, any>;
}

export interface WebhookConfig {
  path: string;
  method: string;
  authentication?: AuthConfig;
  validation?: ValidationRule[];
}

export interface FileWatchConfig {
  paths: string[];
  patterns: string[];
  events: ('create' | 'modify' | 'delete' | 'move')[];
  recursive: boolean;
  debounce?: number;
}

export interface ConditionConfig {
  expression: string;
  checkInterval: number;
  maxChecks?: number;
}

export interface TriggerCondition {
  field: string;
  operator: string;
  value: any;
  type: 'header' | 'body' | 'query' | 'path' | 'environment';
}

// Data flow and pipeline definitions
export interface DataFlowDefinition {
  inputs: DataInput[];
  outputs: DataOutput[];
  transformations: DataTransformation[];
  validations: DataValidation[];
}

export interface DataInput {
  name: string;
  type: string;
  source: DataSource;
  schema?: object;
  required: boolean;
  defaultValue?: any;
}

export interface DataOutput {
  name: string;
  type: string;
  destination: DataDestination;
  format?: string;
  schema?: object;
}

export interface DataSource {
  type: 'variable' | 'file' | 'api' | 'database' | 'environment' | 'user_input';
  config: any;
}

export interface DataDestination {
  type: 'variable' | 'file' | 'api' | 'database' | 'notification';
  config: any;
}

export interface DataTransformation {
  id: string;
  type: 'map' | 'filter' | 'reduce' | 'merge' | 'split' | 'validate' | 'format' | 'encrypt';
  config: any;
  input: string[];
  output: string;
}

export interface DataValidation {
  field: string;
  rules: ValidationRule[];
}

export interface ValidationRule {
  type: 'required' | 'type' | 'range' | 'pattern' | 'custom';
  value?: any;
  message?: string;
}

// State machine for complex workflows
export interface StateMachine {
  id: string;
  name: string;
  initialState: string;
  states: State[];
  transitions: Transition[];
  context: Record<string, any>;
}

export interface State {
  id: string;
  name: string;
  type: 'initial' | 'intermediate' | 'final' | 'error';
  onEntry?: StateAction[];
  onExit?: StateAction[];
  tasks?: string[]; // Task IDs to execute in this state
  timeout?: number;
}

export interface Transition {
  id: string;
  from: string;
  to: string;
  condition?: TaskCondition;
  actions?: StateAction[];
  guards?: Guard[];
}

export interface StateAction {
  type: 'set_variable' | 'call_task' | 'send_event' | 'log' | 'notify';
  config: any;
}

export interface Guard {
  expression: string;
  message?: string;
}

// Approval and human interaction
export interface ApprovalConfig {
  id: string;
  name: string;
  type: ApprovalType;
  required: boolean;
  approvers: Approver[];
  timeout?: number;
  escalation?: EscalationConfig;
  conditions?: ApprovalCondition[];
}

export interface ApprovalRequirement {
  configId: string;
  context?: Record<string, any>;
  skipConditions?: TaskCondition[];
}

export interface Approver {
  type: 'user' | 'group' | 'role' | 'external';
  identifier: string;
  weight?: number; // For weighted approvals
}

export interface EscalationConfig {
  levels: EscalationLevel[];
}

export interface EscalationLevel {
  delay: number;
  approvers: Approver[];
  actions?: StateAction[];
}

export interface ApprovalCondition {
  field: string;
  operator: string;
  value: any;
}

// Error handling and resilience
export interface ErrorHandlingStrategy {
  global: GlobalErrorHandling;
  taskSpecific: Record<string, TaskErrorHandling>;
}

export interface GlobalErrorHandling {
  onError: 'fail' | 'continue' | 'retry' | 'rollback' | 'notify_and_pause';
  retryPolicy?: RetryPolicy;
  notifications?: NotificationConfig[];
  rollback?: RollbackStrategy;
}

export interface TaskErrorHandling {
  onError: 'fail' | 'continue' | 'retry' | 'rollback' | 'skip';
  retryPolicy?: RetryPolicy;
  fallbackTask?: string;
  rollback?: RollbackStrategy;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: 'fixed' | 'exponential' | 'linear';
  initialDelay: number;
  maxDelay?: number;
  multiplier?: number;
  conditions?: RetryCondition[];
}

export interface RetryCondition {
  errorType?: string;
  errorMessage?: string;
  exitCode?: number;
  customCondition?: string;
}

export interface RollbackStrategy {
  type: 'task_based' | 'checkpoint' | 'full' | 'custom';
  steps?: RollbackStep[];
  timeout?: number;
}

export interface RollbackStep {
  taskId?: string;
  action: 'undo' | 'restore' | 'cleanup' | 'custom';
  config?: any;
}

// Notification and alerting
export interface NotificationConfig {
  id: string;
  name: string;
  channels: NotificationChannel[];
  conditions: NotificationCondition[];
  template: NotificationTemplate;
  throttling?: ThrottlingConfig;
}

export interface NotificationChannel {
  type: 'email' | 'slack' | 'teams' | 'webhook' | 'sms' | 'push';
  config: any;
  enabled: boolean;
}

export interface NotificationCondition {
  event: 'workflow_start' | 'workflow_complete' | 'workflow_fail' | 'task_fail' | 'approval_needed' | 'timeout';
  severity?: 'info' | 'warning' | 'error' | 'critical';
  customCondition?: string;
}

export interface NotificationTemplate {
  subject?: string;
  body: string;
  format: 'text' | 'html' | 'markdown';
  variables?: string[];
}

export interface ThrottlingConfig {
  maxNotifications: number;
  timeWindow: number;
  groupBy?: string[];
}

// Execution and runtime types
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  triggeredBy: ExecutionTrigger;
  context: ExecutionContext;
  tasks: TaskExecution[];
  approvals: ApprovalExecution[];
  variables: Record<string, any>;
  artifacts: Artifact[];
  metrics: ExecutionMetrics;
  logs: ExecutionLog[];
  errors: ExecutionError[];
}

export interface ExecutionTrigger {
  type: TriggerType;
  source: string;
  data?: any;
  timestamp: Date;
}

export interface ExecutionContext {
  environment: string;
  user?: string;
  inputs: Record<string, any>;
  metadata: Record<string, any>;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  status: TaskStatus;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  attempts: number;
  input: any;
  output?: any;
  sessionId?: string;
  pid?: number;
  exitCode?: number;
  error?: ExecutionError;
  metrics: TaskMetrics;
  logs: ExecutionLog[];
}

export interface ApprovalExecution {
  id: string;
  configId: string;
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  requestTime: Date;
  responseTime?: Date;
  approver?: string;
  comments?: string;
  context: any;
}

export interface ExecutionMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  avgTaskDuration: number;
  resourceUsage: ResourceUsage;
  performance: PerformanceMetrics;
}

export interface TaskMetrics {
  duration: number;
  memoryUsage: number;
  cpuUsage: number;
  diskIO: number;
  networkIO: number;
  outputSize: number;
}

export interface ResourceUsage {
  peakMemory: number;
  avgCpu: number;
  diskUsed: number;
  networkTraffic: number;
}

export interface PerformanceMetrics {
  queueTime: number;
  executionTime: number;
  waitTime: number;
  overhead: number;
}

export interface ExecutionLog {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  data?: any;
}

export interface ExecutionError {
  timestamp: Date;
  source: string;
  type: string;
  message: string;
  stack?: string;
  context?: any;
  recoverable: boolean;
}

// File operations and artifacts
export interface FileOperation {
  type: 'read' | 'write' | 'copy' | 'move' | 'delete' | 'compress' | 'extract' | 'sync';
  source?: string;
  destination?: string;
  options?: FileOptions;
}

export interface FileOptions {
  encoding?: string;
  mode?: string;
  recursive?: boolean;
  overwrite?: boolean;
  backup?: boolean;
}

export interface Artifact {
  id: string;
  name: string;
  type: 'file' | 'log' | 'report' | 'data' | 'image' | 'binary';
  path: string;
  size: number;
  created: Date;
  metadata: Record<string, any>;
}

// Database operations
export interface DatabaseOperation {
  type: 'query' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction';
  connection: string;
  sql?: string;
  parameters?: Record<string, any>;
  table?: string;
  data?: any;
  conditions?: Record<string, any>;
}

// Authentication and security
export interface AuthConfig {
  type: 'none' | 'basic' | 'bearer' | 'api_key' | 'oauth' | 'certificate';
  config: any;
}

export interface SecurityConfig {
  encryption?: EncryptionConfig;
  secrets?: SecretConfig[];
  permissions?: PermissionConfig[];
}

export interface EncryptionConfig {
  algorithm: string;
  key: string;
  fields: string[];
}

export interface SecretConfig {
  name: string;
  source: 'environment' | 'file' | 'vault' | 'database';
  config: any;
}

export interface PermissionConfig {
  resource: string;
  actions: string[];
  users?: string[];
  groups?: string[];
}

// Workflow variables
export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'secret';
  value?: any;
  defaultValue?: any;
  description?: string;
  required: boolean;
  source?: DataSource;
  validation?: ValidationRule[];
  sensitive?: boolean;
}

// Timeout configurations
export interface TimeoutConfig {
  workflow?: number;
  task?: number;
  approval?: number;
  notification?: number;
  global?: number;
}

// Metrics and monitoring
export interface Metric {
  name: string;
  value: number;
  unit?: string;
  timestamp: Date;
  labels?: Record<string, string>;
}

// Template definitions for common workflows
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  definition: Partial<WorkflowDefinition>;
  parameters: TemplateParameter[];
  examples: TemplateExample[];
  documentation: string;
  tags: string[];
  author: string;
  created: Date;
}

export interface TemplateParameter {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: any;
  description: string;
  validation?: ValidationRule[];
}

export interface TemplateExample {
  name: string;
  description: string;
  parameters: Record<string, any>;
  expectedOutput?: any;
}

// Workflow registry and versioning
export interface WorkflowRegistry {
  workflows: Map<string, WorkflowDefinition[]>;
  templates: Map<string, WorkflowTemplate>;
  executions: Map<string, WorkflowExecution>;
  schedules: Map<string, ScheduledWorkflow>;
}

export interface ScheduledWorkflow {
  id: string;
  workflowId: string;
  schedule: ScheduleConfig;
  lastRun?: Date;
  nextRun: Date;
  enabled: boolean;
  executions: string[];
}

// Integration with external systems
export interface ExternalIntegration {
  id: string;
  name: string;
  type: 'api' | 'database' | 'queue' | 'storage' | 'monitoring' | 'notification';
  config: IntegrationConfig;
  authentication: AuthConfig;
  healthCheck?: HealthCheckConfig;
}

export interface IntegrationConfig {
  endpoint?: string;
  connectionString?: string;
  settings: Record<string, any>;
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

export interface HealthCheckConfig {
  enabled: boolean;
  interval: number;
  timeout: number;
  endpoint?: string;
  expectedStatus?: number;
}