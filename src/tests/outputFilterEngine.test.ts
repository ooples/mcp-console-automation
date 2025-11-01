import {
  OutputFilterEngine,
  FilterOptions,
  FilterResult,
} from '../core/OutputFilterEngine.js';
import { ConsoleOutput } from '../types/index.js';

describe('OutputFilterEngine', () => {
  let filterEngine: OutputFilterEngine;

  beforeEach(() => {
    filterEngine = new OutputFilterEngine();
  });

  // Helper function to create test console output
  const createTestOutput = (
    lines: string[],
    baseTimestamp = Date.now()
  ): ConsoleOutput[] => {
    return lines.map((line, index) => ({
      sessionId: 'test-session',
      timestamp: new Date(baseTimestamp + index * 1000), // 1 second apart
      type: 'stdout' as const,
      data: line,
    }));
  };

  // Helper function to create large test datasets
  const createLargeOutput = (
    size: number,
    pattern = 'line'
  ): ConsoleOutput[] => {
    const lines: string[] = [];
    const baseTimestamp = Date.now();

    for (let i = 0; i < size; i++) {
      let line: string;
      if (i % 1000 === 0) {
        line = `ERROR: Critical failure at ${pattern} ${i}`;
      } else if (i % 500 === 0) {
        line = `WARN: Warning message for ${pattern} ${i}`;
      } else if (i % 100 === 0) {
        line = `INFO: Information about ${pattern} ${i}`;
      } else {
        line = `DEBUG: Regular debug ${pattern} ${i} with some content`;
      }
      lines.push(line);
    }

    return createTestOutput(lines, baseTimestamp);
  };

  describe('Basic Pattern Matching', () => {
    test('should filter lines with simple regex pattern', async () => {
      const output = createTestOutput([
        'This is a test line',
        'Another test line here',
        'No match in this one',
        'Final test line',
      ]);

      const result = await filterEngine.filter(output, {
        grep: 'test',
      });

      expect(result.output).toHaveLength(3);
      expect(result.metadata.totalLines).toBe(4);
      expect(result.metadata.filteredLines).toBe(3);
    });

    test('should handle case-insensitive matching', async () => {
      const output = createTestOutput([
        'ERROR: Something failed',
        'error: Another failure',
        'Error: Mixed case',
        'INFO: All good',
      ]);

      const result = await filterEngine.filter(output, {
        grep: 'error',
        grepIgnoreCase: true,
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(3);
    });

    test('should handle complex regex patterns', async () => {
      const output = createTestOutput([
        'user@host:~/project$ ls -la',
        'total 48',
        'drwxr-xr-x 2 user user 4096 Dec 25 10:30 .',
        'drwxr-xr-x 3 user user 4096 Dec 25 10:25 ..',
        '-rw-r--r-- 1 user user  220 Dec 25 10:25 .bashrc',
        'user@host:~/project$ cat file.txt',
        'Hello World',
      ]);

      // Match shell prompts
      const result = await filterEngine.filter(output, {
        grep: '^[^@]+@[^:]+:[^$]+\\$',
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(2);
    });
  });

  describe('Time-based Filtering', () => {
    test('should filter by absolute timestamp (ISO)', async () => {
      const now = new Date();
      const output = createTestOutput(
        ['Old log entry', 'Another old entry', 'Recent entry', 'Latest entry'],
        now.getTime() - 7000
      ); // 7 seconds ago

      const filterTime = new Date(now.getTime() - 5000).toISOString(); // 5 seconds ago

      const result = await filterEngine.filter(output, {
        since: filterTime,
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(2); // Last 2 entries
    });

    test('should filter by relative timestamp', async () => {
      const now = Date.now();
      const output = createTestOutput(
        ['Very old entry', 'Old entry', 'Recent entry', 'Latest entry'],
        now - 7000
      ); // 7 seconds ago

      const result = await filterEngine.filter(output, {
        since: '5s', // Last 5 seconds
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(2); // Last 2 entries within 5 seconds
    });

    test('should handle various relative time formats', async () => {
      const testCases = [
        { format: '30s', milliseconds: 30 * 1000 },
        { format: '5m', milliseconds: 5 * 60 * 1000 },
        { format: '2h', milliseconds: 2 * 60 * 60 * 1000 },
        { format: '1d', milliseconds: 24 * 60 * 60 * 1000 },
      ];

      for (const testCase of testCases) {
        const now = Date.now();
        const output = createTestOutput(
          ['Old entry', 'Recent entry'],
          now - (testCase.milliseconds + 1000)
        ); // Just outside the window

        const result = await filterEngine.filter(output, {
          since: testCase.format,
        });

        expect(result.success).toBe(true);
        expect(result.filteredOutput).toHaveLength(1); // Only the recent one
      }
    });
  });

  describe('Line-based Operations', () => {
    test('should return first N lines (head)', async () => {
      const output = createTestOutput(
        Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      );

      const result = await filterEngine.filter(output, {
        head: 5,
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(5);
      expect(result.filteredOutput[0].data).toBe('Line 1');
      expect(result.filteredOutput[4].data).toBe('Line 5');
    });

    test('should return last N lines (tail)', async () => {
      const output = createTestOutput(
        Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      );

      const result = await filterEngine.filter(output, {
        tail: 3,
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(3);
      expect(result.filteredOutput[0].data).toBe('Line 98');
      expect(result.filteredOutput[2].data).toBe('Line 100');
    });

    test('should return specific line range', async () => {
      const output = createTestOutput(
        Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
      );

      const result = await filterEngine.filter(output, {
        lineRange: [10, 15], // Lines 10-15 (1-indexed)
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(6);
      expect(result.filteredOutput[0].data).toBe('Line 10');
      expect(result.filteredOutput[5].data).toBe('Line 15');
    });

    test('should handle invalid line ranges gracefully', async () => {
      const output = createTestOutput(
        Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`)
      );

      const result = await filterEngine.filter(output, {
        lineRange: [5, 20], // End beyond available lines
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(6); // Lines 5-10
      expect(result.filteredOutput[0].data).toBe('Line 5');
      expect(result.filteredOutput[5].data).toBe('Line 10');
    });
  });

  describe('Multi-pattern Search', () => {
    test('should handle AND logic with multiple patterns', async () => {
      const output = createTestOutput([
        'ERROR: Database connection failed',
        'WARN: Database slow',
        'ERROR: Authentication failed',
        'INFO: Database connected',
        'ERROR: Database timeout',
      ]);

      const result = await filterEngine.filter(output, {
        multiPattern: {
          patterns: ['ERROR', 'Database'],
          logic: 'AND',
        },
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(2); // Only ERRORs containing 'Database'
    });

    test('should handle OR logic with multiple patterns', async () => {
      const output = createTestOutput([
        'ERROR: Something failed',
        'WARN: Warning message',
        'INFO: Information',
        'DEBUG: Debug info',
      ]);

      const result = await filterEngine.filter(output, {
        multiPattern: {
          patterns: ['ERROR', 'WARN'],
          logic: 'OR',
        },
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(2);
    });

    test('should combine multi-pattern with other filters', async () => {
      const output = createTestOutput([
        'ERROR: Old error',
        'WARN: Old warning',
        'ERROR: Recent error',
        'INFO: Recent info',
        'WARN: Recent warning',
      ]);

      const result = await filterEngine.filter(output, {
        multiPattern: {
          patterns: ['ERROR', 'WARN'],
          logic: 'OR',
        },
        tail: 3, // Last 3 lines after multi-pattern filtering
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(3);
      expect(result.filteredOutput[0].data).toBe('WARN: Old warning');
      expect(result.filteredOutput[1].data).toBe('ERROR: Recent error');
      expect(result.filteredOutput[2].data).toBe('WARN: Recent warning');
    });
  });

  describe('Performance and Large Data Tests', () => {
    test('should handle 100k+ lines efficiently', async () => {
      const output = createLargeOutput(100000);

      console.time('100k lines filter');
      const result = await filterEngine.filter(output, {
        grep: 'ERROR',
      });
      console.timeEnd('100k lines filter');

      expect(result.success).toBe(true);
      expect(result.metrics.totalLines).toBe(100000);
      expect(result.metrics.filteredLines).toBe(100); // Every 1000th line is ERROR
      expect(result.metrics.processingTimeMs).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('should use streaming mode for large outputs', async () => {
      const output = createLargeOutput(150000);

      console.time('150k lines streaming');
      const result = await filterEngine.filter(output, {
        grep: 'WARN',
        streamingMode: true,
      });
      console.timeEnd('150k lines streaming');

      expect(result.success).toBe(true);
      expect(result.metrics.totalLines).toBe(150000);
      expect(result.metrics.filteredLines).toBe(150); // WARN at 500, 1500, 2500... (every 1000, offset by 500)
      // Note: streamingUsed property not available in current metrics interface
    });

    test('should respect maxLines limit for performance', async () => {
      const output = createLargeOutput(200000);

      const result = await filterEngine.filter(output, {
        grep: 'INFO',
        maxLines: 50000, // Limit processing to first 50k lines
      });

      expect(result.success).toBe(true);
      expect(result.metrics.totalLines).toBe(50000); // Should only process 50k
      expect(result.metrics.filteredLines).toBe(400); // INFO at every 100th except ERROR (50) and WARN (50)
    });

    test('should maintain performance with complex regex patterns', async () => {
      const output = createLargeOutput(50000);

      console.time('Complex regex performance');
      const result = await filterEngine.filter(output, {
        grep: '^(ERROR|WARN|INFO):\\s+.*\\s+(\\d+)$', // Complex pattern matching log format
      });
      console.timeEnd('Complex regex performance');

      expect(result.success).toBe(true);
      expect(result.metrics.processingTimeMs).toBeLessThan(3000); // Should be reasonably fast
      expect(result.filteredOutput.length).toBeGreaterThan(0);
    });

    test('should handle memory efficiently with streaming', async () => {
      const output = createLargeOutput(200000);

      // Measure memory before
      const memBefore = process.memoryUsage().heapUsed;

      const result = await filterEngine.filter(output, {
        grep: 'ERROR',
        streamingMode: true,
        maxLines: 100000,
      });

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memAfter = process.memoryUsage().heapUsed;
      const memDiff = memAfter - memBefore;

      expect(result.success).toBe(true);
      expect(memDiff).toBeLessThan(100 * 1024 * 1024); // Should use less than 100MB additional memory
    });
  });

  describe('Combined Filter Operations', () => {
    test('should apply multiple filters in correct order', async () => {
      const now = Date.now();
      const output = createTestOutput(
        [
          'OLD ERROR: First error',
          'OLD WARN: First warning',
          'OLD INFO: First info',
          'ERROR: Recent error',
          'WARN: Recent warning',
          'INFO: Recent info',
          'ERROR: Latest error',
          'DEBUG: Latest debug',
        ],
        now - 10000
      );

      const result = await filterEngine.filter(output, {
        since: '7s', // Time filter first
        grep: '^(ERROR|WARN)', // Then pattern filter
        tail: 2, // Then line limit
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(2);
      expect(result.filteredOutput[0].data).toBe('WARN: Recent warning');
      expect(result.filteredOutput[1].data).toBe('ERROR: Latest error');
    });

    test('should handle edge cases with empty results', async () => {
      const output = createTestOutput([
        'INFO: No errors here',
        'DEBUG: Just debug info',
        'TRACE: Trace information',
      ]);

      const result = await filterEngine.filter(output, {
        grep: 'ERROR', // No matches
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(0);
      expect(result.metrics.totalLines).toBe(3);
      expect(result.metrics.filteredLines).toBe(0);
    });

    test('should validate filter options', async () => {
      const output = createTestOutput(['test line']);

      // Test invalid regex
      const invalidRegexResult = await filterEngine.filter(output, {
        grep: '[invalid regex(',
      });

      expect(invalidRegexResult.success).toBe(false);
      expect(invalidRegexResult.error).toContain('Invalid regex pattern');

      // Test invalid line range
      const invalidRangeResult = await filterEngine.filter(output, {
        lineRange: [10, 5], // Start > end
      });

      expect(invalidRangeResult.success).toBe(false);
      expect(invalidRangeResult.error).toContain('Invalid line range');
    });
  });

  describe('Caching and Optimization', () => {
    test('should cache regex patterns for performance', async () => {
      const output = createLargeOutput(10000);
      const pattern = 'ERROR';

      // First run - should compile and cache regex
      console.time('First regex run');
      const result1 = await filterEngine.filter(output, { grep: pattern });
      console.timeEnd('First regex run');

      // Second run - should use cached regex
      console.time('Cached regex run');
      const result2 = await filterEngine.filter(output, { grep: pattern });
      console.timeEnd('Cached regex run');

      expect(result1.filteredOutput).toHaveLength(
        result2.filteredOutput.length
      );
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    test('should cache timestamp parsing for performance', async () => {
      const output = createLargeOutput(5000);
      const timeFilter = '5m';

      // First run - should parse and cache timestamp
      const result1 = await filterEngine.filter(output, { since: timeFilter });

      // Second run - should use cached timestamp
      const result2 = await filterEngine.filter(output, { since: timeFilter });

      expect(result1.filteredOutput).toHaveLength(
        result2.filteredOutput.length
      );
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  describe('Real-world Scenarios', () => {
    test('should filter application logs effectively', async () => {
      const appLogs = createTestOutput([
        '2023-12-25T10:30:00Z [INFO] Application started',
        '2023-12-25T10:30:01Z [INFO] Database connected',
        '2023-12-25T10:30:05Z [WARN] High memory usage detected',
        '2023-12-25T10:30:10Z [ERROR] Failed to process request: timeout',
        '2023-12-25T10:30:15Z [INFO] Request processed successfully',
        '2023-12-25T10:30:20Z [ERROR] Database connection lost',
        '2023-12-25T10:30:25Z [WARN] Retrying database connection',
        '2023-12-25T10:30:30Z [INFO] Database reconnected',
      ]);

      // Get only errors in the last 20 seconds
      const result = await filterEngine.filter(appLogs, {
        grep: '\\[ERROR\\]',
        since: '20s',
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(2);
      expect(result.filteredOutput[0].data).toContain('timeout');
      expect(result.filteredOutput[1].data).toContain('connection lost');
    });

    test('should handle build output filtering', async () => {
      const buildOutput = createTestOutput([
        'npm run build',
        'Building for production...',
        'Compiling TypeScript files...',
        'src/app.ts: warning TS2345: unused variable',
        'src/utils.ts: compiled successfully',
        'src/components/Button.tsx: compiled successfully',
        'src/types.ts: error TS2304: Cannot find name',
        'Build failed with 1 error, 1 warning',
        'npm run build exited with code 1',
      ]);

      // Get build errors and warnings
      const result = await filterEngine.filter(buildOutput, {
        multiPattern: {
          patterns: ['error', 'warning', 'failed'],
          logic: 'OR',
        },
        grepIgnoreCase: true,
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(3);
    });

    test('should filter server access logs', async () => {
      const accessLogs = createTestOutput([
        '192.168.1.1 - - [25/Dec/2023:10:30:00 +0000] "GET / HTTP/1.1" 200 1234',
        '192.168.1.2 - - [25/Dec/2023:10:30:01 +0000] "GET /api/users HTTP/1.1" 200 567',
        '10.0.0.1 - - [25/Dec/2023:10:30:02 +0000] "POST /api/login HTTP/1.1" 401 89',
        '192.168.1.1 - - [25/Dec/2023:10:30:03 +0000] "GET /favicon.ico HTTP/1.1" 404 0',
        '10.0.0.1 - - [25/Dec/2023:10:30:04 +0000] "POST /api/login HTTP/1.1" 200 156',
      ]);

      // Get failed requests (4xx, 5xx status codes)
      const result = await filterEngine.filter(accessLogs, {
        grep: '" [45]\\d\\d ',
        tail: 10,
      });

      expect(result.success).toBe(true);
      expect(result.filteredOutput).toHaveLength(2);
      expect(result.filteredOutput[0].data).toContain('401');
      expect(result.filteredOutput[1].data).toContain('404');
    });
  });
});
