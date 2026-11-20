import { createHmac } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * How an SSH connection treats the server's host key, matching OpenSSH's StrictHostKeyChecking:
 * - `true`: the key must already be in known_hosts.
 * - `'accept-new'` (default): an unknown host is trusted and recorded on first use; a host whose
 *   recorded key differs is refused.
 * - `false`: any key is accepted. Only for throwaway hosts; this allows interception.
 */
export type HostKeyPolicy = boolean | 'accept-new';

export const DEFAULT_HOST_KEY_POLICY: HostKeyPolicy = 'accept-new';

export type HostKeyStatus = 'match' | 'mismatch' | 'unknown';

export function defaultKnownHostsFile(): string {
  return join(homedir(), '.ssh', 'known_hosts');
}

/** The name OpenSSH records a host under: `host` on port 22, `[host]:port` otherwise. */
export function knownHostsName(host: string, port = 22): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

/** The OpenSSH StrictHostKeyChecking value for a policy. */
export function openSshStrictHostKeyChecking(policy: HostKeyPolicy): string {
  if (policy === 'accept-new') return 'accept-new';
  return policy ? 'yes' : 'no';
}

/** Reads the key type from an SSH wire-format public key blob (uint32 length + name). */
export function keyTypeOfBlob(blob: Buffer): string {
  if (blob.length < 4) return '';
  const length = blob.readUInt32BE(0);
  return blob.subarray(4, 4 + length).toString('ascii');
}

function hostPatternMatches(pattern: string, name: string): boolean {
  // Hashed entry: |1|base64(salt)|base64(HMAC-SHA1(salt, name))
  if (pattern.startsWith('|1|')) {
    const [, , salt, hash] = pattern.split('|');
    if (!salt || !hash) return false;
    const digest = createHmac('sha1', Buffer.from(salt, 'base64'))
      .update(name)
      .digest('base64');
    return digest === hash;
  }
  return pattern === name;
}

/**
 * Compares a presented host key with known_hosts. Only entries of the same key type are
 * compared, as OpenSSH does; a host recorded only under other key types counts as unknown.
 * A key marked `@revoked` for the host is a mismatch.
 */
export function checkHostKey(
  contents: string,
  host: string,
  port: number,
  keyType: string,
  keyBase64: string
): HostKeyStatus {
  const name = knownHostsName(host, port);
  let sawSameType = false;
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    let marker = '';
    if (fields[0].startsWith('@')) marker = fields.shift()!;
    if (marker === '@cert-authority' || fields.length < 3) continue;
    const [patterns, type, key] = fields;
    const negated = patterns.split(',').some((p) => p.startsWith('!') && hostPatternMatches(p.slice(1), name));
    if (negated || !patterns.split(',').some((p) => hostPatternMatches(p, name))) continue;
    if (marker === '@revoked') {
      if (type === keyType && key === keyBase64) return 'mismatch';
      continue;
    }
    if (type !== keyType) continue;
    if (key === keyBase64) return 'match';
    sawSameType = true;
  }
  return sawSameType ? 'mismatch' : 'unknown';
}

/**
 * Decides whether to accept a host key under a policy, recording it in known_hosts when the
 * policy is `'accept-new'` and the host is new. Returns the reason when the key is refused.
 */
export function verifyHostKey(options: {
  host: string;
  port?: number;
  keyBlob: Buffer;
  policy?: HostKeyPolicy;
  knownHostsFile?: string;
}): { accepted: boolean; status: HostKeyStatus; reason?: string } {
  const policy = options.policy ?? DEFAULT_HOST_KEY_POLICY;
  const port = options.port ?? 22;
  const file = options.knownHostsFile ?? defaultKnownHostsFile();
  const keyType = keyTypeOfBlob(options.keyBlob);
  const keyBase64 = options.keyBlob.toString('base64');
  const contents = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const status = checkHostKey(contents, options.host, port, keyType, keyBase64);

  if (policy === false || status === 'match') return { accepted: true, status };
  const name = knownHostsName(options.host, port);
  if (status === 'mismatch') {
    return {
      accepted: false,
      status,
      reason: `The ${keyType} host key for ${name} does not match the one recorded in ${file}. The server's key changed, or the connection is being intercepted. If the change is expected, remove the old entry (ssh-keygen -R "${name}") and connect again.`,
    };
  }
  if (policy === true) {
    return {
      accepted: false,
      status,
      reason: `${name} is not in ${file} and strictHostKeyChecking is true. Add its key first (ssh-keyscan -p ${port} ${options.host} >> "${file}"), or connect with strictHostKeyChecking: "accept-new" to trust it on first use.`,
    };
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const prefix = contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
  appendFileSync(file, `${prefix}${name} ${keyType} ${keyBase64}\n`, { mode: 0o600 });
  return { accepted: true, status };
}
