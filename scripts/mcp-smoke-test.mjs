import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SessionManager } from '../dist/core/SessionManager.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = process.env.MCP_SERVER_PATH
  ? path.resolve(process.env.MCP_SERVER_PATH)
  : path.join(root, 'dist', 'mcp', 'server.js');
const temporaryHome = fs.mkdtempSync(
  path.join(os.tmpdir(), 'console-automation-mcp-')
);
const debugLog = path.join(temporaryHome, 'mcp-debug.log');
const sessionPersistenceFile = path.join(
  temporaryHome,
  'data',
  'sessions.json'
);

assert.ok(fs.existsSync(serverPath), `Missing built MCP server: ${serverPath}`);

async function verifySessionPersistenceRedaction() {
  const persistencePath = path.join(temporaryHome, 'sessions.json');
  if (process.platform !== 'win32') {
    fs.writeFileSync(persistencePath, '[]', { mode: 0o666 });
    fs.chmodSync(temporaryHome, 0o777);
    fs.chmodSync(persistencePath, 0o666);
  }
  const manager = new SessionManager({
    persistenceEnabled: true,
    persistencePath,
    enableLogging: false,
    recoveryOptions: { persistSessionData: true },
  });
  if (process.platform !== 'win32') {
    assert.equal(
      fs.statSync(path.dirname(persistencePath)).mode & 0o777,
      0o700,
      'Existing persistence directory permissions were not restricted'
    );
    assert.equal(
      fs.statSync(persistencePath).mode & 0o777,
      0o600,
      'Existing persistence file permissions were not restricted'
    );
  }
  const inlineSecrets = {
    password: 'persisted-password-must-not-appear',
    privateKey: 'persisted-private-key-must-not-appear',
    passphrase: 'persisted-passphrase-must-not-appear',
  };
  const environmentSecret = 'persisted-environment-must-not-appear';

  try {
    const state = await manager.registerSession(
      {
        id: 'ssh-persistence-smoke',
        status: 'running',
        type: 'ssh',
        createdAt: new Date(),
        lastActivity: new Date(),
        command: 'ssh',
        args: [],
        cwd: temporaryHome,
        env: { SMOKE_API_TOKEN: environmentSecret },
        streaming: false,
        sshOptions: {
          host: 'localhost',
          username: 'smoke',
          passwordEnvVar: 'SMOKE_PASSWORD',
          ...inlineSecrets,
        },
      },
      'ssh'
    );

    assert.equal(
      state.metadata.originalSession.sshOptions.password,
      inlineSecrets.password,
      'Persistence sanitization mutated the live session'
    );
    assert.equal(
      state.metadata.originalSession.env.SMOKE_API_TOKEN,
      environmentSecret,
      'Persistence sanitization mutated the live environment'
    );
    const persisted = fs.readFileSync(persistencePath, 'utf8');
    if (process.platform !== 'win32') {
      assert.equal(
        fs.statSync(path.dirname(persistencePath)).mode & 0o777,
        0o700,
        'Persistence directory permissions are not restricted'
      );
      assert.equal(
        fs.statSync(persistencePath).mode & 0o777,
        0o600,
        'Persistence file permissions are not restricted'
      );
    }
    for (const secret of [...Object.values(inlineSecrets), environmentSecret]) {
      assert.doesNotMatch(persisted, new RegExp(secret));
    }
    assert.doesNotMatch(persisted, /SMOKE_API_TOKEN/);
    assert.match(persisted, /SMOKE_PASSWORD/);
  } finally {
    await manager.shutdown();
  }
}

await verifySessionPersistenceRedaction();

const client = new Client({
  name: 'console-automation-smoke',
  version: '1.0.0',
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: temporaryHome,
  env: {
    ...process.env,
    HOME: temporaryHome,
    USERPROFILE: temporaryHome,
    MCP_SERVER_MODE: 'true',
    LOG_LEVEL: 'warn',
    SMOKE_PASSWORD: 'must-not-appear-in-output',
    MCP_DEBUG_LOG: '',
    MCP_LOG_DIR: '',
  },
});

try {
  await client.connect(transport);
  const serverVersion = client.getServerVersion();
  assert.equal(serverVersion?.name, 'console-automation');
  assert.match(serverVersion?.version ?? '', /^\d+\.\d+\.\d+/);

  const { tools } = await client.listTools();
  const toolNames = new Set(tools.map((tool) => tool.name));
  for (const requiredTool of [
    'console_create_session',
    'console_execute_command',
    'console_list_sessions',
    'console_save_profile',
    'console_list_profiles',
    'console_send_key',
    'console_cleanup_sessions',
    'console_cleanup_jobs',
  ]) {
    assert.ok(toolNames.has(requiredTool), `Missing MCP tool: ${requiredTool}`);
  }

  const listSessions = tools.find(
    (tool) => tool.name === 'console_list_sessions'
  );
  const executeCommand = tools.find(
    (tool) => tool.name === 'console_execute_command'
  );
  assert.equal(listSessions?.annotations?.readOnlyHint, true);
  assert.equal(listSessions?.annotations?.destructiveHint, false);
  assert.equal(executeCommand?.annotations?.readOnlyHint, false);
  assert.equal(executeCommand?.annotations?.destructiveHint, true);

  for (const toolName of [
    'console_send_key',
    'console_cleanup_sessions',
    'console_cleanup_jobs',
  ]) {
    const tool = tools.find((candidate) => candidate.name === toolName);
    assert.equal(tool?.annotations?.destructiveHint, true, toolName);
    assert.equal(tool?.annotations?.idempotentHint, false, toolName);
  }

  const oneShotResult = await client.callTool({
    name: 'console_execute_command',
    arguments: {
      command: 'echo',
      args: ['MCP_ONE_SHOT_SMOKE'],
      timeout: 5000,
    },
  });
  assert.notEqual(oneShotResult.isError, true);
  assert.match(
    oneShotResult.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n'),
    /MCP_ONE_SHOT_SMOKE/
  );

  let timeoutRejected = false;
  try {
    const timeoutResult = await client.callTool({
      name: 'console_execute_command',
      arguments:
        process.platform === 'win32'
          ? {
              command: path.join(
                process.env.SystemRoot ?? 'C:\\Windows',
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe'
              ),
              args: [
                '-NoLogo',
                '-NoProfile',
                '-Command',
                'Start-Sleep -Seconds 5',
              ],
              timeout: 100,
            }
          : {
              command: 'sleep',
              args: ['5'],
              timeout: 100,
            },
    });
    const timeoutText = timeoutResult.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');
    timeoutRejected =
      timeoutResult.isError === true && /timeout/i.test(timeoutText);
  } catch (error) {
    timeoutRejected = /timeout/i.test(String(error));
  }
  assert.equal(
    timeoutRejected,
    true,
    'One-shot timeout did not reject with a timeout error'
  );

  const saveProfile = tools.find(
    (tool) => tool.name === 'console_save_profile'
  );
  const sshProperties =
    saveProfile?.inputSchema?.properties?.sshOptions?.properties;
  assert.ok(sshProperties?.passwordEnvVar);
  assert.ok(sshProperties?.privateKeyEnvVar);
  assert.ok(sshProperties?.privateKeyPath);
  assert.ok(sshProperties?.passphraseEnvVar);
  assert.equal(sshProperties?.password, undefined);
  assert.equal(sshProperties?.privateKey, undefined);
  assert.equal(sshProperties?.passphrase, undefined);

  await client.callTool({
    name: 'console_save_profile',
    arguments: {
      profileType: 'connection',
      name: 'smoke-ssh',
      connectionType: 'ssh',
      sshOptions: {
        host: 'localhost',
        username: 'smoke',
        passwordEnvVar: 'SMOKE_PASSWORD',
      },
    },
  });

  const profileResult = await client.callTool({
    name: 'console_list_profiles',
    arguments: {},
  });
  const profileText = profileResult.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  assert.match(profileText, /smoke-ssh/);
  assert.match(profileText, /SMOKE_PASSWORD/);
  assert.doesNotMatch(profileText, /must-not-appear-in-output/);

  let inlineSecretRejected = false;
  try {
    const result = await client.callTool({
      name: 'console_save_profile',
      arguments: {
        profileType: 'connection',
        name: 'unsafe-inline-secret',
        connectionType: 'ssh',
        sshOptions: {
          host: 'localhost',
          username: 'smoke',
          password: 'inline-secret',
        },
      },
    });
    inlineSecretRejected = result.isError === true;
  } catch {
    inlineSecretRejected = true;
  }
  assert.equal(
    inlineSecretRejected,
    true,
    'Inline profile secret was accepted'
  );

  const localSessionResult = await client.callTool({
    name: 'console_create_session',
    arguments: {
      command: process.execPath,
      args: ['-e', "console.log('MCP_LOCAL_SMOKE'); setTimeout(() => {}, 250)"],
      timeout: 5000,
    },
  });
  assert.notEqual(localSessionResult.isError, true);
  const localSessionText = localSessionResult.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  const localSession = JSON.parse(localSessionText);
  assert.ok(localSession.sessionId, 'Local session did not return an ID');

  const localOutput = await client.callTool({
    name: 'console_wait_for_output',
    arguments: {
      sessionId: localSession.sessionId,
      pattern: 'MCP_LOCAL_SMOKE',
      timeout: 5000,
    },
  });
  assert.notEqual(localOutput.isError, true);
  assert.match(
    localOutput.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n'),
    /MCP_LOCAL_SMOKE/
  );

  await client.callTool({
    name: 'console_stop_session',
    arguments: { sessionId: localSession.sessionId },
  });

  const sessionResult = await client.callTool({
    name: 'console_list_sessions',
    arguments: {},
  });
  assert.notEqual(sessionResult.isError, true);
  assert.equal(fs.existsSync(debugLog), false, 'Default debug log was created');
  assert.equal(
    fs.existsSync(sessionPersistenceFile),
    false,
    'Session persistence was enabled by default'
  );

  process.stdout.write(
    `${JSON.stringify({
      server: serverVersion,
      tools: tools.length,
      oneShotCommand: 'passed',
      timeoutCleanup: 'passed',
      localSession: 'passed',
      credentialRedaction: 'passed',
      persistenceRedaction: 'passed',
      debugLoggingDefault: 'off',
    })}\n`
  );
} finally {
  await client.close();
  fs.rmSync(temporaryHome, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
