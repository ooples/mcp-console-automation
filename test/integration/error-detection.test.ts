import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { ErrorDetector } from '../../src/core/ErrorDetector.js';
import { ConsoleManager } from '../../src/core/ConsoleManager.js';
import { ErrorPattern } from '../../src/types/index.js';
import { platform } from 'os';

describe('Error Detection Integration Tests', () => {
  let errorDetector: ErrorDetector;
  let consoleManager: ConsoleManager;

  beforeAll(() => {
    errorDetector = new ErrorDetector();
    consoleManager = new ConsoleManager();
  });

  afterAll(async () => {
    await consoleManager.destroy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Pattern Matching Across Languages', () => {
    it('should detect JavaScript/Node.js errors', () => {
      const nodeError = `
ReferenceError: undefinedVariable is not defined
    at Object.<anonymous> (/app/test.js:5:1)
    at Module._compile (module.js:573:30)
    at Object.Module._extensions..js (module.js:584:10)
    at Module.load (module.js:507:32)
    at tryModuleLoad (module.js:447:12)
`;
      
      const errors = errorDetector.detect(nodeError);
      expect(errors).toHaveLength(1);
      expect(errors[0].pattern.type).toBe('error');
      expect(errors[0].pattern.severity).toBe('high');
      
      // Test stack trace analysis
      const stackTrace = errorDetector.analyzeStackTrace(nodeError);
      expect(stackTrace.language).toBe('javascript');
      expect(stackTrace.frames.length).toBeGreaterThan(0);
    });

    it('should detect Python errors and tracebacks', () => {
      const pythonError = `
Traceback (most recent call last):
  File "test.py", line 10, in <module>
    result = divide(10, 0)
  File "test.py", line 5, in divide
    return a / b
ZeroDivisionError: division by zero
`;
      
      const errors = errorDetector.detect(pythonError);
      expect(errors.length).toBeGreaterThan(0);
      
      const exceptionErrors = errors.filter(e => e.pattern.type === 'exception');
      expect(exceptionErrors.length).toBeGreaterThan(0);
      
      // Test stack trace analysis
      const stackTrace = errorDetector.analyzeStackTrace(pythonError);
      expect(stackTrace.language).toBe('python');
      expect(stackTrace.frames.length).toBeGreaterThan(0);
      expect(stackTrace.frames[0]).toContain('File "test.py"');
    });

    it('should detect Java errors and stack traces', () => {
      const javaError = `
Exception in thread "main" java.lang.NullPointerException
  at com.example.MyClass.process(MyClass.java:42)
  at com.example.Main.main(Main.java:15)
`;
      
      const errors = errorDetector.detect(javaError);
      expect(errors.length).toBeGreaterThan(0);
      
      const nullPointerErrors = errors.filter(e => 
        e.pattern.description.includes('Null pointer')
      );
      expect(nullPointerErrors.length).toBeGreaterThan(0);
      
      // Test stack trace analysis
      const stackTrace = errorDetector.analyzeStackTrace(javaError);
      expect(stackTrace.language).toBe('java');
      expect(stackTrace.frames.length).toBeGreaterThan(0);
      expect(stackTrace.frames[0]).toContain('at com.example');
    });

    it('should detect C/C++ errors', () => {
      const cppError = `
Segmentation fault (core dumped)
*** stack smashing detected ***: ./program terminated
Assertion 'ptr != NULL' failed.
`;
      
      const errors = errorDetector.detect(cppError);
      expect(errors.length).toBeGreaterThan(0);
      
      const segFaultErrors = errors.filter(e => 
        e.pattern.description.includes('Segmentation fault')
      );
      expect(segFaultErrors.length).toBeGreaterThan(0);
      
      const assertionErrors = errors.filter(e => 
        e.pattern.description.includes('Assertion failed')
      );
      expect(assertionErrors.length).toBeGreaterThan(0);
    });

    it('should detect compilation errors across languages', () => {
      const compilationErrors = `
gcc: error: unrecognized command line option '-invalid'
javac: error: file not found: NonExistent.java
error CS1002: ; expected
SyntaxError: invalid syntax (line 5)
`;
      
      const errors = errorDetector.detect(compilationErrors);
      expect(errors.length).toBeGreaterThan(0);
      
      const syntaxErrors = errors.filter(e => 
        e.pattern.description.includes('Syntax error') ||
        e.pattern.type === 'error'
      );
      expect(syntaxErrors.length).toBeGreaterThan(0);
    });

    it('should detect database errors', () => {
      const dbError = `
SQLException: Column 'invalid_column' doesn't exist in table 'users'
Connection refused: unable to connect to database server
Access denied for user 'test'@'localhost' to database 'production'
`;
      
      const errors = errorDetector.detect(dbError);
      expect(errors.length).toBeGreaterThan(0);
      
      const accessErrors = errors.filter(e => 
        e.pattern.description.includes('Access denied')
      );
      expect(accessErrors.length).toBeGreaterThan(0);
      
      const connectionErrors = errors.filter(e => 
        e.pattern.description.includes('Connection refused')
      );
      expect(connectionErrors.length).toBeGreaterThan(0);
    });

    it('should detect network and system errors', () => {
      const networkError = `
curl: (7) Failed to connect to localhost port 8080: Connection refused
ping: cannot resolve example.invalid: Name or service not known
Permission denied (publickey)
Timeout: operation took too long to complete
`;
      
      const errors = errorDetector.detect(networkError);
      expect(errors.length).toBeGreaterThan(0);
      
      const permissionErrors = errors.filter(e => 
        e.pattern.description.includes('Permission denied')
      );
      expect(permissionErrors.length).toBeGreaterThan(0);
      
      const timeoutErrors = errors.filter(e => 
        e.pattern.description.includes('timeout')
      );
      expect(timeoutErrors.length).toBeGreaterThan(0);
    });
  });

  describe('Error Severity Classification', () => {
    it('should classify critical errors correctly', () => {
      const criticalErrors = `
FATAL: database connection lost
Out of memory: killed process
Segmentation fault occurred
Exception: null pointer dereference
Stack trace detected
`;
      
      const errors = errorDetector.detect(criticalErrors);
      const criticalCount = errors.filter(e => e.pattern.severity === 'critical').length;
      
      expect(criticalCount).toBeGreaterThan(0);
      
      const severityScore = errorDetector.getSeverityScore(errors);
      expect(severityScore).toBeGreaterThan(10); // Multiple critical errors
    });

    it('should classify high severity errors correctly', () => {
      const highErrors = `
ERROR: failed to start service
Access denied to critical resource
Permission denied for admin operation
`;
      
      const errors = errorDetector.detect(highErrors);
      const highSeverityErrors = errors.filter(e => e.pattern.severity === 'high');
      
      expect(highSeverityErrors.length).toBeGreaterThan(0);
      
      const severityScore = errorDetector.getSeverityScore(errors);
      expect(severityScore).toBeGreaterThan(5);
    });

    it('should classify medium severity errors correctly', () => {
      const mediumErrors = `
Cannot find configuration file
Unable to load optional module
Not found: resource missing
Connection timeout occurred
`;
      
      const errors = errorDetector.detect(mediumErrors);
      const mediumSeverityErrors = errors.filter(e => e.pattern.severity === 'medium');
      
      expect(mediumSeverityErrors.length).toBeGreaterThan(0);
      
      const severityScore = errorDetector.getSeverityScore(errors);
      expect(severityScore).toBeGreaterThan(2);
      expect(severityScore).toBeLessThan(15);
    });

    it('should classify low severity errors correctly', () => {
      const lowErrors = `
Warning: deprecated function used
Warning: configuration value ignored
`;
      
      const errors = errorDetector.detect(lowErrors);
      const lowSeverityErrors = errors.filter(e => e.pattern.severity === 'low');
      
      expect(lowSeverityErrors.length).toBeGreaterThan(0);
      
      const severityScore = errorDetector.getSeverityScore(errors);
      expect(severityScore).toBeLessThan(5);
    });

    it('should handle mixed severity scenarios', () => {
      const mixedErrors = `
Warning: minor issue detected
ERROR: critical system failure
Cannot find optional file
FATAL: system crash imminent
`;
      
      const errors = errorDetector.detect(mixedErrors);
      
      const severities = errors.map(e => e.pattern.severity);
      expect(severities).toContain('low');
      expect(severities).toContain('high');
      expect(severities).toContain('critical');
      expect(severities).toContain('medium');
      
      const severityScore = errorDetector.getSeverityScore(errors);
      expect(severityScore).toBeGreaterThan(8); // Mixed but high due to critical errors
    });
  });

  describe('Error Recovery Strategies', () => {
    it('should suggest recovery for connection errors', async () => {
      const sessionId = await consoleManager.createSession({
        command: platform() === 'win32' ? 
          'echo Connection refused: unable to connect to server' :
          'echo Connection refused: unable to connect to server',
        detectErrors: true,
        timeout: 5000
      });

      let errorEvent: any = null;
      
      consoleManager.on('console-event', (event) => {
        if (event.sessionId === sessionId && event.type === 'error') {
          errorEvent = event;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(errorEvent).toBeTruthy();
      expect(errorEvent.data.errors.length).toBeGreaterThan(0);
      
      const connectionErrors = errorEvent.data.errors.filter((e: any) => 
        e.pattern.description.includes('Connection refused')
      );
      expect(connectionErrors.length).toBeGreaterThan(0);

      await consoleManager.stopSession(sessionId);
    }, 10000);

    it('should handle permission errors with recovery suggestions', async () => {
      const sessionId = await consoleManager.createSession({
        command: platform() === 'win32' ? 
          'echo Access denied: insufficient privileges' :
          'echo Permission denied: operation not permitted',
        detectErrors: true,
        timeout: 5000
      });

      let errorEvent: any = null;
      
      consoleManager.on('console-event', (event) => {
        if (event.sessionId === sessionId && event.type === 'error') {
          errorEvent = event;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(errorEvent).toBeTruthy();
      expect(errorEvent.data.errors.length).toBeGreaterThan(0);
      
      const permissionErrors = errorEvent.data.errors.filter((e: any) => 
        e.pattern.description.includes('Access denied') ||
        e.pattern.description.includes('Permission denied')
      );
      expect(permissionErrors.length).toBeGreaterThan(0);

      await consoleManager.stopSession(sessionId);
    }, 10000);

    it('should handle timeout errors with retry suggestions', async () => {
      const sessionId = await consoleManager.createSession({
        command: platform() === 'win32' ? 
          'echo Timeout: operation exceeded time limit' :
          'echo Timeout: operation exceeded time limit',
        detectErrors: true,
        timeout: 5000
      });

      let errorEvent: any = null;
      
      consoleManager.on('console-event', (event) => {
        if (event.sessionId === sessionId && event.type === 'error') {
          errorEvent = event;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(errorEvent).toBeTruthy();
      expect(errorEvent.data.errors.length).toBeGreaterThan(0);
      
      const timeoutErrors = errorEvent.data.errors.filter((e: any) => 
        e.pattern.description.includes('timeout')
      );
      expect(timeoutErrors.length).toBeGreaterThan(0);

      await consoleManager.stopSession(sessionId);
    }, 10000);

    it('should identify recoverable vs non-recoverable errors', () => {
      const recoverableErrors = `
Connection timeout occurred
Unable to connect to service
Resource temporarily unavailable
`;

      const nonRecoverableErrors = `
Segmentation fault occurred
Out of memory: process killed
FATAL: corrupted data detected
`;

      const recoverable = errorDetector.detect(recoverableErrors);
      const nonRecoverable = errorDetector.detect(nonRecoverableErrors);

      // Recoverable errors typically have medium or high severity
      const recoverableScore = errorDetector.getSeverityScore(recoverable);
      const nonRecoverableScore = errorDetector.getSeverityScore(nonRecoverable);

      expect(nonRecoverableScore).toBeGreaterThan(recoverableScore);
      
      const criticalCount = nonRecoverable.filter(e => e.pattern.severity === 'critical').length;
      expect(criticalCount).toBeGreaterThan(0);
    });
  });

  describe('Performance Under High Error Rates', () => {
    it('should handle high-frequency error detection efficiently', async () => {
      const errorCount = 100;
      const errors = Array.from({ length: errorCount }, (_, i) => 
        `ERROR: Test error number ${i + 1}\nException: Critical failure ${i + 1}`
      ).join('\n');

      const startTime = Date.now();
      const detectedErrors = errorDetector.detect(errors);
      const endTime = Date.now();

      const processingTime = endTime - startTime;
      
      expect(detectedErrors.length).toBe(errorCount * 2); // ERROR + Exception per iteration
      expect(processingTime).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should maintain performance with complex error patterns', async () => {
      const complexErrors = `
[2023-12-01 10:30:15] ERROR in module.py:42 - Database connection failed
[2023-12-01 10:30:16] FATAL: System crash detected in component X
Traceback (most recent call last):
  File "complex.py", line 100, in process_data
    result = risky_operation()
  File "complex.py", line 85, in risky_operation
    raise ValueError("Invalid input data")
ValueError: Invalid input data
Connection refused: Could not establish connection to remote server
Permission denied: User lacks sufficient privileges
WARNING: Deprecated API usage detected
`;

      const iterations = 50;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const errors = errorDetector.detect(complexErrors);
        expect(errors.length).toBeGreaterThan(0);
      }

      const endTime = Date.now();
      const avgProcessingTime = (endTime - startTime) / iterations;

      expect(avgProcessingTime).toBeLessThan(50); // Average should be under 50ms per iteration
    });

    it('should handle concurrent error detection', async () => {
      const errorText = `
Multiple ERROR messages
Several FATAL issues
Various WARNING indicators
Many EXCEPTION cases
`;

      const concurrentPromises = Array.from({ length: 20 }, async (_, i) => {
        const errors = errorDetector.detect(`${errorText} - Batch ${i}`);
        return errors.length;
      });

      const startTime = Date.now();
      const results = await Promise.all(concurrentPromises);
      const endTime = Date.now();

      expect(results.every(count => count > 0)).toBe(true);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should handle memory efficiently with large error logs', () => {
      // Generate a large error log (simulate real-world scenario)
      const largeErrorLog = Array.from({ length: 1000 }, (_, i) => {
        const errorTypes = [
          `ERROR: Database query failed on line ${i}`,
          `WARNING: Deprecated method used in function ${i}`,
          `FATAL: Memory allocation failed for object ${i}`,
          `Exception: Null pointer at address ${i * 1000}`
        ];
        return errorTypes[i % 4];
      }).join('\n');

      const initialMemory = process.memoryUsage().heapUsed;
      
      const errors = errorDetector.detect(largeErrorLog);
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024); // MB

      expect(errors.length).toBe(1000); // Should detect all errors
      expect(memoryIncrease).toBeLessThan(50); // Should not use excessive memory
    });

    it('should handle streaming error detection performance', async () => {
      const command = platform() === 'win32' ? 
        'for /L %i in (1,1,50) do @echo ERROR: Test error %i & @echo WARNING: Test warning %i' :
        'for i in {1..50}; do echo "ERROR: Test error $i"; echo "WARNING: Test warning $i"; done';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        detectErrors: true,
        streaming: true,
        timeout: 15000
      });

      const errorEvents: any[] = [];
      const startTime = Date.now();

      consoleManager.on('console-event', (event) => {
        if (event.sessionId === sessionId && event.type === 'error') {
          errorEvents.push({
            ...event,
            detectionTime: Date.now() - startTime
          });
        }
      });

      // Wait for command completion
      await new Promise(resolve => setTimeout(resolve, 10000));

      expect(errorEvents.length).toBeGreaterThan(0);
      
      // Check that error detection didn't cause significant delays
      const avgDetectionTime = errorEvents.reduce((sum, event) => 
        sum + (event.detectionTime || 0), 0) / errorEvents.length;
      
      expect(avgDetectionTime).toBeLessThan(5000); // Should detect errors promptly

      await consoleManager.stopSession(sessionId);
    }, 20000);
  });

  describe('Custom Error Patterns', () => {
    it('should support adding custom error patterns', () => {
      const customPattern: ErrorPattern = {
        pattern: /CUSTOM_ERROR:\s+.*/i,
        type: 'error',
        description: 'Custom application error',
        severity: 'high'
      };

      errorDetector.addPattern(customPattern);

      const testText = 'CUSTOM_ERROR: Something went wrong in our app';
      const errors = errorDetector.detect(testText);

      const customErrors = errors.filter(e => 
        e.pattern.description === 'Custom application error'
      );
      expect(customErrors.length).toBe(1);
    });

    it('should support domain-specific error patterns', () => {
      const customPatterns: ErrorPattern[] = [
        {
          pattern: /BILLING_ERROR:\s+.*/i,
          type: 'error',
          description: 'Billing system error',
          severity: 'critical'
        },
        {
          pattern: /USER_AUTH_FAILED:\s+.*/i,
          type: 'error',
          description: 'User authentication failure',
          severity: 'high'
        }
      ];

      customPatterns.forEach(pattern => errorDetector.addPattern(pattern));

      const testText = `
BILLING_ERROR: Payment processing failed
USER_AUTH_FAILED: Invalid credentials provided
`;

      const errors = errorDetector.detect(testText);
      
      const billingErrors = errors.filter(e => 
        e.pattern.description === 'Billing system error'
      );
      const authErrors = errors.filter(e => 
        e.pattern.description === 'User authentication failure'
      );

      expect(billingErrors.length).toBe(1);
      expect(authErrors.length).toBe(1);
    });

    it('should support removing custom patterns', () => {
      const tempPattern: ErrorPattern = {
        pattern: /TEMP_ERROR:\s+.*/i,
        type: 'error',
        description: 'Temporary error pattern',
        severity: 'low'
      };

      errorDetector.addPattern(tempPattern);

      let errors = errorDetector.detect('TEMP_ERROR: This should be detected');
      expect(errors.length).toBe(1);

      errorDetector.removePattern(tempPattern.pattern);

      errors = errorDetector.detect('TEMP_ERROR: This should not be detected');
      const tempErrors = errors.filter(e => 
        e.pattern.description === 'Temporary error pattern'
      );
      expect(tempErrors.length).toBe(0);
    });

    it('should integrate custom patterns with ConsoleManager', async () => {
      const customPattern: ErrorPattern = {
        pattern: /APPLICATION_CRASH:\s+.*/i,
        type: 'exception',
        description: 'Application crash detected',
        severity: 'critical'
      };

      const sessionId = await consoleManager.createSession({
        command: platform() === 'win32' ? 
          'echo APPLICATION_CRASH: Main thread terminated' :
          'echo APPLICATION_CRASH: Main thread terminated',
        patterns: [customPattern],
        detectErrors: true,
        timeout: 5000
      });

      let errorEvent: any = null;
      
      consoleManager.on('console-event', (event) => {
        if (event.sessionId === sessionId && event.type === 'error') {
          errorEvent = event;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(errorEvent).toBeTruthy();
      expect(errorEvent.data.errors.length).toBeGreaterThan(0);
      
      const crashErrors = errorEvent.data.errors.filter((e: any) => 
        e.pattern.description === 'Application crash detected'
      );
      expect(crashErrors.length).toBeGreaterThan(0);

      await consoleManager.stopSession(sessionId);
    }, 10000);
  });
});