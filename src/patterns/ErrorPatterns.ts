import { ErrorPattern } from '../types/index.js';

export interface ExtendedErrorPattern extends ErrorPattern {
  category: string;
  language?: string;
  remediation?: string;
  tags?: string[];
  contexts?: string[];
  retryable?: boolean;
  filePathPattern?: RegExp;
  lineNumberPattern?: RegExp;
}

export interface ErrorContext {
  beforeLines?: string[];
  afterLines?: string[];
  fullStackTrace?: string;
  environment?: Record<string, string>;
  workingDirectory?: string;
}

export interface ParsedError {
  pattern: ExtendedErrorPattern;
  match: string;
  line: number;
  context?: ErrorContext;
  extractedInfo?: {
    filePath?: string;
    lineNumber?: number;
    columnNumber?: number;
    errorCode?: string;
    stackTrace?: string[];
    suggestion?: string;
  };
}

/**
 * Comprehensive error patterns for multi-language, multi-platform error detection
 * Includes runtime errors, compilation errors, network issues, database problems,
 * SSH connection issues, build tool errors, and performance problems
 */
export class ErrorPatterns {
  /**
   * Runtime Error Patterns - Errors that occur during program execution
   */
  static readonly RUNTIME_PATTERNS: ExtendedErrorPattern[] = [
    // JavaScript/Node.js Runtime Errors
    {
      pattern: /TypeError: (.+)/,
      type: 'exception',
      category: 'runtime',
      language: 'javascript',
      description: 'JavaScript TypeError',
      severity: 'high',
      remediation: 'Check object types and ensure properties exist before accessing',
      tags: ['javascript', 'node', 'type-error'],
      contexts: ['browser', 'node']
    },
    {
      pattern: /ReferenceError: (.+) is not defined/,
      type: 'exception',
      category: 'runtime',
      language: 'javascript',
      description: 'JavaScript ReferenceError',
      severity: 'high',
      remediation: 'Declare the variable or import the required module',
      tags: ['javascript', 'node', 'reference-error']
    },
    {
      pattern: /SyntaxError: (.+)/,
      type: 'exception',
      category: 'runtime',
      language: 'javascript',
      description: 'JavaScript SyntaxError',
      severity: 'critical',
      remediation: 'Fix syntax issues in your JavaScript code',
      tags: ['javascript', 'syntax']
    },
    {
      pattern: /UnhandledPromiseRejectionWarning: (.+)/,
      type: 'warning',
      category: 'runtime',
      language: 'javascript',
      description: 'Unhandled Promise Rejection',
      severity: 'high',
      remediation: 'Add .catch() handler or use try-catch with async/await',
      tags: ['javascript', 'node', 'promise', 'async']
    },

    // Python Runtime Errors
    {
      pattern: /Traceback \(most recent call last\):/,
      type: 'exception',
      category: 'runtime',
      language: 'python',
      description: 'Python Exception with Stack Trace',
      severity: 'high',
      remediation: 'Check the stack trace for the root cause',
      tags: ['python', 'traceback', 'exception']
    },
    {
      pattern: /(\w+Error): (.+)/,
      type: 'exception',
      category: 'runtime',
      language: 'python',
      description: 'Python Exception',
      severity: 'high',
      remediation: 'Handle the specific exception type',
      tags: ['python', 'exception']
    },
    {
      pattern: /IndentationError: (.+)/,
      type: 'exception',
      category: 'runtime',
      language: 'python',
      description: 'Python Indentation Error',
      severity: 'high',
      remediation: 'Fix indentation issues in Python code',
      tags: ['python', 'syntax', 'indentation']
    },

    // Java Runtime Errors
    {
      pattern: /Exception in thread "(.+)" (.+): (.+)/,
      type: 'exception',
      category: 'runtime',
      language: 'java',
      description: 'Java Exception',
      severity: 'high',
      remediation: 'Check the exception type and stack trace',
      tags: ['java', 'exception', 'thread'],
      lineNumberPattern: /at .+\.java:(\d+)/
    },
    {
      pattern: /java\.lang\.NullPointerException/,
      type: 'exception',
      category: 'runtime',
      language: 'java',
      description: 'Java Null Pointer Exception',
      severity: 'critical',
      remediation: 'Check for null values before accessing object methods/properties',
      tags: ['java', 'null-pointer', 'npe']
    },
    {
      pattern: /java\.lang\.OutOfMemoryError/,
      type: 'exception',
      category: 'runtime',
      language: 'java',
      description: 'Java Out of Memory Error',
      severity: 'critical',
      remediation: 'Increase heap size with -Xmx or optimize memory usage',
      tags: ['java', 'memory', 'heap']
    },

    // Go Runtime Errors
    {
      pattern: /panic: (.+)/,
      type: 'exception',
      category: 'runtime',
      language: 'go',
      description: 'Go Panic',
      severity: 'critical',
      remediation: 'Add proper error handling or recover from panic',
      tags: ['go', 'panic']
    },
    {
      pattern: /runtime error: (.+)/,
      type: 'exception',
      category: 'runtime',
      language: 'go',
      description: 'Go Runtime Error',
      severity: 'high',
      remediation: 'Check bounds, nil pointers, and type assertions',
      tags: ['go', 'runtime']
    },

    // Rust Runtime Errors
    {
      pattern: /thread '(.+)' panicked at '(.+)'/,
      type: 'exception',
      category: 'runtime',
      language: 'rust',
      description: 'Rust Panic',
      severity: 'critical',
      remediation: 'Handle errors properly using Result types',
      tags: ['rust', 'panic']
    },

    // C/C++ Runtime Errors
    {
      pattern: /Segmentation fault/i,
      type: 'exception',
      category: 'runtime',
      language: 'c',
      description: 'Segmentation Fault',
      severity: 'critical',
      remediation: 'Check memory access, pointers, and array bounds',
      tags: ['c', 'cpp', 'segfault', 'memory']
    },
    {
      pattern: /Aborted \(core dumped\)/,
      type: 'exception',
      category: 'runtime',
      language: 'c',
      description: 'Program Aborted with Core Dump',
      severity: 'critical',
      remediation: 'Check for assertion failures or invalid operations',
      tags: ['c', 'cpp', 'abort', 'core-dump']
    }
  ];

  /**
   * Compilation Error Patterns - Errors that occur during build/compile time
   */
  static readonly COMPILATION_PATTERNS: ExtendedErrorPattern[] = [
    // TypeScript Compilation Errors
    {
      pattern: /(.+\.ts)\((\d+),(\d+)\): error TS(\d+): (.+)/,
      type: 'error',
      category: 'compilation',
      language: 'typescript',
      description: 'TypeScript Compilation Error',
      severity: 'high',
      remediation: 'Fix TypeScript type errors and syntax issues',
      tags: ['typescript', 'tsc', 'compile'],
      filePathPattern: /(.+\.ts)/,
      lineNumberPattern: /\((\d+),(\d+)\)/
    },
    
    // Java Compilation Errors
    {
      pattern: /(.+\.java):(\d+): error: (.+)/,
      type: 'error',
      category: 'compilation',
      language: 'java',
      description: 'Java Compilation Error',
      severity: 'high',
      remediation: 'Fix Java syntax and type errors',
      tags: ['java', 'javac', 'compile'],
      filePathPattern: /(.+\.java)/,
      lineNumberPattern: /:(\d+):/
    },

    // C/C++ Compilation Errors
    {
      pattern: /(.+\.[ch]pp?):(\d+):(\d+): error: (.+)/,
      type: 'error',
      category: 'compilation',
      language: 'c',
      description: 'C/C++ Compilation Error',
      severity: 'high',
      remediation: 'Fix C/C++ syntax, includes, and linking issues',
      tags: ['c', 'cpp', 'gcc', 'clang', 'compile'],
      filePathPattern: /(.+\.[ch]pp?)/,
      lineNumberPattern: /:(\d+):(\d+):/
    },

    // Go Compilation Errors
    {
      pattern: /(.+\.go):(\d+):(\d+): (.+)/,
      type: 'error',
      category: 'compilation',
      language: 'go',
      description: 'Go Compilation Error',
      severity: 'high',
      remediation: 'Fix Go syntax and import issues',
      tags: ['go', 'compile'],
      filePathPattern: /(.+\.go)/,
      lineNumberPattern: /:(\d+):(\d+):/
    },

    // Rust Compilation Errors
    {
      pattern: /error\[E\d+\]: (.+)/,
      type: 'error',
      category: 'compilation',
      language: 'rust',
      description: 'Rust Compilation Error',
      severity: 'high',
      remediation: 'Fix Rust syntax, borrowing, and lifetime issues',
      tags: ['rust', 'rustc', 'compile']
    }
  ];

  /**
   * Network Error Patterns - Network-related connection and communication errors
   */
  static readonly NETWORK_PATTERNS: ExtendedErrorPattern[] = [
    {
      pattern: /Connection refused|connection refused/,
      type: 'error',
      category: 'network',
      description: 'Connection Refused',
      severity: 'high',
      remediation: 'Check if the service is running and accessible on the specified port',
      tags: ['network', 'connection', 'refused'],
      retryable: true
    },
    {
      pattern: /Connection timed out|connection timed out/,
      type: 'error',
      category: 'network',
      description: 'Connection Timeout',
      severity: 'medium',
      remediation: 'Check network connectivity and increase timeout values',
      tags: ['network', 'timeout'],
      retryable: true
    },
    {
      pattern: /Network is unreachable|network unreachable/,
      type: 'error',
      category: 'network',
      description: 'Network Unreachable',
      severity: 'high',
      remediation: 'Check network configuration and routing',
      tags: ['network', 'unreachable'],
      retryable: true
    },
    {
      pattern: /Host not found|host not found|Name or service not known/,
      type: 'error',
      category: 'network',
      description: 'DNS Resolution Failed',
      severity: 'high',
      remediation: 'Check DNS settings and hostname spelling',
      tags: ['network', 'dns', 'hostname'],
      retryable: true
    },
    {
      pattern: /SSL certificate verify failed|certificate verification failed/i,
      type: 'error',
      category: 'network',
      description: 'SSL Certificate Verification Failed',
      severity: 'high',
      remediation: 'Check SSL certificate validity or disable verification for testing',
      tags: ['network', 'ssl', 'certificate', 'security']
    },
    {
      pattern: /Connection reset by peer|connection reset/,
      type: 'error',
      category: 'network',
      description: 'Connection Reset by Peer',
      severity: 'medium',
      remediation: 'Check server configuration and network stability',
      tags: ['network', 'connection', 'reset'],
      retryable: true
    }
  ];

  /**
   * SSH-Specific Error Patterns
   */
  static readonly SSH_PATTERNS: ExtendedErrorPattern[] = [
    {
      pattern: /ssh: connect to host (.+) port (\d+): Connection refused/,
      type: 'error',
      category: 'ssh',
      description: 'SSH Connection Refused',
      severity: 'high',
      remediation: 'Check if SSH service is running on the target host',
      tags: ['ssh', 'connection', 'refused'],
      retryable: true
    },
    {
      pattern: /Permission denied \(publickey\)/,
      type: 'error',
      category: 'ssh',
      description: 'SSH Public Key Authentication Failed',
      severity: 'high',
      remediation: 'Check SSH key configuration and permissions',
      tags: ['ssh', 'authentication', 'publickey']
    },
    {
      pattern: /Permission denied, please try again/,
      type: 'error',
      category: 'ssh',
      description: 'SSH Password Authentication Failed',
      severity: 'high',
      remediation: 'Verify username and password are correct',
      tags: ['ssh', 'authentication', 'password']
    },
    {
      pattern: /Host key verification failed/,
      type: 'error',
      category: 'ssh',
      description: 'SSH Host Key Verification Failed',
      severity: 'high',
      remediation: 'Update known_hosts file or verify host authenticity',
      tags: ['ssh', 'hostkey', 'security']
    },
    {
      pattern: /ssh: Could not resolve hostname (.+): (.+)/,
      type: 'error',
      category: 'ssh',
      description: 'SSH Hostname Resolution Failed',
      severity: 'high',
      remediation: 'Check hostname spelling and DNS configuration',
      tags: ['ssh', 'dns', 'hostname']
    },
    {
      pattern: /Connection to (.+) closed by remote host/,
      type: 'error',
      category: 'ssh',
      description: 'SSH Connection Closed by Remote Host',
      severity: 'medium',
      remediation: 'Check server logs and connection limits',
      tags: ['ssh', 'connection', 'closed'],
      retryable: true
    }
  ];

  /**
   * Build Tool Error Patterns
   */
  static readonly BUILD_TOOL_PATTERNS: ExtendedErrorPattern[] = [
    // NPM Errors
    {
      pattern: /npm ERR! (.+)/,
      type: 'error',
      category: 'build-tool',
      language: 'javascript',
      description: 'NPM Error',
      severity: 'high',
      remediation: 'Check package.json and dependencies',
      tags: ['npm', 'javascript', 'build']
    },
    {
      pattern: /Module not found: Error: Can't resolve '(.+)'/,
      type: 'error',
      category: 'build-tool',
      language: 'javascript',
      description: 'Module Resolution Error',
      severity: 'high',
      remediation: 'Install missing dependency or check import path',
      tags: ['javascript', 'module', 'webpack', 'build']
    },

    // Maven Errors
    {
      pattern: /\[ERROR\] (.+)/,
      type: 'error',
      category: 'build-tool',
      language: 'java',
      description: 'Maven Build Error',
      severity: 'high',
      remediation: 'Check Maven configuration and dependencies',
      tags: ['maven', 'java', 'build']
    },

    // Gradle Errors
    {
      pattern: /> Task .+ FAILED/,
      type: 'error',
      category: 'build-tool',
      language: 'java',
      description: 'Gradle Task Failed',
      severity: 'high',
      remediation: 'Check Gradle configuration and task dependencies',
      tags: ['gradle', 'java', 'build']
    },

    // Cargo Errors (Rust)
    {
      pattern: /error: (.+)/,
      type: 'error',
      category: 'build-tool',
      language: 'rust',
      description: 'Cargo Build Error',
      severity: 'high',
      remediation: 'Check Cargo.toml and Rust code',
      tags: ['cargo', 'rust', 'build']
    },

    // Make Errors
    {
      pattern: /make: \*\*\* (.+) Error (\d+)/,
      type: 'error',
      category: 'build-tool',
      description: 'Make Build Error',
      severity: 'high',
      remediation: 'Check Makefile and build dependencies',
      tags: ['make', 'build']
    }
  ];

  /**
   * Database Error Patterns
   */
  static readonly DATABASE_PATTERNS: ExtendedErrorPattern[] = [
    // MySQL Errors
    {
      pattern: /ERROR (\d+) \((\w+)\): (.+)/,
      type: 'error',
      category: 'database',
      description: 'MySQL Error',
      severity: 'high',
      remediation: 'Check MySQL error code and query syntax',
      tags: ['mysql', 'database', 'sql']
    },
    {
      pattern: /Can't connect to MySQL server on '(.+)'/,
      type: 'error',
      category: 'database',
      description: 'MySQL Connection Failed',
      severity: 'high',
      remediation: 'Check MySQL server status and connection parameters',
      tags: ['mysql', 'database', 'connection'],
      retryable: true
    },

    // PostgreSQL Errors
    {
      pattern: /ERROR: (.+)/,
      type: 'error',
      category: 'database',
      description: 'PostgreSQL Error',
      severity: 'high',
      remediation: 'Check PostgreSQL logs and query syntax',
      tags: ['postgresql', 'postgres', 'database', 'sql']
    },
    {
      pattern: /could not connect to server: (.+)/,
      type: 'error',
      category: 'database',
      description: 'PostgreSQL Connection Failed',
      severity: 'high',
      remediation: 'Check PostgreSQL server status and configuration',
      tags: ['postgresql', 'postgres', 'database', 'connection'],
      retryable: true
    },

    // MongoDB Errors
    {
      pattern: /MongoError: (.+)/,
      type: 'error',
      category: 'database',
      description: 'MongoDB Error',
      severity: 'high',
      remediation: 'Check MongoDB configuration and query',
      tags: ['mongodb', 'database', 'nosql']
    },

    // Redis Errors
    {
      pattern: /WRONGTYPE (.+)/,
      type: 'error',
      category: 'database',
      description: 'Redis Wrong Type Error',
      severity: 'medium',
      remediation: 'Check Redis key types and operations',
      tags: ['redis', 'database', 'cache']
    },

    // Generic Database Connection Errors
    {
      pattern: /Connection pool exhausted|connection pool/i,
      type: 'error',
      category: 'database',
      description: 'Database Connection Pool Exhausted',
      severity: 'critical',
      remediation: 'Check connection pool configuration and close unused connections',
      tags: ['database', 'connection-pool', 'performance']
    },
    {
      pattern: /Deadlock found when trying to get lock|deadlock/i,
      type: 'error',
      category: 'database',
      description: 'Database Deadlock',
      severity: 'high',
      remediation: 'Optimize transaction order and reduce lock time',
      tags: ['database', 'deadlock', 'transaction'],
      retryable: true
    }
  ];

  /**
   * Performance Issue Patterns
   */
  static readonly PERFORMANCE_PATTERNS: ExtendedErrorPattern[] = [
    // Memory Issues
    {
      pattern: /OutOfMemoryError|out of memory|OOM/i,
      type: 'error',
      category: 'performance',
      description: 'Out of Memory Error',
      severity: 'critical',
      remediation: 'Increase memory allocation or optimize memory usage',
      tags: ['memory', 'performance', 'oom']
    },
    {
      pattern: /Memory leak|memory leak/i,
      type: 'warning',
      category: 'performance',
      description: 'Potential Memory Leak',
      severity: 'high',
      remediation: 'Profile application and fix memory leaks',
      tags: ['memory', 'performance', 'leak']
    },
    {
      pattern: /GC overhead limit exceeded/,
      type: 'error',
      category: 'performance',
      language: 'java',
      description: 'Garbage Collection Overhead',
      severity: 'critical',
      remediation: 'Optimize memory usage or tune GC parameters',
      tags: ['java', 'gc', 'memory', 'performance']
    },

    // CPU Issues
    {
      pattern: /High CPU usage|cpu usage/i,
      type: 'warning',
      category: 'performance',
      description: 'High CPU Usage',
      severity: 'medium',
      remediation: 'Profile application and optimize CPU-intensive operations',
      tags: ['cpu', 'performance']
    },
    {
      pattern: /Thread pool exhausted|thread pool/i,
      type: 'error',
      category: 'performance',
      description: 'Thread Pool Exhausted',
      severity: 'high',
      remediation: 'Increase thread pool size or optimize task processing',
      tags: ['threads', 'performance', 'pool']
    },

    // Disk I/O Issues
    {
      pattern: /No space left on device|disk full/i,
      type: 'error',
      category: 'performance',
      description: 'Disk Space Exhausted',
      severity: 'critical',
      remediation: 'Free up disk space or increase storage capacity',
      tags: ['disk', 'storage', 'space']
    },
    {
      pattern: /I\/O error|disk error|read error|write error/i,
      type: 'error',
      category: 'performance',
      description: 'Disk I/O Error',
      severity: 'high',
      remediation: 'Check disk health and file system integrity',
      tags: ['disk', 'io', 'hardware']
    }
  ];

  /**
   * Security Error Patterns
   */
  static readonly SECURITY_PATTERNS: ExtendedErrorPattern[] = [
    {
      pattern: /Access denied|access denied|Forbidden/i,
      type: 'error',
      category: 'security',
      description: 'Access Denied',
      severity: 'high',
      remediation: 'Check permissions and authentication',
      tags: ['security', 'access', 'permissions']
    },
    {
      pattern: /Unauthorized|unauthorized|401/,
      type: 'error',
      category: 'security',
      description: 'Unauthorized Access',
      severity: 'high',
      remediation: 'Verify authentication credentials',
      tags: ['security', 'authentication', 'unauthorized']
    },
    {
      pattern: /Invalid token|token expired|JWT/i,
      type: 'error',
      category: 'security',
      description: 'Authentication Token Error',
      severity: 'medium',
      remediation: 'Refresh or renew authentication token',
      tags: ['security', 'token', 'jwt', 'authentication'],
      retryable: true
    },
    {
      pattern: /CSRF token mismatch|csrf/i,
      type: 'error',
      category: 'security',
      description: 'CSRF Token Error',
      severity: 'high',
      remediation: 'Ensure CSRF token is properly included in requests',
      tags: ['security', 'csrf', 'token']
    },
    {
      pattern: /SQL injection|sql injection/i,
      type: 'error',
      category: 'security',
      description: 'Potential SQL Injection',
      severity: 'critical',
      remediation: 'Use parameterized queries and input validation',
      tags: ['security', 'sql-injection', 'database']
    }
  ];

  /**
   * AWS Systems Manager (SSM) Error Patterns
   */
  static readonly AWS_SSM_PATTERNS: ExtendedErrorPattern[] = [
    // SSM Session Errors
    {
      pattern: /SessionId ([\w-]+) is not valid/,
      type: 'error',
      category: 'aws-ssm',
      description: 'Invalid SSM Session ID',
      severity: 'high',
      remediation: 'Create a new SSM session or verify session ID',
      tags: ['aws', 'ssm', 'session', 'invalid-id']
    },
    {
      pattern: /Unable to start session: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Session Start Failed',
      severity: 'high',
      remediation: 'Check instance status, SSM agent, and IAM permissions',
      tags: ['aws', 'ssm', 'session', 'start-failed'],
      retryable: true
    },
    {
      pattern: /Session ([\w-]+) has been terminated/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Session Terminated',
      severity: 'medium',
      remediation: 'Check session timeout settings and reconnect if needed',
      tags: ['aws', 'ssm', 'session', 'terminated'],
      retryable: true
    },
    {
      pattern: /Session ([\w-]+) is not in a valid state for this operation/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Session Invalid State',
      severity: 'high',
      remediation: 'Verify session status and create new session if needed',
      tags: ['aws', 'ssm', 'session', 'invalid-state']
    },

    // SSM Agent Errors
    {
      pattern: /SSM agent is not running on instance (i-[\w]+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Agent Not Running',
      severity: 'critical',
      remediation: 'Start SSM agent on the target EC2 instance',
      tags: ['aws', 'ssm', 'agent', 'not-running']
    },
    {
      pattern: /SSM agent version (.+) is not supported/,
      type: 'error',
      category: 'aws-ssm',
      description: 'Unsupported SSM Agent Version',
      severity: 'high',
      remediation: 'Update SSM agent to a supported version',
      tags: ['aws', 'ssm', 'agent', 'version']
    },
    {
      pattern: /Instance (i-[\w]+) is not managed by SSM/,
      type: 'error',
      category: 'aws-ssm',
      description: 'Instance Not Managed by SSM',
      severity: 'critical',
      remediation: 'Install and configure SSM agent on the instance',
      tags: ['aws', 'ssm', 'instance', 'not-managed']
    },

    // IAM and Permission Errors
    {
      pattern: /User: (.+) is not authorized to perform: ssm:(.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Permission Denied',
      severity: 'high',
      remediation: 'Add required SSM permissions to IAM user/role',
      tags: ['aws', 'ssm', 'iam', 'permissions']
    },
    {
      pattern: /Access denied for SSM operation: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Access Denied',
      severity: 'high',
      remediation: 'Check IAM permissions and resource-based policies',
      tags: ['aws', 'ssm', 'access-denied']
    },
    {
      pattern: /Instance profile (.+) does not have SSM permissions/,
      type: 'error',
      category: 'aws-ssm',
      description: 'Instance Profile Missing SSM Permissions',
      severity: 'critical',
      remediation: 'Add SSM permissions to the instance profile role',
      tags: ['aws', 'ssm', 'instance-profile', 'permissions']
    },

    // Port Forwarding Errors
    {
      pattern: /Port (\d+) is already in use for session ([\w-]+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Port Already in Use',
      severity: 'high',
      remediation: 'Use a different local port or terminate existing session',
      tags: ['aws', 'ssm', 'port-forwarding', 'port-in-use']
    },
    {
      pattern: /Unable to establish port forwarding session to (.+):(\d+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Port Forwarding Failed',
      severity: 'high',
      remediation: 'Check target port accessibility and security groups',
      tags: ['aws', 'ssm', 'port-forwarding', 'failed'],
      retryable: true
    },
    {
      pattern: /Port forwarding session ([\w-]+) failed: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Port Forwarding Session Failed',
      severity: 'high',
      remediation: 'Check connectivity and restart port forwarding session',
      tags: ['aws', 'ssm', 'port-forwarding', 'session-failed'],
      retryable: true
    },

    // Document Execution Errors
    {
      pattern: /Document (.+) does not exist/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Document Not Found',
      severity: 'high',
      remediation: 'Verify document name and check if it exists in the account/region',
      tags: ['aws', 'ssm', 'document', 'not-found']
    },
    {
      pattern: /Document (.+) execution failed: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Document Execution Failed',
      severity: 'high',
      remediation: 'Check document parameters and target instance compatibility',
      tags: ['aws', 'ssm', 'document', 'execution-failed']
    },
    {
      pattern: /Invalid parameters for document (.+): (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Document Invalid Parameters',
      severity: 'medium',
      remediation: 'Verify document parameter requirements and values',
      tags: ['aws', 'ssm', 'document', 'invalid-parameters']
    },

    // Connection and Network Errors
    {
      pattern: /Unable to connect to SSM service: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Service Connection Failed',
      severity: 'high',
      remediation: 'Check AWS credentials, region settings, and network connectivity',
      tags: ['aws', 'ssm', 'connection', 'service'],
      retryable: true
    },
    {
      pattern: /WebSocket connection to SSM failed: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM WebSocket Connection Failed',
      severity: 'high',
      remediation: 'Check network connectivity and firewall settings',
      tags: ['aws', 'ssm', 'websocket', 'connection'],
      retryable: true
    },
    {
      pattern: /SSM endpoint not available in region (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Service Not Available in Region',
      severity: 'critical',
      remediation: 'Use a supported AWS region or check service availability',
      tags: ['aws', 'ssm', 'region', 'endpoint']
    },

    // Credential and Authentication Errors
    {
      pattern: /Invalid AWS credentials for SSM/,
      type: 'error',
      category: 'aws-ssm',
      description: 'Invalid AWS Credentials',
      severity: 'critical',
      remediation: 'Verify AWS access key and secret key are correct',
      tags: ['aws', 'ssm', 'credentials', 'invalid']
    },
    {
      pattern: /AWS credentials have expired/,
      type: 'error',
      category: 'aws-ssm',
      description: 'AWS Credentials Expired',
      severity: 'high',
      remediation: 'Refresh AWS credentials or assume new role',
      tags: ['aws', 'ssm', 'credentials', 'expired'],
      retryable: true
    },
    {
      pattern: /MFA token required for SSM access/,
      type: 'error',
      category: 'aws-ssm',
      description: 'MFA Token Required',
      severity: 'medium',
      remediation: 'Provide MFA token to authenticate with AWS',
      tags: ['aws', 'ssm', 'mfa', 'token']
    },

    // Rate Limiting and Throttling
    {
      pattern: /Rate exceeded for SSM API: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM API Rate Limit Exceeded',
      severity: 'medium',
      remediation: 'Implement exponential backoff and retry logic',
      tags: ['aws', 'ssm', 'rate-limit', 'throttling'],
      retryable: true
    },
    {
      pattern: /Throttling exception for SSM: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Service Throttled',
      severity: 'medium',
      remediation: 'Reduce request frequency and implement backoff',
      tags: ['aws', 'ssm', 'throttling'],
      retryable: true
    },

    // Generic SSM Errors
    {
      pattern: /SSMException: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Service Exception',
      severity: 'high',
      remediation: 'Check specific error message and AWS documentation',
      tags: ['aws', 'ssm', 'exception']
    },
    {
      pattern: /SSM operation (.+) failed: (.+)/,
      type: 'error',
      category: 'aws-ssm',
      description: 'SSM Operation Failed',
      severity: 'high',
      remediation: 'Retry operation or check specific error details',
      tags: ['aws', 'ssm', 'operation', 'failed'],
      retryable: true
    }
  ];

  /**
   * Configuration Error Patterns
   */
  static readonly CONFIGURATION_PATTERNS: ExtendedErrorPattern[] = [
    {
      pattern: /Configuration error|config error|configuration/i,
      type: 'error',
      category: 'configuration',
      description: 'Configuration Error',
      severity: 'high',
      remediation: 'Check configuration files and settings',
      tags: ['configuration', 'config']
    },
    {
      pattern: /Missing environment variable|env var|environment/i,
      type: 'error',
      category: 'configuration',
      description: 'Missing Environment Variable',
      severity: 'high',
      remediation: 'Set required environment variables',
      tags: ['configuration', 'environment', 'variables']
    },
    {
      pattern: /Invalid configuration|invalid config/i,
      type: 'error',
      category: 'configuration',
      description: 'Invalid Configuration',
      severity: 'high',
      remediation: 'Validate configuration syntax and values',
      tags: ['configuration', 'validation']
    },
    {
      pattern: /Port already in use|address already in use/i,
      type: 'error',
      category: 'configuration',
      description: 'Port Already in Use',
      severity: 'high',
      remediation: 'Use a different port or stop the conflicting service',
      tags: ['configuration', 'port', 'network']
    }
  ];

  /**
   * WSL (Windows Subsystem for Linux) Error Patterns
   */
  static readonly WSL_PATTERNS: ExtendedErrorPattern[] = [
    {
      pattern: /WslRegisterDistribution failed with error: 0x80070003/,
      type: 'error',
      description: 'WSL distribution registration failed - file not found',
      severity: 'high',
      category: 'wsl-installation',
      remediation: 'Check file paths and permissions for distribution installation',
      tags: ['wsl', 'installation', 'registration'],
      retryable: false
    },
    {
      pattern: /WslRegisterDistribution failed with error: 0x8007019e/,
      type: 'error',
      description: 'WSL feature not enabled',
      severity: 'critical',
      category: 'wsl-configuration',
      remediation: 'Enable WSL feature in Windows Features or via PowerShell',
      tags: ['wsl', 'feature', 'windows'],
      retryable: false
    },
    {
      pattern: /The Windows Subsystem for Linux optional component is not enabled/,
      type: 'error',
      description: 'WSL optional component not enabled',
      severity: 'critical',
      category: 'wsl-configuration',
      remediation: 'Enable WSL in Windows Features',
      tags: ['wsl', 'windows-features'],
      retryable: false
    },
    {
      pattern: /Element not found/,
      type: 'error',
      description: 'WSL distribution not found',
      severity: 'medium',
      category: 'wsl-distribution',
      remediation: 'Check distribution name and installation status',
      tags: ['wsl', 'distribution', 'not-found'],
      retryable: true
    },
    {
      pattern: /The system cannot find the file specified/,
      type: 'error',
      description: 'WSL executable or distribution file not found',
      severity: 'high',
      category: 'wsl-filesystem',
      remediation: 'Reinstall WSL or the specific distribution',
      tags: ['wsl', 'filesystem', 'file-not-found'],
      retryable: true
    },
    {
      pattern: /A connection with the server could not be established/,
      type: 'error',
      description: 'WSL network connectivity issue',
      severity: 'medium',
      category: 'wsl-network',
      remediation: 'Check network configuration and restart WSL',
      tags: ['wsl', 'network', 'connectivity'],
      retryable: true
    },
    {
      pattern: /systemd.*failed/i,
      type: 'error',
      description: 'Systemd service failure',
      severity: 'medium',
      category: 'wsl-systemd',
      remediation: 'Check systemd configuration and service status',
      tags: ['wsl', 'systemd', 'service'],
      retryable: true
    },
    {
      pattern: /mount.*failed/i,
      type: 'error',
      description: 'File system mount failure',
      severity: 'high',
      category: 'wsl-filesystem',
      remediation: 'Check mount points and file system integrity',
      tags: ['wsl', 'filesystem', 'mount'],
      retryable: true
    },
    {
      pattern: /docker.*not found/i,
      type: 'error',
      description: 'Docker not available in WSL',
      severity: 'low',
      category: 'wsl-docker',
      remediation: 'Install Docker in WSL distribution',
      tags: ['wsl', 'docker', 'not-found'],
      retryable: false
    },
    {
      pattern: /permission denied.*\/mnt\//i,
      type: 'error',
      description: 'Permission denied accessing Windows drives',
      severity: 'medium',
      category: 'wsl-permissions',
      remediation: 'Check WSL mount permissions and Windows file permissions',
      tags: ['wsl', 'permissions', 'mount'],
      retryable: false
    },
    {
      pattern: /wsl.*terminated/i,
      type: 'warning',
      description: 'WSL distribution terminated unexpectedly',
      severity: 'medium',
      category: 'wsl-runtime',
      remediation: 'Restart WSL distribution and check system resources',
      tags: ['wsl', 'runtime', 'terminated'],
      retryable: true
    },
    {
      pattern: /Invalid console output mode/i,
      type: 'error',
      description: 'WSL console output mode error',
      severity: 'low',
      category: 'wsl-console',
      remediation: 'Reset WSL terminal configuration',
      tags: ['wsl', 'console', 'output'],
      retryable: true
    },
    {
      pattern: /The parameter is incorrect/,
      type: 'error',
      description: 'WSL command parameter error',
      severity: 'medium',
      category: 'wsl-parameter',
      remediation: 'Check command syntax and parameters',
      tags: ['wsl', 'parameter', 'command'],
      retryable: false
    },
    {
      pattern: /wsl: Argument list too long/i,
      type: 'error',
      description: 'WSL command argument list too long',
      severity: 'low',
      category: 'wsl-argument',
      remediation: 'Reduce command arguments or use input files',
      tags: ['wsl', 'arguments', 'command'],
      retryable: false
    },
    {
      pattern: /Virtual machine could not be started/i,
      type: 'error',
      description: 'WSL2 virtual machine startup failure',
      severity: 'high',
      category: 'wsl2-vm',
      remediation: 'Check Hyper-V settings and system resources',
      tags: ['wsl2', 'vm', 'startup'],
      retryable: true
    }
  ];

  /**
   * Get all error patterns combined
   */
  static getAllPatterns(): ExtendedErrorPattern[] {
    return [
      ...this.RUNTIME_PATTERNS,
      ...this.COMPILATION_PATTERNS,
      ...this.NETWORK_PATTERNS,
      ...this.SSH_PATTERNS,
      ...this.BUILD_TOOL_PATTERNS,
      ...this.DATABASE_PATTERNS,
      ...this.PERFORMANCE_PATTERNS,
      ...this.SECURITY_PATTERNS,
      ...this.AWS_SSM_PATTERNS,
      ...this.CONFIGURATION_PATTERNS,
      ...this.WSL_PATTERNS
    ];
  }

  /**
   * Get patterns by category
   */
  static getPatternsByCategory(category: string): ExtendedErrorPattern[] {
    return this.getAllPatterns().filter(pattern => pattern.category === category);
  }

  /**
   * Get patterns by language
   */
  static getPatternsByLanguage(language: string): ExtendedErrorPattern[] {
    return this.getAllPatterns().filter(pattern => pattern.language === language);
  }

  /**
   * Get patterns by severity
   */
  static getPatternsBySeverity(severity: 'low' | 'medium' | 'high' | 'critical'): ExtendedErrorPattern[] {
    return this.getAllPatterns().filter(pattern => pattern.severity === severity);
  }

  /**
   * Get retryable patterns
   */
  static getRetryablePatterns(): ExtendedErrorPattern[] {
    return this.getAllPatterns().filter(pattern => pattern.retryable === true);
  }
}