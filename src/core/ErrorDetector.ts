import { ErrorPattern } from '../types/index.js';

export class ErrorDetector {
  private defaultPatterns: ErrorPattern[] = [
    {
      pattern: /error:|ERROR:|Error:/i,
      type: 'error',
      description: 'Generic error',
      severity: 'high'
    },
    {
      pattern: /exception:|Exception:|EXCEPTION:/i,
      type: 'exception',
      description: 'Exception thrown',
      severity: 'critical'
    },
    {
      pattern: /warning:|WARNING:|Warning:/i,
      type: 'warning',
      description: 'Warning message',
      severity: 'low'
    },
    {
      pattern: /fatal:|FATAL:|Fatal:/i,
      type: 'error',
      description: 'Fatal error',
      severity: 'critical'
    },
    {
      pattern: /failed to|Failed to|FAILED TO/i,
      type: 'error',
      description: 'Operation failed',
      severity: 'high'
    },
    {
      pattern: /cannot|Cannot|CANNOT/i,
      type: 'error',
      description: 'Cannot perform operation',
      severity: 'medium'
    },
    {
      pattern: /unable to|Unable to|UNABLE TO/i,
      type: 'error',
      description: 'Unable to perform operation',
      severity: 'medium'
    },
    {
      pattern: /not found|Not Found|NOT FOUND/i,
      type: 'error',
      description: 'Resource not found',
      severity: 'medium'
    },
    {
      pattern: /access denied|Access Denied|ACCESS DENIED/i,
      type: 'error',
      description: 'Access denied',
      severity: 'high'
    },
    {
      pattern: /permission denied|Permission Denied|PERMISSION DENIED/i,
      type: 'error',
      description: 'Permission denied',
      severity: 'high'
    },
    {
      pattern: /timeout|Timeout|TIMEOUT/i,
      type: 'error',
      description: 'Operation timeout',
      severity: 'medium'
    },
    {
      pattern: /segmentation fault|Segmentation Fault|SEGMENTATION FAULT/i,
      type: 'exception',
      description: 'Segmentation fault',
      severity: 'critical'
    },
    {
      pattern: /stack trace:|Stack Trace:|STACK TRACE:/i,
      type: 'exception',
      description: 'Stack trace detected',
      severity: 'critical'
    },
    {
      pattern: /traceback|Traceback|TRACEBACK/i,
      type: 'exception',
      description: 'Python traceback',
      severity: 'critical'
    },
    {
      pattern: /assertion failed|Assertion Failed|ASSERTION FAILED/i,
      type: 'error',
      description: 'Assertion failed',
      severity: 'critical'
    },
    {
      pattern: /null pointer|Null Pointer|NULL POINTER/i,
      type: 'exception',
      description: 'Null pointer exception',
      severity: 'critical'
    },
    {
      pattern: /out of memory|Out Of Memory|OUT OF MEMORY/i,
      type: 'error',
      description: 'Out of memory',
      severity: 'critical'
    },
    {
      pattern: /connection refused|Connection Refused|CONNECTION REFUSED/i,
      type: 'error',
      description: 'Connection refused',
      severity: 'high'
    },
    {
      pattern: /syntax error|Syntax Error|SYNTAX ERROR/i,
      type: 'error',
      description: 'Syntax error',
      severity: 'high'
    },
    {
      pattern: /compilation failed|Compilation Failed|COMPILATION FAILED/i,
      type: 'error',
      description: 'Compilation failed',
      severity: 'critical'
    }
  ];

  detect(text: string, customPatterns?: ErrorPattern[]): Array<{ pattern: ErrorPattern; match: string; line: number }> {
    const patterns = customPatterns ? [...this.defaultPatterns, ...customPatterns] : this.defaultPatterns;
    const lines = text.split('\n');
    const detectedErrors: Array<{ pattern: ErrorPattern; match: string; line: number }> = [];

    lines.forEach((line, lineNumber) => {
      patterns.forEach(pattern => {
        const match = line.match(pattern.pattern);
        if (match) {
          detectedErrors.push({
            pattern,
            match: line.trim(),
            line: lineNumber + 1
          });
        }
      });
    });

    return detectedErrors;
  }

  addPattern(pattern: ErrorPattern): void {
    this.defaultPatterns.push(pattern);
  }

  removePattern(pattern: RegExp): void {
    this.defaultPatterns = this.defaultPatterns.filter(p => p.pattern.toString() !== pattern.toString());
  }

  getPatterns(): ErrorPattern[] {
    return [...this.defaultPatterns];
  }

  analyzeStackTrace(text: string): { language?: string; frames: string[] } {
    const result: { language?: string; frames: string[] } = { frames: [] };

    const pythonMatch = text.match(/Traceback \(most recent call last\):([\s\S]*?)(?=\n\S|\n$)/);
    if (pythonMatch) {
      result.language = 'python';
      const frames = pythonMatch[1].split('\n').filter(line => line.trim().startsWith('File'));
      result.frames = frames.map(f => f.trim());
      return result;
    }

    const javaMatch = text.match(/(?:Exception|Error) in thread[\s\S]*?\n((?:\s+at .*\n)+)/);
    if (javaMatch) {
      result.language = 'java';
      result.frames = javaMatch[1].split('\n').filter(line => line.trim().startsWith('at')).map(f => f.trim());
      return result;
    }

    const nodeMatch = text.match(/at .*? \(.*?\)|\n\s+at .*?\n/g);
    if (nodeMatch && nodeMatch.length > 0) {
      result.language = 'javascript';
      result.frames = nodeMatch.map(f => f.trim());
      return result;
    }

    const genericStack = text.match(/^\s*(#\d+|at|\d+:)\s+.*/gm);
    if (genericStack && genericStack.length > 0) {
      result.frames = genericStack.map(f => f.trim());
    }

    return result;
  }

  getSeverityScore(errors: Array<{ pattern: ErrorPattern; match: string; line: number }>): number {
    const severityWeights = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };

    return errors.reduce((score, error) => {
      return score + severityWeights[error.pattern.severity];
    }, 0);
  }
}