/**
 * A caller's argv must reach the shell intact.
 *
 * `getShellInfo` treated a command as a program only when it LOOKED like a path
 * (absolute, contained a separator, or carried an .exe/.cmd/... extension). A
 * bare executable name such as "powershell" failed that test and fell through to
 * the wrapping branch, where command and args were flattened into a single
 * string and handed to an OUTER shell:
 *
 *   powershell.exe -NoLogo -NoProfile -Command "powershell -NoProfile -Command $x = 7; ..."
 *
 * The outer PowerShell then expanded `$x` -- undefined in ITS scope -- to the
 * empty string before the real shell ever saw the script. Measured end to end:
 *
 *   sent      $x = 7; Write-Output "x-is-$x"
 *   executed  = 7; Write-Output "x-is-"
 *
 * The command still "succeeded" (exit code 0), so this corrupted results silently
 * rather than failing. These tests pin the argv-preserving behaviour.
 */
import { LocalProtocol } from '../../src/protocols/LocalProtocol.js';
import type { SessionOptions } from '../../src/types/index.js';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** getShellInfo is private; exercise it the way doCreateSession does. */
const shellInfoFor = (
  protocol: LocalProtocol,
  options: SessionOptions
): { command: string; args: string[] } =>
  (
    protocol as unknown as {
      getShellInfo(o: SessionOptions): { command: string; args: string[] };
    }
  ).getShellInfo(options);

describe('LocalProtocol argv handling', () => {
  const isWindows = process.platform === 'win32';

  it('spawns a bare executable NAME directly instead of re-parsing it', () => {
    const protocol = new LocalProtocol('powershell');
    const script = '$x = 7; Write-Output "x-is-$x"';
    const info = shellInfoFor(protocol, {
      command: isWindows ? 'powershell' : 'sh',
      args: isWindows ? ['-NoProfile', '-Command', script] : ['-c', 'echo hi'],
    } as SessionOptions);

    // argv survives as discrete arguments...
    expect(info.args).toContain(isWindows ? script : 'echo hi');
    // ...and is NOT flattened into one re-parsed string.
    expect(info.args.join(' ')).not.toContain(
      isWindows ? 'powershell -NoProfile' : 'sh -c'
    );
  });

  it('keeps a $variable intact rather than letting an outer shell eat it', async () => {
    if (!isWindows) return; // the failure mode is PowerShell-specific

    // This has to run the command. The pre-fix argv still CONTAINED the literal
    // "$x = 7" -- the loss happened when the outer PowerShell interpreted that
    // string, so only execution reveals it.
    const { ConsoleManager } = await import('../../src/core/ConsoleManager.js');
    const manager = new ConsoleManager();
    try {
      const result = await manager.executeCommand(
        'powershell',
        ['-NoProfile', '-Command', '$x = 7; Write-Output "x-is-$x"'],
        { consoleType: 'powershell', timeout: 60000 }
      );
      expect(result.output).toContain('x-is-7');
      expect(result.output).not.toContain('x-is-\r');
    } finally {
      await manager.destroy?.();
    }
  }, 90000);

  it('still routes a bare cmdlet through the shell', () => {
    // Get-Date is not an executable on PATH; spawning it directly would ENOENT
    // and tear the session down, which is the behaviour the original guard
    // existed to prevent. It must keep going through the shell.
    const protocol = new LocalProtocol('powershell');
    const info = shellInfoFor(protocol, {
      command: 'Get-Date',
      args: ['-Format', 'o'],
    } as SessionOptions);

    expect(info.command.toLowerCase()).toContain('powershell');
    expect(info.args).toContain('-Command');
    expect(info.args.join(' ')).toContain('Get-Date -Format o');
  });

  it('still treats an explicit path as a program', () => {
    const protocol = new LocalProtocol('powershell');
    const explicit = isWindows
      ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
      : '/bin/sh';
    const info = shellInfoFor(protocol, {
      command: explicit,
      args: ['-NoProfile'],
    } as SessionOptions);

    expect(info.command).toBe(explicit);
    expect(info.args).toEqual(['-NoProfile']);
  });
});

/**
 * Resolution must consult the environment the CHILD receives, and must not
 * mistake a directory for a program.
 *
 * doCreateSession spawns with `options.env` merged over `process.env`. Deciding
 * "program or shell builtin" from `process.env` alone answers the question for a
 * process that never runs: a tool reachable only through SessionOptions.env.PATH
 * was judged absent, wrapped in a shell, and had its argv flattened -- the same
 * silent corruption the tests above pin.
 */
describe('LocalProtocol executable resolution', () => {
  const isWindows = process.platform === 'win32';
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'localprotocol-resolve-'));
  });

  afterEach(() => {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* windows can hold a handle briefly */
    }
  });

  it('finds an executable reachable ONLY through SessionOptions.env.PATH', () => {
    const toolbox = join(work, 'toolbox');
    mkdirSync(toolbox, { recursive: true });

    // A real, executable file under a directory that appears in no PATH but the
    // one the caller supplies.
    const name = 'tosttool';
    const file = join(toolbox, isWindows ? `${name}.cmd` : name);
    writeFileSync(
      file,
      isWindows ? '@echo off\r\necho hi\r\n' : '#!/bin/sh\necho hi\n'
    );
    if (!isWindows) {
      chmodSync(file, 0o755);
    }

    const protocol = new LocalProtocol(isWindows ? 'powershell' : 'bash');
    const info = shellInfoFor(protocol, {
      command: name,
      args: ['--flag', 'value with spaces'],
      env: { PATH: toolbox, PATHEXT: '.CMD;.EXE' },
    } as SessionOptions);

    // Recognised as a program: spawned directly, argv intact.
    expect(info.command).toBe(name);
    expect(info.args).toEqual(['--flag', 'value with spaces']);
  });

  it('does not treat a DIRECTORY on PATH as a program', () => {
    const toolbox = join(work, 'toolbox');
    // Resolution probes `name + ext`, so on Windows the directory has to carry
    // the extension to be a candidate at all.
    const name = 'dirtool';
    mkdirSync(join(toolbox, isWindows ? `${name}.cmd` : name), {
      recursive: true,
    });

    const protocol = new LocalProtocol(isWindows ? 'powershell' : 'bash');
    const info = shellInfoFor(protocol, {
      command: name,
      args: ['--flag'],
      env: { PATH: toolbox, PATHEXT: '.CMD;.EXE' },
    } as SessionOptions);

    // existsSync said yes to the directory, so this used to be spawned directly
    // and die with EACCES/EISDIR. It must fall through to the shell instead.
    expect(info.command).not.toBe(name);
  });

  it('does not resolve a bare name that is on NO path', () => {
    const protocol = new LocalProtocol(isWindows ? 'powershell' : 'bash');
    const info = shellInfoFor(protocol, {
      command: 'definitely-not-a-real-program-xyz',
      args: [],
      env: { PATH: join(work, 'empty') },
    } as SessionOptions);

    expect(info.command).not.toBe('definitely-not-a-real-program-xyz');
  });
});
