/**
 * SnapshotDiffer - Compare snapshots and compute differences
 * Phase 2: Assertion Framework
 */

import { SessionSnapshot, SnapshotDiff } from '../types/test-framework.js';

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
  contextLines?: number;
  maxDiffLines?: number;
}

export interface DetailedDiff {
  added: string[];
  removed: string[];
  changed: string[];
  identical: boolean;
  similarity: number;
  outputDiff: LineDiff[];
  stateDiff: ObjectDiff;
}

export interface LineDiff {
  type: 'added' | 'removed' | 'unchanged' | 'modified';
  lineNumber: number;
  content: string;
  oldContent?: string;
}

export interface ObjectDiff {
  added: string[];
  removed: string[];
  modified: Array<{ key: string; oldValue: any; newValue: any }>;
}

export class SnapshotDiffer {
  /**
   * Compare two snapshots and return basic diff
   */
  compare(snapshot1: SessionSnapshot, snapshot2: SessionSnapshot): SnapshotDiff {
    const outputDiff = this.compareOutput(snapshot1.output, snapshot2.output);
    const stateDiff = this.compareState(snapshot1.state, snapshot2.state);

    const added = [
      ...outputDiff.filter(d => d.type === 'added').map(d => d.content),
      ...stateDiff.added,
    ];

    const removed = [
      ...outputDiff.filter(d => d.type === 'removed').map(d => d.content),
      ...stateDiff.removed,
    ];

    const changed = stateDiff.modified.map(
      m => `${m.key}: ${JSON.stringify(m.oldValue)} -> ${JSON.stringify(m.newValue)}`
    );

    const identical = added.length === 0 && removed.length === 0 && changed.length === 0;
    const similarity = this.calculateSimilarity(snapshot1, snapshot2);

    return {
      added,
      removed,
      changed,
      identical,
      similarity,
    };
  }

  /**
   * Get detailed comparison with line-by-line diff
   */
  compareDetailed(
    snapshot1: SessionSnapshot,
    snapshot2: SessionSnapshot,
    options: DiffOptions = {}
  ): DetailedDiff {
    const outputDiff = this.compareOutput(snapshot1.output, snapshot2.output, options);
    const stateDiff = this.compareState(snapshot1.state, snapshot2.state);

    const added = [
      ...outputDiff.filter(d => d.type === 'added').map(d => d.content),
      ...stateDiff.added,
    ];

    const removed = [
      ...outputDiff.filter(d => d.type === 'removed').map(d => d.content),
      ...stateDiff.removed,
    ];

    const changed = stateDiff.modified.map(
      m => `${m.key}: ${JSON.stringify(m.oldValue)} -> ${JSON.stringify(m.newValue)}`
    );

    const identical = added.length === 0 && removed.length === 0 && changed.length === 0;
    const similarity = this.calculateSimilarity(snapshot1, snapshot2);

    return {
      added,
      removed,
      changed,
      identical,
      similarity,
      outputDiff,
      stateDiff,
    };
  }

  /**
   * Compare output strings line by line
   */
  private compareOutput(output1: string, output2: string, options: DiffOptions = {}): LineDiff[] {
    const { ignoreWhitespace = false, ignoreCase = false } = options;

    const lines1 = this.normalizeLines(output1, ignoreWhitespace, ignoreCase);
    const lines2 = this.normalizeLines(output2, ignoreWhitespace, ignoreCase);

    return this.computeLineDiff(lines1, lines2);
  }

  /**
   * Normalize lines for comparison
   */
  private normalizeLines(text: string, ignoreWhitespace: boolean, ignoreCase: boolean): string[] {
    let lines = text.split('\n');

    if (ignoreWhitespace) {
      lines = lines.map(line => line.trim());
    }

    if (ignoreCase) {
      lines = lines.map(line => line.toLowerCase());
    }

    return lines;
  }

  /**
   * Compute line-by-line diff using LCS algorithm
   */
  private computeLineDiff(lines1: string[], lines2: string[]): LineDiff[] {
    const lcs = this.longestCommonSubsequence(lines1, lines2);
    const diff: LineDiff[] = [];

    let i = 0;
    let j = 0;
    let lineNumber = 1;

    while (i < lines1.length || j < lines2.length) {
      if (i < lines1.length && j < lines2.length && lines1[i] === lines2[j]) {
        // Lines are identical
        diff.push({
          type: 'unchanged',
          lineNumber: lineNumber++,
          content: lines1[i],
        });
        i++;
        j++;
      } else if (j >= lines2.length || (i < lines1.length && !lcs.includes(lines1[i]))) {
        // Line removed
        diff.push({
          type: 'removed',
          lineNumber: lineNumber++,
          content: lines1[i],
        });
        i++;
      } else {
        // Line added
        diff.push({
          type: 'added',
          lineNumber: lineNumber++,
          content: lines2[j],
        });
        j++;
      }
    }

    return diff;
  }

  /**
   * Longest Common Subsequence algorithm
   */
  private longestCommonSubsequence(arr1: string[], arr2: string[]): string[] {
    const m = arr1.length;
    const n = arr2.length;
    const dp: number[][] = Array(m + 1)
      .fill(0)
      .map(() => Array(n + 1).fill(0));

    // Build LCS table
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (arr1[i - 1] === arr2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find LCS
    const lcs: string[] = [];
    let i = m;
    let j = n;

    while (i > 0 && j > 0) {
      if (arr1[i - 1] === arr2[j - 1]) {
        lcs.unshift(arr1[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  /**
   * Compare state objects
   */
  private compareState(state1: any, state2: any): ObjectDiff {
    const added: string[] = [];
    const removed: string[] = [];
    const modified: Array<{ key: string; oldValue: any; newValue: any }> = [];

    const keys1 = this.getAllKeys(state1);
    const keys2 = this.getAllKeys(state2);

    // Find added and modified keys
    for (const key of keys2) {
      const value1 = this.getNestedValue(state1, key);
      const value2 = this.getNestedValue(state2, key);

      if (!keys1.includes(key)) {
        added.push(key);
      } else if (!this.deepEqual(value1, value2)) {
        modified.push({ key, oldValue: value1, newValue: value2 });
      }
    }

    // Find removed keys
    for (const key of keys1) {
      if (!keys2.includes(key)) {
        removed.push(key);
      }
    }

    return { added, removed, modified };
  }

  /**
   * Get all nested keys from object (dot notation)
   */
  private getAllKeys(obj: any, prefix: string = ''): string[] {
    if (typeof obj !== 'object' || obj === null) {
      return [];
    }

    const keys: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      keys.push(fullKey);

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        keys.push(...this.getAllKeys(value, fullKey));
      }
    }

    return keys;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, key: string): any {
    const keys = key.split('.');
    let value = obj;

    for (const k of keys) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[k];
    }

    return value;
  }

  /**
   * Deep equality check
   */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, idx) => this.deepEqual(val, b[idx]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      return keysA.every(key => this.deepEqual(a[key], b[key]));
    }

    return false;
  }

  /**
   * Calculate similarity percentage between snapshots
   */
  calculateSimilarity(snapshot1: SessionSnapshot, snapshot2: SessionSnapshot): number {
    const output1Lines = snapshot1.output.split('\n');
    const output2Lines = snapshot2.output.split('\n');

    // Calculate output similarity using LCS
    const lcs = this.longestCommonSubsequence(output1Lines, output2Lines);
    const maxLines = Math.max(output1Lines.length, output2Lines.length);
    const outputSimilarity = maxLines === 0 ? 1 : lcs.length / maxLines;

    // Calculate state similarity
    const stateDiff = this.compareState(snapshot1.state, snapshot2.state);
    const totalStateKeys = this.getAllKeys(snapshot1.state).length + this.getAllKeys(snapshot2.state).length;
    const changedStateKeys = stateDiff.added.length + stateDiff.removed.length + stateDiff.modified.length;
    const stateSimilarity = totalStateKeys === 0 ? 1 : 1 - changedStateKeys / totalStateKeys;

    // Weighted average (70% output, 30% state)
    return outputSimilarity * 0.7 + stateSimilarity * 0.3;
  }

  /**
   * Format diff for display
   */
  formatDiff(diff: DetailedDiff, options: { colors?: boolean; context?: number } = {}): string {
    const { colors = false, context = 3 } = options;
    const lines: string[] = [];

    lines.push('=== Snapshot Diff ===');
    lines.push(`Similarity: ${(diff.similarity * 100).toFixed(2)}%`);
    lines.push('');

    if (diff.identical) {
      lines.push('Snapshots are identical');
      return lines.join('\n');
    }

    // Output diff
    if (diff.outputDiff.length > 0) {
      lines.push('--- Output Diff ---');

      let lastShownLine = -1;
      for (let i = 0; i < diff.outputDiff.length; i++) {
        const lineDiff = diff.outputDiff[i];

        if (lineDiff.type === 'unchanged') {
          // Show context lines
          if (i > 0 && diff.outputDiff[i - 1].type !== 'unchanged' && i - lastShownLine <= context) {
            lines.push(`  ${lineDiff.content}`);
            lastShownLine = i;
          } else if (i < diff.outputDiff.length - 1 && diff.outputDiff[i + 1].type !== 'unchanged') {
            lines.push(`  ${lineDiff.content}`);
            lastShownLine = i;
          }
        } else {
          const prefix = lineDiff.type === 'added' ? '+ ' : '- ';
          const line = colors ? this.colorize(prefix + lineDiff.content, lineDiff.type) : prefix + lineDiff.content;
          lines.push(line);
          lastShownLine = i;
        }
      }

      lines.push('');
    }

    // State diff
    if (diff.stateDiff.added.length > 0 || diff.stateDiff.removed.length > 0 || diff.stateDiff.modified.length > 0) {
      lines.push('--- State Diff ---');

      if (diff.stateDiff.added.length > 0) {
        lines.push('Added:');
        diff.stateDiff.added.forEach(key => {
          const line = `  + ${key}`;
          lines.push(colors ? this.colorize(line, 'added') : line);
        });
      }

      if (diff.stateDiff.removed.length > 0) {
        lines.push('Removed:');
        diff.stateDiff.removed.forEach(key => {
          const line = `  - ${key}`;
          lines.push(colors ? this.colorize(line, 'removed') : line);
        });
      }

      if (diff.stateDiff.modified.length > 0) {
        lines.push('Modified:');
        diff.stateDiff.modified.forEach(({ key, oldValue, newValue }) => {
          lines.push(`  ~ ${key}:`);
          lines.push(`      - ${JSON.stringify(oldValue)}`);
          lines.push(`      + ${JSON.stringify(newValue)}`);
        });
      }
    }

    return lines.join('\n');
  }

  /**
   * Colorize text for terminal output
   */
  private colorize(text: string, type: 'added' | 'removed' | 'unchanged' | 'modified'): string {
    const colors = {
      added: '\x1b[32m',
      removed: '\x1b[31m',
      unchanged: '\x1b[0m',
      modified: '\x1b[33m',
    };
    const reset = '\x1b[0m';
    return `${colors[type]}${text}${reset}`;
  }

  /**
   * Get summary statistics
   */
  getSummary(diff: DetailedDiff): {
    linesAdded: number;
    linesRemoved: number;
    linesChanged: number;
    stateKeysAdded: number;
    stateKeysRemoved: number;
    stateKeysModified: number;
  } {
    return {
      linesAdded: diff.outputDiff.filter(d => d.type === 'added').length,
      linesRemoved: diff.outputDiff.filter(d => d.type === 'removed').length,
      linesChanged: diff.outputDiff.filter(d => d.type === 'modified').length,
      stateKeysAdded: diff.stateDiff.added.length,
      stateKeysRemoved: diff.stateDiff.removed.length,
      stateKeysModified: diff.stateDiff.modified.length,
    };
  }
}
