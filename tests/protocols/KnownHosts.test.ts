/**
 * Host keys are checked the same way on every SSH path.
 *
 * Before: the native-ssh path refused any unknown host with no way to accept it except turning
 * checking off, while both ssh2 paths (password logins and persistent sessions) set no
 * hostVerifier and so accepted ANY key, sending the password to whoever answered.
 */
import { createHmac, randomBytes } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkHostKey,
  keyTypeOfBlob,
  knownHostsName,
  openSshStrictHostKeyChecking,
  verifyHostKey,
} from '../../src/core/KnownHosts.js';
import { remediationSteps } from '../../src/core/RetryManager.js';

function keyBlob(type: string, seed: string): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(name.length);
  return Buffer.concat([length, name, Buffer.from(seed)]);
}

const ed = keyBlob('ssh-ed25519', 'server-key-1');
const edOther = keyBlob('ssh-ed25519', 'attacker-key');
const rsa = keyBlob('ssh-rsa', 'server-rsa');

describe('known_hosts matching', () => {
  it('names hosts the way OpenSSH records them', () => {
    expect(knownHostsName('203.0.113.5')).toBe('203.0.113.5');
    expect(knownHostsName('203.0.113.5', 2222)).toBe('[203.0.113.5]:2222');
  });

  it('reads the key type from the wire blob', () => {
    expect(keyTypeOfBlob(ed)).toBe('ssh-ed25519');
  });

  it('matches plain and comma-separated entries, and reports a changed key', () => {
    const file = `other.example ssh-ed25519 AAAA\nalias,203.0.113.5 ssh-ed25519 ${ed.toString('base64')}\n`;
    expect(checkHostKey(file, '203.0.113.5', 22, 'ssh-ed25519', ed.toString('base64'))).toBe('match');
    expect(checkHostKey(file, '203.0.113.5', 22, 'ssh-ed25519', edOther.toString('base64'))).toBe('mismatch');
    expect(checkHostKey(file, '198.51.100.1', 22, 'ssh-ed25519', ed.toString('base64'))).toBe('unknown');
  });

  it('only compares keys of the same type', () => {
    const file = `203.0.113.5 ssh-rsa ${rsa.toString('base64')}\n`;
    expect(checkHostKey(file, '203.0.113.5', 22, 'ssh-ed25519', ed.toString('base64'))).toBe('unknown');
  });

  it('matches hashed entries (HashKnownHosts yes)', () => {
    const salt = randomBytes(20);
    const hash = createHmac('sha1', salt).update('[203.0.113.5]:2222').digest('base64');
    const file = `|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${ed.toString('base64')}\n`;
    expect(checkHostKey(file, '203.0.113.5', 2222, 'ssh-ed25519', ed.toString('base64'))).toBe('match');
    expect(checkHostKey(file, '203.0.113.5', 22, 'ssh-ed25519', ed.toString('base64'))).toBe('unknown');
  });

  it('treats a revoked key as a mismatch', () => {
    const file = `@revoked 203.0.113.5 ssh-ed25519 ${ed.toString('base64')}\n`;
    expect(checkHostKey(file, '203.0.113.5', 22, 'ssh-ed25519', ed.toString('base64'))).toBe('mismatch');
  });

  it('maps policies to OpenSSH values', () => {
    expect(openSshStrictHostKeyChecking('accept-new')).toBe('accept-new');
    expect(openSshStrictHostKeyChecking(true)).toBe('yes');
    expect(openSshStrictHostKeyChecking(false)).toBe('no');
  });
});

describe('verifyHostKey policies', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'known-hosts-'));
    file = join(dir, 'ssh', 'known_hosts');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accept-new (the default) records a new host, then refuses a changed key', () => {
    expect(verifyHostKey({ host: '203.0.113.5', keyBlob: ed, knownHostsFile: file }).accepted).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(`203.0.113.5 ssh-ed25519 ${ed.toString('base64')}\n`);
    expect(verifyHostKey({ host: '203.0.113.5', keyBlob: ed, knownHostsFile: file })).toMatchObject({ accepted: true, status: 'match' });
    const changed = verifyHostKey({ host: '203.0.113.5', keyBlob: edOther, knownHostsFile: file });
    expect(changed.accepted).toBe(false);
    expect(changed.reason).toMatch(/does not match.*ssh-keygen -R "203.0.113.5"/);
  });

  it('true refuses an unknown host and says how to add it, without writing', () => {
    const result = verifyHostKey({ host: '203.0.113.5', port: 2222, keyBlob: ed, policy: true, knownHostsFile: file });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/ssh-keyscan -p 2222 203.0.113.5/);
    expect(() => readFileSync(file)).toThrow();
  });

  it('false accepts any key and records nothing', () => {
    writeFileSync(join(dir, 'kh'), `203.0.113.5 ssh-ed25519 ${ed.toString('base64')}\n`);
    expect(verifyHostKey({ host: '203.0.113.5', keyBlob: edOther, policy: false, knownHostsFile: join(dir, 'kh') }).accepted).toBe(true);
  });

  it('appends on a new line when the file lacks a trailing newline', () => {
    writeFileSync(join(dir, 'kh'), 'other.example ssh-ed25519 AAAA');
    verifyHostKey({ host: '203.0.113.5', keyBlob: ed, knownHostsFile: join(dir, 'kh') });
    expect(readFileSync(join(dir, 'kh'), 'utf8').split('\n')[1]).toMatch(/^203\.0\.113\.5 ssh-ed25519 /);
  });
});

describe('remediationSteps', () => {
  it('gives host-key advice, not network advice, for a host key failure', () => {
    const steps = remediationSteps('Host key verification failed.').join(' ');
    expect(steps).toMatch(/accept-new/);
    expect(steps).not.toMatch(/network connection/);
  });

  it('gives credential advice for a rejected login', () => {
    const steps = remediationSteps('ubuntu@203.0.113.5: Permission denied (publickey,password).').join(' ');
    expect(steps).toMatch(/authorized_keys/);
    expect(steps).not.toMatch(/firewall/);
  });

  it('keeps the general list for other failures', () => {
    expect(remediationSteps('Connection timed out')[0]).toMatch(/network connection/);
  });
});

describe('logger metadata', () => {
  it('wraps a string so winston does not split it into characters', async () => {
    const { normalizeMeta } = await import('../../src/utils/logger.js');
    expect(normalizeMeta('No ED25519 host key')).toEqual({ detail: 'No ED25519 host key' });
    expect(normalizeMeta({ a: 1 })).toEqual({ a: 1 });
    expect(normalizeMeta(undefined)).toBeUndefined();
  });
});
