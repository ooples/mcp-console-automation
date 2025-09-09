# AWS SSM (Systems Manager) Protocol

## Overview

The AWS SSM Protocol enables AI assistants to manage EC2 instances, execute commands remotely, handle patch management, and automate AWS infrastructure tasks through AWS Systems Manager Session Manager and Run Command services via the MCP Console Automation server.

## Features

- **Session Manager**: Secure shell access to EC2 instances without SSH/RDP
- **Run Command**: Execute commands on multiple instances simultaneously
- **Patch Management**: Automated patching and compliance monitoring
- **Parameter Store**: Secure configuration and secrets management
- **Inventory Collection**: Gather system information and installed software
- **Maintenance Windows**: Scheduled maintenance operations
- **State Manager**: Define and maintain instance configurations
- **Document Execution**: Run predefined or custom automation documents

## Prerequisites

- AWS account with appropriate permissions
- EC2 instances with SSM agent installed and running
- IAM roles configured for SSM access
- VPC endpoints configured (for private subnets)

### IAM Permissions

#### Required IAM Policy for Console Automation
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ssm:StartSession",
                "ssm:TerminateSession",
                "ssm:ResumeSession",
                "ssm:DescribeSessions",
                "ssm:GetConnectionStatus"
            ],
            "Resource": [
                "arn:aws:ssm:*:*:session/${aws:username}-*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "ssm:SendCommand",
                "ssm:ListCommandInvocations",
                "ssm:DescribeInstanceInformation",
                "ssm:GetCommandInvocation",
                "ssm:CancelCommand"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameter",
                "ssm:GetParameters",
                "ssm:GetParametersByPath",
                "ssm:PutParameter",
                "ssm:DeleteParameter"
            ],
            "Resource": "arn:aws:ssm:*:*:parameter/*"
        }
    ]
}
```

#### EC2 Instance Role
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ssm:UpdateInstanceInformation",
                "ssmmessages:CreateControlChannel",
                "ssmmessages:CreateDataChannel",
                "ssmmessages:OpenControlChannel",
                "ssmmessages:OpenDataChannel",
                "ec2messages:AcknowledgeMessage",
                "ec2messages:DeleteMessage",
                "ec2messages:FailMessage",
                "ec2messages:GetEndpoint",
                "ec2messages:GetMessages",
                "ec2messages:SendReply"
            ],
            "Resource": "*"
        }
    ]
}
```

## Configuration

### Basic Configuration

```typescript
const ssmConfig: AWSSSMProtocolConfig = {
  connection: {
    region: 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    // sessionToken: process.env.AWS_SESSION_TOKEN, // For temporary credentials
  },
  sessionManager: {
    enabled: true,
    documentName: 'SSM-SessionManagerRunShell',
    sessionTimeout: 3600, // 1 hour
    idleTimeout: 1200,     // 20 minutes
    maxConcurrentSessions: 10
  },
  runCommand: {
    enabled: true,
    defaultTimeout: 300,    // 5 minutes
    outputS3Bucket: 'my-ssm-output-bucket',
    outputS3KeyPrefix: 'command-outputs/',
    maxConcurrency: 50,
    maxErrors: 5
  },
  parameterStore: {
    enabled: true,
    defaultType: 'String',
    keyId: 'alias/aws/ssm', // KMS key for SecureString
    tier: 'Standard'
  }
};
```

### Multi-Account Configuration

```typescript
const multiAccountSSMConfig = {
  accounts: {
    production: {
      region: 'us-east-1',
      roleArn: 'arn:aws:iam::123456789012:role/CrossAccountSSMRole',
      externalId: 'unique-external-id'
    },
    staging: {
      region: 'us-west-2',
      profile: 'staging-profile' // Use AWS profile
    },
    development: {
      region: 'eu-west-1',
      accessKeyId: process.env.DEV_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.DEV_AWS_SECRET_ACCESS_KEY
    }
  },
  defaultAccount: 'development'
};
```

### Advanced Configuration

```typescript
const advancedSSMConfig: AWSSSMProtocolConfig = {
  connection: {
    region: 'us-east-1',
    endpoint: 'https://ssm.us-east-1.amazonaws.com', // Custom endpoint
    maxRetries: 3,
    retryDelayOptions: {
      base: 300
    },
    httpOptions: {
      timeout: 120000,
      connectTimeout: 60000
    }
  },
  sessionManager: {
    preferences: {
      shellProfile: {
        linux: '/bin/bash',
        windows: 'powershell'
      },
      environment: {
        'TERM': 'xterm-256color',
        'LC_ALL': 'en_US.UTF-8'
      },
      runAsUser: 'ec2-user',
      runAsElevated: false
    },
    logging: {
      cloudWatchEnabled: true,
      cloudWatchLogGroup: 'aws-ssm-sessions',
      s3Enabled: true,
      s3Bucket: 'my-session-logs',
      s3KeyPrefix: 'session-logs/'
    }
  },
  automation: {
    documentExecutionTimeout: 3600,
    maxConcurrentExecutions: 10,
    failureThreshold: 10,
    successCriteria: 'SuccessfullyCompleted'
  }
};
```

## Usage Examples

### 1. Interactive Session Management

```javascript
// Start interactive session with EC2 instance
const sessionResult = await console_create_session({
  command: 'aws-ssm-session',
  consoleType: 'aws-ssm',
  awsOptions: {
    instanceId: 'i-1234567890abcdef0',
    region: 'us-east-1',
    sessionType: 'interactive'
  }
});

console.log(`Session started: ${sessionResult.sessionId}`);

// Execute commands in the session
await console_send_input({
  sessionId: sessionResult.sessionId,
  input: 'sudo yum update -y\n'
});

// Wait for command completion
await console_wait_for_output({
  sessionId: sessionResult.sessionId,
  pattern: 'Complete!',
  timeout: 300000 // 5 minutes
});

// Check system status
await console_send_input({
  sessionId: sessionResult.sessionId,
  input: 'systemctl status httpd\n'
});

// Get session output
const output = await console_get_output({
  sessionId: sessionResult.sessionId,
  limit: 100
});

console.log('Session output:', output);
```

### 2. Run Command on Multiple Instances

```javascript
// Execute command on multiple instances
const runCommandResult = await console_execute_command({
  command: 'aws-ssm-run-command',
  args: ['AWS-RunShellScript'],
  consoleType: 'aws-ssm',
  awsOptions: {
    instanceIds: [
      'i-1234567890abcdef0',
      'i-0987654321fedcba0',
      'i-abcdef1234567890'
    ],
    parameters: {
      commands: [
        '#!/bin/bash',
        'echo "Starting system update"',
        'sudo yum update -y',
        'sudo systemctl restart httpd',
        'echo "Update completed at $(date)"'
      ]
    },
    region: 'us-east-1',
    timeoutSeconds: 300,
    maxConcurrency: '3',
    maxErrors: '1'
  }
});

// Monitor command execution
const commandId = runCommandResult.commandId;
console.log(`Command execution started: ${commandId}`);

// Wait for completion
let allInstancesComplete = false;
while (!allInstancesComplete) {
  const status = await console_execute_command({
    command: 'aws-ssm-get-command-invocation',
    args: [commandId],
    consoleType: 'aws-ssm',
    awsOptions: {
      region: 'us-east-1'
    }
  });

  const invocations = JSON.parse(status.output);
  allInstancesComplete = invocations.every(inv => 
    inv.Status === 'Success' || 
    inv.Status === 'Failed' || 
    inv.Status === 'Cancelled'
  );

  if (!allInstancesComplete) {
    console.log('Waiting for command completion...');
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
  }
}

// Get detailed results
for (const instanceId of runCommandResult.instanceIds) {
  const invocationResult = await console_execute_command({
    command: 'aws-ssm-get-command-invocation',
    args: [commandId, instanceId],
    consoleType: 'aws-ssm',
    awsOptions: {
      region: 'us-east-1'
    }
  });

  const invocation = JSON.parse(invocationResult.output);
  console.log(`Instance ${instanceId}:`);
  console.log(`  Status: ${invocation.Status}`);
  console.log(`  Output: ${invocation.StandardOutputContent}`);
  
  if (invocation.Status === 'Failed') {
    console.error(`  Error: ${invocation.StandardErrorContent}`);
  }
}
```

### 3. Automated Patch Management

```javascript
// Automated patching workflow
async function performPatchManagement(instanceGroups) {
  console.log('Starting automated patch management...');

  for (const group of instanceGroups) {
    console.log(`Processing group: ${group.name}`);

    try {
      // Create maintenance window
      const maintenanceWindow = await console_execute_command({
        command: 'aws-ssm-create-maintenance-window',
        consoleType: 'aws-ssm',
        awsOptions: {
          name: `${group.name}-patching-${Date.now()}`,
          description: `Automated patching for ${group.name}`,
          schedule: group.schedule || 'cron(0 2 ? * SUN *)', // Sunday 2 AM
          duration: group.duration || 4, // 4 hours
          cutoff: group.cutoff || 1, // 1 hour before end
          allowUnassociatedTargets: false,
          region: group.region || 'us-east-1'
        }
      });

      const windowId = JSON.parse(maintenanceWindow.output).WindowId;

      // Register targets (instances)
      await console_execute_command({
        command: 'aws-ssm-register-target-with-maintenance-window',
        consoleType: 'aws-ssm',
        awsOptions: {
          windowId: windowId,
          resourceType: 'INSTANCE',
          targets: [{
            key: 'tag:PatchGroup',
            values: [group.name]
          }],
          region: group.region || 'us-east-1'
        }
      });

      // Register patch task
      await console_execute_command({
        command: 'aws-ssm-register-task-with-maintenance-window',
        consoleType: 'aws-ssm',
        awsOptions: {
          windowId: windowId,
          taskType: 'RUN_COMMAND',
          taskArn: 'AWS-RunPatchBaseline',
          serviceRoleArn: 'arn:aws:iam::123456789012:role/MW-Role',
          maxConcurrency: group.maxConcurrency || '10',
          maxErrors: group.maxErrors || '2',
          priority: 1,
          parameters: {
            Operation: ['Install'],
            RebootOption: ['RebootIfNeeded']
          },
          region: group.region || 'us-east-1'
        }
      });

      console.log(`Maintenance window created: ${windowId}`);

      // Monitor patch compliance
      await monitorPatchCompliance(group.instanceIds, group.region);

    } catch (error) {
      console.error(`Patch management failed for group ${group.name}:`, error.message);
    }
  }
}

async function monitorPatchCompliance(instanceIds, region) {
  console.log('Monitoring patch compliance...');

  const complianceResult = await console_execute_command({
    command: 'aws-ssm-list-compliance-items',
    consoleType: 'aws-ssm',
    awsOptions: {
      resourceIds: instanceIds,
      resourceTypes: ['ManagedInstance'],
      complianceTypes: ['Patch'],
      region: region
    }
  });

  const complianceItems = JSON.parse(complianceResult.output);
  
  for (const item of complianceItems) {
    console.log(`Instance ${item.ResourceId}: ${item.ComplianceType} - ${item.Status}`);
    
    if (item.Status === 'NON_COMPLIANT') {
      console.warn(`Non-compliant instance detected: ${item.ResourceId}`);
      
      // Get detailed compliance information
      const detailResult = await console_execute_command({
        command: 'aws-ssm-list-compliance-items',
        consoleType: 'aws-ssm',
        awsOptions: {
          resourceId: item.ResourceId,
          resourceType: 'ManagedInstance',
          complianceType: 'Patch',
          region: region
        }
      });

      const details = JSON.parse(detailResult.output);
      console.log(`Details for ${item.ResourceId}:`, details);
    }
  }
}

// Execute patching for different environment groups
const patchGroups = [
  {
    name: 'production-web',
    instanceIds: ['i-prod1', 'i-prod2'],
    schedule: 'cron(0 3 ? * SUN *)', // Sunday 3 AM
    duration: 2,
    maxConcurrency: '1', // One at a time for production
    maxErrors: '0',
    region: 'us-east-1'
  },
  {
    name: 'staging-env',
    instanceIds: ['i-stage1', 'i-stage2', 'i-stage3'],
    schedule: 'cron(0 2 ? * SAT *)', // Saturday 2 AM
    duration: 3,
    maxConcurrency: '50%',
    maxErrors: '1',
    region: 'us-west-2'
  }
];

await performPatchManagement(patchGroups);
```

### 4. Parameter Store Configuration Management

```javascript
// Configuration management using Parameter Store
class SSMConfigManager {
  constructor(region = 'us-east-1') {
    this.region = region;
  }

  async deployConfiguration(environment, configData) {
    console.log(`Deploying configuration for ${environment}...`);

    const basePath = `/myapp/${environment}`;
    const configEntries = this.flattenConfig(configData, basePath);

    for (const [path, value] of Object.entries(configEntries)) {
      try {
        // Determine parameter type
        const isSecret = path.includes('password') || path.includes('secret') || path.includes('key');
        const parameterType = isSecret ? 'SecureString' : 'String';

        await console_execute_command({
          command: 'aws-ssm-put-parameter',
          consoleType: 'aws-ssm',
          awsOptions: {
            name: path,
            value: value.toString(),
            type: parameterType,
            overwrite: true,
            tier: value.toString().length > 4096 ? 'Advanced' : 'Standard',
            region: this.region,
            tags: [
              { key: 'Environment', value: environment },
              { key: 'Application', value: 'myapp' },
              { key: 'ManagedBy', value: 'console-automation' }
            ]
          }
        });

        console.log(`✓ Updated parameter: ${path}`);

      } catch (error) {
        console.error(`✗ Failed to update parameter ${path}:`, error.message);
      }
    }

    // Notify instances to refresh configuration
    await this.notifyConfigurationUpdate(environment);
  }

  async getConfiguration(environment, application = 'myapp') {
    const basePath = `/${application}/${environment}`;
    
    const parametersResult = await console_execute_command({
      command: 'aws-ssm-get-parameters-by-path',
      consoleType: 'aws-ssm',
      awsOptions: {
        path: basePath,
        recursive: true,
        withDecryption: true,
        region: this.region
      }
    });

    const parameters = JSON.parse(parametersResult.output);
    return this.unflattenConfig(parameters, basePath);
  }

  async notifyConfigurationUpdate(environment) {
    // Get instances for environment
    const instancesResult = await console_execute_command({
      command: 'aws-ssm-describe-instance-information',
      consoleType: 'aws-ssm',
      awsOptions: {
        filters: [
          {
            key: 'tag:Environment',
            valueSet: [environment]
          }
        ],
        region: this.region
      }
    });

    const instances = JSON.parse(instancesResult.output);
    const instanceIds = instances.map(inst => inst.InstanceId);

    if (instanceIds.length === 0) {
      console.log('No instances found for configuration update notification');
      return;
    }

    // Send configuration reload command
    await console_execute_command({
      command: 'aws-ssm-run-command',
      args: ['AWS-RunShellScript'],
      consoleType: 'aws-ssm',
      awsOptions: {
        instanceIds: instanceIds,
        parameters: {
          commands: [
            '#!/bin/bash',
            'echo "Configuration updated - reloading application"',
            'sudo systemctl reload myapp || sudo service myapp reload',
            'echo "Configuration reload completed at $(date)"'
          ]
        },
        region: this.region
      }
    });

    console.log(`Configuration update notification sent to ${instanceIds.length} instances`);
  }

  flattenConfig(obj, prefix = '') {
    const flattened = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}/${key}` : key;
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(flattened, this.flattenConfig(value, newKey));
      } else {
        flattened[newKey] = value;
      }
    }
    
    return flattened;
  }

  unflattenConfig(parameters, basePath) {
    const config = {};
    
    for (const param of parameters) {
      const path = param.Name.replace(basePath + '/', '').split('/');
      let current = config;
      
      for (let i = 0; i < path.length - 1; i++) {
        if (!(path[i] in current)) {
          current[path[i]] = {};
        }
        current = current[path[i]];
      }
      
      current[path[path.length - 1]] = param.Value;
    }
    
    return config;
  }
}

// Usage example
const configManager = new SSMConfigManager('us-east-1');

// Deploy configuration
const productionConfig = {
  database: {
    host: 'prod-db.example.com',
    port: 5432,
    name: 'production_db',
    username: 'dbuser',
    password: 'super-secure-password'
  },
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 30000,
    retries: 3
  },
  features: {
    newFeatureEnabled: true,
    debugMode: false
  }
};

await configManager.deployConfiguration('production', productionConfig);

// Retrieve configuration
const currentConfig = await configManager.getConfiguration('production');
console.log('Current configuration:', currentConfig);
```

### 5. Infrastructure Automation

```javascript
// Automated infrastructure setup and configuration
async function setupWebServerCluster(clusterConfig) {
  console.log(`Setting up web server cluster: ${clusterConfig.name}`);

  const instanceIds = clusterConfig.instanceIds;

  // Step 1: Install and configure web server
  console.log('Installing web server software...');
  
  const installResult = await console_execute_command({
    command: 'aws-ssm-run-command',
    args: ['AWS-RunShellScript'],
    consoleType: 'aws-ssm',
    awsOptions: {
      instanceIds: instanceIds,
      parameters: {
        commands: [
          '#!/bin/bash',
          'yum update -y',
          'yum install -y httpd php mysql',
          'systemctl enable httpd',
          'systemctl start httpd',
          'chkconfig httpd on'
        ]
      },
      timeoutSeconds: 600,
      region: clusterConfig.region
    }
  });

  // Step 2: Configure load balancer health checks
  console.log('Configuring health check endpoint...');
  
  await console_execute_command({
    command: 'aws-ssm-run-command',
    args: ['AWS-RunShellScript'],
    consoleType: 'aws-ssm',
    awsOptions: {
      instanceIds: instanceIds,
      parameters: {
        commands: [
          'cat > /var/www/html/health.php << EOF',
          '<?php',
          'header("Content-Type: application/json");',
          '$status = array(',
          '  "status" => "healthy",',
          '  "timestamp" => date("c"),',
          '  "hostname" => gethostname(),',
          '  "load" => sys_getloadavg()[0]',
          ');',
          'echo json_encode($status);',
          '?>',
          'EOF',
          'chmod 644 /var/www/html/health.php'
        ]
      },
      region: clusterConfig.region
    }
  });

  // Step 3: Deploy application code
  console.log('Deploying application code...');
  
  await console_execute_command({
    command: 'aws-ssm-run-command',
    args: ['AWS-RunShellScript'],
    consoleType: 'aws-ssm',
    awsOptions: {
      instanceIds: instanceIds,
      parameters: {
        commands: [
          `aws s3 sync s3://${clusterConfig.deploymentBucket}/latest/ /var/www/html/ --delete`,
          'chown -R apache:apache /var/www/html',
          'chmod -R 755 /var/www/html',
          'systemctl reload httpd'
        ]
      },
      region: clusterConfig.region
    }
  });

  // Step 4: Configure monitoring
  console.log('Setting up monitoring...');
  
  await console_execute_command({
    command: 'aws-ssm-run-command',
    args: ['AWS-ConfigureAWSPackage'],
    consoleType: 'aws-ssm',
    awsOptions: {
      instanceIds: instanceIds,
      parameters: {
        action: 'Install',
        name: 'AmazonCloudWatchAgent'
      },
      region: clusterConfig.region
    }
  });

  // Step 5: Verify deployment
  console.log('Verifying deployment...');
  
  for (const instanceId of instanceIds) {
    const verifyResult = await console_execute_command({
      command: 'aws-ssm-run-command',
      args: ['AWS-RunShellScript'],
      consoleType: 'aws-ssm',
      awsOptions: {
        instanceIds: [instanceId],
        parameters: {
          commands: [
            'curl -f http://localhost/health.php',
            'systemctl is-active httpd',
            'ps aux | grep httpd | grep -v grep | wc -l'
          ]
        },
        region: clusterConfig.region
      }
    });

    console.log(`Instance ${instanceId} verification completed`);
  }

  console.log('Web server cluster setup completed successfully');
}

// Example cluster configuration
const webClusterConfig = {
  name: 'production-web-cluster',
  instanceIds: [
    'i-1234567890abcdef0',
    'i-0987654321fedcba0',
    'i-abcdef1234567890'
  ],
  region: 'us-east-1',
  deploymentBucket: 'my-app-deployments'
};

await setupWebServerCluster(webClusterConfig);
```

### 6. Inventory and Compliance Monitoring

```javascript
// Comprehensive inventory and compliance monitoring
async function performComplianceAudit(accountRegions) {
  console.log('Starting compliance audit...');

  const auditReport = {
    timestamp: new Date().toISOString(),
    accounts: {},
    summary: {
      totalInstances: 0,
      compliantInstances: 0,
      nonCompliantInstances: 0,
      offlineInstances: 0
    }
  };

  for (const account of accountRegions) {
    console.log(`Auditing account ${account.accountId} in ${account.region}...`);

    auditReport.accounts[account.accountId] = {
      region: account.region,
      instances: [],
      compliance: {},
      inventory: {}
    };

    try {
      // Get instance information
      const instancesResult = await console_execute_command({
        command: 'aws-ssm-describe-instance-information',
        consoleType: 'aws-ssm',
        awsOptions: {
          region: account.region,
          maxResults: 50
        }
      });

      const instances = JSON.parse(instancesResult.output);
      auditReport.summary.totalInstances += instances.length;

      for (const instance of instances) {
        console.log(`  Checking instance: ${instance.InstanceId}`);

        const instanceAudit = {
          instanceId: instance.InstanceId,
          name: instance.Name || 'Unknown',
          platformType: instance.PlatformType,
          platformName: instance.PlatformName,
          platformVersion: instance.PlatformVersion,
          agentVersion: instance.AgentVersion,
          lastPingDateTime: instance.LastPingDateTime,
          status: instance.PingStatus,
          compliance: {},
          inventory: {}
        };

        if (instance.PingStatus === 'Online') {
          // Check patch compliance
          const patchComplianceResult = await console_execute_command({
            command: 'aws-ssm-list-compliance-items',
            consoleType: 'aws-ssm',
            awsOptions: {
              resourceId: instance.InstanceId,
              resourceType: 'ManagedInstance',
              complianceType: 'Patch',
              region: account.region
            }
          });

          const patchCompliance = JSON.parse(patchComplianceResult.output);
          instanceAudit.compliance.patches = patchCompliance;

          // Check configuration compliance
          const configComplianceResult = await console_execute_command({
            command: 'aws-ssm-list-compliance-items',
            consoleType: 'aws-ssm',
            awsOptions: {
              resourceId: instance.InstanceId,
              resourceType: 'ManagedInstance',
              complianceType: 'Configuration',
              region: account.region
            }
          });

          const configCompliance = JSON.parse(configComplianceResult.output);
          instanceAudit.compliance.configuration = configCompliance;

          // Get inventory data
          const inventoryResult = await console_execute_command({
            command: 'aws-ssm-get-inventory',
            consoleType: 'aws-ssm',
            awsOptions: {
              filters: [
                {
                  key: 'AWS:InstanceInformation.InstanceId',
                  values: [instance.InstanceId]
                }
              ],
              region: account.region
            }
          });

          const inventoryData = JSON.parse(inventoryResult.output);
          instanceAudit.inventory = inventoryData;

          // Determine overall compliance status
          const isCompliant = this.determineComplianceStatus(instanceAudit);
          if (isCompliant) {
            auditReport.summary.compliantInstances++;
          } else {
            auditReport.summary.nonCompliantInstances++;
          }

        } else {
          auditReport.summary.offlineInstances++;
        }

        auditReport.accounts[account.accountId].instances.push(instanceAudit);
      }

    } catch (error) {
      console.error(`Failed to audit account ${account.accountId}:`, error.message);
    }
  }

  // Generate compliance report
  await this.generateComplianceReport(auditReport);
  
  // Send alerts for critical issues
  await this.sendComplianceAlerts(auditReport);

  return auditReport;
}

function determineComplianceStatus(instanceAudit) {
  // Check if instance has critical non-compliance issues
  const criticalIssues = [];

  // Check patch compliance
  if (instanceAudit.compliance.patches) {
    const criticalPatches = instanceAudit.compliance.patches.filter(p => 
      p.Status === 'NON_COMPLIANT' && p.Severity === 'Critical'
    );
    if (criticalPatches.length > 0) {
      criticalIssues.push('Critical patches missing');
    }
  }

  // Check agent version
  if (instanceAudit.agentVersion && this.isAgentVersionOutdated(instanceAudit.agentVersion)) {
    criticalIssues.push('SSM Agent outdated');
  }

  // Check last ping time
  const lastPing = new Date(instanceAudit.lastPingDateTime);
  const hoursSinceLastPing = (Date.now() - lastPing.getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastPing > 24) {
    criticalIssues.push('Instance not communicating');
  }

  return criticalIssues.length === 0;
}

async function generateComplianceReport(auditReport) {
  const reportContent = `
# AWS Systems Manager Compliance Audit Report

Generated: ${auditReport.timestamp}

## Summary
- Total Instances: ${auditReport.summary.totalInstances}
- Compliant: ${auditReport.summary.compliantInstances}
- Non-Compliant: ${auditReport.summary.nonCompliantInstances}
- Offline: ${auditReport.summary.offlineInstances}

## Compliance Rate
${((auditReport.summary.compliantInstances / auditReport.summary.totalInstances) * 100).toFixed(2)}%

## Account Details
${Object.entries(auditReport.accounts).map(([accountId, accountData]) => `
### Account: ${accountId} (${accountData.region})
- Instances: ${accountData.instances.length}
- Compliant: ${accountData.instances.filter(i => this.determineComplianceStatus(i)).length}
`).join('')}

## Recommendations
${this.generateRecommendations(auditReport)}
`;

  // Save report to S3 or local file
  const reportPath = `compliance-reports/audit-${Date.now()}.md`;
  require('fs').writeFileSync(reportPath, reportContent);
  
  console.log(`Compliance report generated: ${reportPath}`);
}

// Run compliance audit
const auditScope = [
  { accountId: '123456789012', region: 'us-east-1' },
  { accountId: '123456789012', region: 'us-west-2' },
  { accountId: '234567890123', region: 'eu-west-1' }
];

const auditResults = await performComplianceAudit(auditScope);
console.log('Compliance audit completed:', auditResults.summary);
```

## Advanced Features

### Custom SSM Documents

```javascript
// Create and execute custom SSM documents
const customDocument = {
  schemaVersion: '2.2',
  description: 'Custom application deployment script',
  parameters: {
    applicationVersion: {
      type: 'String',
      description: 'Version of application to deploy'
    },
    environment: {
      type: 'String',
      description: 'Target environment',
      allowedValues: ['dev', 'staging', 'production']
    }
  },
  mainSteps: [
    {
      action: 'aws:runShellScript',
      name: 'downloadApplication',
      inputs: {
        runCommand: [
          'cd /opt/applications',
          'wget https://releases.example.com/app-{{ applicationVersion }}.tar.gz',
          'tar -xzf app-{{ applicationVersion }}.tar.gz'
        ]
      }
    },
    {
      action: 'aws:runShellScript',
      name: 'deployApplication',
      inputs: {
        runCommand: [
          'systemctl stop myapp',
          'cp -r /opt/applications/app-{{ applicationVersion }}/* /opt/myapp/',
          'chown -R appuser:appgroup /opt/myapp',
          'systemctl start myapp'
        ]
      }
    },
    {
      action: 'aws:runShellScript',
      name: 'verifyDeployment',
      inputs: {
        runCommand: [
          'sleep 10',
          'curl -f http://localhost:8080/health || exit 1',
          'echo "Deployment successful"'
        ]
      }
    }
  ]
};

// Create document
await console_execute_command({
  command: 'aws-ssm-create-document',
  consoleType: 'aws-ssm',
  awsOptions: {
    content: JSON.stringify(customDocument),
    name: 'MyApp-Deploy',
    documentType: 'Command',
    documentFormat: 'JSON',
    region: 'us-east-1'
  }
});

// Execute custom document
await console_execute_command({
  command: 'aws-ssm-run-command',
  args: ['MyApp-Deploy'],
  consoleType: 'aws-ssm',
  awsOptions: {
    instanceIds: ['i-1234567890abcdef0'],
    parameters: {
      applicationVersion: '1.2.3',
      environment: 'production'
    },
    region: 'us-east-1'
  }
});
```

### Port Forwarding

```javascript
// Set up port forwarding through Session Manager
const portForwardSession = await console_create_session({
  command: 'aws-ssm-start-session',
  consoleType: 'aws-ssm',
  awsOptions: {
    target: 'i-1234567890abcdef0',
    documentName: 'AWS-StartPortForwardingSession',
    parameters: {
      portNumber: '80',
      localPortNumber: '8080'
    },
    region: 'us-east-1'
  }
});

console.log('Port forwarding active - access http://localhost:8080');

// The session will maintain the port forward until terminated
```

## Error Handling

### Session Management Errors

```javascript
protocol.on('session-error', (error, sessionInfo) => {
  console.error(`SSM Session error: ${error.message}`);
  
  switch (error.code) {
    case 'TargetNotConnected':
      console.error('Instance is not connected to SSM - check SSM agent');
      break;
    case 'AccessDenied':
      console.error('Access denied - check IAM permissions');
      break;
    case 'SessionLimitExceeded':
      console.error('Maximum concurrent sessions reached');
      break;
    case 'InvalidTarget':
      console.error('Invalid target instance ID');
      break;
  }
});

protocol.on('command-failed', (error, commandInfo) => {
  console.error(`Command execution failed: ${error.message}`);
  
  // Retry logic for transient failures
  if (error.code === 'InternalServerError' || error.code === 'Throttling') {
    console.log('Retrying command after delay...');
    setTimeout(() => {
      retryCommand(commandInfo);
    }, 5000);
  }
});
```

### Instance Connectivity Issues

```javascript
// Check and troubleshoot instance connectivity
async function troubleshootInstanceConnectivity(instanceId, region) {
  console.log(`Troubleshooting connectivity for instance ${instanceId}...`);

  // Check if instance exists and is running
  const instanceResult = await console_execute_command({
    command: 'aws-ec2-describe-instances',
    consoleType: 'aws-ec2',
    awsOptions: {
      instanceIds: [instanceId],
      region: region
    }
  });

  const instance = JSON.parse(instanceResult.output).Instances[0];
  console.log(`Instance state: ${instance.State.Name}`);

  if (instance.State.Name !== 'running') {
    console.error('Instance is not in running state');
    return false;
  }

  // Check SSM agent status
  const ssmInfoResult = await console_execute_command({
    command: 'aws-ssm-describe-instance-information',
    consoleType: 'aws-ssm',
    awsOptions: {
      filters: [
        {
          key: 'InstanceIds',
          valueSet: [instanceId]
        }
      ],
      region: region
    }
  });

  const ssmInfo = JSON.parse(ssmInfoResult.output);
  
  if (ssmInfo.length === 0) {
    console.error('Instance not registered with SSM');
    console.log('Troubleshooting steps:');
    console.log('1. Check if SSM agent is installed and running');
    console.log('2. Verify IAM role has required SSM permissions');
    console.log('3. Check VPC endpoints for private subnets');
    return false;
  }

  const instanceInfo = ssmInfo[0];
  console.log(`SSM Agent version: ${instanceInfo.AgentVersion}`);
  console.log(`Last ping: ${instanceInfo.LastPingDateTime}`);
  console.log(`Ping status: ${instanceInfo.PingStatus}`);

  if (instanceInfo.PingStatus !== 'Online') {
    console.error('Instance is not online in SSM');
    
    // Check if agent is outdated
    if (this.isAgentVersionOutdated(instanceInfo.AgentVersion)) {
      console.log('SSM agent may need updating');
    }
    
    return false;
  }

  console.log('Instance connectivity looks good');
  return true;
}
```

## Best Practices

### 1. Security

```javascript
// Use least privilege IAM policies
const restrictivePolicy = {
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:StartSession"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:document/AWS-StartInteractiveCommand",
        "arn:aws:ssm:*:*:document/AWS-StartPortForwardingSession"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:StartSession"
      ],
      "Resource": [
        "arn:aws:ec2:*:*:instance/*"
      ],
      "Condition": {
        "StringEquals": {
          "ssm:resourceTag/Environment": "${aws:PrincipalTag/Environment}"
        }
      }
    }
  ]
};

// Enable session logging
const sessionPreferences = {
  sessionManagerPreferences: {
    shellProfile: {
      linux: '/usr/bin/bash -l',
      windows: ''
    },
    sessionLoggingEnabled: true,
    cloudWatchLogGroupName: 'aws-ssm-session-logs',
    cloudWatchStreamingEnabled: true,
    s3BucketName: 'my-session-logs-bucket',
    s3KeyPrefix: 'session-logs/',
    s3EncryptionEnabled: true
  }
};

// Implement session timeout
const sessionConfig = {
  sessionTimeout: 1800, // 30 minutes
  idleTimeout: 900,     // 15 minutes
  maxConcurrentSessions: 5
};
```

### 2. Monitoring and Alerting

```javascript
// Set up comprehensive monitoring
const monitoringConfig = {
  cloudWatch: {
    enabled: true,
    logGroups: [
      'aws-ssm-session-logs',
      'aws-ssm-run-command-logs'
    ],
    metrics: [
      'SSM-SessionDuration',
      'SSM-CommandExecutionTime',
      'SSM-FailedCommands'
    ]
  },
  alerts: [
    {
      name: 'HighSessionDuration',
      metric: 'SSM-SessionDuration',
      threshold: 3600, // 1 hour
      action: 'notify-security-team'
    },
    {
      name: 'FailedCommandRate',
      metric: 'SSM-FailedCommands',
      threshold: 5,
      period: 300, // 5 minutes
      action: 'investigate-issues'
    }
  ]
};

// Monitor session activities
protocol.on('session-started', (sessionInfo) => {
  logger.info('SSM session started', {
    sessionId: sessionInfo.sessionId,
    instanceId: sessionInfo.target,
    user: sessionInfo.user,
    timestamp: new Date().toISOString()
  });
});

protocol.on('session-ended', (sessionInfo) => {
  logger.info('SSM session ended', {
    sessionId: sessionInfo.sessionId,
    duration: sessionInfo.duration,
    reason: sessionInfo.terminationReason
  });
});
```

### 3. Cost Optimization

```javascript
// Implement cost controls
const costControls = {
  sessionLimits: {
    maxConcurrentSessions: 10,
    maxSessionDuration: 7200, // 2 hours
    autoTerminateIdleSessions: true,
    idleTimeout: 1800 // 30 minutes
  },
  runCommandLimits: {
    maxConcurrentCommands: 25,
    maxExecutionTime: 3600, // 1 hour
    rateLimiting: {
      commandsPerMinute: 10,
      commandsPerHour: 100
    }
  },
  parameterStoreLimits: {
    maxParametersPerRequest: 10,
    preferStandardTier: true,
    automaticCleanup: {
      enabled: true,
      retentionDays: 90
    }
  }
};

// Monitor usage and costs
async function generateUsageReport(timeRange) {
  const report = {
    sessions: await getSessionUsage(timeRange),
    commands: await getCommandUsage(timeRange),
    parameters: await getParameterUsage(timeRange),
    estimatedCosts: {}
  };

  // Calculate estimated costs
  report.estimatedCosts.sessions = report.sessions.count * 0.05; // $0.05 per session
  report.estimatedCosts.commands = report.commands.count * 0.0025; // $0.0025 per command
  report.estimatedCosts.parameters = report.parameters.requests * 0.00004; // $0.00004 per request

  return report;
}
```

## Troubleshooting

### Common Issues

#### 1. Instance Not Showing in SSM
```javascript
// Diagnostic script
async function diagnoseSSMConnectivity(instanceId, region) {
  const checks = [
    'EC2 instance running',
    'SSM agent installed',
    'IAM role attached',
    'IAM permissions correct',
    'VPC endpoints configured',
    'Security groups allow HTTPS outbound'
  ];

  for (const check of checks) {
    const result = await performCheck(check, instanceId, region);
    console.log(`${check}: ${result ? '✓' : '✗'}`);
  }
}
```

#### 2. Session Connection Failures
```javascript
// Session troubleshooting
async function troubleshootSessionFailure(sessionId) {
  try {
    const sessionDetails = await console_execute_command({
      command: 'aws-ssm-describe-sessions',
      consoleType: 'aws-ssm',
      awsOptions: {
        state: 'History',
        filters: [
          {
            key: 'SessionId',
            value: sessionId
          }
        ]
      }
    });

    const session = JSON.parse(sessionDetails.output)[0];
    console.log('Session status:', session.Status);
    console.log('Reason:', session.Details);
    
  } catch (error) {
    console.error('Failed to get session details:', error.message);
  }
}
```

## Migration Guide

### From Direct SSH to SSM Session Manager

#### Before (SSH)
```bash
# Direct SSH access
ssh -i ~/.ssh/my-key.pem ec2-user@ec2-instance-ip.compute-1.amazonaws.com
```

#### After (SSM Session Manager)
```javascript
// SSM Session Manager
const session = await console_create_session({
  command: 'aws-ssm-start-session',
  consoleType: 'aws-ssm',
  awsOptions: {
    target: 'i-1234567890abcdef0',
    region: 'us-east-1'
  }
});

// No SSH keys or public IPs needed!
```

## Performance Tuning

### Optimize Command Execution

```javascript
// Batch commands for better performance
const batchCommands = [
  'yum update -y',
  'systemctl restart httpd',
  'systemctl status httpd'
].join(' && ');

await console_execute_command({
  command: 'aws-ssm-run-command',
  args: ['AWS-RunShellScript'],
  consoleType: 'aws-ssm',
  awsOptions: {
    instanceIds: instanceIds,
    parameters: {
      commands: [batchCommands]
    },
    maxConcurrency: '10', // Adjust based on capacity
    timeoutSeconds: 300
  }
});
```

## API Reference

### Events
- `session-started`: Session initiated
- `session-ended`: Session terminated
- `session-error`: Session error occurred
- `command-started`: Command execution started
- `command-completed`: Command execution finished
- `command-failed`: Command execution failed
- `parameter-updated`: Parameter Store value changed

### Methods
- `createSession(options)`: Start SSM session
- `runCommand(document, instances, parameters)`: Execute command
- `getParameter(name, decrypt)`: Get parameter value
- `putParameter(name, value, type)`: Set parameter value
- `listSessions(filters)`: List active sessions
- `terminateSession(sessionId)`: End session
- `getCommandInvocation(commandId, instanceId)`: Get command results
- `createMaintenanceWindow(config)`: Create maintenance window
- `getPatchCompliance(instanceIds)`: Get patch status

### Configuration Options
See the TypeScript interfaces in the source code for complete configuration options including `AWSSSMProtocolConfig`, `SSMConnectionOptions`, and `SSMSessionPreferences`.