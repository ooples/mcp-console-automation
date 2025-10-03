/**
 * SnapshotManager - Capture and store session state snapshots
 * Phase 2: Assertion Framework
 */

import { SessionSnapshot } from '../types/test-framework.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface SnapshotOptions {
  includeMetadata?: boolean;
  computeHash?: boolean;
  pretty?: boolean;
}

export class SnapshotManager {
  private snapshotsDir: string;

  constructor(snapshotsDir?: string) {
    this.snapshotsDir = snapshotsDir || path.join(process.cwd(), 'data', 'snapshots');
    this.ensureSnapshotsDir();
  }

  /**
   * Ensure snapshots directory exists
   */
  private ensureSnapshotsDir(): void {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  /**
   * Capture a snapshot of current session state
   */
  async capture(
    sessionId: string,
    output: string,
    state: any,
    metadata?: Record<string, any>
  ): Promise<SessionSnapshot> {
    const timestamp = Date.now();

    const snapshot: SessionSnapshot = {
      sessionId,
      timestamp,
      output,
      state,
      metadata: metadata || {},
    };

    // Compute hash for integrity verification
    snapshot.hash = this.computeHash(snapshot);

    return snapshot;
  }

  /**
   * Save snapshot to disk
   */
  async save(snapshot: SessionSnapshot, options: SnapshotOptions = {}): Promise<string> {
    const { pretty = true } = options;

    const filename = this.generateFilename(snapshot);
    const filepath = path.join(this.snapshotsDir, filename);

    const content = pretty
      ? JSON.stringify(snapshot, null, 2)
      : JSON.stringify(snapshot);

    await fs.promises.writeFile(filepath, content, 'utf8');

    return filepath;
  }

  /**
   * Load snapshot from disk
   */
  async load(filepath: string): Promise<SessionSnapshot> {
    const content = await fs.promises.readFile(filepath, 'utf8');
    const snapshot = JSON.parse(content) as SessionSnapshot;

    // Verify hash if present
    if (snapshot.hash) {
      const computedHash = this.computeHash(snapshot);
      if (computedHash !== snapshot.hash) {
        throw new Error('Snapshot hash mismatch - file may be corrupted');
      }
    }

    return snapshot;
  }

  /**
   * Load snapshot by session ID and timestamp
   */
  async loadBySessionId(sessionId: string, timestamp?: number): Promise<SessionSnapshot> {
    const snapshots = await this.listSnapshots(sessionId);

    if (snapshots.length === 0) {
      throw new Error(`No snapshots found for session: ${sessionId}`);
    }

    if (timestamp === undefined) {
      // Return most recent snapshot
      return this.load(snapshots[0]);
    }

    // Find snapshot with matching timestamp
    for (const filepath of snapshots) {
      const snapshot = await this.load(filepath);
      if (snapshot.timestamp === timestamp) {
        return snapshot;
      }
    }

    throw new Error(`No snapshot found for session ${sessionId} at timestamp ${timestamp}`);
  }

  /**
   * List all snapshot files
   */
  async listSnapshots(sessionId?: string): Promise<string[]> {
    const files = await fs.promises.readdir(this.snapshotsDir);

    const snapshotFiles = files
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(this.snapshotsDir, f));

    if (!sessionId) {
      // Sort by modification time (newest first)
      const withStats = await Promise.all(
        snapshotFiles.map(async f => ({
          file: f,
          mtime: (await fs.promises.stat(f)).mtime.getTime(),
        }))
      );
      return withStats.sort((a, b) => b.mtime - a.mtime).map(s => s.file);
    }

    // Filter by session ID
    const filtered: string[] = [];
    for (const filepath of snapshotFiles) {
      try {
        const snapshot = await this.load(filepath);
        if (snapshot.sessionId === sessionId) {
          filtered.push(filepath);
        }
      } catch (error) {
        // Skip corrupted files
        continue;
      }
    }

    // Sort by timestamp (newest first)
    const withTimestamps = await Promise.all(
      filtered.map(async f => {
        const snapshot = await this.load(f);
        return { file: f, timestamp: snapshot.timestamp };
      })
    );

    return withTimestamps.sort((a, b) => b.timestamp - a.timestamp).map(s => s.file);
  }

  /**
   * Delete a snapshot
   */
  async delete(filepath: string): Promise<void> {
    await fs.promises.unlink(filepath);
  }

  /**
   * Delete all snapshots for a session
   */
  async deleteBySessionId(sessionId: string): Promise<number> {
    const snapshots = await this.listSnapshots(sessionId);
    await Promise.all(snapshots.map(s => this.delete(s)));
    return snapshots.length;
  }

  /**
   * Delete all snapshots
   */
  async deleteAll(): Promise<number> {
    const snapshots = await this.listSnapshots();
    await Promise.all(snapshots.map(s => this.delete(s)));
    return snapshots.length;
  }

  /**
   * Get snapshot statistics
   */
  async getStats(): Promise<{
    totalSnapshots: number;
    totalSize: number;
    sessions: number;
    oldestTimestamp?: number;
    newestTimestamp?: number;
  }> {
    const snapshots = await this.listSnapshots();

    if (snapshots.length === 0) {
      return {
        totalSnapshots: 0,
        totalSize: 0,
        sessions: 0,
      };
    }

    let totalSize = 0;
    const sessionIds = new Set<string>();
    let oldestTimestamp = Infinity;
    let newestTimestamp = -Infinity;

    for (const filepath of snapshots) {
      const stats = await fs.promises.stat(filepath);
      totalSize += stats.size;

      try {
        const snapshot = await this.load(filepath);
        sessionIds.add(snapshot.sessionId);
        oldestTimestamp = Math.min(oldestTimestamp, snapshot.timestamp);
        newestTimestamp = Math.max(newestTimestamp, snapshot.timestamp);
      } catch (error) {
        // Skip corrupted files
        continue;
      }
    }

    return {
      totalSnapshots: snapshots.length,
      totalSize,
      sessions: sessionIds.size,
      oldestTimestamp: oldestTimestamp === Infinity ? undefined : oldestTimestamp,
      newestTimestamp: newestTimestamp === -Infinity ? undefined : newestTimestamp,
    };
  }

  /**
   * Clean up old snapshots (keep only N most recent per session)
   */
  async cleanup(keepPerSession: number = 10): Promise<number> {
    const snapshots = await this.listSnapshots();
    const sessionMap = new Map<string, string[]>();

    // Group by session ID
    for (const filepath of snapshots) {
      try {
        const snapshot = await this.load(filepath);
        const existing = sessionMap.get(snapshot.sessionId) || [];
        existing.push(filepath);
        sessionMap.set(snapshot.sessionId, existing);
      } catch (error) {
        // Skip corrupted files
        continue;
      }
    }

    let deletedCount = 0;

    // Delete old snapshots for each session
    for (const [sessionId, files] of sessionMap.entries()) {
      // Sort by timestamp (newest first)
      const sorted = await Promise.all(
        files.map(async f => {
          const snapshot = await this.load(f);
          return { file: f, timestamp: snapshot.timestamp };
        })
      );
      sorted.sort((a, b) => b.timestamp - a.timestamp);

      // Delete old snapshots
      const toDelete = sorted.slice(keepPerSession);
      for (const { file } of toDelete) {
        await this.delete(file);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Generate filename for snapshot
   */
  private generateFilename(snapshot: SessionSnapshot): string {
    const sanitizedSessionId = snapshot.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${sanitizedSessionId}-${snapshot.timestamp}.json`;
  }

  /**
   * Compute hash of snapshot for integrity verification
   */
  private computeHash(snapshot: SessionSnapshot): string {
    // Create a copy without the hash field
    const { hash, ...data } = snapshot;

    const content = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Export snapshot to different format
   */
  async export(snapshot: SessionSnapshot, format: 'json' | 'yaml' | 'text'): Promise<string> {
    switch (format) {
      case 'json':
        return JSON.stringify(snapshot, null, 2);

      case 'yaml':
        // Simple YAML-like format
        return this.toYAML(snapshot);

      case 'text':
        return this.toText(snapshot);

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Convert snapshot to YAML-like format
   */
  private toYAML(snapshot: SessionSnapshot): string {
    const lines: string[] = [];
    lines.push('---');
    lines.push(`sessionId: ${snapshot.sessionId}`);
    lines.push(`timestamp: ${snapshot.timestamp}`);
    lines.push(`hash: ${snapshot.hash}`);
    lines.push('output: |');
    snapshot.output.split('\n').forEach(line => {
      lines.push(`  ${line}`);
    });
    lines.push('state:');
    lines.push(this.objectToYAML(snapshot.state, 2));
    lines.push('metadata:');
    lines.push(this.objectToYAML(snapshot.metadata, 2));
    return lines.join('\n');
  }

  /**
   * Convert object to YAML-like format with indentation
   */
  private objectToYAML(obj: any, indent: number): string {
    const spaces = ' '.repeat(indent);
    const lines: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`${spaces}${key}:`);
        lines.push(this.objectToYAML(value, indent + 2));
      } else {
        lines.push(`${spaces}${key}: ${JSON.stringify(value)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Convert snapshot to human-readable text
   */
  private toText(snapshot: SessionSnapshot): string {
    const lines: string[] = [];
    lines.push('=== Session Snapshot ===');
    lines.push(`Session ID: ${snapshot.sessionId}`);
    lines.push(`Timestamp: ${new Date(snapshot.timestamp).toISOString()}`);
    lines.push(`Hash: ${snapshot.hash}`);
    lines.push('');
    lines.push('--- Output ---');
    lines.push(snapshot.output);
    lines.push('');
    lines.push('--- State ---');
    lines.push(JSON.stringify(snapshot.state, null, 2));
    lines.push('');
    lines.push('--- Metadata ---');
    lines.push(JSON.stringify(snapshot.metadata, null, 2));
    return lines.join('\n');
  }
}
