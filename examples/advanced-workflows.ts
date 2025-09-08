/**
 * Advanced Workflow Examples and Real-World Use Cases
 * Demonstrates complex automation scenarios using the enhanced MCP
 */

import { WorkflowEngine } from '../src/core/WorkflowEngine.js';
import { DataPipelineManager } from '../src/core/DataPipelineManager.js';
import { TriggerManager } from '../src/core/TriggerManager.js';
import { WorkflowTemplateLibrary } from '../src/templates/WorkflowTemplates.js';
import { ConsoleManager } from '../src/core/ConsoleManager.js';
import { WorkflowDefinition } from '../src/types/workflow.js';

/**
 * Example 1: Automated Deployment Pipeline with Rollback
 * Complete CI/CD workflow with automated testing, deployment, and rollback capabilities
 */
export async function createDeploymentPipeline(workflowEngine: WorkflowEngine): Promise<string> {
  const workflowDefinition: WorkflowDefinition = {
    id: 'production-deployment-pipeline',
    name: 'Production Deployment Pipeline',
    description: 'Automated deployment with testing, approval gates, and rollback capabilities',
    version: '2.0.0',
    metadata: {
      category: 'deployment',
      environment: ['staging', 'production'],
      requiredPermissions: ['git.read', 'docker.build', 'k8s.deploy', 'monitoring.read'],
      estimatedDuration: 900000, // 15 minutes
      resourceRequirements: {
        cpu: '4 cores',
        memory: '8GB',
        disk: '50GB',
        network: true,
        services: ['docker', 'kubectl', 'helm']
      },
      dependencies: ['git-repo', 'docker-registry', 'kubernetes-cluster', 'monitoring-system'],
      outputs: [
        { name: 'deployment_status', type: 'string', description: 'Final deployment status', required: true },
        { name: 'service_urls', type: 'array', description: 'Deployed service endpoints', required: true },
        { name: 'rollback_info', type: 'object', description: 'Rollback information if needed', required: false }
      ]
    },
    triggers: [
      {
        id: 'git-release-tag',
        type: 'webhook',
        name: 'Git Release Tag Trigger',
        enabled: true,
        config: {
          webhook: {
            path: '/webhook/release',
            method: 'POST',
            authentication: {
              type: 'bearer',
              config: { token: '${GIT_WEBHOOK_TOKEN}' }
            },
            validation: [
              { type: 'required', value: 'ref_type', message: 'Ref type required' },
              { type: 'pattern', value: 'tag', message: 'Only tag events allowed' }
            ]
          }
        },
        conditions: [
          { field: 'ref', operator: 'matches', value: '^v\\d+\\.\\d+\\.\\d+$', type: 'body' }
        ]
      }
    ],
    variables: [
      { name: 'repository_url', type: 'string', required: true, description: 'Git repository URL' },
      { name: 'release_tag', type: 'string', required: true, description: 'Release tag to deploy' },
      { name: 'target_environment', type: 'string', defaultValue: 'production', required: false, description: 'Deployment environment' },
      { name: 'docker_registry', type: 'string', required: true, description: 'Docker registry URL' },
      { name: 'kubernetes_namespace', type: 'string', defaultValue: 'default', required: false, description: 'K8s namespace' },
      { name: 'health_check_timeout', type: 'number', defaultValue: 300000, required: false, description: 'Health check timeout (ms)' },
      { name: 'rollback_on_failure', type: 'boolean', defaultValue: true, required: false, description: 'Auto-rollback on deployment failure' }
    ],
    tasks: [
      {
        id: 'pre-deployment-checks',
        name: 'Pre-Deployment Checks',
        type: 'parallel_group',
        description: 'Run parallel pre-deployment validations',
        dependsOn: [],
        executionMode: 'parallel',
        parallel: {
          maxConcurrency: 3,
          failFast: true,
          collectResults: true,
          aggregationStrategy: 'merge'
        },
        input: {
          variables: {
            checks: [
              {
                name: 'git-connectivity',
                command: 'git ls-remote {{repository_url}} {{release_tag}}',
                expected_pattern: '{{release_tag}}'
              },
              {
                name: 'docker-registry-access',
                command: 'docker login {{docker_registry}}',
                expected_pattern: 'Login Succeeded'
              },
              {
                name: 'kubernetes-cluster-access',
                command: 'kubectl cluster-info',
                expected_pattern: 'is running'
              }
            ]
          }
        },
        metadata: {
          estimatedDuration: 60000,
          criticality: 'critical',
          category: 'validation',
          tags: ['pre-check', 'validation']
        }
      },
      {
        id: 'checkout-and-build',
        name: 'Checkout Code and Build',
        type: 'command',
        description: 'Clone repository and build application',
        dependsOn: ['pre-deployment-checks'],
        executionMode: 'sequential',
        timeout: 600000,
        retryPolicy: {
          maxAttempts: 2,
          backoff: 'exponential',
          initialDelay: 30000,
          maxDelay: 120000,
          multiplier: 2,
          conditions: [
            { errorType: 'NetworkError' },
            { exitCode: 128 } // Git error
          ]
        },
        input: {
          command: 'bash',
          args: ['-c', `
            set -e
            echo "Cloning repository..."
            git clone --depth 1 --branch {{release_tag}} {{repository_url}} ./workspace
            cd ./workspace
            
            echo "Installing dependencies..."
            npm ci --production=false
            
            echo "Running tests..."
            npm run test:ci
            
            echo "Building application..."
            npm run build
            
            echo "Building Docker image..."
            docker build -t {{docker_registry}}/{{app_name}}:{{release_tag}} .
            docker push {{docker_registry}}/{{app_name}}:{{release_tag}}
          `]
        },
        output: {
          variables: {
            'image_tag': '{{docker_registry}}/{{app_name}}:{{release_tag}}',
            'build_timestamp': '${Date.now()}'
          }
        },
        onFailure: [
          {
            type: 'send_notification',
            config: {
              message: 'Build failed for release {{release_tag}}',
              severity: 'error',
              channels: ['slack', 'email']
            }
          }
        ],
        metadata: {
          estimatedDuration: 480000,
          criticality: 'critical',
          category: 'build',
          tags: ['git', 'build', 'docker', 'test']
        }
      },
      {
        id: 'security-scanning',
        name: 'Security Vulnerability Scan',
        type: 'api_call',
        description: 'Scan container image for security vulnerabilities',
        dependsOn: ['checkout-and-build'],
        executionMode: 'sequential',
        timeout: 300000,
        input: {
          url: '{{security_scanner_api}}/scan',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer {{security_scanner_token}}',
            'Content-Type': 'application/json'
          },
          body: {
            image: '{{image_tag}}',
            severity_threshold: 'HIGH',
            fail_on_critical: true
          }
        },
        condition: {
          type: 'variable',
          variables: ['enable_security_scanning'],
          operator: 'eq',
          value: true
        },
        onFailure: [
          {
            type: 'set_variable',
            config: { name: 'security_issues_found', value: true }
          },
          {
            type: 'trigger_workflow',
            config: { workflowId: 'security-review-process' }
          }
        ],
        metadata: {
          estimatedDuration: 180000,
          criticality: 'high',
          category: 'security',
          tags: ['security', 'scanning', 'compliance']
        }
      },
      {
        id: 'deployment-approval',
        name: 'Production Deployment Approval',
        type: 'condition',
        description: 'Wait for deployment approval from release manager',
        dependsOn: ['security-scanning'],
        executionMode: 'sequential',
        approval: {
          configId: 'production-deployment-approval',
          context: {
            release_tag: '{{release_tag}}',
            image_tag: '{{image_tag}}',
            security_scan_passed: '!{{security_issues_found}}',
            estimated_downtime: '2 minutes'
          },
          skipConditions: [
            {
              type: 'variable',
              variables: ['target_environment'],
              operator: 'ne',
              value: 'production'
            }
          ]
        },
        input: {},
        metadata: {
          estimatedDuration: 0, // Depends on approver
          criticality: 'high',
          category: 'approval',
          tags: ['approval', 'governance']
        }
      },
      {
        id: 'backup-current-deployment',
        name: 'Backup Current Deployment',
        type: 'command',
        description: 'Create backup of current deployment for rollback',
        dependsOn: ['deployment-approval'],
        executionMode: 'sequential',
        timeout: 120000,
        input: {
          command: 'bash',
          args: ['-c', `
            set -e
            echo "Backing up current deployment..."
            kubectl get deployment {{app_name}} -n {{kubernetes_namespace}} -o yaml > /tmp/{{app_name}}-backup-$(date +%s).yaml
            
            echo "Getting current image tag..."
            CURRENT_IMAGE=$(kubectl get deployment {{app_name}} -n {{kubernetes_namespace}} -o jsonpath='{.spec.template.spec.containers[0].image}')
            echo "current_image_backup=$CURRENT_IMAGE" >> $GITHUB_OUTPUT
          `]
        },
        output: {
          variables: {
            'rollback_image': 'env.current_image_backup',
            'backup_file': '/tmp/{{app_name}}-backup-{{build_timestamp}}.yaml'
          }
        },
        metadata: {
          estimatedDuration: 30000,
          criticality: 'high',
          category: 'backup',
          tags: ['backup', 'rollback', 'kubernetes']
        }
      },
      {
        id: 'deploy-to-kubernetes',
        name: 'Deploy to Kubernetes',
        type: 'command',
        description: 'Deploy new version to Kubernetes cluster',
        dependsOn: ['backup-current-deployment'],
        executionMode: 'sequential',
        timeout: 300000,
        rollbackStrategy: {
          type: 'custom',
          steps: [
            {
              action: 'custom',
              config: {
                command: 'kubectl set image deployment/{{app_name}} {{app_name}}={{rollback_image}} -n {{kubernetes_namespace}}'
              }
            }
          ],
          timeout: 120000
        },
        input: {
          command: 'bash',
          args: ['-c', `
            set -e
            echo "Deploying to Kubernetes..."
            
            # Update deployment with new image
            kubectl set image deployment/{{app_name}} {{app_name}}={{image_tag}} -n {{kubernetes_namespace}}
            
            # Wait for rollout to complete
            kubectl rollout status deployment/{{app_name}} -n {{kubernetes_namespace}} --timeout={{health_check_timeout}}ms
            
            echo "Deployment completed successfully"
          `]
        },
        onFailure: [
          {
            type: 'trigger_workflow',
            config: {
              workflowId: 'deployment-rollback',
              inputs: {
                app_name: '{{app_name}}',
                namespace: '{{kubernetes_namespace}}',
                rollback_image: '{{rollback_image}}'
              }
            }
          }
        ],
        metadata: {
          estimatedDuration: 240000,
          criticality: 'critical',
          category: 'deployment',
          tags: ['kubernetes', 'deployment', 'rollout']
        }
      },
      {
        id: 'health-checks',
        name: 'Post-Deployment Health Checks',
        type: 'parallel_group',
        description: 'Verify deployment health across multiple dimensions',
        dependsOn: ['deploy-to-kubernetes'],
        executionMode: 'parallel',
        timeout: 300000,
        parallel: {
          maxConcurrency: 5,
          failFast: false,
          collectResults: true,
          aggregationStrategy: 'merge'
        },
        loop: {
          type: 'while',
          condition: {
            type: 'expression',
            expression: 'attempts < 10 && !allHealthy'
          },
          maxIterations: 10,
          breakCondition: {
            type: 'variable',
            variables: ['all_health_checks_passed'],
            operator: 'eq',
            value: true
          }
        },
        input: {
          variables: {
            health_checks: [
              {
                name: 'pod-readiness',
                command: 'kubectl get pods -l app={{app_name}} -n {{kubernetes_namespace}} --field-selector=status.phase=Running',
                expected_count: 3
              },
              {
                name: 'http-endpoint',
                command: 'curl -f http://{{service_url}}/health',
                expected_pattern: '"status":"healthy"'
              },
              {
                name: 'database-connectivity',
                command: 'kubectl exec deployment/{{app_name}} -n {{kubernetes_namespace}} -- npm run db:health-check',
                expected_pattern: 'Connection successful'
              },
              {
                name: 'external-api-connectivity',
                command: 'kubectl exec deployment/{{app_name}} -n {{kubernetes_namespace}} -- npm run external-api:health-check',
                expected_pattern: 'All external APIs accessible'
              },
              {
                name: 'performance-baseline',
                api_call: {
                  url: '{{load_test_service}}/quick-test',
                  method: 'POST',
                  body: { target: '{{service_url}}', duration: 60 }
                },
                expected_metric: 'response_time_p95 < 500'
              }
            ]
          }
        },
        onFailure: [
          {
            type: 'call_webhook',
            config: {
              url: '{{monitoring_webhook}}',
              method: 'POST',
              body: {
                alert: 'deployment-health-check-failed',
                deployment: '{{release_tag}}',
                environment: '{{target_environment}}'
              }
            }
          }
        ],
        metadata: {
          estimatedDuration: 180000,
          criticality: 'critical',
          category: 'validation',
          tags: ['health-check', 'monitoring', 'validation']
        }
      },
      {
        id: 'update-monitoring',
        name: 'Update Monitoring and Alerting',
        type: 'api_call',
        description: 'Update monitoring dashboards and alerts for new version',
        dependsOn: ['health-checks'],
        executionMode: 'sequential',
        timeout: 60000,
        input: {
          url: '{{monitoring_api}}/deployments',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer {{monitoring_token}}',
            'Content-Type': 'application/json'
          },
          body: {
            application: '{{app_name}}',
            version: '{{release_tag}}',
            environment: '{{target_environment}}',
            deployment_time: '{{build_timestamp}}',
            health_endpoints: ['{{service_url}}/health', '{{service_url}}/metrics'],
            alert_rules: [
              {
                name: 'high-error-rate',
                expression: 'rate(http_requests_total{status=~"5.."}[5m]) > 0.05',
                severity: 'critical'
              },
              {
                name: 'high-response-time',
                expression: 'histogram_quantile(0.95, http_request_duration_seconds_bucket) > 1.0',
                severity: 'warning'
              }
            ]
          }
        },
        metadata: {
          estimatedDuration: 30000,
          criticality: 'medium',
          category: 'monitoring',
          tags: ['monitoring', 'alerting', 'observability']
        }
      },
      {
        id: 'deployment-notification',
        name: 'Send Deployment Notifications',
        type: 'notification',
        description: 'Notify stakeholders of successful deployment',
        dependsOn: ['update-monitoring'],
        executionMode: 'sequential',
        input: {
          variables: {
            message: `🚀 Successfully deployed {{app_name}} version {{release_tag}} to {{target_environment}}
            
📊 Deployment Stats:
• Build Time: {{build_duration}}ms
• Deployment Time: {{deployment_duration}}ms  
• Health Checks: ✅ All Passed
• Service URL: {{service_url}}
• Rollback Image: {{rollback_image}}

🔗 Links:
• Monitoring Dashboard: {{monitoring_dashboard_url}}
• Logs: {{logs_url}}
• Release Notes: {{release_notes_url}}`,
            channels: ['slack', 'email'],
            severity: 'info'
          }
        },
        metadata: {
          estimatedDuration: 5000,
          criticality: 'low',
          category: 'notification',
          tags: ['notification', 'communication']
        }
      }
    ],
    dataFlow: {
      inputs: [
        {
          name: 'webhook_data',
          type: 'object',
          source: { type: 'variable', config: { name: 'trigger_data' } },
          required: true
        }
      ],
      outputs: [
        {
          name: 'deployment_summary',
          type: 'object',
          destination: { type: 'api', config: { url: '{{deployment_tracking_api}}/record' } },
          format: 'json'
        }
      ],
      transformations: [
        {
          id: 'extract-release-info',
          type: 'map',
          input: ['webhook_data'],
          output: 'release_info',
          config: {
            expression: `{
              release_tag: item.ref.replace('refs/tags/', ''),
              repository: item.repository.full_name,
              pusher: item.pusher.name,
              timestamp: item.head_commit.timestamp
            }`
          }
        }
      ],
      validations: [
        {
          field: 'release_tag',
          rules: [
            { type: 'required', message: 'Release tag is required' },
            { type: 'pattern', value: '^v\\d+\\.\\d+\\.\\d+$', message: 'Invalid semantic version format' }
          ]
        }
      ]
    },
    errorHandling: {
      global: {
        onError: 'rollback',
        retryPolicy: {
          maxAttempts: 1, // No global retries for deployments
          backoff: 'fixed',
          initialDelay: 0,
          conditions: []
        },
        notifications: [
          {
            id: 'deployment-failure-alert',
            name: 'Deployment Failure Alert',
            channels: [
              { type: 'slack', config: { channel: '#deployments-critical' }, enabled: true },
              { type: 'email', config: { recipients: ['devops@company.com', 'oncall@company.com'] }, enabled: true }
            ],
            conditions: [
              { event: 'workflow_fail', severity: 'error' }
            ],
            template: {
              subject: '🚨 CRITICAL: Production Deployment Failed',
              body: `Production deployment of {{app_name}} version {{release_tag}} has failed.
              
⚠️  Failure Details:
• Environment: {{target_environment}}
• Failed Task: {{failed_task_name}}
• Error: {{error_message}}
• Timestamp: {{failure_timestamp}}

🔧 Actions Taken:
• {{#if rollback_on_failure}}Automatic rollback initiated{{else}}Manual intervention required{{/if}}
• Monitoring alerts activated
• Incident response team notified

📋 Next Steps:
1. Check deployment logs: {{logs_url}}
2. Verify rollback status: kubectl get pods -n {{kubernetes_namespace}}
3. Join incident response channel: #incident-{{incident_id}}

🔗 Resources:
• Runbook: {{runbook_url}}
• Dashboard: {{monitoring_dashboard_url}}
• Escalation: {{oncall_contact}}`,
              format: 'markdown'
            },
            throttling: {
              maxNotifications: 3,
              timeWindow: 3600000, // 1 hour
              groupBy: ['app_name', 'environment']
            }
          }
        ],
        rollback: {
          type: 'custom',
          steps: [
            {
              action: 'custom',
              config: {
                workflowId: 'emergency-rollback-procedure',
                inputs: {
                  app_name: '{{app_name}}',
                  target_environment: '{{target_environment}}',
                  rollback_image: '{{rollback_image}}',
                  incident_severity: 'high'
                }
              }
            }
          ],
          timeout: 300000
        }
      },
      taskSpecific: {
        'deploy-to-kubernetes': {
          onError: 'rollback',
          retryPolicy: {
            maxAttempts: 2,
            backoff: 'fixed',
            initialDelay: 60000,
            conditions: [
              { errorType: 'TimeoutError' },
              { errorMessage: 'connection refused' }
            ]
          },
          rollback: {
            type: 'task_based',
            steps: [
              {
                taskId: 'backup-current-deployment',
                action: 'restore',
                config: {
                  command: 'kubectl apply -f {{backup_file}}'
                }
              }
            ],
            timeout: 120000
          }
        }
      }
    },
    notifications: [
      {
        id: 'deployment-started',
        name: 'Deployment Started',
        channels: [
          { type: 'slack', config: { channel: '#deployments' }, enabled: true }
        ],
        conditions: [
          { event: 'workflow_start' }
        ],
        template: {
          body: '🚀 Starting deployment of {{app_name}} version {{release_tag}} to {{target_environment}}',
          format: 'text'
        }
      }
    ],
    approvals: [
      {
        id: 'production-deployment-approval',
        name: 'Production Deployment Approval',
        type: 'manual',
        required: true,
        approvers: [
          { type: 'role', identifier: 'release-manager', weight: 1 },
          { type: 'role', identifier: 'tech-lead', weight: 1 }
        ],
        timeout: 7200000, // 2 hours
        escalation: {
          levels: [
            {
              delay: 3600000, // 1 hour
              approvers: [
                { type: 'role', identifier: 'engineering-director' }
              ],
              actions: [
                {
                  type: 'send_notification',
                  config: {
                    message: 'Deployment approval escalated to Engineering Director',
                    channels: ['email']
                  }
                }
              ]
            }
          ]
        },
        conditions: [
          { field: 'target_environment', operator: 'eq', value: 'production' }
        ]
      }
    ],
    timeouts: {
      workflow: 3600000, // 1 hour total
      task: 600000, // 10 minutes per task
      approval: 7200000, // 2 hours for approvals
      notification: 30000, // 30 seconds for notifications
      global: 3600000 // 1 hour global timeout
    },
    retryPolicy: {
      maxAttempts: 1, // Deployments should not be retried globally
      backoff: 'fixed',
      initialDelay: 0,
      conditions: []
    },
    tags: ['deployment', 'production', 'kubernetes', 'cicd', 'critical'],
    created: new Date(),
    updated: new Date(),
    author: 'DevOps Team'
  };

  workflowEngine.registerWorkflow(workflowDefinition);
  return workflowDefinition.id;
}

/**
 * Example 2: Data Processing Pipeline with Quality Gates
 * Complex ETL workflow with data validation, transformation, and quality checks
 */
export async function createDataProcessingPipeline(
  dataManager: DataPipelineManager,
  workflowEngine: WorkflowEngine
): Promise<string> {
  // Register data pipeline
  const pipelineDefinition = {
    inputs: [
      {
        name: 'source_data',
        type: 'file',
        source: {
          type: 'file',
          config: {
            path: '{{input_file_path}}',
            format: 'csv',
            options: { hasHeader: true, delimiter: ',' }
          }
        },
        required: true,
        schema: {
          type: 'object',
          properties: {
            customer_id: { type: 'string' },
            transaction_date: { type: 'string', format: 'date' },
            amount: { type: 'number', minimum: 0 },
            category: { type: 'string' }
          },
          required: ['customer_id', 'transaction_date', 'amount']
        }
      },
      {
        name: 'reference_data',
        type: 'database',
        source: {
          type: 'database',
          config: {
            connector: 'postgresql',
            query: 'SELECT customer_id, customer_tier, created_date FROM customers WHERE active = true'
          }
        },
        required: true
      }
    ],
    outputs: [
      {
        name: 'processed_data',
        type: 'object',
        destination: {
          type: 'database',
          config: {
            connector: 'postgresql',
            table: 'processed_transactions'
          }
        },
        format: 'json'
      },
      {
        name: 'quality_report',
        type: 'object',
        destination: {
          type: 'file',
          config: {
            path: '/reports/quality-{{timestamp}}.json',
            format: 'json'
          }
        }
      }
    ],
    transformations: [
      {
        id: 'data-cleaning',
        type: 'map',
        input: ['source_data'],
        output: 'cleaned_data',
        config: {
          function: `
            // Clean and normalize data
            item.customer_id = item.customer_id.trim().toUpperCase();
            item.transaction_date = new Date(item.transaction_date).toISOString();
            item.amount = parseFloat(item.amount);
            item.category = item.category ? item.category.toLowerCase() : 'uncategorized';
            return item;
          `
        }
      },
      {
        id: 'enrich-with-reference',
        type: 'merge',
        input: ['cleaned_data', 'reference_data'],
        output: 'enriched_data',
        config: {
          strategy: 'left_join',
          key: 'customer_id'
        }
      },
      {
        id: 'calculate-metrics',
        type: 'map',
        input: ['enriched_data'],
        output: 'final_data',
        config: {
          function: `
            // Calculate derived metrics
            const daysSinceCustomerCreated = (new Date(item.transaction_date) - new Date(item.created_date)) / (1000 * 60 * 60 * 24);
            return {
              ...item,
              days_since_customer_created: Math.floor(daysSinceCustomerCreated),
              amount_category: item.amount > 1000 ? 'high' : item.amount > 100 ? 'medium' : 'low',
              processed_timestamp: new Date().toISOString()
            };
          `
        }
      }
    ],
    validations: [
      {
        field: 'amount',
        rules: [
          { type: 'required', message: 'Amount is required' },
          { type: 'range', value: [0, 1000000], message: 'Amount must be between 0 and 1,000,000' }
        ]
      },
      {
        field: 'customer_id',
        rules: [
          { type: 'required', message: 'Customer ID is required' },
          { type: 'pattern', value: '^[A-Z0-9]{8}$', message: 'Customer ID must be 8 alphanumeric characters' }
        ]
      }
    ]
  };

  dataManager.registerPipeline('transaction-processing', pipelineDefinition);

  // Create workflow that uses the data pipeline
  const workflowDefinition: WorkflowDefinition = {
    id: 'data-processing-workflow',
    name: 'Transaction Data Processing Workflow',
    description: 'Process transaction data with quality gates and alerting',
    version: '1.0.0',
    metadata: {
      category: 'data',
      environment: ['production'],
      requiredPermissions: ['database.read', 'database.write', 'file.read', 'file.write'],
      estimatedDuration: 1800000, // 30 minutes
      resourceRequirements: {
        cpu: '2 cores',
        memory: '4GB',
        disk: '20GB'
      },
      dependencies: ['postgresql', 'file-storage'],
      outputs: [
        { name: 'processing_summary', type: 'object', description: 'Processing statistics', required: true }
      ]
    },
    triggers: [
      {
        id: 'file-arrival',
        type: 'file_watch',
        name: 'New Data File Trigger',
        enabled: true,
        config: {
          fileWatch: {
            paths: ['/data/inbox'],
            patterns: ['transactions-*.csv'],
            events: ['create'],
            recursive: false,
            debounce: 30000 // Wait 30 seconds after file creation
          }
        }
      },
      {
        id: 'scheduled-processing',
        type: 'schedule',
        name: 'Daily Processing',
        enabled: true,
        config: {
          schedule: {
            cron: '0 6 * * *', // Daily at 6 AM
            timezone: 'UTC'
          }
        }
      }
    ],
    variables: [
      { name: 'input_file_path', type: 'string', required: true, description: 'Path to input CSV file' },
      { name: 'quality_threshold', type: 'number', defaultValue: 0.95, required: false, description: 'Data quality threshold' },
      { name: 'notify_on_completion', type: 'boolean', defaultValue: true, required: false, description: 'Send completion notifications' }
    ],
    tasks: [
      {
        id: 'validate-input-file',
        name: 'Validate Input File',
        type: 'command',
        description: 'Check if input file exists and is readable',
        dependsOn: [],
        executionMode: 'sequential',
        input: {
          command: 'bash',
          args: ['-c', `
            if [[ ! -f "{{input_file_path}}" ]]; then
              echo "Error: Input file not found: {{input_file_path}}"
              exit 1
            fi
            
            if [[ ! -r "{{input_file_path}}" ]]; then
              echo "Error: Cannot read input file: {{input_file_path}}"
              exit 1
            fi
            
            FILE_SIZE=$(stat -f%z "{{input_file_path}}" 2>/dev/null || stat -c%s "{{input_file_path}}")
            if [[ $FILE_SIZE -eq 0 ]]; then
              echo "Error: Input file is empty"
              exit 1
            fi
            
            LINE_COUNT=$(wc -l < "{{input_file_path}}")
            echo "File validation passed. Size: $FILE_SIZE bytes, Lines: $LINE_COUNT"
          `]
        },
        output: {
          variables: {
            'file_size': 'parseFileSize(output)',
            'record_count': 'parseLineCount(output)'
          }
        },
        metadata: {
          estimatedDuration: 10000,
          criticality: 'high',
          category: 'validation',
          tags: ['file', 'validation']
        }
      },
      {
        id: 'execute-data-pipeline',
        name: 'Execute Data Processing Pipeline',
        type: 'subworkflow',
        description: 'Run the data processing pipeline',
        dependsOn: ['validate-input-file'],
        executionMode: 'sequential',
        timeout: 1200000, // 20 minutes
        input: {
          variables: {
            workflowId: 'data-pipeline-execution',
            pipelineId: 'transaction-processing',
            input_file_path: '{{input_file_path}}'
          }
        },
        output: {
          variables: {
            'processing_stats': 'data.processingStats',
            'quality_score': 'data.qualityScore',
            'error_count': 'data.errorCount'
          }
        },
        metadata: {
          estimatedDuration: 900000,
          criticality: 'critical',
          category: 'processing',
          tags: ['etl', 'data-pipeline']
        }
      },
      {
        id: 'quality-gate-check',
        name: 'Data Quality Gate',
        type: 'condition',
        description: 'Verify data quality meets threshold',
        dependsOn: ['execute-data-pipeline'],
        executionMode: 'sequential',
        condition: {
          type: 'expression',
          expression: 'quality_score >= quality_threshold'
        },
        onFailure: [
          {
            type: 'trigger_workflow',
            config: {
              workflowId: 'data-quality-investigation',
              inputs: {
                quality_score: '{{quality_score}}',
                threshold: '{{quality_threshold}}',
                file_path: '{{input_file_path}}'
              }
            }
          },
          {
            type: 'send_notification',
            config: {
              message: 'Data quality gate failed. Score: {{quality_score}}, Threshold: {{quality_threshold}}',
              severity: 'warning',
              channels: ['slack', 'email']
            }
          }
        ],
        input: {},
        metadata: {
          estimatedDuration: 5000,
          criticality: 'high',
          category: 'quality',
          tags: ['quality-gate', 'validation']
        }
      },
      {
        id: 'generate-summary-report',
        name: 'Generate Processing Summary',
        type: 'data_transform',
        description: 'Create summary report of processing results',
        dependsOn: ['quality-gate-check'],
        executionMode: 'sequential',
        input: {
          variables: {
            template: `
# Data Processing Summary Report

## File Information
- **File Path:** {{input_file_path}}
- **File Size:** {{file_size}} bytes
- **Records Processed:** {{record_count}}
- **Processing Date:** {{processing_date}}

## Processing Statistics
- **Successful Records:** {{processing_stats.successful}}
- **Failed Records:** {{processing_stats.failed}}
- **Quality Score:** {{quality_score}} ({{quality_score >= quality_threshold ? 'PASS' : 'FAIL'}})
- **Error Count:** {{error_count}}

## Quality Metrics
{{#each processing_stats.qualityMetrics}}
- **{{@key}}:** {{this}}
{{/each}}

## Recommendations
{{#if quality_score < quality_threshold}}
⚠️ **Action Required:** Data quality below threshold. Please review error details and investigate data sources.
{{else}}
✅ **Status:** Processing completed successfully. Data quality meets requirements.
{{/if}}

---
*Report generated on {{timestamp}}*
            `,
            output_format: 'markdown'
          }
        },
        output: {
          variables: {
            'summary_report': 'generated_report',
            'report_path': '/reports/processing-summary-{{timestamp}}.md'
          }
        },
        metadata: {
          estimatedDuration: 15000,
          criticality: 'medium',
          category: 'reporting',
          tags: ['report', 'summary']
        }
      }
    ],
    dataFlow: {
      inputs: [],
      outputs: [],
      transformations: [],
      validations: []
    },
    errorHandling: {
      global: {
        onError: 'continue',
        notifications: [
          {
            id: 'processing-error',
            name: 'Data Processing Error',
            channels: [
              { type: 'email', config: { recipients: ['data-team@company.com'] }, enabled: true }
            ],
            conditions: [
              { event: 'task_fail', severity: 'error' }
            ],
            template: {
              subject: 'Data Processing Error - {{input_file_path}}',
              body: 'Data processing failed for file {{input_file_path}}. Error: {{error_message}}',
              format: 'text'
            }
          }
        ]
      },
      taskSpecific: {}
    },
    notifications: [],
    approvals: [],
    timeouts: {
      workflow: 2400000, // 40 minutes
      task: 1200000 // 20 minutes
    },
    retryPolicy: {
      maxAttempts: 2,
      backoff: 'exponential',
      initialDelay: 60000,
      maxDelay: 300000,
      multiplier: 2,
      conditions: []
    },
    tags: ['data', 'etl', 'quality', 'automation'],
    created: new Date(),
    updated: new Date(),
    author: 'Data Engineering Team'
  };

  workflowEngine.registerWorkflow(workflowDefinition);
  return workflowDefinition.id;
}

/**
 * Example 3: Incident Response Automation
 * Automated incident detection, escalation, and response coordination
 */
export async function createIncidentResponseWorkflow(
  workflowEngine: WorkflowEngine,
  triggerManager: TriggerManager
): Promise<string> {
  const workflowDefinition: WorkflowDefinition = {
    id: 'incident-response-automation',
    name: 'Automated Incident Response',
    description: 'Detect, classify, and respond to production incidents automatically',
    version: '1.0.0',
    metadata: {
      category: 'incident-response',
      environment: ['production'],
      requiredPermissions: ['monitoring.read', 'notification.send', 'runbook.execute'],
      estimatedDuration: 300000, // 5 minutes initial response
      resourceRequirements: {
        network: true,
        services: ['monitoring', 'alerting', 'communication']
      },
      dependencies: ['monitoring-system', 'oncall-schedule', 'runbook-library'],
      outputs: [
        { name: 'incident_id', type: 'string', description: 'Created incident identifier', required: true },
        { name: 'response_actions', type: 'array', description: 'Actions taken', required: true }
      ]
    },
    triggers: [
      {
        id: 'alert-webhook',
        type: 'webhook',
        name: 'Monitoring Alert Webhook',
        enabled: true,
        config: {
          webhook: {
            path: '/webhook/alert',
            method: 'POST',
            authentication: {
              type: 'api_key',
              config: { header: 'X-Alert-Token', secret: '${ALERT_WEBHOOK_SECRET}' }
            }
          }
        },
        conditions: [
          { field: 'severity', operator: 'matches', value: '^(critical|high)$', type: 'body' },
          { field: 'status', operator: 'eq', value: 'firing', type: 'body' }
        ]
      }
    ],
    variables: [
      { name: 'alert_data', type: 'object', required: true, description: 'Alert payload from monitoring system' },
      { name: 'severity', type: 'string', required: true, description: 'Alert severity level' },
      { name: 'service_name', type: 'string', required: true, description: 'Affected service name' },
      { name: 'auto_remediation_enabled', type: 'boolean', defaultValue: true, required: false, description: 'Enable automatic remediation' }
    ],
    tasks: [
      {
        id: 'classify-incident',
        name: 'Classify Incident',
        type: 'api_call',
        description: 'Use ML model to classify incident type and severity',
        dependsOn: [],
        executionMode: 'sequential',
        timeout: 30000,
        input: {
          url: '{{incident_classifier_api}}/classify',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer {{classifier_token}}',
            'Content-Type': 'application/json'
          },
          body: {
            alert_name: '{{alert_data.alertname}}',
            labels: '{{alert_data.labels}}',
            annotations: '{{alert_data.annotations}}',
            metrics: '{{alert_data.metrics}}'
          }
        },
        output: {
          variables: {
            'incident_type': 'data.incident_type',
            'confidence_score': 'data.confidence',
            'recommended_runbook': 'data.runbook_id',
            'escalation_level': 'data.escalation_level'
          }
        },
        metadata: {
          estimatedDuration: 15000,
          criticality: 'high',
          category: 'classification',
          tags: ['ai', 'classification', 'incident']
        }
      },
      {
        id: 'create-incident-ticket',
        name: 'Create Incident Ticket',
        type: 'api_call',
        description: 'Create incident tracking ticket',
        dependsOn: ['classify-incident'],
        executionMode: 'sequential',
        timeout: 30000,
        input: {
          url: '{{ticketing_api}}/incidents',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer {{ticketing_token}}',
            'Content-Type': 'application/json'
          },
          body: {
            title: 'INCIDENT: {{alert_data.alertname}} - {{service_name}}',
            description: `
Automated incident created from monitoring alert.

## Alert Details
- **Service:** {{service_name}}
- **Severity:** {{severity}}
- **Alert:** {{alert_data.alertname}}
- **Incident Type:** {{incident_type}} (confidence: {{confidence_score}})

## Timeline
- **Detected:** {{alert_data.startsAt}}
- **Created:** {{timestamp}}

## Metrics
{{#each alert_data.metrics}}
- **{{@key}}:** {{this}}
{{/each}}

## Recommended Actions
- Follow runbook: {{recommended_runbook}}
- Escalation Level: {{escalation_level}}
            `,
            severity: '{{severity}}',
            service: '{{service_name}}',
            labels: ['automated', 'monitoring', '{{incident_type}}'],
            assignee: null, // Will be assigned by escalation
            priority: '{{escalation_level}}'
          }
        },
        output: {
          variables: {
            'incident_id': 'data.id',
            'incident_url': 'data.url'
          }
        },
        metadata: {
          estimatedDuration: 10000,
          criticality: 'high',
          category: 'ticketing',
          tags: ['incident', 'tracking']
        }
      },
      {
        id: 'initial-notification',
        name: 'Send Initial Notifications',
        type: 'parallel_group',
        description: 'Notify relevant teams and stakeholders',
        dependsOn: ['create-incident-ticket'],
        executionMode: 'parallel',
        parallel: {
          maxConcurrency: 5,
          failFast: false,
          collectResults: false,
          aggregationStrategy: 'array'
        },
        input: {
          variables: {
            notifications: [
              {
                channel: 'slack',
                target: '#incidents-{{severity}}',
                message: `🚨 **{{severity.toUpperCase()}} INCIDENT DETECTED**
                
**Service:** {{service_name}}
**Alert:** {{alert_data.alertname}}
**Incident ID:** {{incident_id}}
**Classification:** {{incident_type}} ({{Math.round(confidence_score * 100)}}% confidence)

**Quick Actions:**
• [View Incident]({{incident_url}})
• [Service Dashboard]({{service_dashboard_url}})
• [Runbook]({{runbook_url}})

**Next Steps:**
{{#if auto_remediation_enabled}}
🤖 Attempting automatic remediation...
{{else}}
👤 Manual intervention required
{{/if}}`
              },
              {
                channel: 'email',
                target: '{{oncall_email}}',
                subject: '[{{severity.toUpperCase()}}] {{service_name}} - {{alert_data.alertname}}',
                message: 'Incident {{incident_id}} requires attention. Details: {{incident_url}}'
              },
              {
                channel: 'sms',
                target: '{{oncall_phone}}',
                message: '[{{severity.toUpperCase()}}] {{service_name}} incident {{incident_id}}. Check Slack for details.',
                condition: 'severity === "critical"'
              },
              {
                channel: 'pagerduty',
                target: '{{pagerduty_service_key}}',
                incident_key: '{{incident_id}}',
                description: '{{alert_data.alertname}} on {{service_name}}'
              }
            ]
          }
        },
        metadata: {
          estimatedDuration: 20000,
          criticality: 'high',
          category: 'notification',
          tags: ['alert', 'communication']
        }
      },
      {
        id: 'execute-runbook',
        name: 'Execute Automated Runbook',
        type: 'subworkflow',
        description: 'Run automated remediation steps from runbook',
        dependsOn: ['initial-notification'],
        executionMode: 'sequential',
        timeout: 600000, // 10 minutes
        condition: {
          type: 'variable',
          variables: ['auto_remediation_enabled'],
          operator: 'eq',
          value: true
        },
        input: {
          variables: {
            workflowId: '{{recommended_runbook}}',
            incident_id: '{{incident_id}}',
            service_name: '{{service_name}}',
            alert_data: '{{alert_data}}',
            severity: '{{severity}}'
          }
        },
        output: {
          variables: {
            'remediation_status': 'data.status',
            'actions_taken': 'data.actions',
            'resolution_time': 'data.duration'
          }
        },
        onFailure: [
          {
            type: 'send_notification',
            config: {
              message: 'Automated remediation failed for incident {{incident_id}}. Manual intervention required.',
              channels: ['slack'],
              severity: 'error'
            }
          },
          {
            type: 'call_webhook',
            config: {
              url: '{{escalation_webhook}}',
              method: 'POST',
              body: {
                incident_id: '{{incident_id}}',
                action: 'escalate',
                reason: 'automated_remediation_failed'
              }
            }
          }
        ],
        metadata: {
          estimatedDuration: 300000,
          criticality: 'critical',
          category: 'remediation',
          tags: ['runbook', 'automation', 'remediation']
        }
      },
      {
        id: 'monitor-resolution',
        name: 'Monitor for Resolution',
        type: 'condition',
        description: 'Wait for alert to clear or timeout',
        dependsOn: ['execute-runbook'],
        executionMode: 'sequential',
        timeout: 1800000, // 30 minutes
        loop: {
          type: 'while',
          condition: {
            type: 'external',
            expression: 'checkAlertStatus(alert_data.alertname) === "firing"'
          },
          maxIterations: 180, // Check every 10 seconds for 30 minutes
          breakCondition: {
            type: 'external',
            expression: 'checkAlertStatus(alert_data.alertname) === "resolved"'
          }
        },
        input: {
          variables: {
            check_interval: 10000, // 10 seconds
            alert_name: '{{alert_data.alertname}}'
          }
        },
        output: {
          variables: {
            'final_status': 'alert_resolved ? "resolved" : "timeout"',
            'resolution_duration': 'Date.now() - start_time'
          }
        },
        metadata: {
          estimatedDuration: 600000, // Average 10 minutes
          criticality: 'medium',
          category: 'monitoring',
          tags: ['resolution', 'monitoring']
        }
      },
      {
        id: 'update-incident-status',
        name: 'Update Incident Status',
        type: 'api_call',
        description: 'Update incident ticket with final status',
        dependsOn: ['monitor-resolution'],
        executionMode: 'sequential',
        timeout: 30000,
        input: {
          url: '{{ticketing_api}}/incidents/{{incident_id}}',
          method: 'PATCH',
          headers: {
            'Authorization': 'Bearer {{ticketing_token}}',
            'Content-Type': 'application/json'
          },
          body: {
            status: '{{final_status}}',
            resolution_time: '{{resolution_duration}}',
            automated_actions: '{{actions_taken}}',
            notes: `
## Incident Resolution Summary

**Final Status:** {{final_status}}
**Total Duration:** {{Math.round(resolution_duration / 60000)}} minutes
**Automated Actions:** {{actions_taken.length}} steps executed

### Timeline
- **Detected:** {{alert_data.startsAt}}
- **Ticket Created:** {{incident_creation_time}}
- **Remediation Started:** {{remediation_start_time}}
- **{{final_status === 'resolved' ? 'Resolved' : 'Timeout'}}:** {{timestamp}}

### Actions Taken
{{#each actions_taken}}
- {{this.timestamp}}: {{this.action}} - {{this.status}}
{{/each}}

{{#if final_status === 'resolved'}}
✅ **Incident automatically resolved**
{{else}}
⚠️ **Manual intervention required** - Incident timeout reached
{{/if}}
            `
          }
        },
        metadata: {
          estimatedDuration: 10000,
          criticality: 'medium',
          category: 'ticketing',
          tags: ['incident', 'resolution']
        }
      },
      {
        id: 'post-incident-actions',
        name: 'Execute Post-Incident Actions',
        type: 'parallel_group',
        description: 'Cleanup and post-incident procedures',
        dependsOn: ['update-incident-status'],
        executionMode: 'parallel',
        parallel: {
          maxConcurrency: 3,
          failFast: false,
          collectResults: false,
          aggregationStrategy: 'array'
        },
        input: {
          variables: {
            actions: [
              {
                type: 'notification',
                config: {
                  channel: 'slack',
                  target: '#incidents-{{severity}}',
                  message: `{{final_status === 'resolved' ? '✅' : '⚠️'}} **Incident {{incident_id}} {{final_status.toUpperCase()}}**
                  
**Service:** {{service_name}}
**Duration:** {{Math.round(resolution_duration / 60000)}} minutes
**Actions:** {{actions_taken.length}} automated steps

{{#if final_status === 'resolved'}}
Incident was automatically resolved. No further action needed.
{{else}}
⚠️ **Requires manual attention** - Please check [incident details]({{incident_url}})
{{/if}}`
                }
              },
              {
                type: 'api_call',
                config: {
                  url: '{{metrics_api}}/incidents/record',
                  method: 'POST',
                  body: {
                    incident_id: '{{incident_id}}',
                    service: '{{service_name}}',
                    severity: '{{severity}}',
                    incident_type: '{{incident_type}}',
                    duration: '{{resolution_duration}}',
                    automated_resolution: '{{final_status === "resolved"}}',
                    actions_count: '{{actions_taken.length}}'
                  }
                }
              },
              {
                type: 'conditional',
                condition: 'final_status === "timeout"',
                config: {
                  type: 'trigger_workflow',
                  workflowId: 'incident-escalation',
                  inputs: {
                    incident_id: '{{incident_id}}',
                    escalation_reason: 'automated_timeout',
                    current_severity: '{{severity}}'
                  }
                }
              }
            ]
          }
        },
        metadata: {
          estimatedDuration: 30000,
          criticality: 'low',
          category: 'cleanup',
          tags: ['post-incident', 'metrics']
        }
      }
    ],
    dataFlow: {
      inputs: [
        {
          name: 'alert_payload',
          type: 'object',
          source: { type: 'variable', config: { name: 'alert_data' } },
          required: true
        }
      ],
      outputs: [
        {
          name: 'incident_metrics',
          type: 'object',
          destination: { type: 'api', config: { url: '{{metrics_collector}}/incident-response' } }
        }
      ],
      transformations: [
        {
          id: 'extract-alert-info',
          type: 'map',
          input: ['alert_payload'],
          output: 'processed_alert',
          config: {
            expression: `{
              severity: item.labels.severity || 'unknown',
              service_name: item.labels.service || item.labels.job || 'unknown',
              alert_name: item.alertname,
              start_time: new Date(item.startsAt),
              labels: item.labels,
              annotations: item.annotations
            }`
          }
        }
      ],
      validations: [
        {
          field: 'severity',
          rules: [
            { type: 'required', message: 'Alert severity is required' },
            { type: 'pattern', value: '^(critical|high|medium|low|info)$', message: 'Invalid severity level' }
          ]
        }
      ]
    },
    errorHandling: {
      global: {
        onError: 'continue',
        retryPolicy: {
          maxAttempts: 2,
          backoff: 'fixed',
          initialDelay: 30000,
          conditions: [
            { errorType: 'NetworkError' },
            { errorType: 'TimeoutError' }
          ]
        },
        notifications: [
          {
            id: 'incident-response-failure',
            name: 'Incident Response System Failure',
            channels: [
              { type: 'email', config: { recipients: ['sre@company.com'] }, enabled: true },
              { type: 'sms', config: { numbers: ['{{emergency_phone}}'] }, enabled: true }
            ],
            conditions: [
              { event: 'workflow_fail', severity: 'critical' }
            ],
            template: {
              subject: '🚨 CRITICAL: Incident Response System Failure',
              body: 'Automated incident response failed. Manual intervention required immediately. Incident: {{incident_id}}',
              format: 'text'
            }
          }
        ]
      },
      taskSpecific: {
        'execute-runbook': {
          onError: 'continue', // Continue with escalation even if runbook fails
          fallbackTask: 'escalate-to-human'
        }
      }
    },
    notifications: [],
    approvals: [],
    timeouts: {
      workflow: 3600000, // 1 hour total
      task: 600000, // 10 minutes per task
      global: 3600000
    },
    retryPolicy: {
      maxAttempts: 1, // Incident response should not be retried
      backoff: 'fixed',
      initialDelay: 0,
      conditions: []
    },
    tags: ['incident-response', 'automation', 'monitoring', 'critical'],
    created: new Date(),
    updated: new Date(),
    author: 'SRE Team'
  };

  workflowEngine.registerWorkflow(workflowDefinition);

  // Register the trigger for this workflow
  triggerManager.registerTrigger(workflowDefinition.id, workflowDefinition.triggers[0]);

  return workflowDefinition.id;
}

/**
 * Example usage and demonstration
 */
export async function demonstrateAdvancedWorkflows(): Promise<void> {
  const consoleManager = new ConsoleManager();
  const workflowEngine = new WorkflowEngine(consoleManager);
  const dataManager = new DataPipelineManager();
  const triggerManager = new TriggerManager(workflowEngine);
  const templateLibrary = new WorkflowTemplateLibrary();

  console.log('🚀 Initializing Advanced Workflow Automation...');

  try {
    // Create deployment pipeline
    const deploymentWorkflowId = await createDeploymentPipeline(workflowEngine);
    console.log(`✅ Deployment pipeline created: ${deploymentWorkflowId}`);

    // Create data processing pipeline
    const dataWorkflowId = await createDataProcessingPipeline(dataManager, workflowEngine);
    console.log(`✅ Data processing pipeline created: ${dataWorkflowId}`);

    // Create incident response workflow
    const incidentWorkflowId = await createIncidentResponseWorkflow(workflowEngine, triggerManager);
    console.log(`✅ Incident response workflow created: ${incidentWorkflowId}`);

    // Demonstrate template usage
    const template = templateLibrary.getTemplate('cicd-pipeline');
    if (template) {
      const customWorkflow = templateLibrary.generateWorkflowFromTemplate(
        'cicd-pipeline',
        {
          repository_url: 'https://github.com/company/sample-app.git',
          docker_registry: 'registry.company.com',
          deployment_environment: 'staging'
        }
      );
      
      workflowEngine.registerWorkflow(customWorkflow);
      console.log(`✅ Workflow created from template: ${customWorkflow.id}`);
    }

    // Example: Execute a workflow manually
    const executionId = await workflowEngine.executeWorkflow(
      deploymentWorkflowId,
      {
        environment: 'staging',
        user: 'demo-user',
        inputs: {
          repository_url: 'https://github.com/company/demo-app.git',
          release_tag: 'v1.2.3',
          target_environment: 'staging'
        },
        metadata: { source: 'manual-demo' }
      },
      {
        docker_registry: 'registry.demo.com',
        kubernetes_namespace: 'staging'
      }
    );

    console.log(`✅ Workflow execution started: ${executionId}`);
    console.log('📊 Monitor execution progress through the workflow engine...');

    // Demonstrate trigger system
    console.log('🎯 Trigger system active and monitoring for events...');
    console.log('📈 Data pipeline system ready for processing...');
    console.log('🚨 Incident response system armed and ready...');

  } catch (error: any) {
    console.error('❌ Error during workflow demonstration:', error.message);
  }
}

// Export for use in other examples
export {
  demonstrateAdvancedWorkflows
};