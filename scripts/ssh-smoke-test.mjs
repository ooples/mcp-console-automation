import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SSHSessionHandler } from '../dist/core/SSHSessionHandler.js';

const host = process.env.SSH_TEST_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.SSH_TEST_PORT || '22', 10);
const username = process.env.SSH_TEST_USER;
const password = process.env.SSH_TEST_PASS;
const privateKeyPath = process.env.SSH_TEST_KEY;

assert.ok(username, 'SSH_TEST_USER is required');
assert.ok(password, 'SSH_TEST_PASS is required');
assert.ok(privateKeyPath, 'SSH_TEST_KEY is required');

const handler = new SSHSessionHandler();

async function waitForOutput(sessionId, marker, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = handler.getFullOutput(sessionId).join('');
    if (output.includes(marker)) return output;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for SSH output marker: ${marker}`);
}

async function exerciseSession(authentication, marker) {
  const sessionId = await handler.createSession({
    host,
    port,
    username,
    ...authentication,
    tryKeyboard: false,
    readyTimeout: 10000,
  });

  try {
    await handler.sendInput(sessionId, `printf '${marker}\\n'\n`);
    const output = await waitForOutput(sessionId, marker);
    assert.match(output, new RegExp(marker));
  } finally {
    await handler.closeSession(sessionId);
  }
}

await exerciseSession({ password }, 'SSH_PASSWORD_SMOKE_OK');
await exerciseSession(
  { privateKey: fs.readFileSync(privateKeyPath, 'utf8') },
  'SSH_KEY_SMOKE_OK'
);

process.stdout.write(
  `${JSON.stringify({ passwordAuthentication: 'passed', keyAuthentication: 'passed' })}\n`
);
