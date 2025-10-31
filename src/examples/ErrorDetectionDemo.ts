import { ErrorDetector } from '../core/ErrorDetector.js';
import {
  ErrorReporter,
  ReportingOptions,
  MonitoringIntegration,
} from '../core/ErrorReporting.js';
import { ErrorPatterns } from '../patterns/ErrorPatterns.js';

/**
 * Comprehensive demonstration of the enhanced ErrorDetector capabilities
 */
export class ErrorDetectionDemo {
  private errorDetector: ErrorDetector;
  private errorReporter: ErrorReporter;

  constructor() {
    this.errorDetector = new ErrorDetector();
    this.errorReporter = new ErrorReporter({
      enabled: true,
      channels: ['console'],
      threshold: {
        critical: 1,
        high: 3,
        total: 5,
      },
      cooldownMinutes: 10,
    });
  }

  /**
   * Demo various error patterns across different languages and categories
   */
  async runDemo(): Promise<void> {
    console.log('🚀 Enhanced Error Detection Demo');
    console.log('═══════════════════════════════════════════════════════════');

    // Demo different error types
    await this.demoRuntimeErrors();
    await this.demoCompilationErrors();
    await this.demoNetworkErrors();
    await this.demoSSHErrors();
    await this.demoBuildToolErrors();
    await this.demoDatabaseErrors();
    await this.demoPerformanceIssues();
    await this.demoSecurityErrors();
    await this.demoComplexScenario();
  }

  private async demoRuntimeErrors(): Promise<void> {
    console.log('\n📋 Demo: Runtime Errors');
    console.log('───────────────────────────────────────────────────────────');

    const errorLogs = `
2024-01-15 14:23:45 [INFO] Application starting...
2024-01-15 14:23:46 [ERROR] TypeError: Cannot read property 'length' of undefined
    at processData (/app/src/utils.js:42:15)
    at main (/app/src/index.js:18:5)
    at Object.<anonymous> (/app/src/index.js:25:1)
2024-01-15 14:23:47 [ERROR] Traceback (most recent call last):
  File "/app/main.py", line 15, in process_items
    result = items[index]
IndexError: list index out of range
2024-01-15 14:23:48 [FATAL] java.lang.NullPointerException: Cannot invoke method on null object
    at com.example.Service.process(Service.java:45)
    at com.example.Main.main(Main.java:23)
2024-01-15 14:23:49 [ERROR] panic: runtime error: index out of range [5] with length 3
`;

    const report = this.errorDetector.generateReport(errorLogs);
    console.log(
      this.errorReporter.formatForConsole(report, { includeRemediation: true })
    );
  }

  private async demoCompilationErrors(): Promise<void> {
    console.log('\n📋 Demo: Compilation Errors');
    console.log('───────────────────────────────────────────────────────────');

    const compilationLogs = `
Building TypeScript project...
src/utils.ts(25,8): error TS2304: Cannot find name 'undefinedVariable'.
src/models/User.ts(42,15): error TS2339: Property 'name' does not exist on type 'UserData'.
Main.java:15: error: cannot find symbol
  symbol:   method undefinedMethod()
  location: variable obj of type Object
error[E0425]: cannot find value 'undefined_var' in this scope
 --> src/main.rs:8:13
  |
8 |     println!("{}", undefined_var);
  |             ^^^^^^^^^^^^^ not found in this scope
`;

    const report = this.errorDetector.generateReport(compilationLogs);
    const options: ReportingOptions = {
      includeRemediation: true,
      categories: ['compilation'],
    };
    console.log(this.errorReporter.formatForConsole(report, options));
  }

  private async demoNetworkErrors(): Promise<void> {
    console.log('\n📋 Demo: Network Errors');
    console.log('───────────────────────────────────────────────────────────');

    const networkLogs = `
2024-01-15 14:30:00 [ERROR] Connection refused: Unable to connect to database.example.com:5432
2024-01-15 14:30:05 [WARN] Connection timed out after 30 seconds
2024-01-15 14:30:10 [ERROR] Host not found: api.nonexistent.com
2024-01-15 14:30:15 [ERROR] SSL certificate verify failed: certificate has expired
2024-01-15 14:30:20 [ERROR] Connection reset by peer: Remote server closed connection unexpectedly
`;

    const report = this.errorDetector.generateReport(networkLogs);
    console.log(
      this.errorReporter.formatForConsole(report, {
        includeRemediation: true,
        categories: ['network'],
      })
    );
  }

  private async demoSSHErrors(): Promise<void> {
    console.log('\n📋 Demo: SSH Connection Errors');
    console.log('───────────────────────────────────────────────────────────');

    const sshLogs = `
$ ssh user@remote-server.com
ssh: connect to host remote-server.com port 22: Connection refused
$ ssh user@another-server.com
Permission denied (publickey).
$ ssh user@test-server.local
Host key verification failed.
$ ssh user@192.168.1.100
ssh: Could not resolve hostname 192.168.1.100: Name or service not known
Connection to production-server.com closed by remote host.
`;

    const report = this.errorDetector.generateReport(sshLogs);
    console.log(
      this.errorReporter.formatForConsole(report, {
        includeRemediation: true,
        categories: ['ssh'],
      })
    );
  }

  private async demoBuildToolErrors(): Promise<void> {
    console.log('\n📋 Demo: Build Tool Errors');
    console.log('───────────────────────────────────────────────────────────');

    const buildLogs = `
npm ERR! Cannot resolve dependency 'nonexistent-package'
npm ERR! peer dep missing: react@^17.0.0, required by react-router@6.0.0
Module not found: Error: Can't resolve './missing-module' in '/app/src'
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.8.1:compile
[ERROR] /Users/dev/project/src/main/java/Service.java:[15,8] cannot find symbol
> Task :app:compileKotlin FAILED
error: could not compile 'main' (lib main) due to previous error
make: *** [all] Error 1
`;

    const report = this.errorDetector.generateReport(buildLogs);
    console.log(
      this.errorReporter.formatForConsole(report, {
        includeRemediation: true,
        categories: ['build-tool'],
      })
    );
  }

  private async demoDatabaseErrors(): Promise<void> {
    console.log('\n📋 Demo: Database Errors');
    console.log('───────────────────────────────────────────────────────────');

    const dbLogs = `
ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: YES)
Can't connect to MySQL server on 'localhost' (10061)
ERROR: relation "users_table" does not exist
could not connect to server: Connection refused (0x0000274D/10061)
MongoError: connection 5 to mongodb://localhost:27017 timed out
WRONGTYPE Operation against a key holding the wrong kind of value
Connection pool exhausted: Unable to get connection from pool
Deadlock found when trying to get lock; try restarting transaction
`;

    const report = this.errorDetector.generateReport(dbLogs);
    console.log(
      this.errorReporter.formatForConsole(report, {
        includeRemediation: true,
        categories: ['database'],
      })
    );
  }

  private async demoPerformanceIssues(): Promise<void> {
    console.log('\n📋 Demo: Performance Issues');
    console.log('───────────────────────────────────────────────────────────');

    const perfLogs = `
java.lang.OutOfMemoryError: Java heap space
GC overhead limit exceeded
Memory leak detected in module: UserService
High CPU usage detected: 95% for 5 minutes
Thread pool exhausted: All 50 threads are in use
No space left on device: /var/log (used 100%)
I/O error: Disk read error on /dev/sda1
`;

    const report = this.errorDetector.generateReport(perfLogs);
    console.log(
      this.errorReporter.formatForConsole(report, {
        includeRemediation: true,
        categories: ['performance'],
      })
    );
  }

  private async demoSecurityErrors(): Promise<void> {
    console.log('\n📋 Demo: Security Errors');
    console.log('───────────────────────────────────────────────────────────');

    const securityLogs = `
HTTP 401: Unauthorized access attempt to /admin
Access denied: User 'guest' does not have permission to perform this action
Invalid token: JWT signature verification failed
CSRF token mismatch: Expected 'abc123' but received 'xyz789'
Potential SQL injection detected in parameter 'id'
Forbidden: Access to /sensitive-data denied
`;

    const report = this.errorDetector.generateReport(securityLogs);
    console.log(
      this.errorReporter.formatForConsole(report, {
        includeRemediation: true,
        categories: ['security'],
      })
    );
  }

  private async demoComplexScenario(): Promise<void> {
    console.log('\n📋 Demo: Complex Multi-Category Scenario');
    console.log('───────────────────────────────────────────────────────────');

    const complexLogs = `
2024-01-15 10:00:00 [INFO] Starting microservice deployment...
2024-01-15 10:00:01 [ERROR] Connection refused: Unable to connect to database.prod.com:5432
2024-01-15 10:00:02 [ERROR] Configuration error: Missing environment variable 'DB_PASSWORD'
2024-01-15 10:00:03 [CRITICAL] java.lang.OutOfMemoryError: Java heap space
    at com.example.service.DataProcessor.process(DataProcessor.java:156)
    at com.example.service.MainService.handleRequest(MainService.java:89)
2024-01-15 10:00:04 [ERROR] ssh: connect to host worker-node-1.internal port 22: Connection refused
2024-01-15 10:00:05 [ERROR] Permission denied (publickey) for deployment@worker-node-2.internal
2024-01-15 10:00:06 [ERROR] npm ERR! Cannot resolve dependency '@types/node'
2024-01-15 10:00:07 [FATAL] TypeError: Cannot read property 'execute' of null
    at DeploymentService.deploy (/app/services/deployment.js:45:12)
    at async main (/app/index.js:23:5)
2024-01-15 10:00:08 [ERROR] Deadlock found when trying to get lock on table 'deployments'
2024-01-15 10:00:09 [CRITICAL] High CPU usage detected: 98% sustained for 10 minutes
2024-01-15 10:00:10 [ERROR] Access denied: User 'deployer' lacks permission for resource '/api/deploy'
`;

    const report = this.errorDetector.generateReport(complexLogs);

    console.log(
      this.errorReporter.formatForConsole(report, {
        includeRemediation: true,
        includeContext: false,
      })
    );

    // Demo structured output for APIs
    console.log('\n📊 MCP Structured Response:');
    console.log('───────────────────────────────────────────────────────────');
    const mcpResponse = this.errorReporter.generateMcpResponse(report);
    console.log(JSON.stringify(mcpResponse, null, 2));

    // Demo monitoring integration
    await this.demoMonitoringIntegration(report);
  }

  private async demoMonitoringIntegration(report: any): Promise<void> {
    console.log('\n📡 Demo: Monitoring Integration');
    console.log('───────────────────────────────────────────────────────────');

    const integrations: MonitoringIntegration[] = [
      {
        type: 'console',
        threshold: {
          criticalErrors: 1,
          totalErrors: 5,
        },
      },
      {
        type: 'file',
        filePath: './error-report.json',
        threshold: {
          severityScore: 10,
        },
      },
      {
        type: 'custom',
        customHandler: async (report) => {
          console.log(
            `📧 Custom handler: Sending alert for ${report.analysis.totalErrors} errors`
          );
        },
        threshold: {
          criticalErrors: 2,
        },
      },
    ];

    try {
      await this.errorReporter.sendToMonitoring(report, integrations);
      await this.errorReporter.sendAlert(report);
      console.log('✅ Monitoring integration completed successfully');
    } catch (error) {
      console.error('❌ Monitoring integration failed:', error);
    }
  }

  /**
   * Demo custom pattern creation
   */
  demoCustomPatterns(): void {
    console.log('\n📋 Demo: Custom Pattern Creation');
    console.log('───────────────────────────────────────────────────────────');

    // Add custom pattern for specific application errors
    this.errorDetector.addPattern({
      pattern: /MYAPP_ERROR: (.+)/,
      type: 'error',
      category: 'application',
      language: 'custom',
      description: 'Custom Application Error',
      severity: 'high',
      remediation: 'Check application-specific logs and configuration',
      tags: ['custom', 'myapp'],
      retryable: false,
    });

    const customLogs = `
2024-01-15 12:00:00 [ERROR] MYAPP_ERROR: User session expired during critical operation
2024-01-15 12:00:01 [WARN] Standard warning message
2024-01-15 12:00:02 [ERROR] MYAPP_ERROR: Database connection pool exhausted
`;

    const report = this.errorDetector.generateReport(customLogs);
    console.log(
      this.errorReporter.formatForConsole(report, { includeRemediation: true })
    );
  }

  /**
   * Demo pattern filtering and categorization
   */
  demoPatternFiltering(): void {
    console.log('\n📋 Demo: Pattern Filtering');
    console.log('───────────────────────────────────────────────────────────');

    // Show patterns by category
    console.log('🌐 Network patterns:');
    const networkPatterns = ErrorPatterns.getPatternsByCategory('network');
    networkPatterns.slice(0, 3).forEach((pattern) => {
      console.log(`  - ${pattern.description}: ${pattern.pattern}`);
    });

    console.log('\n☕ Java patterns:');
    const javaPatterns = ErrorPatterns.getPatternsByLanguage('java');
    javaPatterns.slice(0, 3).forEach((pattern) => {
      console.log(`  - ${pattern.description}: ${pattern.pattern}`);
    });

    console.log('\n🔴 Critical patterns:');
    const criticalPatterns = ErrorPatterns.getPatternsBySeverity('critical');
    criticalPatterns.slice(0, 3).forEach((pattern) => {
      console.log(`  - ${pattern.description}: ${pattern.pattern}`);
    });

    console.log('\n🔄 Retryable patterns:');
    const retryablePatterns = ErrorPatterns.getRetryablePatterns();
    retryablePatterns.slice(0, 3).forEach((pattern) => {
      console.log(`  - ${pattern.description}: ${pattern.pattern}`);
    });
  }
}

// Usage example
export async function runErrorDetectionDemo(): Promise<void> {
  const demo = new ErrorDetectionDemo();

  try {
    await demo.runDemo();
    demo.demoCustomPatterns();
    demo.demoPatternFiltering();

    console.log('\n🎉 Demo completed successfully!');
    console.log('═══════════════════════════════════════════════════════════');
  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runErrorDetectionDemo();
}
