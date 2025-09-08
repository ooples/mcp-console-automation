/**
 * Enterprise SSO Manager
 * Handles Single Sign-On authentication with OIDC, SAML, and LDAP providers
 */

import { EventEmitter } from 'events';
import jwt from 'jsonwebtoken';
import { Strategy as OIDCStrategy } from 'passport-openidconnect';
import { Strategy as SAMLStrategy } from 'passport-saml';
import { Strategy as LDAPStrategy } from 'passport-ldapauth';
import {
  SSOProvider,
  OIDCConfig,
  SAMLConfig,
  LDAPConfig,
  User,
  SSOConfig
} from '../types/enterprise.js';
import { Logger } from '../../utils/logger.js';

export interface AuthenticationResult {
  success: boolean;
  user?: User;
  token?: string;
  error?: string;
  mfaRequired?: boolean;
  mfaToken?: string;
}

export interface SSOSession {
  id: string;
  userId: string;
  provider: string;
  token: string;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
  attributes: Record<string, any>;
  createdAt: Date;
  lastActivity: Date;
}

export class SSOManager extends EventEmitter {
  private logger: Logger;
  private config: SSOConfig;
  private providers: Map<string, SSOProvider>;
  private sessions: Map<string, SSOSession>;
  private tokenSecret: string;
  private strategies: Map<string, any>;

  constructor(config: SSOConfig, tokenSecret: string) {
    super();
    this.logger = new Logger('SSOManager');
    this.config = config;
    this.tokenSecret = tokenSecret;
    this.providers = new Map();
    this.sessions = new Map();
    this.strategies = new Map();

    this.initializeProviders();
    this.startSessionCleanup();
  }

  private initializeProviders() {
    if (!this.config.enabled) {
      this.logger.info('SSO is disabled');
      return;
    }

    for (const provider of this.config.providers) {
      try {
        this.configureProvider(provider);
        this.providers.set(provider.name, provider);
        this.logger.info(`Configured SSO provider: ${provider.name} (${provider.type})`);
      } catch (error) {
        this.logger.error(`Failed to configure SSO provider ${provider.name}:`, error);
      }
    }
  }

  private configureProvider(provider: SSOProvider) {
    switch (provider.type) {
      case 'oidc':
        this.configureOIDC(provider.name, provider.config as OIDCConfig);
        break;
      case 'saml':
        this.configureSAML(provider.name, provider.config as SAMLConfig);
        break;
      case 'ldap':
        this.configureLDAP(provider.name, provider.config as LDAPConfig);
        break;
      default:
        throw new Error(`Unsupported SSO provider type: ${provider.type}`);
    }
  }

  private configureOIDC(name: string, config: OIDCConfig) {
    const strategy = new OIDCStrategy({
      issuer: config.issuer,
      clientID: config.clientId,
      clientSecret: config.clientSecret,
      authorizationURL: `${config.issuer}/auth`,
      tokenURL: `${config.issuer}/token`,
      userInfoURL: `${config.issuer}/userinfo`,
      callbackURL: config.redirectUri,
      scope: config.scopes.join(' '),
      ...config.additionalParams
    }, (tokenSet: any, userInfo: any, done: Function) => {
      try {
        const user = this.mapOIDCUser(userInfo, tokenSet);
        done(null, user);
      } catch (error) {
        done(error);
      }
    });

    this.strategies.set(name, strategy);
  }

  private configureSAML(name: string, config: SAMLConfig) {
    const strategy = new SAMLStrategy({
      entryPoint: config.entryPoint,
      issuer: config.issuer,
      cert: config.cert,
      signatureAlgorithm: config.signatureAlgorithm,
      attributeConsumingServiceIndex: false,
      disableRequestedAuthnContext: true
    }, (profile: any, done: Function) => {
      try {
        const user = this.mapSAMLUser(profile, config.attributeMappings);
        done(null, user);
      } catch (error) {
        done(error);
      }
    });

    this.strategies.set(name, strategy);
  }

  private configureLDAP(name: string, config: LDAPConfig) {
    const strategy = new LDAPStrategy({
      server: {
        url: config.url,
        bindDN: config.bindDN,
        bindCredentials: config.bindPassword,
        searchBase: config.baseDN,
        searchFilter: config.searchFilter,
        searchAttributes: Object.values(config.attributes)
      }
    }, (profile: any, done: Function) => {
      try {
        const user = this.mapLDAPUser(profile, config.attributes);
        done(null, user);
      } catch (error) {
        done(error);
      }
    });

    this.strategies.set(name, strategy);
  }

  private mapOIDCUser(userInfo: any, tokenSet: any): User {
    return {
      id: userInfo.sub,
      username: userInfo.preferred_username || userInfo.email,
      email: userInfo.email,
      displayName: userInfo.name || `${userInfo.given_name} ${userInfo.family_name}`,
      roles: this.extractRoles(userInfo.roles || userInfo.groups),
      teams: this.extractTeams(userInfo.teams || userInfo.groups),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      attributes: {
        ...userInfo,
        oidcToken: tokenSet.access_token,
        oidcRefreshToken: tokenSet.refresh_token
      }
    };
  }

  private mapSAMLUser(profile: any, attributeMappings: Record<string, string>): User {
    const getValue = (key: string) => {
      const mappedKey = attributeMappings[key];
      return profile[mappedKey] || profile[key];
    };

    return {
      id: getValue('id') || profile.nameID,
      username: getValue('username') || getValue('email'),
      email: getValue('email'),
      displayName: getValue('displayName') || getValue('name'),
      roles: this.extractRoles(getValue('roles')),
      teams: this.extractTeams(getValue('teams')),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      attributes: profile
    };
  }

  private mapLDAPUser(profile: any, attributeMappings: Record<string, string>): User {
    const getValue = (key: string) => {
      const mappedKey = attributeMappings[key];
      const value = profile[mappedKey] || profile[key];
      return Array.isArray(value) ? value[0] : value;
    };

    return {
      id: getValue('id') || getValue('username'),
      username: getValue('username'),
      email: getValue('email'),
      displayName: getValue('displayName') || getValue('name'),
      roles: this.extractRoles(getValue('roles')),
      teams: this.extractTeams(getValue('teams')),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      attributes: profile
    };
  }

  private extractRoles(roles: any): string[] {
    if (!roles) return [];
    if (typeof roles === 'string') return [roles];
    if (Array.isArray(roles)) return roles;
    return [];
  }

  private extractTeams(teams: any): string[] {
    if (!teams) return [];
    if (typeof teams === 'string') return [teams];
    if (Array.isArray(teams)) return teams;
    return [];
  }

  async authenticate(provider: string, credentials?: any): Promise<AuthenticationResult> {
    try {
      if (!this.config.enabled) {
        return { success: false, error: 'SSO is disabled' };
      }

      const ssoProvider = this.providers.get(provider);
      if (!ssoProvider) {
        return { success: false, error: `SSO provider '${provider}' not found` };
      }

      // For demonstration - actual implementation would integrate with passport strategies
      const user = await this.processAuthentication(provider, credentials);
      
      if (!user) {
        return { success: false, error: 'Authentication failed' };
      }

      // Check if MFA is required
      if (this.config.multiFactorRequired && !credentials?.mfaToken) {
        const mfaToken = this.generateMFAToken(user);
        return {
          success: false,
          mfaRequired: true,
          mfaToken,
          error: 'Multi-factor authentication required'
        };
      }

      const session = await this.createSession(user, provider, credentials?.ipAddress, credentials?.userAgent);
      const token = this.generateJWT(user, session);

      this.emit('authentication', {
        success: true,
        userId: user.id,
        provider,
        timestamp: new Date(),
        ipAddress: credentials?.ipAddress,
        userAgent: credentials?.userAgent
      });

      return {
        success: true,
        user,
        token
      };

    } catch (error: any) {
      this.logger.error(`Authentication error for provider ${provider}:`, error);
      
      this.emit('authentication', {
        success: false,
        provider,
        error: error.message,
        timestamp: new Date(),
        ipAddress: credentials?.ipAddress,
        userAgent: credentials?.userAgent
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  private async processAuthentication(provider: string, credentials: any): Promise<User | null> {
    // This would integrate with actual authentication providers
    // For now, return a mock implementation
    const strategy = this.strategies.get(provider);
    if (!strategy) {
      throw new Error(`Strategy for provider '${provider}' not found`);
    }

    // Mock authentication - replace with actual provider integration
    return null;
  }

  private async createSession(user: User, provider: string, ipAddress?: string, userAgent?: string): Promise<SSOSession> {
    const sessionId = this.generateSessionId();
    const session: SSOSession = {
      id: sessionId,
      userId: user.id,
      provider,
      token: this.generateSessionToken(),
      expiresAt: new Date(Date.now() + this.config.sessionTimeout * 1000),
      ipAddress: ipAddress || 'unknown',
      userAgent: userAgent || 'unknown',
      attributes: user.attributes || {},
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  private generateJWT(user: User, session: SSOSession): string {
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      teams: user.teams,
      sessionId: session.id,
      provider: session.provider,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(session.expiresAt.getTime() / 1000)
    };

    return jwt.sign(payload, this.tokenSecret, { algorithm: 'HS256' });
  }

  async validateToken(token: string): Promise<{ valid: boolean; user?: User; session?: SSOSession }> {
    try {
      const decoded = jwt.verify(token, this.tokenSecret) as any;
      const session = this.sessions.get(decoded.sessionId);

      if (!session || session.expiresAt < new Date()) {
        return { valid: false };
      }

      // Update last activity
      session.lastActivity = new Date();
      this.sessions.set(session.id, session);

      const user: User = {
        id: decoded.sub,
        username: decoded.username,
        email: decoded.email,
        displayName: decoded.displayName,
        roles: decoded.roles,
        teams: decoded.teams,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      return { valid: true, user, session };

    } catch (error) {
      this.logger.debug('Token validation failed:', error);
      return { valid: false };
    }
  }

  async refreshToken(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    // Extend session expiry
    session.expiresAt = new Date(Date.now() + this.config.sessionTimeout * 1000);
    session.lastActivity = new Date();
    this.sessions.set(sessionId, session);

    // Generate new JWT
    const user: User = {
      id: session.userId,
      username: '', // Would fetch from user store
      email: '',
      displayName: '',
      roles: [],
      teams: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return this.generateJWT(user, session);
  }

  async logout(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      
      this.emit('logout', {
        userId: session.userId,
        sessionId,
        provider: session.provider,
        timestamp: new Date()
      });

      return true;
    }
    return false;
  }

  async logoutAll(userId: string): Promise<number> {
    let count = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        this.sessions.delete(sessionId);
        count++;
      }
    }

    if (count > 0) {
      this.emit('logout_all', {
        userId,
        sessionCount: count,
        timestamp: new Date()
      });
    }

    return count;
  }

  getActiveSessions(userId?: string): SSOSession[] {
    const sessions = Array.from(this.sessions.values());
    return userId 
      ? sessions.filter(s => s.userId === userId)
      : sessions;
  }

  private generateSessionId(): string {
    return `sso_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateSessionToken(): string {
    return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  }

  private generateMFAToken(user: User): string {
    const payload = {
      userId: user.id,
      type: 'mfa',
      exp: Math.floor((Date.now() + 300000) / 1000) // 5 minutes
    };
    return jwt.sign(payload, this.tokenSecret);
  }

  private startSessionCleanup() {
    setInterval(() => {
      const now = new Date();
      let cleanedCount = 0;

      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.expiresAt < now) {
          this.sessions.delete(sessionId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.debug(`Cleaned up ${cleanedCount} expired sessions`);
      }
    }, 60000); // Check every minute
  }

  getProviders(): SSOProvider[] {
    return Array.from(this.providers.values());
  }

  addProvider(provider: SSOProvider): void {
    try {
      this.configureProvider(provider);
      this.providers.set(provider.name, provider);
      this.logger.info(`Added SSO provider: ${provider.name}`);
    } catch (error) {
      this.logger.error(`Failed to add SSO provider ${provider.name}:`, error);
      throw error;
    }
  }

  removeProvider(name: string): boolean {
    const removed = this.providers.delete(name);
    this.strategies.delete(name);
    if (removed) {
      this.logger.info(`Removed SSO provider: ${name}`);
    }
    return removed;
  }

  getSessionStats(): { total: number; byProvider: Record<string, number> } {
    const sessions = Array.from(this.sessions.values());
    const byProvider: Record<string, number> = {};

    sessions.forEach(session => {
      byProvider[session.provider] = (byProvider[session.provider] || 0) + 1;
    });

    return {
      total: sessions.length,
      byProvider
    };
  }
}