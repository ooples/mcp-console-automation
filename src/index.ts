#!/usr/bin/env node
import { ConsoleAutomationServer } from './mcp/server.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('log-level', {
    type: 'string',
    description: 'Set the logging level',
    default: 'info',
    choices: ['error', 'warn', 'info', 'debug']
  })
  .help()
  .parseSync();

process.env.LOG_LEVEL = argv['log-level'];

const server = new ConsoleAutomationServer();
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});