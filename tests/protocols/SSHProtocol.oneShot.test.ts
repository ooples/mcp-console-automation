/**
 * One-shot SSH commands must run as written and report their real exit status.
 *
 * Two defects, both seen against a live Ubuntu host:
 * - the whole command line was shell-quoted as one word, so `whoami; hostname` reached bash as a
 *   single program name and failed with "No such file or directory";
 * - the session was marked complete one second after the command was sent, with exit code 0,
 *   so failures read as success and anything slower than a second returned before it ran.
 */
import {
  buildRemoteCommand,
  createCompletionMarker,
} from '../../src/protocols/SSHProtocol.js';

describe('buildRemoteCommand', () => {
  it('sends a shell command line as written', () => {
    expect(buildRemoteCommand('cd /srv && ls; echo "done"')).toBe(
      'cd /srv && ls; echo "done"'
    );
  });

  it('quotes only the arguments, preserving their boundaries', () => {
    expect(buildRemoteCommand('bash', ['-c', "echo 'a b'; exit 3"])).toBe(
      `bash -c 'echo '"'"'a b'"'"'; exit 3'`
    );
    expect(buildRemoteCommand('ls', ['-la', '/tmp'])).toBe('ls -la /tmp');
  });
});

describe('createCompletionMarker', () => {
  const marker = createCompletionMarker('0123456789abcdef');

  it('appends a printf that renders the exit status', () => {
    expect(marker.suffix).toBe(
      `; printf '\\n__MCP_DONE_%s_%d__\\n' 0123456789abcdef "$?"`
    );
  });

  it('does not match the echoed command line', () => {
    const echo = `ls /missing${marker.suffix}\r\n`;
    expect(marker.parse(echo)).toBeUndefined();
  });

  it('reads the exit status from the rendered marker, including non-zero codes', () => {
    expect(marker.parse('out\r\n__MCP_DONE_0123456789abcdef_0__\r\n')).toBe(0);
    expect(marker.parse('err\r\n__MCP_DONE_0123456789abcdef_127__\r\n')).toBe(127);
  });

  it('ignores markers that belong to another command', () => {
    expect(marker.parse('__MCP_DONE_ffffffffffffffff_0__')).toBeUndefined();
  });

  it('gives each command its own nonce by default', () => {
    expect(createCompletionMarker().suffix).not.toBe(createCompletionMarker().suffix);
  });
});
