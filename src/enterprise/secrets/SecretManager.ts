/**
 * Enterprise Secret Manager
 * Integrates with multiple secret management providers (Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager)
 */

import { EventEmitter } from 'events';
import { createHash, randomBytes, createCipher, createDecipher } from 'crypto';
import {
  SecretProvider,
  VaultConfig,
  AWSSecretsConfig,
  AzureKeyVaultConfig,
  GCPSecretConfig,
  SecretsConfig,
  TLSConfig
} from '../types/enterprise.js';
import { Logger } from '../../utils/logger.js';

export interface SecretMetadata {
  id: string;
  path: string;
  provider: string;
  version?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  tags: Record<string, string>;
  accessCount: number;
  lastAccessed?: Date;
}

export interface SecretValue {
  data: Record<string, any>;
  metadata: SecretMetadata;
}

export interface SecretRequest {
  path: string;
  version?: string;
  provider?: string;
}

export interface SecretRotationPolicy {
  enabled: boolean;
  interval: number; // days
  notifyBefore: number; // days before expiry
  autoRotate: boolean;
  rotationScript?: string;
}

export interface SecretAuditEvent {
  id: string;
  secretPath: string;
  action: 'read' | 'write' | 'delete' | 'rotate' | 'expire';
  userId: string;
  provider: string;
  timestamp: Date;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export class SecretManager extends EventEmitter {
  private logger: Logger;
  private config: SecretsConfig;
  private providers: Map<string, SecretProvider>;
  private cache: Map<string, { value: SecretValue; expiresAt: Date }>;
  private rotationPolicies: Map<string, SecretRotationPolicy>;
  private auditEvents: SecretAuditEvent[];
  private encryptionKey: string;

  constructor(config: SecretsConfig, encryptionKey: string) {
    super();
    this.logger = new Logger('SecretManager');
    this.config = config;
    this.encryptionKey = encryptionKey;
    this.providers = new Map();
    this.cache = new Map();
    this.rotationPolicies = new Map();
    this.auditEvents = [];

    this.initializeProviders();
    this.startCacheCleanup();
    this.startRotationMonitor();
  }

  private async initializeProviders(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Secret management is disabled');
      return;
    }

    // Sort providers by priority (higher priority first)
    const sortedProviders = [...this.config.providers].sort((a, b) => b.priority - a.priority);

    for (const provider of sortedProviders) {
      try {
        await this.initializeProvider(provider);
        this.providers.set(provider.name, provider);
        this.logger.info(`Initialized secret provider: ${provider.name} (${provider.type})`);
      } catch (error) {
        this.logger.error(`Failed to initialize secret provider ${provider.name}:`, error);
      }
    }

    if (this.providers.size === 0) {
      this.logger.warn('No secret providers initialized');
    }
  }

  private async initializeProvider(provider: SecretProvider): Promise<void> {
    switch (provider.type) {
      case 'vault':
        await this.initializeVault(provider.config as VaultConfig);
        break;
      case 'aws-secrets':
        await this.initializeAWSSecrets(provider.config as AWSSecretsConfig);
        break;
      case 'azure-keyvault':
        await this.initializeAzureKeyVault(provider.config as AzureKeyVaultConfig);
        break;
      case 'gcp-secret-manager':
        await this.initializeGCPSecrets(provider.config as GCPSecretConfig);
        break;
      default:
        throw new Error(`Unsupported secret provider type: ${provider.type}`);
    }
  }

  private async initializeVault(config: VaultConfig): Promise<void> {
    // Initialize HashiCorp Vault client
    const axios = (await import('axios')).default;
    
    // Authenticate with Vault
    let token = config.token;
    
    if (!token && config.roleId && config.secretId) {
      // AppRole authentication
      const authResponse = await axios.post(`${config.address}/v1/auth/approle/login`, {
        role_id: config.roleId,
        secret_id: config.secretId
      }, {
        httpsAgent: this.createHttpsAgent(config.tlsConfig)
      });
      
      token = authResponse.data.auth.client_token;
    }

    if (!token) {
      throw new Error('Vault authentication failed: no token available');
    }

    // Test connection
    await axios.get(`${config.address}/v1/sys/health`, {
      headers: { 'X-Vault-Token': token },
      httpsAgent: this.createHttpsAgent(config.tlsConfig)
    });

    this.logger.info('Vault client initialized successfully');
  }

  private async initializeAWSSecrets(config: AWSSecretsConfig): Promise<void> {
    // Initialize AWS Secrets Manager client
    const AWS = await import('aws-sdk');
    
    const clientConfig: any = {
      region: config.region
    };

    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.accessKeyId = config.accessKeyId;
      clientConfig.secretAccessKey = config.secretAccessKey;
    }

    if (config.roleArn) {
      // Assume role
      const sts = new AWS.STS(clientConfig);
      const assumedRole = await sts.assumeRole({
        RoleArn: config.roleArn,
        RoleSessionName: 'SecretManager'
      }).promise();

      clientConfig.accessKeyId = assumedRole.Credentials!.AccessKeyId;
      clientConfig.secretAccessKey = assumedRole.Credentials!.SecretAccessKey;
      clientConfig.sessionToken = assumedRole.Credentials!.SessionToken;
    }

    const secretsManager = new AWS.SecretsManager(clientConfig);
    
    // Test connection
    await secretsManager.listSecrets({ MaxResults: 1 }).promise();

    this.logger.info('AWS Secrets Manager client initialized successfully');
  }

  private async initializeAzureKeyVault(config: AzureKeyVaultConfig): Promise<void> {
    // Initialize Azure Key Vault client
    const { DefaultAzureCredential, ClientSecretCredential, CertificateCredential } = await import('@azure/identity');
    const { SecretClient } = await import('@azure/keyvault-secrets');

    let credential;

    if (config.clientId && config.clientSecret) {
      credential = new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
    } else if (config.certificate) {
      credential = new CertificateCredential(config.tenantId, config.clientId!, config.certificate);
    } else {
      credential = new DefaultAzureCredential();
    }

    const client = new SecretClient(config.vaultUrl, credential);
    
    // Test connection
    const iterator = client.listPropertiesOfSecrets();
    await iterator.next();

    this.logger.info('Azure Key Vault client initialized successfully');
  }

  private async initializeGCPSecrets(config: GCPSecretConfig): Promise<void> {
    // Initialize Google Cloud Secret Manager client
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');

    const clientConfig: any = {
      projectId: config.projectId
    };

    if (config.keyFilename) {
      clientConfig.keyFilename = config.keyFilename;
    } else if (config.credentials) {
      clientConfig.credentials = config.credentials;
    }

    const client = new SecretManagerServiceClient(clientConfig);
    
    // Test connection
    const [secrets] = await client.listSecrets({
      parent: `projects/${config.projectId}`,
      pageSize: 1
    });

    this.logger.info('GCP Secret Manager client initialized successfully');
  }

  private createHttpsAgent(tlsConfig?: TLSConfig): any {
    if (!tlsConfig) return undefined;

    const https = require('https');
    const fs = require('fs');

    const agentOptions: any = {
      rejectUnauthorized: !tlsConfig.skipVerify
    };

    if (tlsConfig.caCert) {
      agentOptions.ca = fs.readFileSync(tlsConfig.caCert);
    }

    if (tlsConfig.clientCert && tlsConfig.clientKey) {
      agentOptions.cert = fs.readFileSync(tlsConfig.clientCert);
      agentOptions.key = fs.readFileSync(tlsConfig.clientKey);
    }

    return new https.Agent(agentOptions);
  }

  async getSecret(request: SecretRequest, userId: string): Promise<SecretValue | null> {
    const auditEventId = this.generateAuditId();
    const startTime = Date.now();

    try {
      // Check cache first
      if (this.config.cacheTimeout > 0) {
        const cached = this.getCachedSecret(request.path);
        if (cached) {
          await this.logAudit({
            id: auditEventId,
            secretPath: request.path,
            action: 'read',
            userId,
            provider: 'cache',
            timestamp: new Date(),
            success: true,
            metadata: { cacheHit: true, duration: Date.now() - startTime }
          });

          this.updateAccessMetadata(cached.metadata);
          return cached;
        }
      }

      // Try providers in priority order
      const providers = request.provider 
        ? [this.providers.get(request.provider)].filter(Boolean) as SecretProvider[]
        : Array.from(this.providers.values()).sort((a, b) => b.priority - a.priority);

      for (const provider of providers) {
        try {
          const secret = await this.getSecretFromProvider(provider, request);
          if (secret) {
            // Cache the secret
            if (this.config.cacheTimeout > 0) {
              this.cacheSecret(request.path, secret);
            }

            await this.logAudit({
              id: auditEventId,
              secretPath: request.path,
              action: 'read',
              userId,
              provider: provider.name,
              timestamp: new Date(),
              success: true,
              metadata: { duration: Date.now() - startTime }
            });

            this.updateAccessMetadata(secret.metadata);
            return secret;
          }
        } catch (error: any) {
          this.logger.warn(`Failed to get secret from provider ${provider.name}:`, error.message);
          continue;
        }
      }

      await this.logAudit({
        id: auditEventId,
        secretPath: request.path,
        action: 'read',
        userId,
        provider: 'unknown',
        timestamp: new Date(),
        success: false,
        error: 'Secret not found in any provider',
        metadata: { duration: Date.now() - startTime }
      });

      return null;

    } catch (error: any) {
      await this.logAudit({
        id: auditEventId,
        secretPath: request.path,
        action: 'read',
        userId,
        provider: 'unknown',
        timestamp: new Date(),
        success: false,
        error: error.message,
        metadata: { duration: Date.now() - startTime }
      });

      throw error;
    }
  }

  private async getSecretFromProvider(provider: SecretProvider, request: SecretRequest): Promise<SecretValue | null> {
    switch (provider.type) {
      case 'vault':
        return await this.getVaultSecret(provider, request);
      case 'aws-secrets':
        return await this.getAWSSecret(provider, request);
      case 'azure-keyvault':
        return await this.getAzureSecret(provider, request);
      case 'gcp-secret-manager':
        return await this.getGCPSecret(provider, request);
      default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  }

  private async getVaultSecret(provider: SecretProvider, request: SecretRequest): Promise<SecretValue | null> {
    const config = provider.config as VaultConfig;
    const axios = (await import('axios')).default;

    const url = `${config.address}/v1/${config.mountPoint}/data/${request.path}`;
    const headers = { 'X-Vault-Token': config.token };

    if (config.namespace) {
      headers['X-Vault-Namespace'] = config.namespace;
    }

    const response = await axios.get(url, {
      headers,
      httpsAgent: this.createHttpsAgent(config.tlsConfig)
    });

    if (!response.data || !response.data.data) {
      return null;
    }

    const secretData = response.data.data.data;
    const metadata = response.data.data.metadata;

    return {
      data: secretData,
      metadata: {
        id: `vault:${request.path}`,
        path: request.path,
        provider: provider.name,
        version: String(metadata.version),
        createdAt: new Date(metadata.created_time),
        updatedAt: new Date(metadata.created_time),
        tags: {},
        accessCount: 0
      }
    };
  }

  private async getAWSSecret(provider: SecretProvider, request: SecretRequest): Promise<SecretValue | null> {
    const config = provider.config as AWSSecretsConfig;
    const AWS = await import('aws-sdk');

    const secretsManager = new AWS.SecretsManager({ region: config.region });

    const params: any = { SecretId: request.path };
    if (request.version) {
      params.VersionId = request.version;
    }

    const response = await secretsManager.getSecretValue(params).promise();

    if (!response.SecretString && !response.SecretBinary) {
      return null;
    }

    const secretData = response.SecretString 
      ? JSON.parse(response.SecretString)
      : JSON.parse(Buffer.from(response.SecretBinary as string, 'base64').toString());

    return {
      data: secretData,
      metadata: {
        id: `aws:${request.path}`,
        path: request.path,
        provider: provider.name,
        version: response.VersionId,
        createdAt: response.CreatedDate || new Date(),
        updatedAt: response.CreatedDate || new Date(),
        tags: {},
        accessCount: 0
      }
    };
  }

  private async getAzureSecret(provider: SecretProvider, request: SecretRequest): Promise<SecretValue | null> {
    const config = provider.config as AzureKeyVaultConfig;
    const { DefaultAzureCredential } = await import('@azure/identity');
    const { SecretClient } = await import('@azure/keyvault-secrets');

    const credential = new DefaultAzureCredential();
    const client = new SecretClient(config.vaultUrl, credential);

    const secretName = request.path.replace(/\//g, '-'); // Azure doesn't allow '/' in secret names
    const options: any = {};
    
    if (request.version) {
      options.version = request.version;
    }

    const secret = await client.getSecret(secretName, options);

    if (!secret.value) {
      return null;
    }

    return {
      data: { value: secret.value },
      metadata: {
        id: `azure:${request.path}`,
        path: request.path,
        provider: provider.name,
        version: secret.properties.version,
        createdAt: secret.properties.createdOn || new Date(),
        updatedAt: secret.properties.updatedOn || new Date(),
        expiresAt: secret.properties.expiresOn || undefined,
        tags: secret.properties.tags || {},
        accessCount: 0
      }
    };
  }

  private async getGCPSecret(provider: SecretProvider, request: SecretRequest): Promise<SecretValue | null> {
    const config = provider.config as GCPSecretConfig;
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');

    const client = new SecretManagerServiceClient({
      projectId: config.projectId,
      keyFilename: config.keyFilename
    });

    const versionName = request.version || 'latest';
    const name = `projects/${config.projectId}/secrets/${request.path}/versions/${versionName}`;

    const [version] = await client.accessSecretVersion({ name });

    if (!version.payload?.data) {
      return null;
    }

    const secretData = JSON.parse(version.payload.data.toString());

    return {
      data: secretData,
      metadata: {
        id: `gcp:${request.path}`,
        path: request.path,
        provider: provider.name,
        version: version.name?.split('/').pop(),
        createdAt: new Date(version.createTime?.seconds! * 1000),
        updatedAt: new Date(version.createTime?.seconds! * 1000),
        tags: {},
        accessCount: 0
      }
    };
  }

  async storeSecret(path: string, data: Record<string, any>, provider?: string, userId: string = 'system'): Promise<SecretMetadata> {
    const auditEventId = this.generateAuditId();
    const startTime = Date.now();

    try {
      const targetProvider = provider 
        ? this.providers.get(provider)
        : Array.from(this.providers.values())[0]; // Use first provider as default

      if (!targetProvider) {
        throw new Error(provider ? `Provider ${provider} not found` : 'No providers available');
      }

      const metadata = await this.storeSecretInProvider(targetProvider, path, data);

      // Invalidate cache
      this.cache.delete(path);

      await this.logAudit({
        id: auditEventId,
        secretPath: path,
        action: 'write',
        userId,
        provider: targetProvider.name,
        timestamp: new Date(),
        success: true,
        metadata: { duration: Date.now() - startTime }
      });

      this.emit('secret:stored', { path, provider: targetProvider.name, metadata });
      return metadata;

    } catch (error: any) {
      await this.logAudit({
        id: auditEventId,
        secretPath: path,
        action: 'write',
        userId,
        provider: provider || 'unknown',
        timestamp: new Date(),
        success: false,
        error: error.message,
        metadata: { duration: Date.now() - startTime }
      });

      throw error;
    }
  }

  private async storeSecretInProvider(provider: SecretProvider, path: string, data: Record<string, any>): Promise<SecretMetadata> {
    switch (provider.type) {
      case 'vault':
        return await this.storeVaultSecret(provider, path, data);
      case 'aws-secrets':
        return await this.storeAWSSecret(provider, path, data);
      case 'azure-keyvault':
        return await this.storeAzureSecret(provider, path, data);
      case 'gcp-secret-manager':
        return await this.storeGCPSecret(provider, path, data);
      default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  }

  private async storeVaultSecret(provider: SecretProvider, path: string, data: Record<string, any>): Promise<SecretMetadata> {
    const config = provider.config as VaultConfig;
    const axios = (await import('axios')).default;

    const url = `${config.address}/v1/${config.mountPoint}/data/${path}`;
    const headers = { 'X-Vault-Token': config.token };

    if (config.namespace) {
      headers['X-Vault-Namespace'] = config.namespace;
    }

    const response = await axios.post(url, { data }, {
      headers,
      httpsAgent: this.createHttpsAgent(config.tlsConfig)
    });

    return {
      id: `vault:${path}`,
      path,
      provider: provider.name,
      version: String(response.data.data.version),
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: {},
      accessCount: 0
    };
  }

  private async storeAWSSecret(provider: SecretProvider, path: string, data: Record<string, any>): Promise<SecretMetadata> {
    const config = provider.config as AWSSecretsConfig;
    const AWS = await import('aws-sdk');

    const secretsManager = new AWS.SecretsManager({ region: config.region });

    const params = {
      Name: path,
      SecretString: JSON.stringify(data),
      KmsKeyId: config.kmsKeyId
    };

    try {
      // Try to update existing secret
      const response = await secretsManager.updateSecret(params).promise();
      return {
        id: `aws:${path}`,
        path,
        provider: provider.name,
        version: response.VersionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: {},
        accessCount: 0
      };
    } catch (error: any) {
      if (error.code === 'ResourceNotFoundException') {
        // Create new secret
        const response = await secretsManager.createSecret(params).promise();
        return {
          id: `aws:${path}`,
          path,
          provider: provider.name,
          version: response.VersionId,
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: {},
          accessCount: 0
        };
      }
      throw error;
    }
  }

  private async storeAzureSecret(provider: SecretProvider, path: string, data: Record<string, any>): Promise<SecretMetadata> {
    const config = provider.config as AzureKeyVaultConfig;
    const { DefaultAzureCredential } = await import('@azure/identity');
    const { SecretClient } = await import('@azure/keyvault-secrets');

    const credential = new DefaultAzureCredential();
    const client = new SecretClient(config.vaultUrl, credential);

    const secretName = path.replace(/\//g, '-');
    const secretValue = JSON.stringify(data);

    const result = await client.setSecret(secretName, secretValue);

    return {
      id: `azure:${path}`,
      path,
      provider: provider.name,
      version: result.properties.version,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: {},
      accessCount: 0
    };
  }

  private async storeGCPSecret(provider: SecretProvider, path: string, data: Record<string, any>): Promise<SecretMetadata> {
    const config = provider.config as GCPSecretConfig;
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');

    const client = new SecretManagerServiceClient({
      projectId: config.projectId,
      keyFilename: config.keyFilename
    });

    const parent = `projects/${config.projectId}`;
    const secretId = path;

    try {
      // Try to create secret
      await client.createSecret({
        parent,
        secretId,
        secret: {
          replication: {
            automatic: {}
          }
        }
      });
    } catch (error: any) {
      // Secret might already exist
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }

    // Add secret version
    const [version] = await client.addSecretVersion({
      parent: `${parent}/secrets/${secretId}`,
      payload: {
        data: Buffer.from(JSON.stringify(data))
      }
    });

    return {
      id: `gcp:${path}`,
      path,
      provider: provider.name,
      version: version.name?.split('/').pop(),
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: {},
      accessCount: 0
    };
  }

  async deleteSecret(path: string, provider?: string, userId: string = 'system'): Promise<boolean> {
    const auditEventId = this.generateAuditId();
    const startTime = Date.now();

    try {
      const targetProvider = provider 
        ? this.providers.get(provider)
        : Array.from(this.providers.values())[0];

      if (!targetProvider) {
        throw new Error(provider ? `Provider ${provider} not found` : 'No providers available');
      }

      const deleted = await this.deleteSecretFromProvider(targetProvider, path);

      // Invalidate cache
      this.cache.delete(path);

      await this.logAudit({
        id: auditEventId,
        secretPath: path,
        action: 'delete',
        userId,
        provider: targetProvider.name,
        timestamp: new Date(),
        success: deleted,
        metadata: { duration: Date.now() - startTime }
      });

      if (deleted) {
        this.emit('secret:deleted', { path, provider: targetProvider.name });
      }

      return deleted;

    } catch (error: any) {
      await this.logAudit({
        id: auditEventId,
        secretPath: path,
        action: 'delete',
        userId,
        provider: provider || 'unknown',
        timestamp: new Date(),
        success: false,
        error: error.message,
        metadata: { duration: Date.now() - startTime }
      });

      throw error;
    }
  }

  private async deleteSecretFromProvider(provider: SecretProvider, path: string): Promise<boolean> {
    switch (provider.type) {
      case 'vault':
        return await this.deleteVaultSecret(provider, path);
      case 'aws-secrets':
        return await this.deleteAWSSecret(provider, path);
      case 'azure-keyvault':
        return await this.deleteAzureSecret(provider, path);
      case 'gcp-secret-manager':
        return await this.deleteGCPSecret(provider, path);
      default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  }

  private async deleteVaultSecret(provider: SecretProvider, path: string): Promise<boolean> {
    const config = provider.config as VaultConfig;
    const axios = (await import('axios')).default;

    const url = `${config.address}/v1/${config.mountPoint}/metadata/${path}`;
    const headers = { 'X-Vault-Token': config.token };

    if (config.namespace) {
      headers['X-Vault-Namespace'] = config.namespace;
    }

    try {
      await axios.delete(url, {
        headers,
        httpsAgent: this.createHttpsAgent(config.tlsConfig)
      });
      return true;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return false; // Secret doesn't exist
      }
      throw error;
    }
  }

  private async deleteAWSSecret(provider: SecretProvider, path: string): Promise<boolean> {
    const config = provider.config as AWSSecretsConfig;
    const AWS = await import('aws-sdk');

    const secretsManager = new AWS.SecretsManager({ region: config.region });

    try {
      await secretsManager.deleteSecret({
        SecretId: path,
        ForceDeleteWithoutRecovery: false // Allow recovery for 30 days
      }).promise();
      return true;
    } catch (error: any) {
      if (error.code === 'ResourceNotFoundException') {
        return false;
      }
      throw error;
    }
  }

  private async deleteAzureSecret(provider: SecretProvider, path: string): Promise<boolean> {
    const config = provider.config as AzureKeyVaultConfig;
    const { DefaultAzureCredential } = await import('@azure/identity');
    const { SecretClient } = await import('@azure/keyvault-secrets');

    const credential = new DefaultAzureCredential();
    const client = new SecretClient(config.vaultUrl, credential);

    const secretName = path.replace(/\//g, '-');

    try {
      await client.beginDeleteSecret(secretName);
      return true;
    } catch (error: any) {
      if (error.code === 'SecretNotFound') {
        return false;
      }
      throw error;
    }
  }

  private async deleteGCPSecret(provider: SecretProvider, path: string): Promise<boolean> {
    const config = provider.config as GCPSecretConfig;
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');

    const client = new SecretManagerServiceClient({
      projectId: config.projectId,
      keyFilename: config.keyFilename
    });

    const name = `projects/${config.projectId}/secrets/${path}`;

    try {
      await client.deleteSecret({ name });
      return true;
    } catch (error: any) {
      if (error.code === 5) { // NOT_FOUND
        return false;
      }
      throw error;
    }
  }

  // Rotation Management
  async rotateSecret(path: string, newData: Record<string, any>, userId: string): Promise<SecretMetadata> {
    const auditEventId = this.generateAuditId();

    try {
      // Store new version
      const metadata = await this.storeSecret(path, newData, undefined, userId);

      await this.logAudit({
        id: auditEventId,
        secretPath: path,
        action: 'rotate',
        userId,
        provider: metadata.provider,
        timestamp: new Date(),
        success: true
      });

      this.emit('secret:rotated', { path, metadata });
      return metadata;

    } catch (error: any) {
      await this.logAudit({
        id: auditEventId,
        secretPath: path,
        action: 'rotate',
        userId,
        provider: 'unknown',
        timestamp: new Date(),
        success: false,
        error: error.message
      });

      throw error;
    }
  }

  setRotationPolicy(path: string, policy: SecretRotationPolicy): void {
    this.rotationPolicies.set(path, policy);
    this.logger.info(`Set rotation policy for ${path}: rotate every ${policy.interval} days`);
  }

  getRotationPolicy(path: string): SecretRotationPolicy | undefined {
    return this.rotationPolicies.get(path);
  }

  // Cache Management
  private getCachedSecret(path: string): SecretValue | null {
    const cached = this.cache.get(path);
    if (cached && cached.expiresAt > new Date()) {
      return cached.value;
    }
    
    if (cached) {
      this.cache.delete(path); // Remove expired cache
    }
    
    return null;
  }

  private cacheSecret(path: string, secret: SecretValue): void {
    const expiresAt = new Date(Date.now() + this.config.cacheTimeout * 1000);
    this.cache.set(path, { value: secret, expiresAt });
  }

  private updateAccessMetadata(metadata: SecretMetadata): void {
    metadata.accessCount++;
    metadata.lastAccessed = new Date();
  }

  // Audit and Monitoring
  private async logAudit(event: SecretAuditEvent): Promise<void> {
    this.auditEvents.push(event);
    
    // Keep only recent audit events
    const maxEvents = 10000;
    if (this.auditEvents.length > maxEvents) {
      this.auditEvents = this.auditEvents.slice(-maxEvents);
    }

    if (this.config.auditAccess) {
      this.emit('audit:secret', event);
    }
  }

  getAuditEvents(filters?: Partial<SecretAuditEvent>): SecretAuditEvent[] {
    if (!filters) return this.auditEvents;

    return this.auditEvents.filter(event => {
      return Object.entries(filters).every(([key, value]) => 
        event[key as keyof SecretAuditEvent] === value
      );
    });
  }

  // Cleanup and maintenance
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = new Date();
      let cleanedCount = 0;

      for (const [path, cached] of this.cache.entries()) {
        if (cached.expiresAt <= now) {
          this.cache.delete(path);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.debug(`Cleaned up ${cleanedCount} expired cache entries`);
      }
    }, 60000); // Every minute
  }

  private startRotationMonitor(): void {
    if (!this.config.rotationEnabled) return;

    setInterval(async () => {
      for (const [path, policy] of this.rotationPolicies.entries()) {
        if (!policy.enabled || !policy.autoRotate) continue;

        try {
          const secret = await this.getSecret({ path }, 'system');
          if (!secret) continue;

          const daysSinceUpdate = (Date.now() - secret.metadata.updatedAt.getTime()) / (24 * 60 * 60 * 1000);
          
          if (daysSinceUpdate >= policy.interval) {
            this.emit('secret:rotation-needed', { path, daysSinceUpdate, policy });
            
            if (policy.rotationScript) {
              // Execute rotation script
              await this.executeRotationScript(path, policy.rotationScript);
            }
          } else if (daysSinceUpdate >= policy.interval - policy.notifyBefore) {
            this.emit('secret:rotation-warning', { 
              path, 
              daysSinceUpdate, 
              daysRemaining: policy.interval - daysSinceUpdate,
              policy 
            });
          }
        } catch (error) {
          this.logger.error(`Error checking rotation for ${path}:`, error);
        }
      }
    }, 24 * 60 * 60 * 1000); // Daily check
  }

  private async executeRotationScript(path: string, script: string): Promise<void> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      await execAsync(script, { 
        env: { ...process.env, SECRET_PATH: path },
        timeout: 300000 // 5 minutes
      });

      this.logger.info(`Rotation script completed for ${path}`);
    } catch (error) {
      this.logger.error(`Rotation script failed for ${path}:`, error);
      this.emit('secret:rotation-failed', { path, error });
    }
  }

  private generateAuditId(): string {
    return `audit_${Date.now()}_${randomBytes(4).toString('hex')}`;
  }

  // Statistics and health
  getStatistics(): any {
    const providers = Array.from(this.providers.values());
    const auditEvents = this.auditEvents;
    const last24h = auditEvents.filter(e => e.timestamp >= new Date(Date.now() - 24 * 60 * 60 * 1000));

    return {
      providers: {
        total: providers.length,
        byType: providers.reduce((acc, p) => {
          acc[p.type] = (acc[p.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      },
      cache: {
        size: this.cache.size,
        hitRate: this.calculateCacheHitRate()
      },
      audit: {
        totalEvents: auditEvents.length,
        last24Hours: last24h.length,
        successRate: last24h.filter(e => e.success).length / Math.max(1, last24h.length)
      },
      rotation: {
        totalPolicies: this.rotationPolicies.size,
        enabledPolicies: Array.from(this.rotationPolicies.values()).filter(p => p.enabled).length
      }
    };
  }

  private calculateCacheHitRate(): number {
    const recent = this.auditEvents.slice(-1000); // Last 1000 events
    const cacheHits = recent.filter(e => e.metadata?.cacheHit).length;
    return recent.length > 0 ? cacheHits / recent.length : 0;
  }

  async healthCheck(): Promise<{ healthy: boolean; providers: Record<string, boolean> }> {
    const results: Record<string, boolean> = {};

    for (const provider of this.providers.values()) {
      try {
        // Test each provider with a simple operation
        await this.testProviderHealth(provider);
        results[provider.name] = true;
      } catch (error) {
        this.logger.warn(`Provider ${provider.name} health check failed:`, error);
        results[provider.name] = false;
      }
    }

    const healthy = Object.values(results).some(status => status);
    return { healthy, providers: results };
  }

  private async testProviderHealth(provider: SecretProvider): Promise<void> {
    // Implement provider-specific health checks
    switch (provider.type) {
      case 'vault':
        await this.testVaultHealth(provider);
        break;
      case 'aws-secrets':
        await this.testAWSHealth(provider);
        break;
      case 'azure-keyvault':
        await this.testAzureHealth(provider);
        break;
      case 'gcp-secret-manager':
        await this.testGCPHealth(provider);
        break;
    }
  }

  private async testVaultHealth(provider: SecretProvider): Promise<void> {
    const config = provider.config as VaultConfig;
    const axios = (await import('axios')).default;

    await axios.get(`${config.address}/v1/sys/health`, {
      headers: { 'X-Vault-Token': config.token },
      httpsAgent: this.createHttpsAgent(config.tlsConfig),
      timeout: 5000
    });
  }

  private async testAWSHealth(provider: SecretProvider): Promise<void> {
    const config = provider.config as AWSSecretsConfig;
    const AWS = await import('aws-sdk');

    const secretsManager = new AWS.SecretsManager({ region: config.region });
    await secretsManager.listSecrets({ MaxResults: 1 }).promise();
  }

  private async testAzureHealth(provider: SecretProvider): Promise<void> {
    const config = provider.config as AzureKeyVaultConfig;
    const { DefaultAzureCredential } = await import('@azure/identity');
    const { SecretClient } = await import('@azure/keyvault-secrets');

    const credential = new DefaultAzureCredential();
    const client = new SecretClient(config.vaultUrl, credential);
    
    const iterator = client.listPropertiesOfSecrets();
    await iterator.next();
  }

  private async testGCPHealth(provider: SecretProvider): Promise<void> {
    const config = provider.config as GCPSecretConfig;
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');

    const client = new SecretManagerServiceClient({
      projectId: config.projectId,
      keyFilename: config.keyFilename
    });

    await client.listSecrets({
      parent: `projects/${config.projectId}`,
      pageSize: 1
    });
  }
}