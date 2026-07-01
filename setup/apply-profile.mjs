#!/usr/bin/env node
// Merge the shared (non-secret) SSH connection profile into this machine's
// console-automation-mcp config (~/.console-automation-mcp/config.json), pointing
// at this machine's local private key. Idempotent: re-running updates in place.
//
// Usage: node apply-profile.mjs <path-to-server.json> [absolute-private-key-path]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const serverJsonPath = process.argv[2];
const keyPath = process.argv[3] || join(homedir(), '.ssh', 'claude_automation');

if (!serverJsonPath || !existsSync(serverJsonPath)) {
  console.error(`server.json not found: ${serverJsonPath}`);
  process.exit(1);
}
const server = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
if (!server.host || String(server.host).includes('<') ||
    !server.username || String(server.username).includes('<')) {
  console.error('server.json still has placeholder host/username — fill it in first.');
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error(`private key not found at ${keyPath} — run the bootstrap to generate it first.`);
  process.exit(1);
}

const cfgDir = join(homedir(), '.console-automation-mcp');
const cfgFile = join(cfgDir, 'config.json');
mkdirSync(cfgDir, { recursive: true });

let cfg = { connectionProfiles: [], applicationProfiles: [] };
if (existsSync(cfgFile)) {
  try { cfg = JSON.parse(readFileSync(cfgFile, 'utf8')); } catch { /* start fresh on parse error */ }
}
cfg.connectionProfiles = cfg.connectionProfiles || [];

const profile = {
  name: server.name || 'ooples-prod',
  type: 'ssh',
  isDefault: true,
  sshOptions: {
    host: server.host,
    port: server.port || 22,
    username: server.username,
    privateKeyPath: keyPath,        // absolute local path — no ~ expansion ambiguity
    strictHostKeyChecking: false,   // first-connect friendly; tighten later if desired
  },
};

const i = cfg.connectionProfiles.findIndex((p) => p && p.name === profile.name);
if (i >= 0) cfg.connectionProfiles[i] = profile;
else cfg.connectionProfiles.push(profile);
cfg.defaultConnectionProfile = profile.name;

writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
console.log(`Wrote profile '${profile.name}' -> ${cfgFile}`);
console.log(`  host=${server.host}:${server.port || 22} user=${server.username} key=${keyPath}`);
