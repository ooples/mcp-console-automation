import { AIConfig, CommandInterpretation } from './AICore.js';
import { Logger } from '../utils/logger.js';

interface CommandTemplate {
  pattern: RegExp;
  template: string;
  confidence: number;
  parameters: string[];
  description: string;
  examples: string[];
}

export class NaturalLanguageProcessor {
  private logger: Logger;
  private config: AIConfig;
  private commandTemplates: CommandTemplate[];

  constructor(config: AIConfig) {
    this.config = config;
    this.logger = new Logger('NLP');
    this.initializeTemplates();
  }

  private initializeTemplates() {
    this.commandTemplates = [
      // File operations
      {
        pattern: /(?:list|show|display)\s+(?:files|contents?)\s+(?:in|of)\s+(.+)/i,
        template: 'ls -la {path}',
        confidence: 0.9,
        parameters: ['path'],
        description: 'List files in directory',
        examples: ['list files in /var/log', 'show contents of documents']
      },
      {
        pattern: /(?:find|search|locate)\s+(?:files?)\s+(?:named?|called?)\s+(.+)/i,
        template: 'find . -name "{pattern}" -type f',
        confidence: 0.85,
        parameters: ['pattern'],
        description: 'Find files by name',
        examples: ['find files named config.json', 'search files called *.log']
      },
      {
        pattern: /(?:create|make)\s+(?:directory|folder)\s+(.+)/i,
        template: 'mkdir -p "{path}"',
        confidence: 0.9,
        parameters: ['path'],
        description: 'Create directory',
        examples: ['create directory /tmp/test', 'make folder new-project']
      },
      {
        pattern: /(?:delete|remove)\s+(?:file|directory)\s+(.+)/i,
        template: 'rm -rf "{path}"',
        confidence: 0.8,
        parameters: ['path'],
        description: 'Delete file or directory',
        examples: ['delete file temp.txt', 'remove directory old-files']
      },
      {
        pattern: /(?:copy|cp)\s+(.+)\s+(?:to|into)\s+(.+)/i,
        template: 'cp -r "{source}" "{destination}"',
        confidence: 0.85,
        parameters: ['source', 'destination'],
        description: 'Copy files or directories',
        examples: ['copy file.txt to backup/', 'cp documents into /backup']
      },
      {
        pattern: /(?:move|mv)\s+(.+)\s+(?:to|into)\s+(.+)/i,
        template: 'mv "{source}" "{destination}"',
        confidence: 0.85,
        parameters: ['source', 'destination'],
        description: 'Move files or directories',
        examples: ['move file.txt to archive/', 'mv old-data into /backup']
      },

      // Process operations
      {
        pattern: /(?:show|list|display)\s+(?:processes|running)\s*(?:processes)?/i,
        template: 'ps aux',
        confidence: 0.9,
        parameters: [],
        description: 'Show running processes',
        examples: ['show processes', 'list running processes']
      },
      {
        pattern: /(?:kill|stop|terminate)\s+(?:process)\s+(.+)/i,
        template: 'pkill -f "{process}"',
        confidence: 0.8,
        parameters: ['process'],
        description: 'Kill process by name',
        examples: ['kill process nginx', 'stop process node']
      },
      {
        pattern: /(?:find|search)\s+(?:process)\s+(.+)/i,
        template: 'pgrep -f "{process}"',
        confidence: 0.85,
        parameters: ['process'],
        description: 'Find process by name',
        examples: ['find process apache', 'search process python']
      },

      // System information
      {
        pattern: /(?:show|display|check)\s+(?:disk|storage)\s+(?:usage|space)/i,
        template: 'df -h',
        confidence: 0.9,
        parameters: [],
        description: 'Show disk usage',
        examples: ['show disk usage', 'check storage space']
      },
      {
        pattern: /(?:show|display|check)\s+(?:memory|ram)\s+(?:usage|status)/i,
        template: 'free -h',
        confidence: 0.9,
        parameters: [],
        description: 'Show memory usage',
        examples: ['show memory usage', 'check ram status']
      },
      {
        pattern: /(?:show|display)\s+(?:system|os)\s+(?:info|information)/i,
        template: 'uname -a',
        confidence: 0.85,
        parameters: [],
        description: 'Show system information',
        examples: ['show system info', 'display os information']
      },

      // Network operations
      {
        pattern: /(?:ping|test)\s+(?:connection to\s+)?(.+)/i,
        template: 'ping -c 4 {host}',
        confidence: 0.85,
        parameters: ['host'],
        description: 'Ping host',
        examples: ['ping google.com', 'test connection to server.com']
      },
      {
        pattern: /(?:check|test)\s+(?:port)\s+(\d+)\s+(?:on\s+)?(.+)/i,
        template: 'nc -zv {host} {port}',
        confidence: 0.8,
        parameters: ['host', 'port'],
        description: 'Check if port is open',
        examples: ['check port 80 on server.com', 'test port 22 localhost']
      },
      {
        pattern: /(?:show|list)\s+(?:network|listening)\s+(?:connections|ports)/i,
        template: 'netstat -tulnp',
        confidence: 0.85,
        parameters: [],
        description: 'Show network connections',
        examples: ['show network connections', 'list listening ports']
      },

      // Git operations
      {
        pattern: /(?:git\s+)?(?:clone|download)\s+(?:repository\s+)?(.+)/i,
        template: 'git clone {repo}',
        confidence: 0.9,
        parameters: ['repo'],
        description: 'Clone git repository',
        examples: ['clone repository https://github.com/user/repo', 'git clone my-project']
      },
      {
        pattern: /(?:git\s+)?(?:status|check)\s+(?:git\s+)?(?:status|changes)/i,
        template: 'git status',
        confidence: 0.95,
        parameters: [],
        description: 'Check git status',
        examples: ['git status', 'check git changes']
      },
      {
        pattern: /(?:git\s+)?(?:add|stage)\s+(?:all\s+)?(?:files?|changes?)/i,
        template: 'git add .',
        confidence: 0.9,
        parameters: [],
        description: 'Stage all changes',
        examples: ['git add all files', 'stage changes']
      },
      {
        pattern: /(?:git\s+)?commit\s+(?:with\s+message\s+)?["\'](.+)["\']?/i,
        template: 'git commit -m "{message}"',
        confidence: 0.9,
        parameters: ['message'],
        description: 'Commit with message',
        examples: ['git commit with message "fix bug"', 'commit "update documentation"']
      },

      // Package management
      {
        pattern: /(?:install|add)\s+(?:package\s+)?(.+)/i,
        template: 'npm install {package}',
        confidence: 0.7,
        parameters: ['package'],
        description: 'Install package',
        examples: ['install package lodash', 'add express']
      },
      {
        pattern: /(?:uninstall|remove)\s+(?:package\s+)?(.+)/i,
        template: 'npm uninstall {package}',
        confidence: 0.7,
        parameters: ['package'],
        description: 'Uninstall package',
        examples: ['uninstall package old-lib', 'remove unused-dep']
      },

      // Docker operations
      {
        pattern: /(?:run|start)\s+(?:docker\s+)?container\s+(.+)/i,
        template: 'docker run -d {image}',
        confidence: 0.8,
        parameters: ['image'],
        description: 'Run docker container',
        examples: ['run docker container nginx', 'start container postgres']
      },
      {
        pattern: /(?:list|show)\s+(?:docker\s+)?containers/i,
        template: 'docker ps -a',
        confidence: 0.9,
        parameters: [],
        description: 'List docker containers',
        examples: ['list docker containers', 'show containers']
      },
      {
        pattern: /(?:stop|kill)\s+(?:docker\s+)?container\s+(.+)/i,
        template: 'docker stop {container}',
        confidence: 0.85,
        parameters: ['container'],
        description: 'Stop docker container',
        examples: ['stop docker container nginx', 'kill container myapp']
      },

      // Log analysis
      {
        pattern: /(?:tail|follow|watch)\s+(?:log\s+)?(?:file\s+)?(.+)/i,
        template: 'tail -f {file}',
        confidence: 0.85,
        parameters: ['file'],
        description: 'Follow log file',
        examples: ['tail log file /var/log/nginx.log', 'follow application.log']
      },
      {
        pattern: /(?:search|grep|find)\s+["\'](.+)["\']\s+(?:in\s+)?(.+)/i,
        template: 'grep -r "{pattern}" {path}',
        confidence: 0.8,
        parameters: ['pattern', 'path'],
        description: 'Search for pattern in files',
        examples: ['search "error" in /var/log', 'grep "exception" logs/']
      },

      // Service management
      {
        pattern: /(?:start|restart|stop)\s+(?:service\s+)?(.+)/i,
        template: 'systemctl {action} {service}',
        confidence: 0.8,
        parameters: ['action', 'service'],
        description: 'Manage system service',
        examples: ['start service nginx', 'restart apache2']
      },
      {
        pattern: /(?:check|show)\s+(?:status\s+of\s+)?(?:service\s+)?(.+)/i,
        template: 'systemctl status {service}',
        confidence: 0.8,
        parameters: ['service'],
        description: 'Check service status',
        examples: ['check status of nginx', 'show service mysql']
      }
    ];

    this.logger.info(`Loaded ${this.commandTemplates.length} command templates`);
  }

  async interpret(query: string, context?: any): Promise<CommandInterpretation> {
    const normalizedQuery = query.trim().toLowerCase();
    const matches: Array<{ template: CommandTemplate; match: RegExpMatchArray; confidence: number }> = [];

    // Find all matching templates
    for (const template of this.commandTemplates) {
      const match = normalizedQuery.match(template.pattern);
      if (match) {
        // Calculate confidence based on template confidence and match quality
        let adjustedConfidence = template.confidence;
        
        // Boost confidence for exact matches
        if (match[0].length === normalizedQuery.length) {
          adjustedConfidence *= 1.1;
        }
        
        // Consider context boost
        if (context && this.isContextRelevant(template, context)) {
          adjustedConfidence *= 1.05;
        }

        matches.push({
          template,
          match,
          confidence: Math.min(adjustedConfidence, 1.0)
        });
      }
    }

    if (matches.length === 0) {
      return this.handleUnknownCommand(query, context);
    }

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);
    const bestMatch = matches[0];

    // Extract parameters
    const parameters = this.extractParameters(bestMatch.template, bestMatch.match);
    
    // Generate command
    const interpretedCommand = this.generateCommand(bestMatch.template.template, parameters);

    // Create alternatives
    const alternatives = matches.slice(1, 4).map(m => ({
      command: this.generateCommand(m.template.template, this.extractParameters(m.template, m.match)),
      confidence: m.confidence
    }));

    return {
      originalQuery: query,
      interpretedCommand,
      confidence: bestMatch.confidence,
      alternatives,
      parameters,
      reasoning: `Matched template: "${bestMatch.template.description}" with confidence ${bestMatch.confidence.toFixed(2)}`
    };
  }

  private extractParameters(template: CommandTemplate, match: RegExpMatchArray): Record<string, any> {
    const parameters: Record<string, any> = {};
    
    template.parameters.forEach((param, index) => {
      const value = match[index + 1]; // match[0] is the full match
      if (value) {
        parameters[param] = value.trim();
      }
    });

    // Special handling for action parameter in service management
    if (template.template.includes('{action}')) {
      const query = match[0].toLowerCase();
      if (query.includes('start')) parameters.action = 'start';
      else if (query.includes('stop')) parameters.action = 'stop';
      else if (query.includes('restart')) parameters.action = 'restart';
      else if (query.includes('reload')) parameters.action = 'reload';
    }

    return parameters;
  }

  private generateCommand(template: string, parameters: Record<string, any>): string {
    let command = template;
    
    // Replace parameters in template
    for (const [key, value] of Object.entries(parameters)) {
      const placeholder = `{${key}}`;
      command = command.replace(new RegExp(placeholder, 'g'), value);
    }

    return command;
  }

  private isContextRelevant(template: CommandTemplate, context: any): boolean {
    if (!context) return false;

    // Check if current directory context is relevant
    if (context.cwd) {
      if (context.cwd.includes('git') && template.description.includes('git')) {
        return true;
      }
      if (context.cwd.includes('node_modules') && template.template.includes('npm')) {
        return true;
      }
    }

    // Check if recent commands are relevant
    if (context.recentCommands && Array.isArray(context.recentCommands)) {
      const recentCommandText = context.recentCommands.join(' ').toLowerCase();
      if (template.description.toLowerCase().split(' ').some(word => 
        recentCommandText.includes(word))) {
        return true;
      }
    }

    return false;
  }

  private handleUnknownCommand(query: string, context?: any): CommandInterpretation {
    // Try to extract basic command structure
    const words = query.toLowerCase().split(' ').filter(w => w.length > 0);
    
    // Look for common command keywords
    const commandKeywords = ['list', 'show', 'find', 'create', 'delete', 'run', 'start', 'stop'];
    const foundKeyword = words.find(word => commandKeywords.includes(word));
    
    let suggestedCommand = query; // Fallback to original
    let confidence = 0.3;
    
    if (foundKeyword) {
      // Try to construct a basic command
      switch (foundKeyword) {
        case 'list':
        case 'show':
          suggestedCommand = 'ls -la';
          confidence = 0.4;
          break;
        case 'find':
          suggestedCommand = 'find . -name "*"';
          confidence = 0.4;
          break;
        case 'create':
          suggestedCommand = 'mkdir new-directory';
          confidence = 0.3;
          break;
        default:
          suggestedCommand = foundKeyword;
          confidence = 0.2;
      }
    }

    return {
      originalQuery: query,
      interpretedCommand: suggestedCommand,
      confidence,
      alternatives: [
        { command: 'echo "Command not recognized. Type \'help\' for available commands."', confidence: 0.1 }
      ],
      parameters: {},
      reasoning: `Unable to match query to known patterns. ${foundKeyword ? `Found keyword: ${foundKeyword}` : 'No recognizable patterns found.'}`
    };
  }

  addCommandTemplate(template: CommandTemplate): void {
    this.commandTemplates.push(template);
    this.logger.info(`Added new command template: ${template.description}`);
  }

  getAvailableCommands(): string[] {
    return this.commandTemplates.map(t => t.description);
  }

  async explainCommand(command: string): Promise<string> {
    const template = this.commandTemplates.find(t => 
      t.template.includes(command) || 
      command.match(t.pattern)
    );

    if (template) {
      return `${template.description}\n\nExamples:\n${template.examples.map(e => `  - "${e}"`).join('\n')}`;
    }

    return `Command not recognized in template library. This appears to be a custom or system-specific command.`;
  }
}