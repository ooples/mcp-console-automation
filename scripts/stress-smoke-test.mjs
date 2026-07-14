import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'dist', 'mcp', 'server.js');
const temporaryHome = fs.mkdtempSync(
  path.join(os.tmpdir(), 'console-automation-stress-')
);
const sessionCount = 20;
const sessionIds = [];

const client = new Client({
  name: 'console-automation-stress-smoke',
  version: '1.0.0',
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
  env: {
    ...process.env,
    HOME: temporaryHome,
    USERPROFILE: temporaryHome,
    MCP_SERVER_MODE: 'true',
    LOG_LEVEL: 'warn',
    MCP_DEBUG_LOG: '',
    MCP_LOG_DIR: '',
  },
});

function textContent(result) {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

try {
  await client.connect(transport);
  const startedAt = Date.now();
  const sessions = await Promise.all(
    Array.from({ length: sessionCount }, async (_, index) => {
      const marker = `MCP_STRESS_${index}`;
      const result = await client.callTool({
        name: 'console_create_session',
        arguments: {
          command: process.execPath,
          args: ['-e', `console.log('${marker}'); setTimeout(() => {}, 30000)`],
          timeout: 35000,
        },
      });
      assert.notEqual(result.isError, true);
      const session = JSON.parse(textContent(result));
      sessionIds.push(session.sessionId);
      return { sessionId: session.sessionId, marker };
    })
  );

  assert.equal(sessions.length, sessionCount);
  assert.equal(new Set(sessionIds).size, sessionCount);

  await Promise.all(
    sessions.map(async ({ sessionId, marker }) => {
      const result = await client.callTool({
        name: 'console_wait_for_output',
        arguments: { sessionId, pattern: marker, timeout: 10000 },
      });
      assert.notEqual(result.isError, true);
      assert.match(textContent(result), new RegExp(marker));
    })
  );

  await Promise.all(
    sessionIds.map((sessionId) =>
      client.callTool({
        name: 'console_stop_session',
        arguments: { sessionId },
      })
    )
  );
  sessionIds.length = 0;

  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 30000, `Concurrency smoke took ${elapsedMs}ms`);
  process.stdout.write(
    `${JSON.stringify({ concurrentSessions: sessionCount, elapsedMs })}\n`
  );
} finally {
  await Promise.allSettled(
    sessionIds.map((sessionId) =>
      client.callTool({
        name: 'console_stop_session',
        arguments: { sessionId },
      })
    )
  );
  await client.close();
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
