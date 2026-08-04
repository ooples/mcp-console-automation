import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'console-automation-installer-')
);
const customPath = path.join(temporaryDirectory, 'config with spaces.json');

const invocation =
  process.platform === 'win32'
    ? {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'install.ps1'),
          '-Target',
          'custom',
          '-CustomPath',
          customPath,
          '-SkipDependencies',
          '-KeepDevDependencies',
        ],
      }
    : {
        command: 'bash',
        args: [
          path.join(root, 'install.sh'),
          '--target',
          'custom',
          '--custom-path',
          customPath,
          '--skip-dependencies',
          '--keep-dev-dependencies',
        ],
      };

try {
  const firstRun = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(
    firstRun.status,
    0,
    `Installer failed:\n${firstRun.stdout}\n${firstRun.stderr}`
  );

  const config = JSON.parse(fs.readFileSync(customPath, 'utf8'));
  const server = config.mcpServers?.['console-automation'];
  assert.ok(server, 'Installer did not write console-automation configuration');
  assert.equal(path.resolve(server.command), path.resolve(process.execPath));
  assert.equal(server.args.length, 1);
  assert.match(server.args[0], /dist[\\/]mcp[\\/]server\.js$/);
  assert.deepEqual(server.env, { LOG_LEVEL: 'warn' });

  const secondRun = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(
    secondRun.status,
    0,
    'Installer overwrote an existing config'
  );

  process.stdout.write(
    `${JSON.stringify({ platform: process.platform, customConfig: 'passed' })}\n`
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
