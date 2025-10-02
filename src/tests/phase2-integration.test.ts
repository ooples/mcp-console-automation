/**
 * Phase 2 Integration Test
 * Tests full workflow of assertion framework components working together
 */

import { AssertionEngine } from '../testing/AssertionEngine';
import { SnapshotManager } from '../testing/SnapshotManager';
import { SnapshotDiffer } from '../testing/SnapshotDiffer';
import { Assertion } from '../types/test-framework';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Phase 2 Integration Test', () => {
  let assertionEngine: AssertionEngine;
  let snapshotManager: SnapshotManager;
  let snapshotDiffer: SnapshotDiffer;
  let testDir: string;

  beforeEach(() => {
    assertionEngine = new AssertionEngine();
    testDir = path.join(os.tmpdir(), `phase2-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    snapshotManager = new SnapshotManager(testDir);
    snapshotDiffer = new SnapshotDiffer();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('End-to-end test workflow', () => {
    it('should capture snapshot, assert on it, and compare', async () => {
      // 1. Capture initial snapshot
      const snapshot1 = await snapshotManager.capture(
        'integration-test',
        'Test started\nTest passed\nExit code: 0',
        { exitCode: 0, status: 'success' },
        { author: 'integration-test', description: 'First snapshot' }
      );

      const filepath1 = await snapshotManager.save(snapshot1);
      expect(fs.existsSync(filepath1)).toBe(true);

      // 2. Run assertions on the snapshot
      const assertions: Assertion[] = [
        {
          type: 'output_contains',
          expected: 'Test passed',
          actual: snapshot1.output,
        },
        {
          type: 'no_errors',
          expected: null,
          actual: snapshot1.output,
        },
        {
          type: 'exit_code',
          expected: 0,
          actual: snapshot1.state.exitCode,
        },
      ];

      const results = await assertionEngine.evaluateAll(assertions);
      expect(results.every(r => r.passed)).toBe(true);

      // 3. Capture second snapshot (different output)
      const snapshot2 = await snapshotManager.capture(
        'integration-test',
        'Test started\nTest failed\nExit code: 1',
        { exitCode: 1, status: 'failed' },
        { author: 'integration-test', description: 'Second snapshot' }
      );

      const filepath2 = await snapshotManager.save(snapshot2);

      // 4. Compare snapshots
      const diff = snapshotDiffer.compare(snapshot1, snapshot2);
      expect(diff.identical).toBe(false);
      expect(diff.similarity).toBeLessThan(1);

      // 5. Get detailed diff
      const detailedDiff = snapshotDiffer.compareDetailed(snapshot1, snapshot2);
      expect(detailedDiff.outputDiff.length).toBeGreaterThan(0);
      expect(detailedDiff.stateDiff.modified.length).toBeGreaterThan(0);

      // 6. Format diff for display
      const formatted = snapshotDiffer.formatDiff(detailedDiff);
      expect(formatted).toContain('Snapshot Diff');
      expect(formatted).toContain('Similarity');
    });

    it('should handle custom matchers in assertions', async () => {
      // Register custom matcher
      assertionEngine.registerMatcher({
        name: 'containsTestResult',
        fn: (actual, expected) => {
          return actual.includes('Test passed') || actual.includes('Test failed');
        },
        description: 'Checks if output contains test result',
      });

      // Create snapshot
      const snapshot = await snapshotManager.capture(
        'custom-test',
        'Running tests...\nTest passed',
        {},
        {}
      );

      // Use custom matcher
      const assertion: Assertion = {
        type: 'custom',
        operator: 'containsTestResult',
        expected: null,
        actual: snapshot.output,
      };

      const result = await assertionEngine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });

    it('should track multiple snapshots and compare them', async () => {
      const sessionId = 'multi-snapshot-test';

      // Create multiple snapshots over time
      const snapshots = [];
      for (let i = 1; i <= 3; i++) {
        const snapshot = await snapshotManager.capture(
          sessionId,
          `Iteration ${i}\nProgress: ${i * 33}%`,
          { iteration: i, progress: i * 33 },
          { step: i }
        );
        snapshots.push(snapshot);
        await snapshotManager.save(snapshot);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // List snapshots for this session
      const savedSnapshots = await snapshotManager.listSnapshots(sessionId);
      expect(savedSnapshots.length).toBe(3);

      // Compare first and last snapshot
      const loaded1 = await snapshotManager.load(savedSnapshots[2]);
      const loaded3 = await snapshotManager.load(savedSnapshots[0]);

      const diff = snapshotDiffer.compare(loaded1, loaded3);
      expect(diff.identical).toBe(false);

      const summary = snapshotDiffer.getSummary(
        snapshotDiffer.compareDetailed(loaded1, loaded3)
      );
      expect(summary.linesAdded + summary.linesRemoved).toBeGreaterThan(0);
    });

    it('should validate test output and capture results', async () => {
      // Simulate test execution
      const testOutput = `
Running test suite...
✓ Test 1 passed
✓ Test 2 passed
✗ Test 3 failed
  Expected: 5
  Actual: 4

3 tests, 2 passed, 1 failed
Exit code: 1
      `.trim();

      // Capture snapshot
      const snapshot = await snapshotManager.capture(
        'validation-test',
        testOutput,
        { passed: 2, failed: 1, total: 3 },
        { timestamp: Date.now(), suite: 'integration' }
      );

      await snapshotManager.save(snapshot);

      // Run multiple assertions
      const assertions: Assertion[] = [
        {
          type: 'output_contains',
          expected: 'test suite',
          actual: testOutput,
        },
        {
          type: 'output_matches',
          expected: /\d+ tests/,
          actual: testOutput,
        },
        {
          type: 'output_contains',
          expected: 'failed',
          actual: testOutput,
        },
      ];

      const { passed, results } = await assertionEngine.checkAll(assertions);
      expect(passed).toBe(true);
      expect(results.length).toBe(3);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('should handle snapshot cleanup workflow', async () => {
      // Create many snapshots
      for (let i = 0; i < 10; i++) {
        const snapshot = await snapshotManager.capture(
          'cleanup-test',
          `Output ${i}`,
          { count: i },
          {}
        );
        await snapshotManager.save(snapshot);
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // Verify all created
      let snapshots = await snapshotManager.listSnapshots('cleanup-test');
      expect(snapshots.length).toBe(10);

      // Cleanup keeping only 5 most recent
      const deleted = await snapshotManager.cleanup(5);
      expect(deleted).toBe(5);

      // Verify cleanup worked
      snapshots = await snapshotManager.listSnapshots('cleanup-test');
      expect(snapshots.length).toBe(5);

      // Get stats
      const stats = await snapshotManager.getStats();
      expect(stats.totalSnapshots).toBe(5);
      expect(stats.sessions).toBe(1);
    });

    it('should export snapshots in different formats', async () => {
      const snapshot = await snapshotManager.capture(
        'export-test',
        'Test output\nMultiple lines',
        { key: 'value' },
        { format: 'test' }
      );

      // Export as JSON
      const jsonExport = await snapshotManager.export(snapshot, 'json');
      const parsed = JSON.parse(jsonExport);
      expect(parsed.sessionId).toBe('export-test');

      // Export as YAML
      const yamlExport = await snapshotManager.export(snapshot, 'yaml');
      expect(yamlExport).toContain('sessionId: export-test');

      // Export as text
      const textExport = await snapshotManager.export(snapshot, 'text');
      expect(textExport).toContain('=== Session Snapshot ===');
    });

    it('should detect and reject corrupted snapshots', async () => {
      const snapshot = await snapshotManager.capture(
        'corruption-test',
        'original output',
        {},
        {}
      );

      const filepath = await snapshotManager.save(snapshot);

      // Corrupt the file
      const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      content.output = 'corrupted output';
      fs.writeFileSync(filepath, JSON.stringify(content));

      // Should fail to load due to hash mismatch
      await expect(snapshotManager.load(filepath)).rejects.toThrow('hash mismatch');
    });

    it('should handle complex assertion scenarios', async () => {
      const complexOutput = `
Build started at 2024-01-01 10:00:00
Compiling TypeScript...
✓ Compiled successfully in 2.3s
Running tests...
  ✓ Unit tests (142 passed)
  ✓ Integration tests (28 passed)
  ✗ E2E tests (3 failed, 12 passed)
Build completed with warnings
Total time: 5.6s
      `.trim();

      const snapshot = await snapshotManager.capture(
        'complex-test',
        complexOutput,
        {
          buildTime: 5.6,
          unitTests: { passed: 142, failed: 0 },
          integrationTests: { passed: 28, failed: 0 },
          e2eTests: { passed: 12, failed: 3 },
        },
        {}
      );

      // Complex assertions
      const assertions: Assertion[] = [
        {
          type: 'output_contains',
          expected: 'Compiled successfully',
          actual: complexOutput,
        },
        {
          type: 'output_matches',
          expected: /\d+\.\d+s/,
          actual: complexOutput,
        },
        {
          type: 'output_contains',
          expected: 'Unit tests',
          actual: complexOutput,
        },
        {
          type: 'state_equals',
          expected: 5.6,
          actual: snapshot.state.buildTime,
        },
      ];

      const results = await assertionEngine.evaluateAll(assertions);
      const allPassed = results.every(r => r.passed);
      expect(allPassed).toBe(true);

      // Verify we can save and reload
      const filepath = await snapshotManager.save(snapshot);
      const reloaded = await snapshotManager.load(filepath);
      expect(reloaded.state.buildTime).toBe(5.6);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle assertions on empty output', async () => {
      const assertion: Assertion = {
        type: 'output_contains',
        expected: 'test',
        actual: '',
      };

      const result = await assertionEngine.evaluate(assertion);
      expect(result.passed).toBe(false);
    });

    it('should handle comparison of identical snapshots', async () => {
      const snapshot = await snapshotManager.capture('test', 'output', {}, {});
      const filepath = await snapshotManager.save(snapshot);

      const loaded1 = await snapshotManager.load(filepath);
      const loaded2 = await snapshotManager.load(filepath);

      const diff = snapshotDiffer.compare(loaded1, loaded2);
      expect(diff.identical).toBe(true);
      expect(diff.similarity).toBe(1);
    });

    it('should handle very long output gracefully', async () => {
      const longOutput = 'line\n'.repeat(10000);
      const snapshot = await snapshotManager.capture('long-test', longOutput, {}, {});

      const assertion: Assertion = {
        type: 'output_contains',
        expected: 'line',
        actual: longOutput,
      };

      const result = await assertionEngine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });

    it('should validate all components work together', async () => {
      // This test validates the complete integration
      const sessionId = 'full-integration';

      // 1. Create initial successful test snapshot
      const successSnapshot = await snapshotManager.capture(
        sessionId,
        'All tests passed',
        { exitCode: 0 },
        {}
      );
      const successPath = await snapshotManager.save(successSnapshot);

      // 2. Assert success
      const successAssertion: Assertion = {
        type: 'no_errors',
        expected: null,
        actual: successSnapshot.output,
      };
      const successResult = await assertionEngine.evaluate(successAssertion);
      expect(successResult.passed).toBe(true);

      // 3. Create failure snapshot
      const failSnapshot = await snapshotManager.capture(
        sessionId,
        'Error: Tests failed',
        { exitCode: 1 },
        {}
      );
      const failPath = await snapshotManager.save(failSnapshot);

      // 4. Assert failure detected
      const failAssertion: Assertion = {
        type: 'no_errors',
        expected: null,
        actual: failSnapshot.output,
      };
      const failResult = await assertionEngine.evaluate(failAssertion);
      expect(failResult.passed).toBe(false);

      // 5. Compare snapshots
      const s1 = await snapshotManager.load(successPath);
      const s2 = await snapshotManager.load(failPath);
      const diff = snapshotDiffer.compare(s1, s2);
      expect(diff.identical).toBe(false);

      // 6. Cleanup
      const count = await snapshotManager.deleteBySessionId(sessionId);
      expect(count).toBe(2);
    });
  });
});
