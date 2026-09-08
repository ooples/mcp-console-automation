import {
  MAX_RETAINED_STDERR,
  appendBoundedStderr,
  describeSshFailure,
  isFatalSshStderr,
} from '../../src/core/SshStderrClassifier.js';

/**
 * Regression tests for "a correctly configured host is unreachable".
 *
 * Both SSH adapters treated every byte on the client's stderr as a fatal error and rejected the pending
 * connection with it. `waitForConnection` rejects on the FIRST such emission — so the first thing SSH said
 * decided the connection's fate, and the first thing SSH says on a new host is:
 *
 *     Warning: Permanently added '203.0.113.10' (ED25519) to the list of known hosts.
 *
 * It prints that whenever `StrictHostKeyChecking=no` is in effect, which is what both adapters set by default
 * (WindowsSSHAdapter also sets `UserKnownHostsFile=/dev/null`, so it prints on *every* connection, not just
 * the first). The result was a 100% failure rate on the standard configuration, reported as the warning text —
 * which reads like a failure, so it sent whoever hit it to their known_hosts file instead of to this code.
 */
describe('SSH stderr is diagnostic unless it says the connection is over', () => {
  describe('routine chatter must not kill a connection', () => {
    // The exact line that caused the outage, as OpenSSH emits it.
    it.each([
      "Warning: Permanently added '203.0.113.10' (ED25519) to the list of known hosts.\r\n",
      "Warning: Permanently added 'ns107444.ip-51-81-109.us' (RSA) to the list of known hosts.\n",
      'Pseudo-terminal will not be allocated because stdin is not a terminal.\n',
      'Authorized uses only. All activity may be monitored and reported.\n',
      'Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-51-generic x86_64)\n',
      'debug1: Reading configuration data /etc/ssh/ssh_config\n',
      '',
    ])('treats %j as diagnostic', (text) => {
      expect(isFatalSshStderr(text)).toBe(false);
    });
  });

  describe('real failures must still be fatal', () => {
    it.each([
      'Permission denied (publickey,password).\n',
      'Received disconnect from 203.0.113.10 port 22:2: Too many authentication failures\n',
      'Host key verification failed.\n',
      '@@@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@@@\n',
      'ssh: connect to host 203.0.113.10 port 22: Connection refused\n',
      'ssh: connect to host 203.0.113.10 port 22: Network is unreachable\n',
      'ssh: Could not resolve hostname nope.invalid: Name or service not known\n',
      'Connection closed by 203.0.113.10 port 22\n',
      'Connection reset by 203.0.113.10 port 22\n',
      'ssh: connect to host 203.0.113.10 port 22: Operation timed out\n',
      'Unable to negotiate with 203.0.113.10 port 22: no matching host key type found.\n',
      'Load key "/home/u/.ssh/id_ed25519": bad permissions\n',
    ])('treats %j as fatal', (text) => {
      expect(isFatalSshStderr(text)).toBe(true);
    });
  });

  it('sees a failure that arrives split across stream chunks', () => {
    // A stream hands out arbitrary slices. Testing each chunk on its own would miss the failure precisely
    // when it matters, so the adapters accumulate and classify the whole buffer.
    const chunks = ['Permission de', 'nied (publickey).\n'];

    expect(chunks.every((chunk) => !isFatalSshStderr(chunk))).toBe(true);
    expect(isFatalSshStderr(chunks.join(''))).toBe(true);
  });

  it('is not fooled by a warning that merely precedes a real failure', () => {
    // The ordering that made the old code look defensible: the warning came first, so it was the warning that
    // got reported and the actual denial never had a say.
    const warning = "Warning: Permanently added '203.0.113.10' (ED25519) to the list of known hosts.\r\n";
    expect(isFatalSshStderr(warning)).toBe(false);
    expect(isFatalSshStderr(warning + 'Permission denied (publickey).\n')).toBe(true);
  });

  describe('an unrecognised failure still gets to explain itself', () => {
    // The classifier is an allowlist of endings, so something novel is not fatal — and would otherwise hang
    // until the connect timeout and be reported as a bare "SSH connection timeout" with the reason discarded.
    // That is the same information loss that made the original bug so hard to place, so the timeout carries
    // whatever SSH actually said.
    it('attaches the accumulated stderr to the timeout', () => {
      const message = describeSshFailure(
        'SSH connection timeout',
        'ssh: some brand new failure mode nobody has classified\n'
      );

      expect(message).toContain('SSH connection timeout');
      expect(message).toContain('some brand new failure mode');
    });

    it('leaves the message alone when SSH said nothing', () => {
      expect(describeSshFailure('SSH connection timeout', '   \n ')).toBe('SSH connection timeout');
    });

    it('bounds a verbose session so the tail survives', () => {
      const noise = 'debug1: chatter\n'.repeat(500);
      const message = describeSshFailure('SSH connection timeout', noise + 'the actual ending');

      expect(message).toContain('the actual ending');
      expect(message.length).toBeLessThan(1000);
    });
  });

  /**
   * The retained buffer is re-scanned on every chunk, so an unbounded one costs memory and makes a chatty
   * session quadratic. Trimming must never cost us a verdict, which is the point of the last two cases.
   */
  describe('retained stderr stays bounded', () => {
    it('keeps short output verbatim', () => {
      expect(appendBoundedStderr('Permission ', 'denied')).toBe('Permission denied');
    });

    it('never grows past the retention window', () => {
      let buffer = '';
      for (let i = 0; i < 500; i++) {
        buffer = appendBoundedStderr(buffer, 'debug1: chatter\n'.repeat(100));
      }

      expect(buffer.length).toBeLessThanOrEqual(MAX_RETAINED_STDERR);
    });

    it('keeps the tail, which is the part that explains the ending', () => {
      const buffer = appendBoundedStderr('x'.repeat(MAX_RETAINED_STDERR), 'Permission denied');

      expect(buffer.length).toBe(MAX_RETAINED_STDERR);
      expect(buffer.endsWith('Permission denied')).toBe(true);
    });

    it('still sees a failure split across chunks after trimming', () => {
      let buffer = appendBoundedStderr('', 'debug1: chatter\n'.repeat(4000));
      buffer = appendBoundedStderr(buffer, 'Permission de');
      buffer = appendBoundedStderr(buffer, 'nied');

      expect(isFatalSshStderr(buffer)).toBe(true);
    });
  });
});
