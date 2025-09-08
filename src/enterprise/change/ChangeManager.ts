/**
 * Enterprise Change Management System
 * Implements ITIL-compliant change management workflows with approval chains
 */

import { EventEmitter } from 'events';
import {
  ChangeRequest,
  Approval,
  Review,
  Attachment,
  ChangeManagementConfig,
  User,
  EnterpriseConsoleSession
} from '../types/enterprise.js';
import { Logger } from '../../utils/logger.js';

export interface ChangeWorkflow {
  id: string;
  name: string;
  description: string;
  steps: ChangeWorkflowStep[];
  isActive: boolean;
  applicableTypes: string[];
  applicableCategories: string[];
}

export interface ChangeWorkflowStep {
  id: string;
  name: string;
  type: 'approval' | 'review' | 'notification' | 'automation' | 'gate';
  order: number;
  required: boolean;
  approvers?: string[];
  reviewers?: string[];
  conditions?: ChangeCondition[];
  timeoutHours?: number;
  autoApprove?: boolean;
  escalation?: EscalationRule;
}

export interface ChangeCondition {
  field: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'in';
  value: any;
}

export interface EscalationRule {
  enabled: boolean;
  timeoutHours: number;
  escalateTo: string[];
  level: number;
  maxLevels: number;
}

export interface ChangeImpactAssessment {
  businessImpact: 'low' | 'medium' | 'high' | 'critical';
  technicalRisk: 'low' | 'medium' | 'high' | 'critical';
  affectedSystems: string[];
  affectedUsers: number;
  downtime: {
    expected: number; // minutes
    maximum: number; // minutes
  };
  dependencies: string[];
  rollbackComplexity: 'simple' | 'moderate' | 'complex';
}

export interface ChangeCalendar {
  id: string;
  name: string;
  description: string;
  type: 'maintenance' | 'freeze' | 'blackout' | 'preferred';
  startDate: Date;
  endDate: Date;
  recurring?: {
    pattern: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    endDate?: Date;
  };
  affectedCategories: string[];
  isActive: boolean;
}

export interface ChangeMetrics {
  totalRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  completedRequests: number;
  failedRequests: number;
  averageApprovalTime: number; // hours
  averageImplementationTime: number; // hours
  successRate: number;
  emergencyChanges: number;
}

export class ChangeManager extends EventEmitter {
  private logger: Logger;
  private config: ChangeManagementConfig;
  private changes: Map<string, ChangeRequest>;
  private workflows: Map<string, ChangeWorkflow>;
  private calendar: Map<string, ChangeCalendar>;
  private attachments: Map<string, Attachment>;

  constructor(config: ChangeManagementConfig) {
    super();
    this.logger = new Logger('ChangeManager');
    this.config = config;
    this.changes = new Map();
    this.workflows = new Map();
    this.calendar = new Map();
    this.attachments = new Map();

    this.initializeDefaultWorkflows();
    this.startPeriodicTasks();
  }

  private initializeDefaultWorkflows(): void {
    // Standard Change Workflow
    this.workflows.set('standard', {
      id: 'standard',
      name: 'Standard Change Workflow',
      description: 'Standard workflow for routine changes',
      isActive: true,
      applicableTypes: ['standard'],
      applicableCategories: ['*'],
      steps: [
        {
          id: 'initial-review',
          name: 'Initial Technical Review',
          type: 'review',
          order: 1,
          required: true,
          reviewers: ['tech-lead'],
          timeoutHours: 24
        },
        {
          id: 'security-review',
          name: 'Security Review',
          type: 'review',
          order: 2,
          required: true,
          reviewers: ['security-team'],
          conditions: [
            { field: 'riskLevel', operator: 'in', value: ['high', 'critical'] }
          ],
          timeoutHours: 48
        },
        {
          id: 'manager-approval',
          name: 'Manager Approval',
          type: 'approval',
          order: 3,
          required: true,
          approvers: ['manager'],
          timeoutHours: 24,
          escalation: {
            enabled: true,
            timeoutHours: 48,
            escalateTo: ['senior-manager'],
            level: 1,
            maxLevels: 2
          }
        },
        {
          id: 'cab-approval',
          name: 'Change Advisory Board Approval',
          type: 'approval',
          order: 4,
          required: true,
          approvers: this.config.defaultApprovers,
          conditions: [
            { field: 'businessImpact', operator: 'in', value: ['high', 'critical'] }
          ],
          timeoutHours: 72
        }
      ]
    });

    // Normal Change Workflow
    this.workflows.set('normal', {
      id: 'normal',
      name: 'Normal Change Workflow',
      description: 'Enhanced workflow for complex changes',
      isActive: true,
      applicableTypes: ['normal'],
      applicableCategories: ['*'],
      steps: [
        {
          id: 'business-review',
          name: 'Business Impact Review',
          type: 'review',
          order: 1,
          required: true,
          reviewers: ['business-analyst'],
          timeoutHours: 48
        },
        {
          id: 'technical-review',
          name: 'Technical Architecture Review',
          type: 'review',
          order: 2,
          required: true,
          reviewers: ['architect'],
          timeoutHours: 48
        },
        {
          id: 'security-review',
          name: 'Security Review',
          type: 'review',
          order: 3,
          required: true,
          reviewers: ['security-team'],
          timeoutHours: 72
        },
        {
          id: 'compliance-review',
          name: 'Compliance Review',
          type: 'review',
          order: 4,
          required: false,
          reviewers: ['compliance-officer'],
          conditions: [
            { field: 'complianceRequired', operator: 'equals', value: true }
          ],
          timeoutHours: 48
        },
        {
          id: 'cab-approval',
          name: 'Change Advisory Board Approval',
          type: 'approval',
          order: 5,
          required: true,
          approvers: this.config.defaultApprovers,
          timeoutHours: 72
        }
      ]
    });

    // Emergency Change Workflow
    this.workflows.set('emergency', {
      id: 'emergency',
      name: 'Emergency Change Workflow',
      description: 'Expedited workflow for emergency changes',
      isActive: true,
      applicableTypes: ['emergency'],
      applicableCategories: ['*'],
      steps: [
        {
          id: 'emergency-approval',
          name: 'Emergency Approval',
          type: 'approval',
          order: 1,
          required: true,
          approvers: ['emergency-approver'],
          timeoutHours: 2,
          autoApprove: this.config.emergencyBypass
        },
        {
          id: 'post-implementation-review',
          name: 'Post-Implementation Review',
          type: 'review',
          order: 2,
          required: true,
          reviewers: this.config.defaultApprovers,
          timeoutHours: 24
        }
      ]
    });

    this.logger.info(`Initialized ${this.workflows.size} change workflows`);
  }

  async createChangeRequest(request: Omit<ChangeRequest, 'id' | 'status' | 'approvals' | 'reviews' | 'attachments' | 'createdAt' | 'updatedAt'>): Promise<ChangeRequest> {
    const changeId = this.generateChangeId();
    
    const changeRequest: ChangeRequest = {
      ...request,
      id: changeId,
      status: 'draft',
      approvals: [],
      reviews: [],
      attachments: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Validate change request
    await this.validateChangeRequest(changeRequest);

    // Assess impact and risk
    const impact = await this.assessImpact(changeRequest);
    changeRequest.riskLevel = this.calculateRiskLevel(changeRequest, impact);

    // Check change calendar conflicts
    await this.checkCalendarConflicts(changeRequest);

    this.changes.set(changeId, changeRequest);

    this.emit('change:created', { changeRequest });
    this.logger.info(`Created change request: ${changeId} - ${changeRequest.title}`);

    return changeRequest;
  }

  private async validateChangeRequest(request: ChangeRequest): Promise<void> {
    const required = ['title', 'description', 'requester', 'type', 'category', 'implementationPlan', 'rollbackPlan'];
    
    for (const field of required) {
      if (!request[field as keyof ChangeRequest]) {
        throw new Error(`Change request missing required field: ${field}`);
      }
    }

    // Validate dates
    if (request.scheduledStart && request.scheduledEnd) {
      if (request.scheduledStart >= request.scheduledEnd) {
        throw new Error('Scheduled start date must be before end date');
      }
    }

    // Validate emergency changes
    if (request.type === 'emergency' && !request.businessJustification) {
      throw new Error('Emergency changes require business justification');
    }

    // Validate affected systems
    if (!request.affectedSystems || request.affectedSystems.length === 0) {
      throw new Error('At least one affected system must be specified');
    }
  }

  private calculateRiskLevel(request: ChangeRequest, impact: ChangeImpactAssessment): 'low' | 'medium' | 'high' {
    let score = 0;

    // Business impact scoring
    const businessImpactScore = { low: 1, medium: 2, high: 3, critical: 4 }[impact.businessImpact];
    score += businessImpactScore;

    // Technical risk scoring
    const technicalRiskScore = { low: 1, medium: 2, high: 3, critical: 4 }[impact.technicalRisk];
    score += technicalRiskScore;

    // Rollback complexity
    const rollbackScore = { simple: 0, moderate: 1, complex: 2 }[impact.rollbackComplexity];
    score += rollbackScore;

    // System criticality
    if (impact.affectedSystems.some(sys => this.isCriticalSystem(sys))) {
      score += 2;
    }

    // Emergency changes are automatically high risk
    if (request.type === 'emergency') {
      score += 2;
    }

    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }

  private isCriticalSystem(system: string): boolean {
    const criticalSystems = ['production', 'database', 'auth', 'payment', 'core'];
    return criticalSystems.some(critical => system.toLowerCase().includes(critical));
  }

  private async assessImpact(request: ChangeRequest): Promise<ChangeImpactAssessment> {
    // This would integrate with CMDB and monitoring systems
    // For now, return a basic assessment
    return {
      businessImpact: request.priority === 'critical' ? 'critical' : 
                     request.priority === 'high' ? 'high' : 'medium',
      technicalRisk: request.affectedSystems.length > 3 ? 'high' : 'medium',
      affectedSystems: request.affectedSystems,
      affectedUsers: this.estimateAffectedUsers(request.affectedSystems),
      downtime: {
        expected: 30,
        maximum: 120
      },
      dependencies: this.findDependencies(request.affectedSystems),
      rollbackComplexity: request.affectedSystems.length > 5 ? 'complex' : 'moderate'
    };
  }

  private estimateAffectedUsers(systems: string[]): number {
    // Simple estimation based on system types
    const systemUserCounts: Record<string, number> = {
      'web': 1000,
      'api': 500,
      'database': 2000,
      'auth': 3000,
      'payment': 500
    };

    return systems.reduce((total, system) => {
      const count = Object.entries(systemUserCounts).find(([key]) => 
        system.toLowerCase().includes(key)
      )?.[1] || 100;
      return total + count;
    }, 0);
  }

  private findDependencies(systems: string[]): string[] {
    // Mock dependency finder
    const dependencies: Record<string, string[]> = {
      'web': ['api', 'database'],
      'api': ['database', 'auth'],
      'payment': ['database', 'auth', 'web']
    };

    const allDependencies = new Set<string>();
    systems.forEach(system => {
      const sysDeps = Object.entries(dependencies).find(([key]) => 
        system.toLowerCase().includes(key)
      )?.[1] || [];
      sysDeps.forEach(dep => allDependencies.add(dep));
    });

    return Array.from(allDependencies);
  }

  private async checkCalendarConflicts(request: ChangeRequest): Promise<void> {
    if (!request.scheduledStart || !request.scheduledEnd) return;

    const conflicts: string[] = [];

    for (const [id, calendarEntry] of this.calendar.entries()) {
      if (!calendarEntry.isActive) continue;

      const hasTimeConflict = this.hasTimeOverlap(
        request.scheduledStart,
        request.scheduledEnd,
        calendarEntry.startDate,
        calendarEntry.endDate
      );

      if (hasTimeConflict) {
        const hasCategoryConflict = calendarEntry.affectedCategories.includes('*') ||
                                   calendarEntry.affectedCategories.includes(request.category);

        if (hasCategoryConflict) {
          if (calendarEntry.type === 'blackout') {
            throw new Error(`Change conflicts with blackout period: ${calendarEntry.name}`);
          } else if (calendarEntry.type === 'freeze') {
            conflicts.push(`Change freeze: ${calendarEntry.name}`);
          }
        }
      }
    }

    if (conflicts.length > 0) {
      this.emit('change:calendar-conflict', { changeRequest: request, conflicts });
      this.logger.warn(`Change ${request.id} has calendar conflicts:`, conflicts);
    }
  }

  private hasTimeOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
    return start1 < end2 && start2 < end1;
  }

  async submitChangeRequest(changeId: string): Promise<void> {
    const change = this.changes.get(changeId);
    if (!change) {
      throw new Error(`Change request ${changeId} not found`);
    }

    if (change.status !== 'draft') {
      throw new Error(`Change request ${changeId} cannot be submitted (current status: ${change.status})`);
    }

    // Start workflow
    const workflow = this.getApplicableWorkflow(change);
    if (!workflow) {
      throw new Error(`No applicable workflow found for change ${changeId}`);
    }

    change.status = 'submitted';
    change.updatedAt = new Date();

    await this.startWorkflow(change, workflow);

    this.emit('change:submitted', { changeRequest: change, workflow });
    this.logger.info(`Submitted change request: ${changeId}`);
  }

  private getApplicableWorkflow(change: ChangeRequest): ChangeWorkflow | undefined {
    return Array.from(this.workflows.values()).find(workflow => 
      workflow.isActive &&
      workflow.applicableTypes.includes(change.type) &&
      (workflow.applicableCategories.includes('*') || workflow.applicableCategories.includes(change.category))
    );
  }

  private async startWorkflow(change: ChangeRequest, workflow: ChangeWorkflow): Promise<void> {
    const sortedSteps = workflow.steps.sort((a, b) => a.order - b.order);
    
    for (const step of sortedSteps) {
      if (step.conditions && !this.evaluateStepConditions(step.conditions, change)) {
        continue; // Skip conditional steps that don't match
      }

      if (step.required || this.shouldExecuteOptionalStep(step, change)) {
        await this.executeWorkflowStep(change, step);
      }
    }
  }

  private evaluateStepConditions(conditions: ChangeCondition[], change: ChangeRequest): boolean {
    return conditions.every(condition => {
      const fieldValue = this.getChangeFieldValue(condition.field, change);
      return this.evaluateCondition(condition, fieldValue);
    });
  }

  private getChangeFieldValue(field: string, change: ChangeRequest): any {
    const parts = field.split('.');
    let value: any = change;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private evaluateCondition(condition: ChangeCondition, fieldValue: any): boolean {
    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value;
      case 'contains':
        return String(fieldValue).includes(String(condition.value));
      case 'gt':
        return Number(fieldValue) > Number(condition.value);
      case 'lt':
        return Number(fieldValue) < Number(condition.value);
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      default:
        return false;
    }
  }

  private shouldExecuteOptionalStep(step: ChangeWorkflowStep, change: ChangeRequest): boolean {
    // Logic to determine if optional steps should be executed
    if (change.type === 'emergency') {
      return false; // Skip optional steps for emergency changes
    }
    
    if (change.riskLevel === 'high') {
      return true; // Execute all optional steps for high-risk changes
    }

    return false;
  }

  private async executeWorkflowStep(change: ChangeRequest, step: ChangeWorkflowStep): Promise<void> {
    switch (step.type) {
      case 'approval':
        await this.requestApprovals(change, step);
        break;
      case 'review':
        await this.requestReviews(change, step);
        break;
      case 'notification':
        await this.sendNotifications(change, step);
        break;
      case 'automation':
        await this.executeAutomation(change, step);
        break;
      case 'gate':
        await this.evaluateGate(change, step);
        break;
    }
  }

  private async requestApprovals(change: ChangeRequest, step: ChangeWorkflowStep): Promise<void> {
    if (!step.approvers) return;

    for (const approverId of step.approvers) {
      const approval: Approval = {
        id: this.generateApprovalId(),
        approverId,
        status: 'pending',
        level: step.order,
        timestamp: undefined
      };

      change.approvals.push(approval);

      // Send approval request notification
      this.emit('approval:requested', { 
        changeRequest: change, 
        approval, 
        step,
        timeoutHours: step.timeoutHours 
      });

      // Set timeout for escalation
      if (step.escalation?.enabled && step.timeoutHours) {
        setTimeout(() => {
          this.handleApprovalTimeout(change.id, approval.id, step.escalation!);
        }, step.timeoutHours * 60 * 60 * 1000);
      }
    }

    change.updatedAt = new Date();
    this.logger.info(`Requested approvals for change ${change.id} from ${step.approvers.length} approvers`);
  }

  private async requestReviews(change: ChangeRequest, step: ChangeWorkflowStep): Promise<void> {
    if (!step.reviewers) return;

    for (const reviewerId of step.reviewers) {
      const review: Review = {
        id: this.generateReviewId(),
        reviewerId,
        type: this.mapStepToReviewType(step.name),
        status: 'pending',
        comments: '',
        timestamp: new Date()
      };

      change.reviews.push(review);

      this.emit('review:requested', { 
        changeRequest: change, 
        review, 
        step,
        timeoutHours: step.timeoutHours 
      });
    }

    change.updatedAt = new Date();
    this.logger.info(`Requested reviews for change ${change.id} from ${step.reviewers.length} reviewers`);
  }

  private mapStepToReviewType(stepName: string): 'technical' | 'security' | 'business' | 'compliance' {
    const name = stepName.toLowerCase();
    if (name.includes('security')) return 'security';
    if (name.includes('business')) return 'business';
    if (name.includes('compliance')) return 'compliance';
    return 'technical';
  }

  private async sendNotifications(change: ChangeRequest, step: ChangeWorkflowStep): Promise<void> {
    this.emit('notification:send', { changeRequest: change, step });
    this.logger.info(`Sent notifications for change ${change.id}`);
  }

  private async executeAutomation(change: ChangeRequest, step: ChangeWorkflowStep): Promise<void> {
    // Execute automated tasks
    this.emit('automation:execute', { changeRequest: change, step });
    this.logger.info(`Executed automation for change ${change.id}`);
  }

  private async evaluateGate(change: ChangeRequest, step: ChangeWorkflowStep): Promise<void> {
    // Evaluate gate conditions
    if (step.conditions && !this.evaluateStepConditions(step.conditions, change)) {
      throw new Error(`Change ${change.id} failed gate evaluation: ${step.name}`);
    }

    this.emit('gate:passed', { changeRequest: change, step });
    this.logger.info(`Change ${change.id} passed gate: ${step.name}`);
  }

  async approveChangeRequest(changeId: string, approverId: string, comments?: string): Promise<void> {
    const change = this.changes.get(changeId);
    if (!change) {
      throw new Error(`Change request ${changeId} not found`);
    }

    const approval = change.approvals.find(a => a.approverId === approverId && a.status === 'pending');
    if (!approval) {
      throw new Error(`No pending approval found for ${approverId} on change ${changeId}`);
    }

    approval.status = 'approved';
    approval.comments = comments;
    approval.timestamp = new Date();

    change.updatedAt = new Date();

    // Check if all required approvals are complete
    await this.checkApprovalCompletion(change);

    this.emit('approval:granted', { changeRequest: change, approval });
    this.logger.info(`Change ${changeId} approved by ${approverId}`);
  }

  async rejectChangeRequest(changeId: string, approverId: string, comments: string): Promise<void> {
    const change = this.changes.get(changeId);
    if (!change) {
      throw new Error(`Change request ${changeId} not found`);
    }

    const approval = change.approvals.find(a => a.approverId === approverId && a.status === 'pending');
    if (!approval) {
      throw new Error(`No pending approval found for ${approverId} on change ${changeId}`);
    }

    approval.status = 'rejected';
    approval.comments = comments;
    approval.timestamp = new Date();

    change.status = 'rejected';
    change.updatedAt = new Date();

    this.emit('approval:rejected', { changeRequest: change, approval });
    this.logger.info(`Change ${changeId} rejected by ${approverId}: ${comments}`);
  }

  private async checkApprovalCompletion(change: ChangeRequest): Promise<void> {
    const requiredApprovals = change.approvals.filter(a => a.level > 0);
    const completedApprovals = requiredApprovals.filter(a => a.status === 'approved');

    if (completedApprovals.length === requiredApprovals.length) {
      change.status = 'approved';
      this.emit('change:approved', { changeRequest: change });
      this.logger.info(`Change ${change.id} fully approved`);
    }
  }

  async implementChange(changeId: string, implementerId: string): Promise<void> {
    const change = this.changes.get(changeId);
    if (!change) {
      throw new Error(`Change request ${changeId} not found`);
    }

    if (change.status !== 'approved') {
      throw new Error(`Change ${changeId} is not approved for implementation`);
    }

    change.status = 'in_progress';
    change.actualStart = new Date();
    change.updatedAt = new Date();

    this.emit('change:implementation-started', { changeRequest: change, implementerId });
    this.logger.info(`Change ${changeId} implementation started by ${implementerId}`);
  }

  async completeChange(changeId: string, implementerId: string, successful: boolean): Promise<void> {
    const change = this.changes.get(changeId);
    if (!change) {
      throw new Error(`Change request ${changeId} not found`);
    }

    if (change.status !== 'in_progress') {
      throw new Error(`Change ${changeId} is not in progress`);
    }

    change.status = successful ? 'completed' : 'failed';
    change.actualEnd = new Date();
    change.updatedAt = new Date();

    const event = successful ? 'change:implementation-completed' : 'change:implementation-failed';
    this.emit(event, { changeRequest: change, implementerId });
    
    this.logger.info(`Change ${changeId} implementation ${successful ? 'completed' : 'failed'}`);

    // If failed, may need rollback
    if (!successful) {
      this.emit('change:rollback-needed', { changeRequest: change });
    }
  }

  async rollbackChange(changeId: string, implementerId: string): Promise<void> {
    const change = this.changes.get(changeId);
    if (!change) {
      throw new Error(`Change request ${changeId} not found`);
    }

    change.status = 'rolled_back';
    change.updatedAt = new Date();

    this.emit('change:rolled-back', { changeRequest: change, implementerId });
    this.logger.info(`Change ${changeId} rolled back by ${implementerId}`);
  }

  private handleApprovalTimeout(changeId: string, approvalId: string, escalation: EscalationRule): void {
    const change = this.changes.get(changeId);
    if (!change) return;

    const approval = change.approvals.find(a => a.id === approvalId);
    if (!approval || approval.status !== 'pending') return;

    this.emit('approval:timeout', { 
      changeRequest: change, 
      approval, 
      escalation,
      level: escalation.level 
    });

    // Escalate if within max levels
    if (escalation.level < escalation.maxLevels) {
      for (const escalatedApproverId of escalation.escalateTo) {
        const escalatedApproval: Approval = {
          id: this.generateApprovalId(),
          approverId: escalatedApproverId,
          status: 'pending',
          level: escalation.level + 1,
          timestamp: undefined
        };

        change.approvals.push(escalatedApproval);

        this.emit('approval:escalated', { 
          changeRequest: change, 
          escalatedApproval,
          originalApproval: approval,
          level: escalation.level + 1
        });
      }
    }

    this.logger.warn(`Approval timeout for change ${changeId}, escalated to level ${escalation.level + 1}`);
  }

  // Calendar Management
  async addCalendarEntry(entry: Omit<ChangeCalendar, 'id'>): Promise<ChangeCalendar> {
    const calendarEntry: ChangeCalendar = {
      ...entry,
      id: this.generateCalendarId()
    };

    this.calendar.set(calendarEntry.id, calendarEntry);

    this.emit('calendar:entry-added', { calendarEntry });
    this.logger.info(`Added calendar entry: ${calendarEntry.name}`);

    return calendarEntry;
  }

  // Attachment Management
  async addAttachment(changeId: string, attachment: Omit<Attachment, 'id'>): Promise<Attachment> {
    const change = this.changes.get(changeId);
    if (!change) {
      throw new Error(`Change request ${changeId} not found`);
    }

    const newAttachment: Attachment = {
      ...attachment,
      id: this.generateAttachmentId()
    };

    this.attachments.set(newAttachment.id, newAttachment);
    change.attachments.push(newAttachment);
    change.updatedAt = new Date();

    this.emit('attachment:added', { changeRequest: change, attachment: newAttachment });
    return newAttachment;
  }

  // Reporting and Metrics
  getChangeMetrics(startDate?: Date, endDate?: Date): ChangeMetrics {
    const changes = Array.from(this.changes.values());
    const filteredChanges = startDate && endDate
      ? changes.filter(c => c.createdAt >= startDate && c.createdAt <= endDate)
      : changes;

    const totalRequests = filteredChanges.length;
    const approvedRequests = filteredChanges.filter(c => c.status === 'approved' || c.status === 'completed').length;
    const rejectedRequests = filteredChanges.filter(c => c.status === 'rejected').length;
    const completedRequests = filteredChanges.filter(c => c.status === 'completed').length;
    const failedRequests = filteredChanges.filter(c => c.status === 'failed').length;
    const emergencyChanges = filteredChanges.filter(c => c.type === 'emergency').length;

    // Calculate average approval time
    const approvedChanges = filteredChanges.filter(c => c.status === 'approved' || c.status === 'completed');
    const approvalTimes = approvedChanges.map(c => {
      const firstApproval = c.approvals.find(a => a.status === 'approved');
      if (firstApproval?.timestamp) {
        return (firstApproval.timestamp.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60); // hours
      }
      return 0;
    });
    const averageApprovalTime = approvalTimes.length > 0 
      ? approvalTimes.reduce((sum, time) => sum + time, 0) / approvalTimes.length 
      : 0;

    // Calculate average implementation time
    const implementedChanges = filteredChanges.filter(c => c.actualStart && c.actualEnd);
    const implementationTimes = implementedChanges.map(c => 
      (c.actualEnd!.getTime() - c.actualStart!.getTime()) / (1000 * 60 * 60) // hours
    );
    const averageImplementationTime = implementationTimes.length > 0
      ? implementationTimes.reduce((sum, time) => sum + time, 0) / implementationTimes.length
      : 0;

    const successRate = completedRequests > 0 
      ? completedRequests / (completedRequests + failedRequests)
      : 0;

    return {
      totalRequests,
      approvedRequests,
      rejectedRequests,
      completedRequests,
      failedRequests,
      averageApprovalTime,
      averageImplementationTime,
      successRate,
      emergencyChanges
    };
  }

  // Console Session Integration
  async createSessionFromChange(changeId: string, sessionOptions: any): Promise<string> {
    const change = this.changes.get(changeId);
    if (!change) {
      throw new Error(`Change request ${changeId} not found`);
    }

    if (change.status !== 'approved' && change.status !== 'in_progress') {
      throw new Error(`Change ${changeId} is not approved for implementation`);
    }

    // Associate session with change request
    const enhancedOptions = {
      ...sessionOptions,
      changeRequestId: changeId,
      riskLevel: change.riskLevel,
      complianceFlags: this.getComplianceFlags(change),
      maxDuration: this.getMaxDuration(change),
      recordingEnabled: change.riskLevel !== 'low'
    };

    this.emit('session:from-change', { changeRequest: change, sessionOptions: enhancedOptions });
    return changeId; // Return change ID as session correlation
  }

  private getComplianceFlags(change: ChangeRequest): string[] {
    const flags: string[] = [];
    
    if (change.riskLevel === 'high') flags.push('HIGH_RISK');
    if (change.type === 'emergency') flags.push('EMERGENCY');
    if (change.affectedSystems.some(sys => this.isCriticalSystem(sys))) flags.push('CRITICAL_SYSTEM');
    
    return flags;
  }

  private getMaxDuration(change: ChangeRequest): number {
    // Calculate max duration based on change type and risk
    const baseDuration = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
    
    if (change.type === 'emergency') return baseDuration / 2;
    if (change.riskLevel === 'high') return baseDuration * 2;
    
    return baseDuration;
  }

  private startPeriodicTasks(): void {
    // Check for overdue changes
    setInterval(() => {
      this.checkOverdueChanges();
    }, 60 * 60 * 1000); // Every hour

    // Generate periodic reports
    setInterval(() => {
      this.generatePeriodicReports();
    }, 24 * 60 * 60 * 1000); // Daily
  }

  private checkOverdueChanges(): void {
    const now = new Date();
    let overdueCount = 0;

    for (const change of this.changes.values()) {
      if (change.status === 'in_progress' && change.scheduledEnd && change.scheduledEnd < now) {
        this.emit('change:overdue', { changeRequest: change });
        overdueCount++;
      }
    }

    if (overdueCount > 0) {
      this.logger.warn(`Found ${overdueCount} overdue changes`);
    }
  }

  private generatePeriodicReports(): void {
    const metrics = this.getChangeMetrics();
    this.emit('report:daily-metrics', { metrics, date: new Date() });
  }

  // Utility methods
  private generateChangeId(): string {
    return `CHG_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateApprovalId(): string {
    return `APR_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateReviewId(): string {
    return `REV_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateAttachmentId(): string {
    return `ATT_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateCalendarId(): string {
    return `CAL_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  // Getters
  getChangeRequest(changeId: string): ChangeRequest | undefined {
    return this.changes.get(changeId);
  }

  getChangeRequests(filters?: Partial<ChangeRequest>): ChangeRequest[] {
    let changes = Array.from(this.changes.values());

    if (filters) {
      changes = changes.filter(change => {
        return Object.entries(filters).every(([key, value]) => 
          change[key as keyof ChangeRequest] === value
        );
      });
    }

    return changes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getWorkflows(): ChangeWorkflow[] {
    return Array.from(this.workflows.values());
  }

  getCalendarEntries(): ChangeCalendar[] {
    return Array.from(this.calendar.values());
  }
}