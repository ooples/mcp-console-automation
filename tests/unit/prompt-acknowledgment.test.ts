import { PromptDetector } from '../../src/core/PromptDetector.js';

/**
 * Regression tests for the long-session wedge.
 *
 * The SSH command queue acknowledges a command once the shell has returned to a
 * prompt. It used to decide that with /[$#%>]\s*$/m, which matches *any* line
 * ending in $ # % > — including ordinary command output. That acknowledged
 * commands early and sent the next one into a still-running shell, so a long
 * session drifted out of sync until it wedged.
 */
describe('prompt detection vs. real command output', () => {
  const SESSION = 'test-session';
  let detector: PromptDetector;

  beforeEach(() => {
    detector = new PromptDetector();
    detector.configureSession({
      sessionId: SESSION,
      shellType: 'bash',
      adaptiveLearning: false,
    });
  });

  // Output captured from a real production session against ubuntu@ns107444.
  const NOT_PROMPTS: Array<[string, string]> = [
    ['df -h usage column', '/dev/sda1        50G   44G   3.0G  94%'],
    ['top cpu line', 'Cpu(s): 12.5%us,  3.1%sy,  0.0%ni, 84.4%'],
    ['psql continuation prompt', 'ooples-#'],
    ['download progress', 'Downloading package... 87%'],
    ['awk/redirect in echoed command', 'cat foo.txt > bar.txt'],
  ];

  it.each(NOT_PROMPTS)(
    'does not treat %s as a shell prompt',
    (_label, line) => {
      const result = detector.detectPrompt(SESSION, `some earlier output\n${line}`);
      expect(result?.detected ?? false).toBe(false);
    }
  );

  const REAL_PROMPTS: Array<[string, string]> = [
    ['ubuntu bash prompt', 'ubuntu@ns107444:~$ '],
    ['ubuntu bash prompt in a subdir', 'ubuntu@ns107444:/opt/ooples$ '],
    ['root prompt', 'root@ns107444:/var/log# '],
  ];

  it.each(REAL_PROMPTS)('detects %s', (_label, prompt) => {
    const result = detector.detectPrompt(SESSION, `command output here\n${prompt}`);
    expect(result?.detected).toBe(true);
  });

  it('detects the prompt that terminates output which itself ends in %', () => {
    // The exact shape that wedged the real session: df output (ending in 94%)
    // followed by the genuine prompt. The prompt is what must be matched.
    const buffer = [
      'Filesystem       Size  Used Avail Use% Mounted on',
      '/dev/sda1        50G   44G   3.0G  94% /',
      'ubuntu@ns107444:~$ ',
    ].join('\n');

    const result = detector.detectPrompt(SESSION, buffer);
    expect(result?.detected).toBe(true);
    expect(result?.matchedText).toContain('ubuntu@ns107444');
  });

  it('buffers output only for configured sessions', () => {
    // addOutput() silently drops data for unconfigured sessions, which left the
    // detector inert for every session the manager created.
    detector.addOutput(SESSION, 'hello');
    expect(detector.getBuffer(SESSION)).toBe('hello');

    detector.addOutput('never-configured', 'hello');
    expect(detector.getBuffer('never-configured')).toBe('');
  });

  it('reports whether a session is configured', () => {
    expect(detector.hasSession(SESSION)).toBe(true);
    expect(detector.hasSession('never-configured')).toBe(false);
  });
});

describe('matchesPromptTail (explicit pattern override)', () => {
  const detector = new PromptDetector();

  // A caller-supplied pattern, as setPromptPattern() would install.
  const USER_PATTERN = /\$\s*$/;

  // What the queue used before: matched any *line* ending in $ # % >, anywhere
  // in the buffer.
  const OLD_BROKEN_PATTERN = /[$#%>]\s*$/m;

  const dfOutput = [
    'Filesystem       Size  Used Avail Use% Mounted on',
    '/dev/sda1        50G   44G   3.0G  94% /',
    'tmpfs             13G     0   13G   0%',
  ].join('\n');

  it('does not fire while command output is still streaming', () => {
    expect(detector.matchesPromptTail(dfOutput, USER_PATTERN)).toBe(false);
  });

  it('fires once the shell prints its prompt after that output', () => {
    expect(
      detector.matchesPromptTail(`${dfOutput}\nubuntu@ns107444:~$ `, USER_PATTERN)
    ).toBe(true);
  });

  it('confines an over-broad pattern to the tail instead of the whole buffer', () => {
    // The old whole-buffer /m match fired on df's `0%` line mid-output, which
    // acknowledged the command early and sent the next one into a running shell.
    // Tail-anchoring alone cannot rescue a pattern this loose (the last line
    // still ends in %), so the queue no longer defaults to one — but anchoring
    // does stop it matching output that has since scrolled past.
    expect(OLD_BROKEN_PATTERN.test(dfOutput)).toBe(true);
    expect(
      detector.matchesPromptTail(`${dfOutput}\nstill running...`, OLD_BROKEN_PATTERN)
    ).toBe(false);
  });

  it('is not stateful across calls for a global regex', () => {
    // A /g regex makes .test() advance lastIndex, so repeated polls would
    // alternate between match and no-match on identical input.
    const globalPattern = /\$\s*$/g;
    const prompt = 'ubuntu@ns107444:~$ ';
    expect(detector.matchesPromptTail(prompt, globalPattern)).toBe(true);
    expect(detector.matchesPromptTail(prompt, globalPattern)).toBe(true);
    expect(detector.matchesPromptTail(prompt, globalPattern)).toBe(true);
  });

  it('ignores trailing blank lines when locating the tail', () => {
    expect(
      detector.matchesPromptTail('ubuntu@ns107444:~$ \n\n', USER_PATTERN)
    ).toBe(true);
  });

  it('returns false for an empty or whitespace-only buffer', () => {
    expect(detector.matchesPromptTail('', USER_PATTERN)).toBe(false);
    expect(detector.matchesPromptTail('   \n  ', USER_PATTERN)).toBe(false);
  });
});
