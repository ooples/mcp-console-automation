import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'console-automation-package-')
);
const installDirectory = path.join(temporaryDirectory, 'install');

const npmInvocation = (args) => {
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  }

  return spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    encoding: 'utf8',
  });
};

try {
  const packed = npmInvocation([
    'pack',
    '--quiet',
    '--pack-destination',
    temporaryDirectory,
  ]);
  assert.equal(
    packed.status,
    0,
    `npm pack failed:\n${packed.stdout}\n${packed.stderr}`
  );

  const archive = fs
    .readdirSync(temporaryDirectory)
    .find((entry) => entry.endsWith('.tgz'));
  assert.ok(archive, 'npm pack did not create an archive');

  fs.mkdirSync(installDirectory, { recursive: true });
  const installed = npmInvocation([
    'install',
    '--prefix',
    installDirectory,
    '--no-package-lock',
    '--omit=dev',
    '--omit=optional',
    path.join(temporaryDirectory, archive),
  ]);
  assert.equal(
    installed.status,
    0,
    `Production package install failed:\n${installed.stdout}\n${installed.stderr}`
  );

  const packageRoot = path.join(
    installDirectory,
    'node_modules',
    'console-automation-mcp'
  );
  const serverPath = path.join(packageRoot, 'dist', 'mcp', 'server.js');
  assert.ok(fs.existsSync(serverPath), 'Packed MCP entry point is missing');
  assert.equal(
    fs.existsSync(path.join(packageRoot, 'src')),
    false,
    'Source tree leaked into the production package'
  );

  const smoke = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'mcp-smoke-test.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MCP_SERVER_PATH: serverPath,
      },
    }
  );
  assert.equal(
    smoke.status,
    0,
    `Packed MCP smoke test failed:\n${smoke.stdout}\n${smoke.stderr}`
  );
  assert.equal(
    smoke.stderr.trim(),
    '',
    `Packed MCP wrote unexpected startup diagnostics:\n${smoke.stderr}`
  );

  process.stdout.write(
    `${JSON.stringify({ packageContents: 'minimal', productionInstall: 'passed' })}\n`
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
