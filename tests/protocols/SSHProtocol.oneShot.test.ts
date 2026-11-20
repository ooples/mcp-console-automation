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
  extractOneShotOutput,
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

describe('extractOneShotOutput', () => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const marker = createCompletionMarker('00ff00ff00ff00ff');
  const typed = `ls /tmp${marker.suffix}`;
  // Shape recorded from a live Ubuntu 26.04 login: banner, the line echoed before and after the
  // prompt, OSC 3008 shell-integration sequences, colored prompt, output, marker, next prompt.
  const transcript =
    'Welcome to Ubuntu 26.04 LTS\r\n\r\n*** System restart required ***\r\n' +
    `${typed}\r\n` +
    `${ESC}]3008;start=abc;type=shell${ESC}\\${ESC}[?2004h${ESC}]0;ubuntu@host: ~${BEL}` +
    `${ESC}[01;32mubuntu@host${ESC}[00m:~$ ${typed}\r\n${ESC}[?2004l\r` +
    `${ESC}]3008;start=def;type=command${ESC}\\a.txt\r\nb.txt\r\n` +
    '__MCP_DONE_00ff00ff00ff00ff_0__\r\n' +
    `${ESC}]3008;end=def;exit=success${ESC}\\ubuntu@host:~$ `;

  it('keeps only what the command printed', () => {
    expect(extractOneShotOutput(transcript)).toBe('a.txt\nb.txt');
  });

  it('returns empty output for a silent command', () => {
    expect(extractOneShotOutput(`${typed}\r\n__MCP_DONE_00ff00ff00ff00ff_7__\r\n`)).toBe('');
  });

  it('only strips escape sequences when no marker arrived', () => {
    expect(extractOneShotOutput(`partial ${ESC}[01;32mgreen${ESC}[00m\r\n`)).toBe('partial green\n');
  });
});

