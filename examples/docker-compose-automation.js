/**
 * Docker Compose Automation Example
 * 
 * This example demonstrates how to automate Docker Compose deployments,
 * including health checking, scaling, and rollback capabilities.
 * 
 * Use cases:
 * - Multi-service application deployment
 * - Blue/green deployments
 * - Automated health checking and monitoring
 * - Service scaling based on load
 * - Automated rollback on failure
 */

import { DockerProtocol } from '../src/protocols/DockerProtocol.js';
import { Logger } from '../src/utils/logger.js';

class DockerComposeAutomation {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('DockerComposeAutomation');
    this.protocol = new DockerProtocol(config.dockerConfig);
    this.deploymentHistory = [];
  }

  /**
   * Deploy a multi-service application using Docker Compose
   */
  async deployApplication(deploymentConfig) {
    const deploymentId = `deploy-${Date.now()}`;
    this.logger.info(`Starting deployment: ${deploymentId}`, deploymentConfig);

    try {
      // Step 1: Pre-deployment validation
      await this.validateDeployment(deploymentConfig);

      // Step 2: Create backup of current deployment
      const backupInfo = await this.createDeploymentBackup(deploymentConfig);

      // Step 3: Build images if needed
      if (deploymentConfig.build) {
        await this.buildImages(deploymentConfig.services);
      }

      // Step 4: Deploy services in order
      const deployedServices = await this.deployServices(deploymentConfig);

      // Step 5: Health check all services
      const healthResults = await this.performHealthChecks(deployedServices);

      // Step 6: Verify deployment
      await this.verifyDeployment(deployedServices);

      // Step 7: Update traffic routing if needed
      if (deploymentConfig.loadBalancer) {
        await this.updateLoadBalancer(deployedServices);
      }

      // Record successful deployment
      const deployment = {
        id: deploymentId,
        timestamp: new Date(),
        config: deploymentConfig,
        services: deployedServices,
        health: healthResults,
        backup: backupInfo,
        status: 'success'
      };

      this.deploymentHistory.push(deployment);
      this.logger.info(`Deployment completed successfully: ${deploymentId}`);

      return deployment;

    } catch (error) {
      this.logger.error(`Deployment failed: ${deploymentId}`, error);

      // Attempt rollback
      if (deploymentConfig.autoRollback !== false) {
        await this.rollbackDeployment(deploymentId, error);
      }

      throw error;
    }
  }

  /**
   * Validate deployment configuration and prerequisites
   */
  async validateDeployment(config) {
    this.logger.info('Validating deployment configuration...');

    // Check Docker Compose file exists
    const composeFiles = Array.isArray(config.composeFiles) ? config.composeFiles : [config.composeFiles || 'docker-compose.yml'];
    
    for (const file of composeFiles) {
      const fileExists = await this.checkFileExists(file);
      if (!fileExists) {
        throw new Error(`Docker Compose file not found: ${file}`);
      }
    }

    // Validate required images are available or can be built
    await this.validateImages(config.services);

    // Check resource requirements
    await this.validateResources(config.services);

    // Validate network configuration
    await this.validateNetworking(config.networking);

    this.logger.info('Deployment validation completed');
  }

  /**
   * Create backup of current deployment
   */
  async createDeploymentBackup(config) {
    this.logger.info('Creating deployment backup...');

    const backupId = `backup-${Date.now()}`;
    const backupPath = `./backups/${backupId}`;

    try {
      // Create backup directory
      await console_execute_command({
        command: 'mkdir',
        args: ['-p', backupPath]
      });

      // Export current container configurations
      const runningContainers = await this.getRunningContainers(config.project);
      const containerBackups = [];

      for (const container of runningContainers) {
        // Export container as image
        const imageBackup = `${backupPath}/${container.name}-backup.tar`;
        await console_execute_command({
          command: 'docker',
          args: ['commit', container.id, `${container.name}-backup:${backupId}`]
        });

        await console_execute_command({
          command: 'docker',
          args: ['save', '-o', imageBackup, `${container.name}-backup:${backupId}`]
        });

        containerBackups.push({
          name: container.name,
          image: container.image,
          backupImage: imageBackup
        });
      }

      // Backup volumes
      const volumeBackups = await this.backupVolumes(config.project, backupPath);

      // Backup environment files
      const envBackups = await this.backupEnvironmentFiles(config.envFiles, backupPath);

      const backupInfo = {
        id: backupId,
        timestamp: new Date(),
        path: backupPath,
        containers: containerBackups,
        volumes: volumeBackups,
        environment: envBackups
      };

      this.logger.info(`Backup created: ${backupId}`);
      return backupInfo;

    } catch (error) {
      this.logger.error('Backup creation failed', error);
      throw error;
    }
  }

  /**
   * Deploy services using Docker Compose
   */
  async deployServices(config) {
    this.logger.info('Deploying services...');

    const deployedServices = [];
    const composeArgs = this.buildComposeArgs(config);

    try {
      // Pull latest images
      if (config.pull !== false) {
        this.logger.info('Pulling latest images...');
        await console_execute_command({
          command: 'docker-compose',
          args: [...composeArgs, 'pull'],
          timeout: 600000 // 10 minutes
        });
      }

      // Deploy services
      this.logger.info('Starting services...');
      const deployResult = await console_execute_command({
        command: 'docker-compose',
        args: [
          ...composeArgs,
          'up',
          '-d',
          config.forceRecreate ? '--force-recreate' : '',
          config.noCache ? '--no-cache' : '',
          config.removeOrphans ? '--remove-orphans' : ''
        ].filter(Boolean),
        timeout: 900000 // 15 minutes
      });

      if (deployResult.exitCode !== 0) {
        throw new Error(`Docker Compose deployment failed: ${deployResult.stderr}`);
      }

      // Get deployed service information
      const servicesInfo = await this.getServiceInfo(config);
      deployedServices.push(...servicesInfo);

      // Wait for services to be ready
      await this.waitForServicesReady(deployedServices, config.readinessTimeout || 300);

      this.logger.info(`Successfully deployed ${deployedServices.length} services`);
      return deployedServices;

    } catch (error) {
      this.logger.error('Service deployment failed', error);
      throw error;
    }
  }

  /**
   * Perform health checks on deployed services
   */
  async performHealthChecks(services) {
    this.logger.info('Performing health checks...');

    const healthResults = [];

    for (const service of services) {
      try {
        const health = await this.checkServiceHealth(service);
        healthResults.push({
          service: service.name,
          status: health.status,
          details: health.details,
          timestamp: new Date()
        });

        if (health.status !== 'healthy') {
          this.logger.warn(`Service ${service.name} health check failed:`, health.details);
        } else {
          this.logger.info(`Service ${service.name} is healthy`);
        }

      } catch (error) {
        this.logger.error(`Health check failed for ${service.name}:`, error);
        healthResults.push({
          service: service.name,
          status: 'error',
          error: error.message,
          timestamp: new Date()
        });
      }
    }

    // Check if deployment is healthy overall
    const healthyServices = healthResults.filter(r => r.status === 'healthy').length;
    const totalServices = services.length;
    const healthPercentage = (healthyServices / totalServices) * 100;

    this.logger.info(`Health check summary: ${healthyServices}/${totalServices} services healthy (${healthPercentage.toFixed(1)}%)`);

    // Fail deployment if health threshold not met
    const minHealthThreshold = this.config.minHealthThreshold || 100;
    if (healthPercentage < minHealthThreshold) {
      throw new Error(`Deployment health check failed: ${healthPercentage.toFixed(1)}% < ${minHealthThreshold}% required`);
    }

    return healthResults;
  }

  /**
   * Check individual service health
   */
  async checkServiceHealth(service) {
    const healthChecks = [];

    // Container health check
    if (service.containerId) {
      const containerHealth = await this.checkContainerHealth(service.containerId);
      healthChecks.push(containerHealth);
    }

    // HTTP health check
    if (service.healthCheck && service.healthCheck.http) {
      const httpHealth = await this.checkHttpHealth(service.healthCheck.http);
      healthChecks.push(httpHealth);
    }

    // TCP port check
    if (service.healthCheck && service.healthCheck.tcp) {
      const tcpHealth = await this.checkTcpHealth(service.healthCheck.tcp);
      healthChecks.push(tcpHealth);
    }

    // Custom health check command
    if (service.healthCheck && service.healthCheck.command) {
      const commandHealth = await this.checkCommandHealth(service.containerId, service.healthCheck.command);
      healthChecks.push(commandHealth);
    }

    // Determine overall health status
    const failedChecks = healthChecks.filter(c => !c.success);
    const isHealthy = failedChecks.length === 0;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      details: {
        checks: healthChecks,
        failed: failedChecks,
        summary: `${healthChecks.length - failedChecks.length}/${healthChecks.length} checks passed`
      }
    };
  }

  /**
   * Scale services based on load or configuration
   */
  async scaleServices(config, scalingConfig) {
    this.logger.info('Scaling services...', scalingConfig);

    const scalingResults = [];

    for (const serviceScale of scalingConfig) {
      try {
        const currentScale = await this.getCurrentScale(config.project, serviceScale.service);
        
        if (currentScale !== serviceScale.replicas) {
          this.logger.info(`Scaling ${serviceScale.service}: ${currentScale} -> ${serviceScale.replicas}`);

          await console_execute_command({
            command: 'docker-compose',
            args: [
              ...this.buildComposeArgs(config),
              'scale',
              `${serviceScale.service}=${serviceScale.replicas}`
            ]
          });

          // Wait for scaling to complete
          await this.waitForScalingComplete(config.project, serviceScale.service, serviceScale.replicas);

          scalingResults.push({
            service: serviceScale.service,
            previousReplicas: currentScale,
            newReplicas: serviceScale.replicas,
            status: 'success'
          });
        } else {
          scalingResults.push({
            service: serviceScale.service,
            replicas: currentScale,
            status: 'no-change'
          });
        }

      } catch (error) {
        this.logger.error(`Failed to scale ${serviceScale.service}:`, error);
        scalingResults.push({
          service: serviceScale.service,
          status: 'failed',
          error: error.message
        });
      }
    }

    return scalingResults;
  }

  /**
   * Monitor service performance and auto-scale if needed
   */
  async startAutoScaling(config, autoScaleConfig) {
    this.logger.info('Starting auto-scaling monitoring...');

    const monitoringInterval = setInterval(async () => {
      try {
        const metrics = await this.collectServiceMetrics(config.project);
        const scalingDecisions = this.analyzeScalingNeeds(metrics, autoScaleConfig);

        if (scalingDecisions.length > 0) {
          this.logger.info('Auto-scaling triggered', scalingDecisions);
          await this.scaleServices(config, scalingDecisions);
        }

      } catch (error) {
        this.logger.error('Auto-scaling monitoring error:', error);
      }
    }, autoScaleConfig.interval || 60000); // Default 1 minute

    // Store interval for cleanup
    this.autoScaleInterval = monitoringInterval;

    return monitoringInterval;
  }

  /**
   * Rollback deployment to previous version
   */
  async rollbackDeployment(deploymentId, reason) {
    this.logger.warn(`Rolling back deployment ${deploymentId}:`, reason);

    try {
      const deployment = this.deploymentHistory.find(d => d.id === deploymentId);
      if (!deployment || !deployment.backup) {
        throw new Error('No backup found for rollback');
      }

      // Stop current services
      const composeArgs = this.buildComposeArgs(deployment.config);
      await console_execute_command({
        command: 'docker-compose',
        args: [...composeArgs, 'down']
      });

      // Restore from backup
      await this.restoreFromBackup(deployment.backup);

      // Start previous version
      await console_execute_command({
        command: 'docker-compose',
        args: [...composeArgs, 'up', '-d']
      });

      this.logger.info(`Rollback completed for deployment ${deploymentId}`);

    } catch (rollbackError) {
      this.logger.error('Rollback failed:', rollbackError);
      throw rollbackError;
    }
  }

  /**
   * Blue/Green deployment strategy
   */
  async deployBlueGreen(config) {
    this.logger.info('Starting Blue/Green deployment...');

    const currentColor = await this.getCurrentDeploymentColor(config.project);
    const newColor = currentColor === 'blue' ? 'green' : 'blue';

    this.logger.info(`Current: ${currentColor}, Deploying: ${newColor}`);

    try {
      // Deploy to new color environment
      const newConfig = {
        ...config,
        project: `${config.project}-${newColor}`,
        environment: {
          ...config.environment,
          DEPLOYMENT_COLOR: newColor
        }
      };

      const deployment = await this.deployApplication(newConfig);

      // Switch traffic to new deployment
      await this.switchTrafficToColor(config.project, newColor);

      // Wait for traffic switch to stabilize
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Verify new deployment is handling traffic correctly
      await this.verifyTrafficSwitch(newColor);

      // Clean up old deployment
      if (config.cleanupOldDeployment !== false) {
        setTimeout(() => {
          this.cleanupColorDeployment(config.project, currentColor);
        }, config.cleanupDelay || 300000); // Default 5 minutes
      }

      this.logger.info(`Blue/Green deployment completed: ${currentColor} -> ${newColor}`);
      return deployment;

    } catch (error) {
      this.logger.error('Blue/Green deployment failed:', error);
      
      // Rollback traffic to original color
      await this.switchTrafficToColor(config.project, currentColor);
      
      throw error;
    }
  }

  /**
   * Canary deployment strategy
   */
  async deployCanary(config, canaryConfig) {
    this.logger.info('Starting Canary deployment...', canaryConfig);

    const { percentage = 10, duration = 600000 } = canaryConfig; // Default 10% for 10 minutes

    try {
      // Deploy canary version
      const canaryDeployment = await this.deployApplication({
        ...config,
        project: `${config.project}-canary`,
        scale: Math.max(1, Math.ceil(config.totalReplicas * percentage / 100))
      });

      // Configure load balancer for canary traffic
      await this.configureCanaryTraffic(config.project, percentage);

      // Monitor canary deployment
      const canaryMetrics = await this.monitorCanary(config.project, duration);

      // Analyze canary results
      const canarySuccess = this.analyzeCanaryResults(canaryMetrics, canaryConfig.successCriteria);

      if (canarySuccess) {
        this.logger.info('Canary deployment successful, promoting to full deployment');
        
        // Promote canary to full deployment
        await this.promoteCanary(config, canaryDeployment);
        
      } else {
        this.logger.warn('Canary deployment failed metrics, rolling back');
        
        // Rollback canary
        await this.rollbackCanary(config.project);
      }

      return { success: canarySuccess, metrics: canaryMetrics };

    } catch (error) {
      this.logger.error('Canary deployment failed:', error);
      
      // Emergency rollback
      await this.rollbackCanary(config.project);
      
      throw error;
    }
  }

  /**
   * Get deployment status and metrics
   */
  async getDeploymentStatus(projectName) {
    const status = {
      project: projectName,
      timestamp: new Date(),
      services: [],
      overall: 'unknown'
    };

    try {
      // Get service status
      const servicesResult = await console_execute_command({
        command: 'docker-compose',
        args: ['-p', projectName, 'ps', '--format', 'json']
      });

      if (servicesResult.exitCode === 0 && servicesResult.output) {
        status.services = JSON.parse(servicesResult.output);
      }

      // Get resource usage
      const resourceUsage = await this.getResourceUsage(projectName);
      status.resources = resourceUsage;

      // Determine overall status
      const runningServices = status.services.filter(s => s.State === 'running').length;
      const totalServices = status.services.length;

      if (totalServices === 0) {
        status.overall = 'not-deployed';
      } else if (runningServices === totalServices) {
        status.overall = 'healthy';
      } else if (runningServices > 0) {
        status.overall = 'degraded';
      } else {
        status.overall = 'failed';
      }

    } catch (error) {
      this.logger.error('Failed to get deployment status:', error);
      status.overall = 'error';
      status.error = error.message;
    }

    return status;
  }

  // Helper methods...

  buildComposeArgs(config) {
    const args = [];
    
    if (config.composeFiles) {
      const files = Array.isArray(config.composeFiles) ? config.composeFiles : [config.composeFiles];
      for (const file of files) {
        args.push('-f', file);
      }
    }

    if (config.project) {
      args.push('-p', config.project);
    }

    if (config.envFiles) {
      const envFiles = Array.isArray(config.envFiles) ? config.envFiles : [config.envFiles];
      for (const envFile of envFiles) {
        args.push('--env-file', envFile);
      }
    }

    return args;
  }

  async checkFileExists(filePath) {
    try {
      const result = await console_execute_command({
        command: 'test',
        args: ['-f', filePath]
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async validateImages(services) {
    // Implementation for image validation
    // Check if images exist locally or can be pulled
  }

  async validateResources(services) {
    // Implementation for resource validation
    // Check if system has enough CPU, memory, disk space
  }

  async validateNetworking(networking) {
    // Implementation for network validation
    // Check port availability, network conflicts
  }

  async getRunningContainers(project) {
    // Implementation to get currently running containers for project
  }

  async backupVolumes(project, backupPath) {
    // Implementation for volume backup
  }

  async backupEnvironmentFiles(envFiles, backupPath) {
    // Implementation for environment file backup
  }

  async getServiceInfo(config) {
    // Implementation to get deployed service information
  }

  async waitForServicesReady(services, timeout) {
    // Implementation to wait for services to be ready
  }

  async checkContainerHealth(containerId) {
    // Implementation for container health check
  }

  async checkHttpHealth(httpConfig) {
    // Implementation for HTTP health check
  }

  async checkTcpHealth(tcpConfig) {
    // Implementation for TCP health check
  }

  async checkCommandHealth(containerId, command) {
    // Implementation for command-based health check
  }

  async getCurrentScale(project, service) {
    // Implementation to get current service scale
  }

  async waitForScalingComplete(project, service, replicas) {
    // Implementation to wait for scaling to complete
  }

  async collectServiceMetrics(project) {
    // Implementation to collect service metrics
  }

  analyzeScalingNeeds(metrics, autoScaleConfig) {
    // Implementation to analyze if scaling is needed
  }

  async restoreFromBackup(backupInfo) {
    // Implementation to restore from backup
  }

  async getCurrentDeploymentColor(project) {
    // Implementation to get current deployment color
  }

  async switchTrafficToColor(project, color) {
    // Implementation to switch load balancer traffic
  }

  async verifyTrafficSwitch(color) {
    // Implementation to verify traffic switch
  }

  async cleanupColorDeployment(project, color) {
    // Implementation to cleanup old color deployment
  }

  async configureCanaryTraffic(project, percentage) {
    // Implementation to configure canary traffic percentage
  }

  async monitorCanary(project, duration) {
    // Implementation to monitor canary deployment
  }

  analyzeCanaryResults(metrics, successCriteria) {
    // Implementation to analyze canary success
  }

  async promoteCanary(config, canaryDeployment) {
    // Implementation to promote canary to full deployment
  }

  async rollbackCanary(project) {
    // Implementation to rollback canary deployment
  }

  async getResourceUsage(project) {
    // Implementation to get resource usage metrics
  }

  async cleanup() {
    if (this.autoScaleInterval) {
      clearInterval(this.autoScaleInterval);
    }
  }
}

// Usage example
async function main() {
  const config = {
    dockerConfig: {
      connection: {
        socketPath: '/var/run/docker.sock'
      },
      autoCleanup: true,
      healthCheck: {
        enabled: true,
        interval: 30000
      }
    },
    minHealthThreshold: 90
  };

  const automation = new DockerComposeAutomation(config);

  // Example deployment configuration
  const deploymentConfig = {
    project: 'myapp',
    composeFiles: ['docker-compose.yml', 'docker-compose.prod.yml'],
    envFiles: ['.env', '.env.production'],
    build: true,
    pull: true,
    forceRecreate: false,
    removeOrphans: true,
    readinessTimeout: 300,
    autoRollback: true,
    services: [
      {
        name: 'web',
        healthCheck: {
          http: {
            url: 'http://localhost:8080/health',
            expectedStatus: 200,
            timeout: 5000
          }
        }
      },
      {
        name: 'api',
        healthCheck: {
          http: {
            url: 'http://localhost:3000/api/health',
            expectedStatus: 200,
            timeout: 5000
          }
        }
      },
      {
        name: 'database',
        healthCheck: {
          tcp: {
            host: 'localhost',
            port: 5432,
            timeout: 5000
          }
        }
      }
    ]
  };

  try {
    // Standard deployment
    const deployment = await automation.deployApplication(deploymentConfig);
    console.log('Deployment completed:', deployment.id);

    // Auto-scaling configuration
    const autoScaleConfig = {
      interval: 60000, // Check every minute
      rules: [
        {
          service: 'web',
          metric: 'cpu',
          scaleUp: { threshold: 80, increment: 2 },
          scaleDown: { threshold: 30, decrement: 1 },
          minReplicas: 2,
          maxReplicas: 10
        }
      ]
    };

    // Start auto-scaling
    await automation.startAutoScaling(deploymentConfig, autoScaleConfig);

    // Blue/Green deployment example
    // const blueGreenDeployment = await automation.deployBlueGreen({
    //   ...deploymentConfig,
    //   cleanupDelay: 600000 // 10 minutes
    // });

    // Canary deployment example
    // const canaryResult = await automation.deployCanary(deploymentConfig, {
    //   percentage: 20,
    //   duration: 600000, // 10 minutes
    //   successCriteria: {
    //     errorRate: { max: 0.01 }, // Less than 1% error rate
    //     responseTime: { max: 500 }, // Less than 500ms average response time
    //     availability: { min: 0.99 } // At least 99% availability
    //   }
    // });

  } catch (error) {
    console.error('Automation failed:', error);
  } finally {
    await automation.cleanup();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { DockerComposeAutomation };