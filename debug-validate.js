#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function debugProtocolFile(filename) {
  const filePath = path.join('src', 'protocols', filename);
  const protocolName = filename.replace('.ts', '');

  console.log(`\n🔍 Debugging ${protocolName}:`);

  if (!fs.existsSync(filePath)) {
    console.log(`❌ File not found: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  const expectedPatterns = [
    `export class ${protocolName} extends BaseProtocol implements IProtocol`,
    'public readonly type:',
    'public readonly version:',
    'public async initialize():',
    'public async createSession(',
    'public async executeCommand(',
    'public async dispose():'
  ];

  console.log('Checking patterns:');
  expectedPatterns.forEach(pattern => {
    const found = content.includes(pattern);
    console.log(`  ${found ? '✅' : '❌'} "${pattern}"`);
  });

  // Check for capabilities
  const hasCapabilitiesProperty = content.includes('public readonly capabilities:');
  const hasCapabilitiesGetter = content.includes('public get capabilities()');
  console.log(`  ${hasCapabilitiesProperty ? '✅' : '❌'} "public readonly capabilities:"`);
  console.log(`  ${hasCapabilitiesGetter ? '✅' : '❌'} "public get capabilities()"`);

  const hasCapabilities = hasCapabilitiesProperty || hasCapabilitiesGetter;
  console.log(`  Overall capabilities: ${hasCapabilities ? '✅' : '❌'}`);
}

// Debug the failing protocols
const failingProtocols = ['HyperVProtocol.ts', 'QEMUProtocol.ts', 'XenProtocol.ts', 'SPICEProtocol.ts', 'JTAGProtocol.ts'];

failingProtocols.forEach(debugProtocolFile);