import { EventEmitter } from 'events';
import { SSHAdapter } from '../../src/core/SSHAdapter.js';
import { WindowsSSHAdapter } from '../../src/core/WindowsSSHAdapter.js';

/**
 * Regression tests for "a denied sudo kills a healthy session".
 *
 * The stderr handlers are attached once and outlive the handshake. Before this fix they classified stderr as a
 * verdict for the whole life of the process, so anything the REMOTE COMMAND printed was judged as if it were
 * the SSH transport speaking. `Permission denied` is the sharp case: it is both a genuine authentication
 * failure during connection AND completely ordinary output from a denied `sudo`, an unreadable file, or a
 * restricted directory. After the session was up, that ordinary output emitted a false `error` — and in
 * SSHAdapter a false `auth-failed` as well — for a connection that was perfectly healthy.
 *
 * The rule these tests pin: stderr is a verdict only while connecting, and diagnostic output afterwards.
 */

/** Minimal stand-in for the spawned ssh process: only the streams the handlers subscribe to. */
function createFakeProcess(): any {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: jest.fn(), end: jest.fn() };
  proc.killed = false;
  proc.kill = jest.fn();
  return proc;
}

describe('SSH stderr is a verdict only while connecting', () => {
  describe('SSHAdapter', () => {
    let adapter: SSHAdapter;
    let proc: any;
    let errors: string[];
    let authFailures: number;

    beforeEach(() => {
      adapter = new SSHAdapter('test-session');
      proc = createFakeProcess();
      (adapter as any).process = proc;

      errors = [];
      authFailures = 0;
      // The adapter installs its own default 'error' listener, so these are additional observers.
      adapter.on('error', (message: string) => errors.push(String(message)));
      adapter.on('auth-failed', () => {
        authFailures++;
      });

      (adapter as any).setupHandlers();
    });

    it('treats a real authentication failure during connection as fatal', () => {
      (adapter as any).isConnected = false;

      proc.stderr.emit('data', Buffer.from('Permission denied (publickey,password).\n'));

      expect(errors.some((e) => e.includes('Permission denied'))).toBe(true);
      expect(authFailures).toBe(1);
    });

    it('does not treat a remote command’s "Permission denied" as a connection failure', () => {
      (adapter as any).isConnected = true;

      proc.stderr.emit('data', Buffer.from('sudo: a password is required\nPermission denied\n'));

      expect(errors).toEqual([]);
      expect(authFailures).toBe(0);
    });

    it('still surfaces post-connection stderr as diagnostic output', () => {
      (adapter as any).isConnected = true;
      const seen: string[] = [];
      adapter.on('stderr', (chunk: string) => seen.push(chunk));

      proc.stderr.emit('data', Buffer.from('cat: /etc/shadow: Permission denied\n'));

      expect(seen.join('')).toContain('Permission denied');
      expect(errors).toEqual([]);
    });

    it('does not emit connection-refused for remote output after connecting', () => {
      (adapter as any).isConnected = true;
      let refused = 0;
      adapter.on('connection-refused', () => {
        refused++;
      });

      proc.stderr.emit('data', Buffer.from('curl: (7) Connection refused\n'));

      expect(refused).toBe(0);
      expect(errors).toEqual([]);
    });
  });

  describe('WindowsSSHAdapter', () => {
    let adapter: WindowsSSHAdapter;
    let proc: any;
    let errors: string[];

    beforeEach(() => {
      adapter = new WindowsSSHAdapter('test-session');
      proc = createFakeProcess();
      (adapter as any).process = proc;

      errors = [];
      adapter.on('error', (message: string) => errors.push(String(message)));

      (adapter as any).setupHandlers();
    });

    it('treats a real authentication failure during connection as fatal', () => {
      (adapter as any).isConnected = false;

      proc.stderr.emit('data', Buffer.from('Permission denied (publickey).\n'));

      expect(errors.some((e) => e.includes('Permission denied'))).toBe(true);
    });

    it('does not treat a remote command’s "Permission denied" as a connection failure', () => {
      (adapter as any).isConnected = true;

      proc.stderr.emit('data', Buffer.from('rm: cannot remove ‘/root/x’: Permission denied\n'));

      expect(errors).toEqual([]);
    });
  });

  /**
   * `connect()` falls back plink -> PowerShell -> ssh, and the plink path alone tries several executables, so
   * one connect can spawn several children. Classification runs against the ACCUMULATED buffer, so without a
   * reset the next attempt's first harmless chunk re-matched the previous attempt's fatal text and rejected a
   * healthy connection — reporting the wrong mechanism's error while doing so.
   */
  describe('WindowsSSHAdapter discards a failed attempt before the next', () => {
    it('does not carry a failed attempt’s fatal stderr into the next attempt', () => {
      const adapter = new WindowsSSHAdapter('test-session');
      const errors: string[] = [];
      adapter.on('error', (message: string) => errors.push(String(message)));

      const first = createFakeProcess();
      (adapter as any).process = first;
      (adapter as any).isConnected = false;
      (adapter as any).setupHandlers();

      first.stderr.emit('data', Buffer.from('Permission denied (publickey).\n'));
      expect(errors).toHaveLength(1);

      // plink failed; connect() falls back to the next mechanism.
      (adapter as any).beginConnectionAttempt();
      const second = createFakeProcess();
      (adapter as any).process = second;
      (adapter as any).setupHandlers();

      // Routine chatter on a healthy attempt must not inherit the previous verdict.
      second.stderr.emit(
        'data',
        Buffer.from("Warning: Permanently added 'host' (ED25519) to the list of known hosts.\n"),
      );

      expect(errors).toHaveLength(1);
    });

    it('kills and detaches the abandoned child', () => {
      const adapter = new WindowsSSHAdapter('test-session');
      const first = createFakeProcess();
      (adapter as any).process = first;
      (adapter as any).setupHandlers();

      (adapter as any).beginConnectionAttempt();

      expect(first.kill).toHaveBeenCalled();
      expect(first.stderr.listenerCount('data')).toBe(0);
      expect(first.stdout.listenerCount('data')).toBe(0);
    });
  });
});
