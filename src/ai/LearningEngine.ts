import { AIConfig } from './AICore.js';
import { Logger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ExecutionRecord {
  sessionId: string;
  command: string;
  success: boolean;
  output: string;
  duration: number;
  context: any;
  timestamp: Date;
}

interface CommandPattern {
  command: string;
  frequency: number;
  successRate: number;
  averageDuration: number;
  commonFollowups: Array<{ command: string; frequency: number }>;
  contexts: Array<{ context: any; frequency: number }>;
  lastUsed: Date;
}

interface UserProfile {
  sessionId: string;
  commandPreferences: Map<string, number>;
  workflowPatterns: Array<{ sequence: string[]; frequency: number }>;
  errorPatterns: Array<{ error: string; resolution: string; frequency: number }>;
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  domains: Array<{ domain: string; confidence: number }>;
}

export class LearningEngine {
  private logger: Logger;
  private config: AIConfig;
  private executionHistory: ExecutionRecord[] = [];
  private commandPatterns: Map<string, CommandPattern> = new Map();
  private userProfiles: Map<string, UserProfile> = new Map();
  private learningDataPath: string;

  constructor(config: AIConfig) {
    this.config = config;
    this.logger = new Logger('LearningEngine');
    this.learningDataPath = config.learningDataPath || './data/learning';
    
    this.initializeLearning();
  }

  private async initializeLearning() {
    try {
      await this.loadLearningData();
      this.logger.info('Learning data loaded successfully');
    } catch (error) {
      this.logger.warn(`Could not load learning data: ${error}`);
    }

    // Start periodic learning update
    setInterval(() => {
      this.updateLearningModel();
    }, 60000); // Update every minute

    // Save data periodically
    setInterval(() => {
      this.save();
    }, 300000); // Save every 5 minutes
  }

  async recordExecution(record: ExecutionRecord): Promise<void> {
    this.executionHistory.push(record);
    
    // Keep only last 10000 records in memory
    if (this.executionHistory.length > 10000) {
      this.executionHistory.shift();
    }

    // Update command patterns
    this.updateCommandPattern(record);
    
    // Update user profile
    this.updateUserProfile(record);

    this.logger.debug(`Recorded execution for session ${record.sessionId}: ${record.command}`);
  }

  private updateCommandPattern(record: ExecutionRecord): void {
    const commandKey = this.normalizeCommand(record.command);
    const pattern = this.commandPatterns.get(commandKey) || {
      command: commandKey,
      frequency: 0,
      successRate: 0,
      averageDuration: 0,
      commonFollowups: [],
      contexts: [],
      lastUsed: new Date()
    };

    // Update frequency
    pattern.frequency++;
    
    // Update success rate using exponential moving average
    const alpha = 0.1;
    pattern.successRate = pattern.successRate * (1 - alpha) + (record.success ? 1 : 0) * alpha;
    
    // Update average duration
    pattern.averageDuration = pattern.averageDuration * (1 - alpha) + record.duration * alpha;
    
    // Update context associations
    this.updateContextAssociation(pattern, record.context);
    
    // Update last used timestamp
    pattern.lastUsed = record.timestamp;

    this.commandPatterns.set(commandKey, pattern);

    // Update followup patterns based on recent command history
    this.updateFollowupPatterns(record);
  }

  private updateUserProfile(record: ExecutionRecord): void {
    let profile = this.userProfiles.get(record.sessionId);
    
    if (!profile) {
      profile = {
        sessionId: record.sessionId,
        commandPreferences: new Map(),
        workflowPatterns: [],
        errorPatterns: [],
        skillLevel: 'beginner',
        domains: []
      };
      this.userProfiles.set(record.sessionId, profile);
    }

    // Update command preferences
    const normalizedCmd = this.normalizeCommand(record.command);
    const currentPref = profile.commandPreferences.get(normalizedCmd) || 0;
    profile.commandPreferences.set(normalizedCmd, currentPref + 1);

    // Update skill level based on command complexity and success rate
    this.updateSkillLevel(profile, record);

    // Update domain knowledge
    this.updateDomainKnowledge(profile, record);

    // Update workflow patterns
    this.updateWorkflowPatterns(profile, record);

    // Update error patterns if applicable
    if (!record.success) {
      this.updateErrorPatterns(profile, record);
    }
  }

  private normalizeCommand(command: string): string {
    // Remove arguments and parameters to focus on the base command
    return command.trim().split(' ')[0].toLowerCase();
  }

  private updateContextAssociation(pattern: CommandPattern, context: any): void {
    if (!context) return;

    const contextKey = JSON.stringify(context);
    const existingContext = pattern.contexts.find(c => JSON.stringify(c.context) === contextKey);
    
    if (existingContext) {
      existingContext.frequency++;
    } else if (pattern.contexts.length < 20) { // Limit context storage
      pattern.contexts.push({ context, frequency: 1 });
    }

    // Sort by frequency and keep top contexts
    pattern.contexts.sort((a, b) => b.frequency - a.frequency);
    pattern.contexts = pattern.contexts.slice(0, 10);
  }

  private updateFollowupPatterns(record: ExecutionRecord): void {
    // Look for recent commands in the same session to identify followup patterns
    const recentCommands = this.executionHistory
      .filter(r => r.sessionId === record.sessionId)
      .slice(-5) // Last 5 commands
      .map(r => this.normalizeCommand(r.command));

    if (recentCommands.length < 2) return;

    const previousCommand = recentCommands[recentCommands.length - 2];
    const currentCommand = recentCommands[recentCommands.length - 1];

    const prevPattern = this.commandPatterns.get(previousCommand);
    if (prevPattern) {
      const followup = prevPattern.commonFollowups.find(f => f.command === currentCommand);
      if (followup) {
        followup.frequency++;
      } else {
        prevPattern.commonFollowups.push({ command: currentCommand, frequency: 1 });
      }

      // Sort and limit followups
      prevPattern.commonFollowups.sort((a, b) => b.frequency - a.frequency);
      prevPattern.commonFollowups = prevPattern.commonFollowups.slice(0, 5);
    }
  }

  private updateSkillLevel(profile: UserProfile, record: ExecutionRecord): void {
    const commandComplexity = this.assessCommandComplexity(record.command);
    const totalCommands = profile.commandPreferences.size;
    const uniqueCommands = Array.from(profile.commandPreferences.keys()).length;
    const avgSuccessRate = this.calculateUserSuccessRate(profile.sessionId);

    let skillScore = 0;
    
    // Factors for skill assessment
    skillScore += Math.min(uniqueCommands / 50, 1) * 25; // Command variety (max 25 points)
    skillScore += avgSuccessRate * 25; // Success rate (max 25 points)
    skillScore += Math.min(commandComplexity, 1) * 25; // Command complexity (max 25 points)
    skillScore += Math.min(totalCommands / 1000, 1) * 25; // Experience (max 25 points)

    // Determine skill level
    if (skillScore >= 80) profile.skillLevel = 'expert';
    else if (skillScore >= 60) profile.skillLevel = 'advanced';
    else if (skillScore >= 40) profile.skillLevel = 'intermediate';
    else profile.skillLevel = 'beginner';
  }

  private assessCommandComplexity(command: string): number {
    let complexity = 0;
    
    // Basic complexity factors
    const parts = command.split(' ');
    complexity += Math.min(parts.length / 10, 0.3); // Command length
    
    // Advanced features
    if (command.includes('|')) complexity += 0.2; // Pipes
    if (command.includes('&&') || command.includes('||')) complexity += 0.2; // Logical operators
    if (command.includes('>') || command.includes('<')) complexity += 0.15; // Redirects
    if (command.match(/\$\(/)) complexity += 0.25; // Command substitution
    if (command.includes('grep') || command.includes('awk') || command.includes('sed')) complexity += 0.3; // Text processing
    if (command.includes('find')) complexity += 0.25; // File finding
    if (command.includes('ssh') || command.includes('scp')) complexity += 0.3; // Remote operations
    if (command.match(/for\s|while\s|if\s/)) complexity += 0.4; // Control structures
    
    return Math.min(complexity, 1);
  }

  private updateDomainKnowledge(profile: UserProfile, record: ExecutionRecord): void {
    const domain = this.identifyDomain(record.command);
    if (!domain) return;

    const existingDomain = profile.domains.find(d => d.domain === domain);
    if (existingDomain) {
      existingDomain.confidence = Math.min(existingDomain.confidence + 0.1, 1);
    } else {
      profile.domains.push({ domain, confidence: 0.1 });
    }

    // Sort by confidence and keep top domains
    profile.domains.sort((a, b) => b.confidence - a.confidence);
    profile.domains = profile.domains.slice(0, 10);
  }

  private identifyDomain(command: string): string | null {
    const domains = [
      { keywords: ['git', 'clone', 'commit', 'push', 'pull', 'merge'], domain: 'version_control' },
      { keywords: ['docker', 'kubectl', 'helm', 'container'], domain: 'containerization' },
      { keywords: ['npm', 'node', 'yarn', 'package.json'], domain: 'nodejs' },
      { keywords: ['python', 'pip', 'conda', 'virtualenv'], domain: 'python' },
      { keywords: ['mysql', 'postgres', 'mongo', 'redis'], domain: 'database' },
      { keywords: ['nginx', 'apache', 'systemctl', 'service'], domain: 'system_admin' },
      { keywords: ['aws', 'gcp', 'azure', 'terraform'], domain: 'cloud' },
      { keywords: ['test', 'pytest', 'jest', 'mocha'], domain: 'testing' },
      { keywords: ['build', 'make', 'cmake', 'maven'], domain: 'build_systems' },
      { keywords: ['ssh', 'scp', 'rsync', 'curl'], domain: 'networking' }
    ];

    const commandLower = command.toLowerCase();
    for (const { keywords, domain } of domains) {
      if (keywords.some(keyword => commandLower.includes(keyword))) {
        return domain;
      }
    }

    return null;
  }

  private updateWorkflowPatterns(profile: UserProfile, record: ExecutionRecord): void {
    // Get recent command sequence
    const recentCommands = this.executionHistory
      .filter(r => r.sessionId === record.sessionId)
      .slice(-5)
      .map(r => this.normalizeCommand(r.command));

    if (recentCommands.length < 3) return;

    const sequence = recentCommands.slice(-3);
    const sequenceKey = sequence.join(' -> ');

    const existingPattern = profile.workflowPatterns.find(p => p.sequence.join(' -> ') === sequenceKey);
    if (existingPattern) {
      existingPattern.frequency++;
    } else {
      profile.workflowPatterns.push({ sequence, frequency: 1 });
    }

    // Sort and limit patterns
    profile.workflowPatterns.sort((a, b) => b.frequency - a.frequency);
    profile.workflowPatterns = profile.workflowPatterns.slice(0, 20);
  }

  private updateErrorPatterns(profile: UserProfile, record: ExecutionRecord): void {
    const errorSummary = record.output.substring(0, 200); // First 200 chars of error
    
    const existingPattern = profile.errorPatterns.find(p => 
      p.error.substring(0, 100) === errorSummary.substring(0, 100)
    );

    if (existingPattern) {
      existingPattern.frequency++;
    } else if (profile.errorPatterns.length < 50) {
      profile.errorPatterns.push({
        error: errorSummary,
        resolution: '', // To be filled when user successfully resolves
        frequency: 1
      });
    }
  }

  private calculateUserSuccessRate(sessionId: string): number {
    const userRecords = this.executionHistory.filter(r => r.sessionId === sessionId);
    if (userRecords.length === 0) return 0;
    
    const successCount = userRecords.filter(r => r.success).length;
    return successCount / userRecords.length;
  }

  async predictNext(sessionId: string, commandHistory: string[]): Promise<string[]> {
    const profile = this.userProfiles.get(sessionId);
    const predictions: Array<{ command: string; score: number }> = [];

    if (commandHistory.length === 0) {
      // Return most frequently used commands for this user
      if (profile) {
        const topCommands = Array.from(profile.commandPreferences.entries())
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5)
          .map(([cmd]) => cmd);
        return topCommands;
      }
      return [];
    }

    const lastCommand = this.normalizeCommand(commandHistory[commandHistory.length - 1]);
    const pattern = this.commandPatterns.get(lastCommand);

    // Prediction based on followup patterns
    if (pattern) {
      for (const followup of pattern.commonFollowups) {
        predictions.push({
          command: followup.command,
          score: followup.frequency * 0.4
        });
      }
    }

    // Prediction based on user workflow patterns
    if (profile) {
      for (const workflow of profile.workflowPatterns) {
        const sequence = workflow.sequence;
        const historyTail = commandHistory.slice(-2).map(cmd => this.normalizeCommand(cmd));
        
        // Check if current history matches part of the workflow
        for (let i = 0; i < sequence.length - 1; i++) {
          if (this.arraysMatch(historyTail, sequence.slice(i, i + historyTail.length))) {
            const nextCmd = sequence[i + historyTail.length];
            if (nextCmd) {
              const existing = predictions.find(p => p.command === nextCmd);
              if (existing) {
                existing.score += workflow.frequency * 0.3;
              } else {
                predictions.push({ command: nextCmd, score: workflow.frequency * 0.3 });
              }
            }
          }
        }
      }
    }

    // Add user preference bias
    if (profile) {
      for (const prediction of predictions) {
        const userPref = profile.commandPreferences.get(prediction.command) || 0;
        prediction.score += userPref * 0.1;
      }
    }

    // Sort and return top predictions
    return predictions
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(p => p.command);
  }

  async getCompletions(partialCommand: string): Promise<string[]> {
    const partial = partialCommand.toLowerCase();
    const completions: Array<{ command: string; score: number }> = [];

    // Find commands that start with the partial command
    for (const [command, pattern] of this.commandPatterns.entries()) {
      if (command.startsWith(partial)) {
        completions.push({
          command,
          score: pattern.frequency * pattern.successRate
        });
      }
    }

    // Also look for commands that contain the partial (fuzzy matching)
    for (const [command, pattern] of this.commandPatterns.entries()) {
      if (command.includes(partial) && !command.startsWith(partial)) {
        completions.push({
          command,
          score: pattern.frequency * pattern.successRate * 0.5 // Lower score for fuzzy matches
        });
      }
    }

    return completions
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(c => c.command);
  }

  private arraysMatch(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) return false;
    return arr1.every((val, index) => val === arr2[index]);
  }

  private updateLearningModel(): void {
    // Periodic model updates
    this.pruneOldData();
    this.optimizePatterns();
  }

  private pruneOldData(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30); // Keep last 30 days

    // Remove old execution records
    this.executionHistory = this.executionHistory.filter(record => 
      record.timestamp > cutoffDate
    );

    // Remove unused command patterns
    for (const [command, pattern] of this.commandPatterns.entries()) {
      if (pattern.lastUsed < cutoffDate && pattern.frequency < 5) {
        this.commandPatterns.delete(command);
      }
    }
  }

  private optimizePatterns(): void {
    // Merge similar command patterns
    const commands = Array.from(this.commandPatterns.keys());
    const toMerge: Array<[string, string]> = [];

    for (let i = 0; i < commands.length; i++) {
      for (let j = i + 1; j < commands.length; j++) {
        if (this.commandsSimilar(commands[i], commands[j])) {
          toMerge.push([commands[i], commands[j]]);
        }
      }
    }

    // Perform merges
    for (const [cmd1, cmd2] of toMerge) {
      this.mergeCommandPatterns(cmd1, cmd2);
    }
  }

  private commandsSimilar(cmd1: string, cmd2: string): boolean {
    // Simple similarity check - can be enhanced with more sophisticated algorithms
    const distance = this.levenshteinDistance(cmd1, cmd2);
    const maxLen = Math.max(cmd1.length, cmd2.length);
    return distance / maxLen < 0.2; // Less than 20% different
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  private mergeCommandPatterns(cmd1: string, cmd2: string): void {
    const pattern1 = this.commandPatterns.get(cmd1);
    const pattern2 = this.commandPatterns.get(cmd2);

    if (!pattern1 || !pattern2) return;

    // Merge into pattern1 and remove pattern2
    pattern1.frequency += pattern2.frequency;
    pattern1.successRate = (pattern1.successRate + pattern2.successRate) / 2;
    pattern1.averageDuration = (pattern1.averageDuration + pattern2.averageDuration) / 2;
    pattern1.lastUsed = pattern1.lastUsed > pattern2.lastUsed ? pattern1.lastUsed : pattern2.lastUsed;

    // Merge followups
    for (const followup of pattern2.commonFollowups) {
      const existing = pattern1.commonFollowups.find(f => f.command === followup.command);
      if (existing) {
        existing.frequency += followup.frequency;
      } else {
        pattern1.commonFollowups.push(followup);
      }
    }

    // Sort and limit
    pattern1.commonFollowups.sort((a, b) => b.frequency - a.frequency);
    pattern1.commonFollowups = pattern1.commonFollowups.slice(0, 5);

    this.commandPatterns.delete(cmd2);
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(this.learningDataPath, { recursive: true });

      // Save execution history (limited)
      const recentHistory = this.executionHistory.slice(-1000);
      await fs.writeFile(
        path.join(this.learningDataPath, 'execution_history.json'),
        JSON.stringify(recentHistory, null, 2)
      );

      // Save command patterns
      const patternsData = Object.fromEntries(this.commandPatterns);
      await fs.writeFile(
        path.join(this.learningDataPath, 'command_patterns.json'),
        JSON.stringify(patternsData, null, 2)
      );

      // Save user profiles
      const profilesData = Object.fromEntries(
        Array.from(this.userProfiles.entries()).map(([k, v]) => [k, {
          ...v,
          commandPreferences: Object.fromEntries(v.commandPreferences)
        }])
      );
      await fs.writeFile(
        path.join(this.learningDataPath, 'user_profiles.json'),
        JSON.stringify(profilesData, null, 2)
      );

      this.logger.debug('Learning data saved successfully');
    } catch (error) {
      this.logger.error(`Failed to save learning data: ${error}`);
    }
  }

  private async loadLearningData(): Promise<void> {
    try {
      // Load execution history
      const historyPath = path.join(this.learningDataPath, 'execution_history.json');
      const historyData = await fs.readFile(historyPath, 'utf8');
      this.executionHistory = JSON.parse(historyData).map((record: any) => ({
        ...record,
        timestamp: new Date(record.timestamp)
      }));

      // Load command patterns
      const patternsPath = path.join(this.learningDataPath, 'command_patterns.json');
      const patternsData = await fs.readFile(patternsPath, 'utf8');
      const patterns = JSON.parse(patternsData);
      this.commandPatterns = new Map(Object.entries(patterns).map(([k, v]: [string, any]) => [k, {
        ...v,
        lastUsed: new Date(v.lastUsed)
      }]));

      // Load user profiles
      const profilesPath = path.join(this.learningDataPath, 'user_profiles.json');
      const profilesData = await fs.readFile(profilesPath, 'utf8');
      const profiles = JSON.parse(profilesData);
      this.userProfiles = new Map(Object.entries(profiles).map(([k, v]: [string, any]) => [k, {
        ...v,
        commandPreferences: new Map(Object.entries(v.commandPreferences))
      }]));

    } catch (error) {
      // Files don't exist yet - this is fine for first run
      this.logger.info('No existing learning data found, starting fresh');
    }
  }

  getLearningStatistics(): any {
    const totalExecutions = this.executionHistory.length;
    const uniqueCommands = this.commandPatterns.size;
    const activeUsers = this.userProfiles.size;

    const successRate = totalExecutions > 0 
      ? this.executionHistory.filter(r => r.success).length / totalExecutions 
      : 0;

    const topCommands = Array.from(this.commandPatterns.entries())
      .sort(([,a], [,b]) => b.frequency - a.frequency)
      .slice(0, 10)
      .map(([cmd, pattern]) => ({ command: cmd, frequency: pattern.frequency }));

    const skillDistribution = Array.from(this.userProfiles.values())
      .reduce((acc, profile) => {
        acc[profile.skillLevel] = (acc[profile.skillLevel] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return {
      totalExecutions,
      uniqueCommands,
      activeUsers,
      successRate,
      topCommands,
      skillDistribution,
      dataSize: {
        executionHistory: this.executionHistory.length,
        commandPatterns: this.commandPatterns.size,
        userProfiles: this.userProfiles.size
      }
    };
  }

  getUserProfile(sessionId: string): UserProfile | undefined {
    return this.userProfiles.get(sessionId);
  }

  getCommandPattern(command: string): CommandPattern | undefined {
    return this.commandPatterns.get(this.normalizeCommand(command));
  }
}