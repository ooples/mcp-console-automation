/**
 * Workflow Template Library
 * Pre-built templates for common automation scenarios
 */

import {
  WorkflowTemplate,
  WorkflowDefinition,
  TemplateParameter,
  TemplateExample
} from '../types/workflow.js';

export class WorkflowTemplateLibrary {
  private templates: Map<string, WorkflowTemplate>;

  constructor() {
    this.templates = new Map();
    this.registerBuiltInTemplates();
  }

  /**
   * Register built-in workflow templates
   */
  private registerBuiltInTemplates(): void {
    // Deployment pipeline templates
    this.registerTemplate(this.createCiCdPipelineTemplate());
    this.registerTemplate(this.createDockerDeploymentTemplate());
    this.registerTemplate(this.createKubernetesDeploymentTemplate());
    
    // Data processing templates
    this.registerTemplate(this.createDataBackupTemplate());
    this.registerTemplate(this.createDataSyncTemplate());
    this.registerTemplate(this.createEtlPipelineTemplate());
    
    // System maintenance templates
    this.registerTemplate(this.createSystemHealthCheckTemplate());
    this.registerTemplate(this.createLogRotationTemplate());
    this.registerTemplate(this.createDiskCleanupTemplate());
    
    // Incident response templates
    this.registerTemplate(this.createIncidentResponseTemplate());
    this.registerTemplate(this.createSecurityScanTemplate());
    this.registerTemplate(this.createAlertEscalationTemplate());
    
    // Development environment templates
    this.registerTemplate(this.createDevEnvSetupTemplate());
    this.registerTemplate(this.createTestingPipelineTemplate());
    this.registerTemplate(this.createCodeQualityCheckTemplate());
    
    // Monitoring and alerting templates
    this.registerTemplate(this.createPerformanceMonitoringTemplate());
    this.registerTemplate(this.createUptimeMonitoringTemplate());
    this.registerTemplate(this.createResourceUsageAlertTemplate());
    
    // Business process templates
    this.registerTemplate(this.createReportGenerationTemplate());
    this.registerTemplate(this.createDataValidationTemplate());
    this.registerTemplate(this.createFileProcessingTemplate());
  }

  /**
   * CI/CD Pipeline Template
   */
  private createCiCdPipelineTemplate(): WorkflowTemplate {
    return {
      id: 'cicd-pipeline',
      name: 'CI/CD Pipeline',
      description: 'Automated continuous integration and deployment pipeline',
      category: 'deployment',
      version: '1.0.0',
      definition: {
        id: '',
        name: 'CI/CD Pipeline',
        description: 'Build, test, and deploy application',
        version: '1.0.0',
        metadata: {
          category: 'deployment',
          environment: ['development', 'staging', 'production'],
          requiredPermissions: ['git.read', 'docker.build', 'deploy.execute'],
          estimatedDuration: 600000, // 10 minutes
          resourceRequirements: {
            cpu: '2 cores',
            memory: '4GB',
            disk: '10GB',
            network: true,
            services: ['docker', 'git']
          },
          dependencies: ['git-repo', 'docker-registry', 'deployment-target'],
          outputs: [
            { name: 'build_status', type: 'string', description: 'Build result status', required: true },
            { name: 'deployment_url', type: 'string', description: 'Deployed application URL', required: false }
          ]
        },
        triggers: [{
          id: 'git-push',
          type: 'webhook',
          name: 'Git Push Trigger',
          enabled: true,
          config: {
            webhook: {
              path: '/webhook/git-push',
              method: 'POST',
              authentication: { type: 'none', config: {} },
              validation: [
                { type: 'required', value: 'repository', message: 'Repository field required' },
                { type: 'required', value: 'ref', message: 'Git ref required' }
              ]
            }
          },
          conditions: [
            { field: 'ref', operator: 'matches', value: '^refs/heads/(main|master|develop)$', type: 'body' }
          ]
        }],
        variables: [
          { name: 'repository_url', type: 'string', required: true, description: 'Git repository URL' },
          { name: 'branch', type: 'string', defaultValue: 'main', required: false, description: 'Git branch to deploy' },
          { name: 'docker_registry', type: 'string', required: true, description: 'Docker registry URL' },
          { name: 'deployment_environment', type: 'string', defaultValue: 'staging', required: false, description: 'Target environment' }
        ],
        tasks: [
          {
            id: 'checkout-code',
            name: 'Checkout Code',
            type: 'command',
            description: 'Clone repository and checkout specific branch',
            dependsOn: [],
            executionMode: 'sequential',
            timeout: 60000,
            input: {
              command: 'git',
              args: ['clone', '--branch', '{{branch}}', '{{repository_url}}', './workspace']
            },
            metadata: {
              estimatedDuration: 30000,
              criticality: 'critical',
              category: 'source-control',
              tags: ['git', 'checkout']
            }
          },
          {
            id: 'install-dependencies',
            name: 'Install Dependencies',
            type: 'command',
            description: 'Install project dependencies',
            dependsOn: ['checkout-code'],
            executionMode: 'sequential',
            timeout: 300000,
            input: {
              command: 'npm',
              args: ['install'],
              variables: { cwd: './workspace' }
            },
            metadata: {
              estimatedDuration: 120000,
              criticality: 'high',
              category: 'build',
              tags: ['npm', 'dependencies']
            }
          },
          {
            id: 'run-tests',
            name: 'Run Tests',
            type: 'command',
            description: 'Execute test suite',
            dependsOn: ['install-dependencies'],
            executionMode: 'sequential',
            timeout: 300000,
            input: {
              command: 'npm',
              args: ['test'],
              variables: { cwd: './workspace' }
            },
            onFailure: [{
              type: 'send_notification',
              config: { 
                message: 'Test suite failed for {{repository_url}}',
                severity: 'error',
                channels: ['email', 'slack']
              }
            }],
            metadata: {
              estimatedDuration: 180000,
              criticality: 'critical',
              category: 'testing',
              tags: ['test', 'quality']
            }
          },
          {
            id: 'build-docker-image',
            name: 'Build Docker Image',
            type: 'command',
            description: 'Build Docker image for deployment',
            dependsOn: ['run-tests'],
            executionMode: 'sequential',
            timeout: 600000,
            input: {
              command: 'docker',
              args: ['build', '-t', '{{docker_registry}}/{{repository_name}}:{{branch}}-{{timestamp}}', '.'],
              variables: { 
                cwd: './workspace',
                timestamp: '${Date.now()}'
              }
            },
            output: {
              variables: {
                'image_tag': '{{docker_registry}}/{{repository_name}}:{{branch}}-{{timestamp}}'
              }
            },
            metadata: {
              estimatedDuration: 300000,
              criticality: 'high',
              category: 'build',
              tags: ['docker', 'build']
            }
          },
          {
            id: 'push-image',
            name: 'Push Docker Image',
            type: 'command',
            description: 'Push image to registry',
            dependsOn: ['build-docker-image'],
            executionMode: 'sequential',
            timeout: 300000,
            input: {
              command: 'docker',
              args: ['push', '{{image_tag}}']
            },
            metadata: {
              estimatedDuration: 120000,
              criticality: 'high',
              category: 'deployment',
              tags: ['docker', 'registry']
            }
          },
          {
            id: 'deploy-application',
            name: 'Deploy Application',
            type: 'api_call',
            description: 'Deploy to target environment',
            dependsOn: ['push-image'],
            executionMode: 'sequential',
            timeout: 300000,
            approval: {
              configId: 'deployment-approval',
              context: { 
                environment: '{{deployment_environment}}',
                image: '{{image_tag}}'
              }
            },
            input: {
              url: '{{deployment_api_url}}/deploy',
              method: 'POST',
              headers: {
                'Authorization': 'Bearer {{deployment_token}}',
                'Content-Type': 'application/json'
              },
              body: {
                image: '{{image_tag}}',
                environment: '{{deployment_environment}}'
              }
            },
            output: {
              variables: {
                'deployment_id': 'data.deployment_id',
                'deployment_url': 'data.url'
              }
            },
            onSuccess: [{
              type: 'send_notification',
              config: {
                message: 'Deployment successful: {{deployment_url}}',
                severity: 'info',
                channels: ['slack']
              }
            }],
            metadata: {
              estimatedDuration: 180000,
              criticality: 'critical',
              category: 'deployment',
              tags: ['deploy', 'api']
            }
          }
        ],
        dataFlow: {
          inputs: [
            {
              name: 'webhook_payload',
              type: 'object',
              source: { type: 'variable', config: { name: 'webhook_data' } },
              required: true
            }
          ],
          outputs: [
            {
              name: 'deployment_result',
              type: 'object',
              destination: { type: 'variable', config: { name: 'result' } }
            }
          ],
          transformations: [],
          validations: []
        },
        errorHandling: {
          global: {
            onError: 'notify_and_pause',
            retryPolicy: {
              maxAttempts: 2,
              backoff: 'exponential',
              initialDelay: 30000,
              maxDelay: 300000,
              multiplier: 2,
              conditions: []
            },
            notifications: [{
              id: 'pipeline-error',
              name: 'Pipeline Error Alert',
              channels: [{ type: 'email', config: { recipients: ['devops@company.com'] }, enabled: true }],
              conditions: [{ event: 'workflow_fail', severity: 'error' }],
              template: {
                subject: 'CI/CD Pipeline Failed',
                body: 'Pipeline failed for {{repository_url}} on branch {{branch}}',
                format: 'text'
              }
            }]
          },
          taskSpecific: {}
        },
        notifications: [],
        approvals: [{
          id: 'deployment-approval',
          name: 'Deployment Approval',
          type: 'conditional',
          required: true,
          approvers: [
            { type: 'role', identifier: 'release-manager', weight: 1 }
          ],
          timeout: 3600000, // 1 hour
          conditions: [
            { field: 'environment', operator: 'eq', value: 'production' }
          ]
        }],
        timeouts: {
          workflow: 1800000, // 30 minutes
          task: 600000, // 10 minutes
          approval: 3600000 // 1 hour
        },
        retryPolicy: {
          maxAttempts: 2,
          backoff: 'exponential',
          initialDelay: 30000,
          maxDelay: 300000,
          multiplier: 2,
          conditions: []
        },
        tags: ['cicd', 'deployment', 'automation'],
        created: new Date(),
        updated: new Date(),
        author: 'system'
      } as Partial<WorkflowDefinition>,
      parameters: [
        {
          name: 'repository_url',
          type: 'string',
          required: true,
          description: 'Git repository URL to build and deploy',
          validation: [
            { type: 'required', message: 'Repository URL is required' },
            { type: 'pattern', value: '^https?://.*\\.git$', message: 'Must be a valid Git repository URL' }
          ]
        },
        {
          name: 'docker_registry',
          type: 'string',
          required: true,
          description: 'Docker registry URL for storing built images'
        },
        {
          name: 'deployment_environment',
          type: 'string',
          required: false,
          defaultValue: 'staging',
          description: 'Target deployment environment (staging, production)'
        }
      ],
      examples: [
        {
          name: 'Node.js Application Deployment',
          description: 'Deploy a Node.js application to staging',
          parameters: {
            repository_url: 'https://github.com/company/app.git',
            docker_registry: 'registry.company.com',
            deployment_environment: 'staging'
          }
        }
      ],
      documentation: `
# CI/CD Pipeline Template

This template provides a complete continuous integration and deployment pipeline for applications.

## Features
- Git repository checkout
- Dependency installation
- Automated testing
- Docker image building and pushing
- Deployment with approval gates
- Comprehensive error handling and notifications

## Prerequisites
- Git access to repository
- Docker registry credentials
- Deployment API access
- Notification channels configured

## Customization
You can customize this template by:
- Modifying build commands for different tech stacks
- Adding additional testing stages
- Customizing deployment strategies
- Adding security scanning steps
      `,
      tags: ['cicd', 'deployment', 'docker', 'git'],
      author: 'Workflow Template Library',
      created: new Date()
    };
  }

  /**
   * System Health Check Template
   */
  private createSystemHealthCheckTemplate(): WorkflowTemplate {
    return {
      id: 'system-health-check',
      name: 'System Health Check',
      description: 'Comprehensive system health monitoring and alerting',
      category: 'monitoring',
      version: '1.0.0',
      definition: {
        id: '',
        name: 'System Health Check',
        description: 'Monitor system resources and services',
        version: '1.0.0',
        metadata: {
          category: 'monitoring',
          environment: ['production', 'staging'],
          requiredPermissions: ['system.read', 'service.status'],
          estimatedDuration: 120000, // 2 minutes
          resourceRequirements: {
            cpu: '0.5 cores',
            memory: '512MB',
            network: true
          },
          dependencies: ['system-tools'],
          outputs: [
            { name: 'health_status', type: 'object', description: 'Overall system health', required: true }
          ]
        },
        triggers: [{
          id: 'scheduled-check',
          type: 'schedule',
          name: 'Periodic Health Check',
          enabled: true,
          config: {
            schedule: {
              cron: '*/5 * * * *', // Every 5 minutes
              timezone: 'UTC'
            }
          }
        }],
        variables: [
          { name: 'cpu_threshold', type: 'number', defaultValue: 80, required: false, description: 'CPU usage alert threshold (%)' },
          { name: 'memory_threshold', type: 'number', defaultValue: 85, required: false, description: 'Memory usage alert threshold (%)' },
          { name: 'disk_threshold', type: 'number', defaultValue: 90, required: false, description: 'Disk usage alert threshold (%)' }
        ],
        tasks: [
          {
            id: 'check-cpu',
            name: 'Check CPU Usage',
            type: 'command',
            description: 'Monitor CPU utilization',
            dependsOn: [],
            executionMode: 'sequential',
            input: {
              command: 'top',
              args: ['-bn1'],
              variables: { parse_output: true }
            },
            output: {
              variables: {
                'cpu_usage': 'parseFloat(data.match(/Cpu\\(s\\):\\s*(\\d+\\.\\d+)%/)[1])'
              }
            },
            metadata: {
              criticality: 'high',
              category: 'monitoring',
              tags: ['cpu', 'performance']
            }
          }
          // Additional health check tasks would be defined here
        ],
        dataFlow: { inputs: [], outputs: [], transformations: [], validations: [] },
        errorHandling: {
          global: {
            onError: 'continue',
            notifications: []
          },
          taskSpecific: {}
        },
        notifications: [],
        approvals: [],
        timeouts: { workflow: 300000 },
        retryPolicy: { maxAttempts: 3, backoff: 'fixed', initialDelay: 10000, conditions: [] },
        tags: ['monitoring', 'health', 'system'],
        created: new Date(),
        updated: new Date(),
        author: 'system'
      } as Partial<WorkflowDefinition>,
      parameters: [
        {
          name: 'check_interval',
          type: 'string',
          required: false,
          defaultValue: '*/5 * * * *',
          description: 'Cron expression for check frequency'
        }
      ],
      examples: [
        {
          name: 'Standard Health Check',
          description: 'Monitor system every 5 minutes',
          parameters: {
            cpu_threshold: 80,
            memory_threshold: 85,
            disk_threshold: 90
          }
        }
      ],
      documentation: 'Automated system health monitoring with configurable thresholds and alerting.',
      tags: ['monitoring', 'health', 'automation'],
      author: 'Workflow Template Library',
      created: new Date()
    };
  }

  /**
   * Data Backup Template
   */
  private createDataBackupTemplate(): WorkflowTemplate {
    return {
      id: 'data-backup',
      name: 'Data Backup Pipeline',
      description: 'Automated data backup with compression and cloud storage',
      category: 'data',
      version: '1.0.0',
      definition: {
        id: '',
        name: 'Data Backup Pipeline',
        description: 'Backup critical data to cloud storage',
        version: '1.0.0',
        metadata: {
          category: 'data',
          environment: ['production'],
          requiredPermissions: ['file.read', 'cloud.write'],
          estimatedDuration: 1800000, // 30 minutes
          resourceRequirements: {
            disk: '20GB',
            network: true
          },
          dependencies: ['backup-tools', 'cloud-credentials'],
          outputs: []
        },
        triggers: [{
          id: 'daily-backup',
          type: 'schedule',
          name: 'Daily Backup',
          enabled: true,
          config: {
            schedule: {
              cron: '0 2 * * *', // Daily at 2 AM
              timezone: 'UTC'
            }
          }
        }],
        variables: [
          { name: 'backup_paths', type: 'array', required: true, description: 'Paths to backup' },
          { name: 'cloud_bucket', type: 'string', required: true, description: 'Cloud storage bucket' },
          { name: 'retention_days', type: 'number', defaultValue: 30, required: false, description: 'Backup retention period' }
        ],
        tasks: [],
        dataFlow: { inputs: [], outputs: [], transformations: [], validations: [] },
        errorHandling: { global: { onError: 'fail' }, taskSpecific: {} },
        notifications: [],
        approvals: [],
        timeouts: {},
        retryPolicy: { maxAttempts: 2, backoff: 'fixed', initialDelay: 60000, conditions: [] },
        tags: ['backup', 'data', 'cloud'],
        created: new Date(),
        updated: new Date(),
        author: 'system'
      } as Partial<WorkflowDefinition>,
      parameters: [
        {
          name: 'backup_paths',
          type: 'array',
          required: true,
          description: 'List of file/directory paths to backup'
        },
        {
          name: 'cloud_bucket',
          type: 'string',
          required: true,
          description: 'Cloud storage bucket for backups'
        }
      ],
      examples: [
        {
          name: 'Database Backup',
          description: 'Daily backup of database files',
          parameters: {
            backup_paths: ['/var/lib/mysql', '/var/lib/postgresql'],
            cloud_bucket: 'company-backups'
          }
        }
      ],
      documentation: 'Automated backup solution with cloud storage integration.',
      tags: ['backup', 'data', 'automation'],
      author: 'Workflow Template Library',
      created: new Date()
    };
  }

  // Additional template creation methods would follow similar patterns...
  private createDockerDeploymentTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createKubernetesDeploymentTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createDataSyncTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createEtlPipelineTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createLogRotationTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createDiskCleanupTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createIncidentResponseTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createSecurityScanTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createAlertEscalationTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createDevEnvSetupTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createTestingPipelineTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createCodeQualityCheckTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createPerformanceMonitoringTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createUptimeMonitoringTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createResourceUsageAlertTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createReportGenerationTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createDataValidationTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }
  private createFileProcessingTemplate(): WorkflowTemplate { /* Implementation */ return {} as WorkflowTemplate; }

  /**
   * Register a workflow template
   */
  registerTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Get a template by ID
   */
  getTemplate(templateId: string): WorkflowTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * Get all templates
   */
  getAllTemplates(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: string): WorkflowTemplate[] {
    return Array.from(this.templates.values())
      .filter(template => template.category === category);
  }

  /**
   * Search templates by tags
   */
  searchTemplatesByTags(tags: string[]): WorkflowTemplate[] {
    return Array.from(this.templates.values())
      .filter(template => 
        tags.some(tag => template.tags.includes(tag))
      );
  }

  /**
   * Generate workflow definition from template
   */
  generateWorkflowFromTemplate(
    templateId: string,
    parameters: Record<string, any>,
    customizations?: Partial<WorkflowDefinition>
  ): WorkflowDefinition {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Validate parameters
    this.validateTemplateParameters(template, parameters);

    // Generate workflow definition
    const definition = this.interpolateTemplate(template.definition, parameters);
    
    // Apply customizations
    if (customizations) {
      Object.assign(definition, customizations);
    }

    // Set required fields
    definition.id = `${templateId}-${Date.now()}`;
    definition.name = definition.name || template.name;
    definition.description = definition.description || template.description;
    definition.version = definition.version || template.version;
    definition.created = new Date();
    definition.updated = new Date();

    return definition as WorkflowDefinition;
  }

  /**
   * Validate template parameters
   */
  private validateTemplateParameters(
    template: WorkflowTemplate,
    parameters: Record<string, any>
  ): void {
    for (const param of template.parameters) {
      const value = parameters[param.name];

      if (param.required && (value === undefined || value === null)) {
        throw new Error(`Required parameter missing: ${param.name}`);
      }

      if (value !== undefined && param.validation) {
        for (const rule of param.validation) {
          if (!this.validateParameterValue(value, rule)) {
            throw new Error(`Parameter validation failed for ${param.name}: ${rule.message || 'Validation error'}`);
          }
        }
      }
    }
  }

  /**
   * Validate parameter value against rule
   */
  private validateParameterValue(value: any, rule: any): boolean {
    switch (rule.type) {
      case 'required':
        return value !== undefined && value !== null && value !== '';
      case 'type':
        return typeof value === rule.value;
      case 'pattern':
        return typeof value === 'string' && new RegExp(rule.value).test(value);
      case 'range':
        return typeof value === 'number' && value >= rule.value[0] && value <= rule.value[1];
      default:
        return true;
    }
  }

  /**
   * Interpolate template with parameters
   */
  private interpolateTemplate(
    template: Partial<WorkflowDefinition>,
    parameters: Record<string, any>
  ): Partial<WorkflowDefinition> {
    const templateStr = JSON.stringify(template);
    const interpolated = templateStr.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return parameters[key] !== undefined ? JSON.stringify(parameters[key]) : match;
    });
    
    return JSON.parse(interpolated);
  }

  /**
   * Export template as JSON
   */
  exportTemplate(templateId: string): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return JSON.stringify(template, null, 2);
  }

  /**
   * Import template from JSON
   */
  importTemplate(templateJson: string): void {
    try {
      const template = JSON.parse(templateJson) as WorkflowTemplate;
      this.registerTemplate(template);
    } catch (error: any) {
      throw new Error(`Failed to import template: ${error.message}`);
    }
  }

  /**
   * Get template categories
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const template of this.templates.values()) {
      categories.add(template.category);
    }
    return Array.from(categories);
  }

  /**
   * Get all template tags
   */
  getAllTags(): string[] {
    const tags = new Set<string>();
    for (const template of this.templates.values()) {
      template.tags.forEach(tag => tags.add(tag));
    }
    return Array.from(tags);
  }
}