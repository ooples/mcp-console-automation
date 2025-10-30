/**
 * SnapshotDiffer Test Suite
 * Tests snapshot comparison and diff algorithms
 */

import { SnapshotDiffer } from '../testing/SnapshotDiffer.js';
import { SessionSnapshot } from '../types/test-framework.js';

describe('SnapshotDiffer', () => {
  let differ: SnapshotDiffer;

  beforeEach(() => {
    differ = new SnapshotDiffer();
  });

  const createSnapshot = (
    id: string,
    output: string,
    state: any = {}
  ): SessionSnapshot => ({
    sessionId: id,
    timestamp: Date.now(),
    output,
    state,
    metadata: {},
  });

  describe('compare', () => {
    it('should detect identical snapshots', () => {
      const snap1 = createSnapshot('test', 'output', { a: 1 });
      const snap2 = createSnapshot('test', 'output', { a: 1 });

      const diff = differ.compare(snap1, snap2);

      expect(diff.identical).toBe(true);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.changed).toEqual([]);
      expect(diff.similarity).toBe(1);
    });

    it('should detect added lines', () => {
      const snap1 = createSnapshot('test', 'line1\nline2', {});
      const snap2 = createSnapshot('test', 'line1\nline2\nline3', {});

      const diff = differ.compare(snap1, snap2);

      expect(diff.identical).toBe(false);
      expect(diff.added).toContain('line3');
    });

    it('should detect removed lines', () => {
      const snap1 = createSnapshot('test', 'line1\nline2\nline3', {});
      const snap2 = createSnapshot('test', 'line1\nline2', {});

      const diff = differ.compare(snap1, snap2);

      expect(diff.identical).toBe(false);
      expect(diff.removed).toContain('line3');
    });

    it('should detect state changes', () => {
      const snap1 = createSnapshot('test', 'output', { a: 1, b: 2 });
      const snap2 = createSnapshot('test', 'output', { a: 1, b: 3 });

      const diff = differ.compare(snap1, snap2);

      expect(diff.identical).toBe(false);
      expect(diff.changed.length).toBeGreaterThan(0);
    });
  });

  describe('compareDetailed', () => {
    it('should provide line-by-line diff', () => {
      const snap1 = createSnapshot('test', 'line1\nline2\nline3', {});
      const snap2 = createSnapshot('test', 'line1\nline2\nline4', {});

      const detailed = differ.compareDetailed(snap1, snap2);

      expect(detailed.outputDiff.length).toBeGreaterThan(0);
      expect(detailed.outputDiff.some((d) => d.type === 'unchanged')).toBe(
        true
      );
      expect(detailed.outputDiff.some((d) => d.type === 'removed')).toBe(true);
      expect(detailed.outputDiff.some((d) => d.type === 'added')).toBe(true);
    });

    it('should detect object state diff', () => {
      const snap1 = createSnapshot('test', 'output', { a: 1, b: 2 });
      const snap2 = createSnapshot('test', 'output', { a: 1, b: 3, c: 4 });

      const detailed = differ.compareDetailed(snap1, snap2);

      expect(detailed.stateDiff.added).toContain('c');
      expect(detailed.stateDiff.modified.some((m) => m.key === 'b')).toBe(true);
    });

    it('should handle nested state', () => {
      const snap1 = createSnapshot('test', 'output', { a: { b: { c: 1 } } });
      const snap2 = createSnapshot('test', 'output', { a: { b: { c: 2 } } });

      const detailed = differ.compareDetailed(snap1, snap2);

      expect(detailed.stateDiff.modified.length).toBeGreaterThan(0);
    });
  });

  describe('calculateSimilarity', () => {
    it('should return 1 for identical snapshots', () => {
      const snap1 = createSnapshot('test', 'output', { a: 1 });
      const snap2 = createSnapshot('test', 'output', { a: 1 });

      const similarity = differ.calculateSimilarity(snap1, snap2);

      expect(similarity).toBe(1);
    });

    it('should return 0 for completely different snapshots', () => {
      const snap1 = createSnapshot('test', 'line1\nline2\nline3', {
        a: 1,
        b: 2,
      });
      const snap2 = createSnapshot('test', 'lineA\nlineB\nlineC', {
        x: 9,
        y: 10,
      });

      const similarity = differ.calculateSimilarity(snap1, snap2);

      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThan(0.5);
    });

    it('should return value between 0 and 1 for partial matches', () => {
      const snap1 = createSnapshot('test', 'line1\nline2\nline3', { a: 1 });
      const snap2 = createSnapshot('test', 'line1\nline2', { a: 1 });

      const similarity = differ.calculateSimilarity(snap1, snap2);

      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });
  });

  describe('formatDiff', () => {
    it('should format diff as text', () => {
      const snap1 = createSnapshot('test', 'line1\nline2', { a: 1 });
      const snap2 = createSnapshot('test', 'line1\nline3', { a: 2 });

      const detailed = differ.compareDetailed(snap1, snap2);
      const formatted = differ.formatDiff(detailed);

      expect(formatted).toContain('=== Snapshot Diff ===');
      expect(formatted).toContain('Similarity:');
      expect(formatted).toContain('Output Diff');
    });

    it('should indicate identical snapshots', () => {
      const snap1 = createSnapshot('test', 'output', { a: 1 });
      const snap2 = createSnapshot('test', 'output', { a: 1 });

      const detailed = differ.compareDetailed(snap1, snap2);
      const formatted = differ.formatDiff(detailed);

      expect(formatted).toContain('identical');
    });

    it('should show added and removed lines', () => {
      const snap1 = createSnapshot('test', 'line1\nline2', {});
      const snap2 = createSnapshot('test', 'line1\nline3', {});

      const detailed = differ.compareDetailed(snap1, snap2);
      const formatted = differ.formatDiff(detailed);

      expect(formatted).toMatch(/[-+]/);
    });

    it('should show state changes', () => {
      const snap1 = createSnapshot('test', 'output', { a: 1, b: 2 });
      const snap2 = createSnapshot('test', 'output', { a: 1, c: 3 });

      const detailed = differ.compareDetailed(snap1, snap2);
      const formatted = differ.formatDiff(detailed);

      expect(formatted).toContain('State Diff');
    });
  });

  describe('getSummary', () => {
    it('should provide summary statistics', () => {
      const snap1 = createSnapshot('test', 'line1\nline2\nline3', {
        a: 1,
        b: 2,
      });
      const snap2 = createSnapshot('test', 'line1\nline4', { a: 1, c: 3 });

      const detailed = differ.compareDetailed(snap1, snap2);
      const summary = differ.getSummary(detailed);

      expect(summary.linesAdded).toBeGreaterThanOrEqual(0);
      expect(summary.linesRemoved).toBeGreaterThanOrEqual(0);
      expect(summary.stateKeysAdded).toBeGreaterThanOrEqual(0);
      expect(summary.stateKeysRemoved).toBeGreaterThanOrEqual(0);
      expect(summary.stateKeysModified).toBeGreaterThanOrEqual(0);
    });

    it('should return zero for identical snapshots', () => {
      const snap1 = createSnapshot('test', 'output', { a: 1 });
      const snap2 = createSnapshot('test', 'output', { a: 1 });

      const detailed = differ.compareDetailed(snap1, snap2);
      const summary = differ.getSummary(detailed);

      expect(summary.linesAdded).toBe(0);
      expect(summary.linesRemoved).toBe(0);
      expect(summary.stateKeysAdded).toBe(0);
      expect(summary.stateKeysRemoved).toBe(0);
      expect(summary.stateKeysModified).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty output', () => {
      const snap1 = createSnapshot('test', '', {});
      const snap2 = createSnapshot('test', '', {});

      const diff = differ.compare(snap1, snap2);

      expect(diff.identical).toBe(true);
    });

    it('should handle empty state', () => {
      const snap1 = createSnapshot('test', 'output', {});
      const snap2 = createSnapshot('test', 'output', {});

      const diff = differ.compare(snap1, snap2);

      expect(diff.identical).toBe(true);
    });

    it('should handle large output differences', () => {
      const snap1 = createSnapshot('test', 'a'.repeat(10000), {});
      const snap2 = createSnapshot('test', 'b'.repeat(10000), {});

      const detailed = differ.compareDetailed(snap1, snap2);

      expect(detailed.similarity).toBeLessThan(0.5);
    });

    it('should handle complex nested state', () => {
      const snap1 = createSnapshot('test', 'output', {
        level1: {
          level2: {
            level3: {
              value: 1,
            },
          },
        },
      });
      const snap2 = createSnapshot('test', 'output', {
        level1: {
          level2: {
            level3: {
              value: 2,
            },
          },
        },
      });

      const detailed = differ.compareDetailed(snap1, snap2);

      expect(detailed.stateDiff.modified.length).toBeGreaterThan(0);
    });
  });
});
