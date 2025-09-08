/**
 * Enterprise Types and Interfaces for Console Automation MCP
 * Provides type definitions for enterprise-grade features
 */

// Role-Based Access Control Types
export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  inherits?: string[]; // Role inheritance
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  isSystem: boolean;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
  constraints?: ResourceConstraint[];
  description: string;
}

export interface ResourceConstraint {
  type: 'regex' | 'exact' | 'prefix' | 'suffix' | 'contains';
  field: string; // e.g., 'command', 'cwd', 'env.VAR_NAME'
  value: string;
  negate?: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  roles: string[];
  teams: string[];
  isActive: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
  attributes?: Record<string, any>; // For SSO attributes
}

export interface Team {
  id: string;
  name: string;
  description: string;
  members: string[];
  roles: string[];
  parentTeam?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Authentication & SSO Types
export interface SSOProvider {
  type: 'oidc' | 'saml' | 'ldap';
  name: string;
  config: OIDCConfig | SAMLConfig | LDAPConfig;
  isDefault: boolean;
}

export interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  additionalParams?: Record<string, string>;
}

export interface SAMLConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
  signatureAlgorithm: string;
  attributeMappings: Record<string, string>;
}

export interface LDAPConfig {
  url: string;
  bindDN: string;
  bindPassword: string;
  baseDN: string;
  searchFilter: string;
  attributes: Record<string, string>;
}

// Audit and Compliance Types
export interface AuditEvent {
  id: string;
  timestamp: Date;
  userId: string;
  sessionId?: string;
  action: string;
  resource: string;
  details: Record<string, any>;
  outcome: 'success' | 'failure' | 'warning';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  ipAddress: string;
  userAgent?: string;
  correlationId?: string;
  complianceFlags?: string[];
}

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  standard: 'SOC2' | 'HIPAA' | 'PCI-DSS' | 'ISO27001' | 'CUSTOM';
  type: 'preventive' | 'detective' | 'corrective';
  severity: 'low' | 'medium' | 'high' | 'critical';
  conditions: ComplianceCondition[];
  actions: ComplianceAction[];
  isActive: boolean;
}

export interface ComplianceCondition {
  field: string;
  operator: 'equals' | 'contains' | 'regex' | 'gt' | 'lt' | 'in';
  value: any;
  negate?: boolean;
}

export interface ComplianceAction {
  type: 'block' | 'warn' | 'log' | 'notify' | 'quarantine';
  config: Record<string, any>;
}

// Change Management Types
export interface ChangeRequest {
  id: string;
  title: string;
  description: string;
  requester: string;
  type: 'standard' | 'normal' | 'emergency';
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  implementationPlan: string;
  rollbackPlan: string;
  testPlan?: string;
  businessJustification: string;
  affectedSystems: string[];
  scheduledStart?: Date;
  scheduledEnd?: Date;
  actualStart?: Date;
  actualEnd?: Date;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'in_progress' | 'completed' | 'failed' | 'rolled_back';
  approvals: Approval[];
  reviews: Review[];
  attachments: Attachment[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Approval {
  id: string;
  approverId: string;
  status: 'pending' | 'approved' | 'rejected';
  comments?: string;
  timestamp?: Date;
  level: number; // Approval hierarchy level
}

export interface Review {
  id: string;
  reviewerId: string;
  type: 'technical' | 'security' | 'business' | 'compliance';
  status: 'pending' | 'approved' | 'rejected' | 'needs_info';
  comments: string;
  timestamp: Date;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: Date;
  url: string;
}

// Secret Management Types
export interface SecretProvider {
  type: 'vault' | 'aws-secrets' | 'azure-keyvault' | 'gcp-secret-manager';
  name: string;
  config: VaultConfig | AWSSecretsConfig | AzureKeyVaultConfig | GCPSecretConfig;
  priority: number; // For fallback ordering
}

export interface VaultConfig {
  address: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  mountPoint: string;
  namespace?: string;
  tlsConfig?: TLSConfig;
}

export interface AWSSecretsConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  roleArn?: string;
  kmsKeyId?: string;
}

export interface AzureKeyVaultConfig {
  vaultUrl: string;
  tenantId: string;
  clientId?: string;
  clientSecret?: string;
  certificate?: string;
}

export interface GCPSecretConfig {
  projectId: string;
  keyFilename?: string;
  credentials?: Record<string, any>;
}

export interface TLSConfig {
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  skipVerify?: boolean;
}

// Integration Types
export interface Integration {
  type: 'jira' | 'servicenow' | 'slack' | 'teams' | 'pagerduty' | 'webhook';
  name: string;
  config: IntegrationConfig;
  isActive: boolean;
  triggers: IntegrationTrigger[];
}

export interface IntegrationConfig {
  baseUrl?: string;
  username?: string;
  password?: string;
  token?: string;
  webhookUrl?: string;
  customHeaders?: Record<string, string>;
  customFields?: Record<string, any>;
}

export interface IntegrationTrigger {
  event: string; // e.g., 'session_created', 'error_detected', 'compliance_violation'
  conditions?: Record<string, any>;
  template: string; // Message template
}

// Enterprise Session Types
export interface EnterpriseConsoleSession extends ConsoleSession {
  userId: string;
  teamId?: string;
  changeRequestId?: string;
  approvedBy?: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  complianceFlags: string[];
  encryptionEnabled: boolean;
  recordingEnabled: boolean;
  maxDuration?: number;
  allowedCommands?: string[];
  restrictedPaths?: string[];
  requiredApprovals?: number;
  businessJustification?: string;
  tags: Record<string, string>;
}

// Governance Types
export interface GovernancePolicy {
  id: string;
  name: string;
  description: string;
  type: 'access' | 'usage' | 'security' | 'compliance';
  scope: 'global' | 'team' | 'user' | 'resource';
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  exceptions?: PolicyException[];
  isActive: boolean;
  effectiveDate: Date;
  expiryDate?: Date;
  createdBy: string;
  approvedBy: string[];
}

export interface PolicyCondition {
  type: 'user' | 'team' | 'role' | 'time' | 'location' | 'resource';
  operator: 'equals' | 'in' | 'matches' | 'between';
  value: any;
}

export interface PolicyAction {
  type: 'allow' | 'deny' | 'require_approval' | 'log' | 'notify';
  parameters?: Record<string, any>;
}

export interface PolicyException {
  id: string;
  reason: string;
  grantedBy: string;
  expiryDate: Date;
  conditions?: PolicyCondition[];
}

// Disaster Recovery Types
export interface BackupConfig {
  enabled: boolean;
  schedule: string; // Cron expression
  retention: RetentionPolicy;
  destinations: BackupDestination[];
  encryption: EncryptionConfig;
  compression: boolean;
}

export interface RetentionPolicy {
  daily: number; // Days to keep daily backups
  weekly: number; // Weeks to keep weekly backups
  monthly: number; // Months to keep monthly backups
  yearly: number; // Years to keep yearly backups
}

export interface BackupDestination {
  type: 's3' | 'azure-blob' | 'gcs' | 'local' | 'nfs';
  config: Record<string, any>;
  isActive: boolean;
  priority: number;
}

export interface EncryptionConfig {
  enabled: boolean;
  algorithm: 'AES-256' | 'ChaCha20-Poly1305';
  keyProvider: 'local' | 'vault' | 'aws-kms' | 'azure-keyvault';
  keyId?: string;
}

// Monitoring and Alerting Types
export interface AlertRule {
  id: string;
  name: string;
  description: string;
  type: 'threshold' | 'anomaly' | 'pattern';
  metric: string;
  conditions: AlertCondition[];
  actions: AlertAction[];
  isActive: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  cooldown: number; // Minutes between alerts
}

export interface AlertCondition {
  operator: 'gt' | 'lt' | 'eq' | 'ne' | 'contains' | 'matches';
  value: any;
  duration?: number; // Minutes condition must be true
}

export interface AlertAction {
  type: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'log';
  config: Record<string, any>;
  delay?: number; // Minutes to delay action
}

// Configuration Types
export interface EnterpriseConfig {
  rbac: RBACConfig;
  sso: SSOConfig;
  audit: AuditConfig;
  compliance: ComplianceConfig;
  secrets: SecretsConfig;
  changeManagement: ChangeManagementConfig;
  integrations: IntegrationsConfig;
  governance: GovernanceConfig;
  backup: BackupConfig;
  monitoring: MonitoringConfig;
}

export interface RBACConfig {
  enabled: boolean;
  defaultRole: string;
  inheritanceEnabled: boolean;
  cacheTimeout: number;
  adminUsers: string[];
}

export interface SSOConfig {
  enabled: boolean;
  providers: SSOProvider[];
  fallbackToLocal: boolean;
  sessionTimeout: number;
  multiFactorRequired: boolean;
}

export interface AuditConfig {
  enabled: boolean;
  retentionDays: number;
  destinations: string[];
  encryptionEnabled: boolean;
  tamperProtection: boolean;
  realTimeAnalysis: boolean;
}

export interface ComplianceConfig {
  enabled: boolean;
  standards: string[];
  rules: ComplianceRule[];
  reportingSchedule: string;
  autoRemediation: boolean;
}

export interface SecretsConfig {
  enabled: boolean;
  providers: SecretProvider[];
  cacheTimeout: number;
  rotationEnabled: boolean;
  auditAccess: boolean;
}

export interface ChangeManagementConfig {
  enabled: boolean;
  defaultApprovers: string[];
  emergencyBypass: boolean;
  integrationEnabled: boolean;
  notificationChannels: string[];
}

export interface IntegrationsConfig {
  enabled: boolean;
  integrations: Integration[];
  retryAttempts: number;
  timeout: number;
}

export interface GovernanceConfig {
  enabled: boolean;
  policies: GovernancePolicy[];
  enforcementMode: 'advisory' | 'enforcing';
  appealProcess: boolean;
}

export interface MonitoringConfig {
  enabled: boolean;
  metricsRetention: number;
  alertRules: AlertRule[];
  dashboardEnabled: boolean;
  exporters: string[];
}

// API Response Types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
  requestId: string;
}

export interface PaginatedResponse<T> extends APIResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Import existing types
export * from '../types/index.js';