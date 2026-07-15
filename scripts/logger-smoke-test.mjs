import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'console-automation-logs-')
);

process.env.MCP_SERVER_MODE = 'true';
process.env.MCP_LOG_DIR = logDirectory;
process.env.LOG_LEVEL = 'debug';

try {
  const { Logger } = await import('../dist/utils/logger.js');
  const logger = new Logger('redaction-smoke');
  const winstonLogger = logger.getWinstonLogger();

  logger.info('Structured metadata test', {
    password: 'password-must-not-appear',
    nested: {
      apiToken: 'token-must-not-appear',
      safeValue: 'visible-value',
    },
  });
  logger.info('Authorization header: Bearer message-token-must-not-appear');

  const finished = once(winstonLogger, 'finish');
  winstonLogger.end();
  await finished;

  const combinedLog = fs.readFileSync(
    path.join(logDirectory, 'mcp-combined.log'),
    'utf8'
  );
  assert.doesNotMatch(combinedLog, /password-must-not-appear/);
  assert.doesNotMatch(combinedLog, /token-must-not-appear/);
  assert.doesNotMatch(combinedLog, /message-token-must-not-appear/);
  assert.match(combinedLog, /\[REDACTED\]/);
  assert.match(combinedLog, /visible-value/);

  process.stdout.write(
    `${JSON.stringify({ structuredLogRedaction: 'passed' })}\n`
  );
} finally {
  fs.rmSync(logDirectory, { recursive: true, force: true });
}
