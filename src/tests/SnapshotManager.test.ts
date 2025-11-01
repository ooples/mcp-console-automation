/**
 * SnapshotManager Test Suite
 * Tests snapshot capture, storage, and management
 */

import { SnapshotManager } from '../testing/SnapshotManager.js';
import { SessionSnapshot } from '../types/test-framework.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SnapshotManager', () => {
  let manager: SnapshotManager;
  let testDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `snapshot-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    manager = new SnapshotManager(testDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('capture', () => {
    it('should capture snapshot with all data', async () => {
      const snapshot = await manager.capture(
        'test-session',
        'test output',
        { status: 'success' },
        { author: 'test' }
      );

      expect(snapshot.sessionId).toBe('test-session');
      expect(snapshot.output).toBe('test output');
      expect(snapshot.state).toEqual({ status: 'success' });
      expect(snapshot.metadata.author).toBe('test');
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.hash).toBeDefined();
    });

    it('should generate hash for integrity', async () => {
      const snapshot = await manager.capture('test-session', 'output', {}, {});
      expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('save and load', () => {
    it('should save snapshot to disk', async () => {
      const snapshot = await manager.capture('test-session', 'output', {}, {});
      const filepath = await manager.save(snapshot);

      expect(fs.existsSync(filepath)).toBe(true);
      expect(filepath).toContain('test-session');
    });

    it('should load snapshot from disk', async () => {
      const original = await manager.capture(
        'test-session',
        'test output',
        { value: 123 },
        {}
      );
      const filepath = await manager.save(original);

      const loaded = await manager.load(filepath);

      expect(loaded.sessionId).toBe(original.sessionId);
      expect(loaded.output).toBe(original.output);
      expect(loaded.state).toEqual(original.state);
      expect(loaded.hash).toBe(original.hash);
    });

    it('should verify hash on load', async () => {
      const snapshot = await manager.capture('test-session', 'output', {}, {});
      const filepath = await manager.save(snapshot);

      // Corrupt the file
      const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      content.output = 'corrupted';
      fs.writeFileSync(filepath, JSON.stringify(content));

      await expect(manager.load(filepath)).rejects.toThrow('hash mismatch');
    });

    it('should save with pretty formatting', async () => {
      const snapshot = await manager.capture('test-session', 'output', {}, {});
      const filepath = await manager.save(snapshot, { pretty: true });

      const content = fs.readFileSync(filepath, 'utf8');
      expect(content).toContain('\n');
      expect(content).toContain('  ');
    });

    it('should save without pretty formatting', async () => {
      const snapshot = await manager.capture('test-session', 'output', {}, {});
      const filepath = await manager.save(snapshot, { pretty: false });

      const content = fs.readFileSync(filepath, 'utf8');
      expect(content).not.toContain('\n  ');
    });
  });

  describe('loadBySessionId', () => {
    it('should load most recent snapshot by session ID', async () => {
      const snap1 = await manager.capture('test-session', 'output 1', {}, {});
      await manager.save(snap1);

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const snap2 = await manager.capture('test-session', 'output 2', {}, {});
      await manager.save(snap2);

      const loaded = await manager.loadBySessionId('test-session');
      expect(loaded.output).toBe('output 2');
    });

    it('should load snapshot by session ID and timestamp', async () => {
      const snap1 = await manager.capture('test-session', 'output 1', {}, {});
      await manager.save(snap1);

      const snap2 = await manager.capture('test-session', 'output 2', {}, {});
      await manager.save(snap2);

      const loaded = await manager.loadBySessionId(
        'test-session',
        snap1.timestamp
      );
      expect(loaded.output).toBe('output 1');
    });

    it('should throw if session not found', async () => {
      await expect(manager.loadBySessionId('nonexistent')).rejects.toThrow(
        'No snapshots found'
      );
    });
  });

  describe('listSnapshots', () => {
    it('should list all snapshots', async () => {
      const snap1 = await manager.capture('session1', 'output', {}, {});
      const snap2 = await manager.capture('session2', 'output', {}, {});
      await manager.save(snap1);
      await manager.save(snap2);

      const snapshots = await manager.listSnapshots();
      expect(snapshots.length).toBe(2);
    });

    it('should filter by session ID', async () => {
      const snap1 = await manager.capture('session1', 'output', {}, {});
      await new Promise((resolve) => setTimeout(resolve, 2)); // Ensure unique timestamp
      const snap2 = await manager.capture('session2', 'output', {}, {});
      await new Promise((resolve) => setTimeout(resolve, 2)); // Ensure unique timestamp
      const snap3 = await manager.capture('session1', 'output2', {}, {});
      await manager.save(snap1);
      await manager.save(snap2);
      await manager.save(snap3);

      const snapshots = await manager.listSnapshots('session1');
      expect(snapshots.length).toBe(2);
    });

    it('should return empty array when no snapshots exist', async () => {
      const snapshots = await manager.listSnapshots();
      expect(snapshots).toEqual([]);
    });
  });

  describe('delete operations', () => {
    it('should delete a snapshot', async () => {
      const snapshot = await manager.capture('test-session', 'output', {}, {});
      const filepath = await manager.save(snapshot);

      await manager.delete(filepath);
      expect(fs.existsSync(filepath)).toBe(false);
    });

    it('should delete all snapshots for a session', async () => {
      const snap1 = await manager.capture('session1', 'output1', {}, {});
      await new Promise((resolve) => setTimeout(resolve, 2)); // Ensure unique timestamp
      const snap2 = await manager.capture('session1', 'output2', {}, {});
      await new Promise((resolve) => setTimeout(resolve, 2)); // Ensure unique timestamp
      const snap3 = await manager.capture('session2', 'output3', {}, {});
      await manager.save(snap1);
      await manager.save(snap2);
      await manager.save(snap3);

      const count = await manager.deleteBySessionId('session1');
      expect(count).toBe(2);

      const remaining = await manager.listSnapshots();
      expect(remaining.length).toBe(1);
    });

    it('should delete all snapshots', async () => {
      const snap1 = await manager.capture('session1', 'output', {}, {});
      const snap2 = await manager.capture('session2', 'output', {}, {});
      await manager.save(snap1);
      await manager.save(snap2);

      const count = await manager.deleteAll();
      expect(count).toBe(2);

      const remaining = await manager.listSnapshots();
      expect(remaining).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      const snap1 = await manager.capture('session1', 'output', {}, {});
      const snap2 = await manager.capture('session2', 'output', {}, {});
      await manager.save(snap1);
      await manager.save(snap2);

      const stats = await manager.getStats();
      expect(stats.totalSnapshots).toBe(2);
      expect(stats.sessions).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.oldestTimestamp).toBeDefined();
      expect(stats.newestTimestamp).toBeDefined();
    });

    it('should return zero stats when no snapshots', async () => {
      const stats = await manager.getStats();
      expect(stats.totalSnapshots).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.sessions).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should keep only N most recent snapshots per session', async () => {
      // Create 5 snapshots for same session
      for (let i = 0; i < 5; i++) {
        const snap = await manager.capture('session1', `output ${i}`, {}, {});
        await manager.save(snap);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const deleted = await manager.cleanup(3);
      expect(deleted).toBe(2);

      const remaining = await manager.listSnapshots('session1');
      expect(remaining.length).toBe(3);
    });

    it('should handle multiple sessions independently', async () => {
      // Create snapshots for two sessions
      for (let i = 0; i < 3; i++) {
        const snap1 = await manager.capture('session1', `output ${i}`, {}, {});
        const snap2 = await manager.capture('session2', `output ${i}`, {}, {});
        await manager.save(snap1);
        await manager.save(snap2);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await manager.cleanup(2);

      const s1 = await manager.listSnapshots('session1');
      const s2 = await manager.listSnapshots('session2');
      expect(s1.length).toBe(2);
      expect(s2.length).toBe(2);
    });
  });

  describe('export', () => {
    it('should export as JSON', async () => {
      const snapshot = await manager.capture(
        'test-session',
        'output',
        { value: 123 },
        {}
      );
      const exported = await manager.export(snapshot, 'json');

      expect(exported).toContain('"sessionId"');
      expect(exported).toContain('"output"');
      const parsed = JSON.parse(exported);
      expect(parsed.sessionId).toBe('test-session');
    });

    it('should export as YAML', async () => {
      const snapshot = await manager.capture(
        'test-session',
        'output',
        { value: 123 },
        {}
      );
      const exported = await manager.export(snapshot, 'yaml');

      expect(exported).toContain('sessionId: test-session');
      expect(exported).toContain('output: |');
    });

    it('should export as text', async () => {
      const snapshot = await manager.capture(
        'test-session',
        'output',
        { value: 123 },
        {}
      );
      const exported = await manager.export(snapshot, 'text');

      expect(exported).toContain('=== Session Snapshot ===');
      expect(exported).toContain('Session ID: test-session');
      expect(exported).toContain('--- Output ---');
    });

    it('should throw for unsupported format', async () => {
      const snapshot = await manager.capture('test-session', 'output', {}, {});
      await expect(manager.export(snapshot, 'xml' as any)).rejects.toThrow(
        'Unsupported'
      );
    });
  });
});
