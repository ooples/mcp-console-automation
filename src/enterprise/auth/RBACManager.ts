/**
 * Enterprise Role-Based Access Control Manager
 * Handles roles, permissions, and access control for console automation
 */

import { EventEmitter } from 'events';
import {
  Role,
  Permission,
  ResourceConstraint,
  User,
  Team,
  RBACConfig,
  EnterpriseConsoleSession
} from '../types/enterprise.js';
import { Logger } from '../../utils/logger.js';

export interface AccessRequest {
  userId: string;
  action: string;
  resource: string;
  context?: Record<string, any>;
}

export interface AccessResult {
  granted: boolean;
  reason?: string;
  requiredPermissions?: Permission[];
  missingPermissions?: Permission[];
}

export interface PermissionCache {
  userId: string;
  permissions: Permission[];
  computedAt: Date;
  expiresAt: Date;
}

export class RBACManager extends EventEmitter {
  private logger: Logger;
  private config: RBACConfig;
  private roles: Map<string, Role>;
  private users: Map<string, User>;
  private teams: Map<string, Team>;
  private permissionCache: Map<string, PermissionCache>;

  constructor(config: RBACConfig) {
    super();
    this.logger = new Logger('RBACManager');
    this.config = config;
    this.roles = new Map();
    this.users = new Map();
    this.teams = new Map();
    this.permissionCache = new Map();

    this.initializeDefaultRoles();
    this.startCacheCleanup();
  }

  private initializeDefaultRoles() {
    if (!this.config.enabled) {
      this.logger.info('RBAC is disabled');
      return;
    }

    // System Administrator role
    this.createSystemRole('system:admin', 'System Administrator', [
      { id: 'admin:*', resource: '*', action: '*', description: 'Full system access' }
    ]);

    // Console Operator role
    this.createSystemRole('console:operator', 'Console Operator', [
      { id: 'console:create', resource: 'console:session', action: 'create', description: 'Create console sessions' },
      { id: 'console:read', resource: 'console:session', action: 'read', description: 'Read console output' },
      { id: 'console:write', resource: 'console:session', action: 'write', description: 'Send input to console' },
      { id: 'console:stop', resource: 'console:session', action: 'stop', description: 'Stop console sessions' }
    ]);

    // Console Viewer role (read-only)
    this.createSystemRole('console:viewer', 'Console Viewer', [
      { id: 'console:read', resource: 'console:session', action: 'read', description: 'Read console output' },
      { id: 'console:list', resource: 'console:session', action: 'list', description: 'List console sessions' }
    ]);

    // Auditor role
    this.createSystemRole('auditor', 'Auditor', [
      { id: 'audit:read', resource: 'audit:log', action: 'read', description: 'Read audit logs' },
      { id: 'console:read', resource: 'console:session', action: 'read', description: 'Read console output' },
      { id: 'console:list', resource: 'console:session', action: 'list', description: 'List console sessions' }
    ]);

    // Default user role
    if (this.config.defaultRole) {
      const defaultRole = this.roles.get(this.config.defaultRole);
      if (!defaultRole) {
        this.createSystemRole(this.config.defaultRole, 'Default User', [
          { id: 'console:create:limited', resource: 'console:session', action: 'create', 
            description: 'Create limited console sessions',
            constraints: [
              { type: 'regex', field: 'command', value: '^(ls|pwd|whoami|date|echo).*' }
            ]
          }
        ]);
      }
    }

    this.logger.info(`Initialized ${this.roles.size} default roles`);
  }

  private createSystemRole(id: string, name: string, permissions: Permission[]) {
    const role: Role = {
      id,
      name,
      description: `System role: ${name}`,
      permissions,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system',
      isSystem: true
    };

    this.roles.set(id, role);
  }

  // Role Management
  async createRole(role: Omit<Role, 'id' | 'createdAt' | 'updatedAt' | 'isSystem'>): Promise<Role> {
    const roleId = `role_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    
    const newRole: Role = {
      ...role,
      id: roleId,
      createdAt: new Date(),
      updatedAt: new Date(),
      isSystem: false
    };

    // Validate role permissions
    await this.validateRolePermissions(newRole);

    this.roles.set(roleId, newRole);
    this.clearPermissionCache();

    this.emit('role:created', { roleId, role: newRole });
    this.logger.info(`Created role: ${newRole.name} (${roleId})`);

    return newRole;
  }

  async updateRole(roleId: string, updates: Partial<Role>): Promise<Role | null> {
    const role = this.roles.get(roleId);
    if (!role) {
      return null;
    }

    if (role.isSystem && !this.config.adminUsers.includes(updates.createdBy || '')) {
      throw new Error('Cannot modify system roles');
    }

    const updatedRole: Role = {
      ...role,
      ...updates,
      id: roleId, // Prevent ID changes
      updatedAt: new Date(),
      isSystem: role.isSystem // Prevent system flag changes
    };

    await this.validateRolePermissions(updatedRole);

    this.roles.set(roleId, updatedRole);
    this.clearPermissionCache();

    this.emit('role:updated', { roleId, role: updatedRole, changes: updates });
    this.logger.info(`Updated role: ${updatedRole.name} (${roleId})`);

    return updatedRole;
  }

  async deleteRole(roleId: string, deletedBy: string): Promise<boolean> {
    const role = this.roles.get(roleId);
    if (!role) {
      return false;
    }

    if (role.isSystem) {
      throw new Error('Cannot delete system roles');
    }

    // Check if role is in use
    const usersWithRole = Array.from(this.users.values()).filter(user => 
      user.roles.includes(roleId)
    );

    if (usersWithRole.length > 0) {
      throw new Error(`Cannot delete role: ${usersWithRole.length} users have this role`);
    }

    this.roles.delete(roleId);
    this.clearPermissionCache();

    this.emit('role:deleted', { roleId, role, deletedBy });
    this.logger.info(`Deleted role: ${role.name} (${roleId})`);

    return true;
  }

  private async validateRolePermissions(role: Role): Promise<void> {
    for (const permission of role.permissions) {
      if (!permission.id || !permission.resource || !permission.action) {
        throw new Error(`Invalid permission in role ${role.name}: missing required fields`);
      }

      // Validate constraints
      if (permission.constraints) {
        for (const constraint of permission.constraints) {
          if (!constraint.type || !constraint.field || constraint.value === undefined) {
            throw new Error(`Invalid constraint in permission ${permission.id}`);
          }

          // Validate regex constraints
          if (constraint.type === 'regex') {
            try {
              new RegExp(constraint.value);
            } catch (error) {
              throw new Error(`Invalid regex in constraint: ${constraint.value}`);
            }
          }
        }
      }
    }

    // Validate role inheritance
    if (role.inherits) {
      for (const inheritedRoleId of role.inherits) {
        const inheritedRole = this.roles.get(inheritedRoleId);
        if (!inheritedRole) {
          throw new Error(`Inherited role not found: ${inheritedRoleId}`);
        }

        // Prevent circular inheritance
        await this.checkCircularInheritance(role.id, inheritedRoleId);
      }
    }
  }

  private async checkCircularInheritance(roleId: string, checkingRoleId: string): Promise<void> {
    const visited = new Set<string>();
    const stack = [checkingRoleId];

    while (stack.length > 0) {
      const currentRoleId = stack.pop()!;
      
      if (currentRoleId === roleId) {
        throw new Error('Circular role inheritance detected');
      }

      if (visited.has(currentRoleId)) {
        continue;
      }

      visited.add(currentRoleId);
      const currentRole = this.roles.get(currentRoleId);
      
      if (currentRole?.inherits) {
        stack.push(...currentRole.inherits);
      }
    }
  }

  // User Management
  async createUser(user: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User> {
    const newUser: User = {
      ...user,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Validate user roles
    for (const roleId of newUser.roles) {
      if (!this.roles.has(roleId)) {
        throw new Error(`Role not found: ${roleId}`);
      }
    }

    // Validate user teams
    for (const teamId of newUser.teams) {
      if (!this.teams.has(teamId)) {
        throw new Error(`Team not found: ${teamId}`);
      }
    }

    this.users.set(newUser.id, newUser);
    this.clearUserPermissionCache(newUser.id);

    this.emit('user:created', { userId: newUser.id, user: newUser });
    this.logger.info(`Created user: ${newUser.username} (${newUser.id})`);

    return newUser;
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User | null> {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }

    const updatedUser: User = {
      ...user,
      ...updates,
      id: userId, // Prevent ID changes
      updatedAt: new Date()
    };

    // Validate updated roles and teams
    if (updates.roles) {
      for (const roleId of updates.roles) {
        if (!this.roles.has(roleId)) {
          throw new Error(`Role not found: ${roleId}`);
        }
      }
    }

    if (updates.teams) {
      for (const teamId of updates.teams) {
        if (!this.teams.has(teamId)) {
          throw new Error(`Team not found: ${teamId}`);
        }
      }
    }

    this.users.set(userId, updatedUser);
    this.clearUserPermissionCache(userId);

    this.emit('user:updated', { userId, user: updatedUser, changes: updates });
    this.logger.info(`Updated user: ${updatedUser.username} (${userId})`);

    return updatedUser;
  }

  // Access Control
  async checkAccess(request: AccessRequest): Promise<AccessResult> {
    if (!this.config.enabled) {
      return { granted: true, reason: 'RBAC is disabled' };
    }

    const user = this.users.get(request.userId);
    if (!user) {
      return { granted: false, reason: 'User not found' };
    }

    if (!user.isActive) {
      return { granted: false, reason: 'User is inactive' };
    }

    const userPermissions = await this.getUserPermissions(request.userId);
    const requiredPermissions = this.getRequiredPermissions(request.resource, request.action);

    const grantedPermissions: Permission[] = [];
    const missingPermissions: Permission[] = [];

    for (const required of requiredPermissions) {
      const hasPermission = userPermissions.some(userPerm => 
        this.permissionMatches(userPerm, required, request.context)
      );

      if (hasPermission) {
        grantedPermissions.push(required);
      } else {
        missingPermissions.push(required);
      }
    }

    const granted = missingPermissions.length === 0;

    // Log access attempt
    this.emit('access:check', {
      userId: request.userId,
      resource: request.resource,
      action: request.action,
      granted,
      timestamp: new Date(),
      context: request.context
    });

    if (!granted) {
      this.logger.warn(`Access denied for user ${user.username}: ${request.action} on ${request.resource}`);
    }

    return {
      granted,
      reason: granted ? 'Access granted' : 'Insufficient permissions',
      requiredPermissions,
      missingPermissions: granted ? undefined : missingPermissions
    };
  }

  private getRequiredPermissions(resource: string, action: string): Permission[] {
    // Define what permissions are required for specific resource/action combinations
    const resourceActionMap: Record<string, Record<string, Permission[]>> = {
      'console:session': {
        'create': [{ id: 'console:create', resource: 'console:session', action: 'create', description: 'Create console sessions' }],
        'read': [{ id: 'console:read', resource: 'console:session', action: 'read', description: 'Read console output' }],
        'write': [{ id: 'console:write', resource: 'console:session', action: 'write', description: 'Send input to console' }],
        'stop': [{ id: 'console:stop', resource: 'console:session', action: 'stop', description: 'Stop console sessions' }],
        'list': [{ id: 'console:list', resource: 'console:session', action: 'list', description: 'List console sessions' }]
      },
      'audit:log': {
        'read': [{ id: 'audit:read', resource: 'audit:log', action: 'read', description: 'Read audit logs' }]
      }
    };

    const resourcePerms = resourceActionMap[resource];
    if (!resourcePerms) {
      // For unknown resources, require admin permission
      return [{ id: 'admin:*', resource: '*', action: '*', description: 'Admin access required' }];
    }

    const actionPerms = resourcePerms[action];
    if (!actionPerms) {
      // For unknown actions, require admin permission
      return [{ id: 'admin:*', resource: '*', action: '*', description: 'Admin access required' }];
    }

    return actionPerms;
  }

  private permissionMatches(userPermission: Permission, requiredPermission: Permission, context?: Record<string, any>): boolean {
    // Check for admin wildcard
    if (userPermission.resource === '*' && userPermission.action === '*') {
      return true;
    }

    // Check resource match (with wildcard support)
    if (userPermission.resource !== requiredPermission.resource && userPermission.resource !== '*') {
      return false;
    }

    // Check action match (with wildcard support)
    if (userPermission.action !== requiredPermission.action && userPermission.action !== '*') {
      return false;
    }

    // Check constraints
    if (userPermission.constraints && context) {
      for (const constraint of userPermission.constraints) {
        if (!this.evaluateConstraint(constraint, context)) {
          return false;
        }
      }
    }

    return true;
  }

  private evaluateConstraint(constraint: ResourceConstraint, context: Record<string, any>): boolean {
    const value = this.getContextValue(constraint.field, context);
    if (value === undefined) {
      return constraint.negate === true; // If field is missing, constraint passes only if negated
    }

    let matches = false;

    switch (constraint.type) {
      case 'exact':
        matches = value === constraint.value;
        break;
      case 'regex':
        matches = new RegExp(constraint.value).test(String(value));
        break;
      case 'prefix':
        matches = String(value).startsWith(constraint.value);
        break;
      case 'suffix':
        matches = String(value).endsWith(constraint.value);
        break;
      case 'contains':
        matches = String(value).includes(constraint.value);
        break;
    }

    return constraint.negate ? !matches : matches;
  }

  private getContextValue(field: string, context: Record<string, any>): any {
    const parts = field.split('.');
    let value = context;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  async getUserPermissions(userId: string): Promise<Permission[]> {
    // Check cache first
    const cached = this.permissionCache.get(userId);
    if (cached && cached.expiresAt > new Date()) {
      return cached.permissions;
    }

    const user = this.users.get(userId);
    if (!user) {
      return [];
    }

    const permissions = new Map<string, Permission>();

    // Collect permissions from user roles
    for (const roleId of user.roles) {
      const rolePermissions = await this.getRolePermissions(roleId);
      rolePermissions.forEach(perm => permissions.set(perm.id, perm));
    }

    // Collect permissions from user teams
    for (const teamId of user.teams) {
      const team = this.teams.get(teamId);
      if (team) {
        for (const roleId of team.roles) {
          const rolePermissions = await this.getRolePermissions(roleId);
          rolePermissions.forEach(perm => permissions.set(perm.id, perm));
        }
      }
    }

    const userPermissions = Array.from(permissions.values());

    // Cache the result
    const cacheEntry: PermissionCache = {
      userId,
      permissions: userPermissions,
      computedAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.cacheTimeout * 1000)
    };
    this.permissionCache.set(userId, cacheEntry);

    return userPermissions;
  }

  private async getRolePermissions(roleId: string): Promise<Permission[]> {
    const role = this.roles.get(roleId);
    if (!role) {
      return [];
    }

    const permissions = new Map<string, Permission>();
    
    // Add direct permissions
    role.permissions.forEach(perm => permissions.set(perm.id, perm));

    // Add inherited permissions
    if (this.config.inheritanceEnabled && role.inherits) {
      for (const inheritedRoleId of role.inherits) {
        const inheritedPermissions = await this.getRolePermissions(inheritedRoleId);
        inheritedPermissions.forEach(perm => permissions.set(perm.id, perm));
      }
    }

    return Array.from(permissions.values());
  }

  // Session Authorization
  async authorizeSession(userId: string, sessionOptions: any): Promise<{ authorized: boolean; reason?: string; modifiedOptions?: any }> {
    const accessResult = await this.checkAccess({
      userId,
      action: 'create',
      resource: 'console:session',
      context: sessionOptions
    });

    if (!accessResult.granted) {
      return {
        authorized: false,
        reason: accessResult.reason
      };
    }

    // Apply policy modifications
    const modifiedOptions = { ...sessionOptions };
    
    // Apply command restrictions
    const userPermissions = await this.getUserPermissions(userId);
    const createPermissions = userPermissions.filter(p => p.resource === 'console:session' && p.action === 'create');

    for (const permission of createPermissions) {
      if (permission.constraints) {
        for (const constraint of permission.constraints) {
          if (constraint.field === 'command' && constraint.type === 'regex') {
            const regex = new RegExp(constraint.value);
            if (!regex.test(modifiedOptions.command)) {
              return {
                authorized: false,
                reason: `Command '${modifiedOptions.command}' is not allowed`
              };
            }
          }
        }
      }
    }

    return {
      authorized: true,
      modifiedOptions
    };
  }

  // Cache Management
  private clearPermissionCache() {
    this.permissionCache.clear();
    this.logger.debug('Cleared permission cache');
  }

  private clearUserPermissionCache(userId: string) {
    this.permissionCache.delete(userId);
    this.logger.debug(`Cleared permission cache for user ${userId}`);
  }

  private startCacheCleanup() {
    setInterval(() => {
      const now = new Date();
      let cleanedCount = 0;

      for (const [userId, cache] of this.permissionCache.entries()) {
        if (cache.expiresAt < now) {
          this.permissionCache.delete(userId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.debug(`Cleaned up ${cleanedCount} expired permission cache entries`);
      }
    }, 60000); // Check every minute
  }

  // Getters
  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  getRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  getUsers(): User[] {
    return Array.from(this.users.values());
  }

  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  getTeams(): Team[] {
    return Array.from(this.teams.values());
  }

  // Statistics
  getStats(): { roles: number; users: number; teams: number; cachedPermissions: number } {
    return {
      roles: this.roles.size,
      users: this.users.size,
      teams: this.teams.size,
      cachedPermissions: this.permissionCache.size
    };
  }
}