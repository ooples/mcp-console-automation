/**
 * Tells an SSH failure apart from SSH talking.
 *
 * The adapters used to treat every byte on the SSH client's stderr as a fatal error and reject the pending
 * connection with it. But `ssh` writes plenty of *non-failure* text to stderr — most notably:
 *
 *     Warning: Permanently added '203.0.113.10' (ED25519) to the list of known hosts.
 *
 * which it prints on the FIRST connection to any host whenever `StrictHostKeyChecking=no` is in effect. Both
 * adapters set that flag by default, so the very first thing stderr produced was a warning, and the connection
 * was aborted before the shell prompt could arrive. A correctly configured host was therefore unreachable
 * 100% of the time, and the reported error was the warning text — which reads like a failure, so it sent
 * whoever hit it looking at their known_hosts file instead of at this code.
 *
 * The rule is inverted here: stderr is diagnostic unless it matches something that genuinely ends a
 * connection. An unrecognised fatal message is not silently swallowed — the connect wait times out and
 * surfaces the accumulated stderr verbatim, so SSH still gets to explain itself in its own words.
 */

/**
 * Conditions that actually mean the connection is over.
 *
 * Deliberately a list of FAILURES rather than a list of benign warnings: the set of things SSH may say
 * informationally is open-ended (host-key notices, banners, MOTD, `Pseudo-terminal will not be allocated`,
 * anything under `-v`), while the set of ways it reports a dead connection is small and stable.
 */
const FATAL_PATTERNS: readonly RegExp[] = [
  /Permission denied/i,
  /Too many authentication failures/i,
  /Host key verification failed/i,
  /REMOTE HOST IDENTIFICATION HAS CHANGED/i,
  /Connection refused/i,
  /Connection closed by/i,
  /Connection reset by/i,
  /No route to host/i,
  /Network is unreachable/i,
  /Could not resolve hostname/i,
  /Operation timed out/i,
  /Connection timed out/i,
  /ssh: connect to host .* port .*: /i,
  /Bad configuration option/i,
  /no matching (?:host key type|key exchange method|cipher) found/i,
  /Load key .*: (?:bad permissions|invalid format|error in libcrypto)/i,
  /Unable to negotiate with/i,
];

/**
 * How much stderr an adapter keeps.
 *
 * The retained buffer is re-scanned on every chunk, so leaving it unbounded costs memory AND turns a chatty
 * session into repeated scans of an ever-growing string — quadratic in the number of chunks. The tail is the
 * part that explains an ending, so that is what is kept.
 *
 * 16 KiB is orders of magnitude longer than the longest pattern above, so trimming to this window cannot cut
 * a match that the complete buffer would have found — including one split across chunk boundaries.
 */
export const MAX_RETAINED_STDERR = 16 * 1024;

/**
 * Append a stderr chunk, retaining only the trailing window.
 *
 * @param buffer Text retained so far.
 * @param chunk The newly arrived slice.
 * @param limit Maximum characters to retain; defaults to {@link MAX_RETAINED_STDERR}.
 */
export function appendBoundedStderr(
  buffer: string,
  chunk: string,
  limit: number = MAX_RETAINED_STDERR,
): string {
  const combined = buffer + chunk;
  if (limit <= 0 || combined.length <= limit) {
    return combined;
  }
  return combined.slice(-limit);
}

/**
 * Whether SSH's stderr says the connection has failed.
 *
 * @param text Accumulated stderr, not a single chunk. A stream hands out arbitrary slices, so
 * `Permission denied` can arrive as `Permission de` + `nied`; matching per-chunk would miss it exactly when it
 * matters most.
 */
export function isFatalSshStderr(text: string): boolean {
  if (!text) {
    return false;
  }

  return FATAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The best available explanation for a connection that never came up.
 *
 * Used when the connect wait times out. Without it the caller gets a bare "SSH connection timeout" and the
 * reason — which SSH already printed — is discarded, which is the same information loss that made the original
 * bug so hard to place.
 */
export function describeSshFailure(fallback: string, accumulatedStderr: string): string {
  const detail = accumulatedStderr.trim();
  if (!detail) {
    return fallback;
  }

  // Keep it bounded: a verbose session can produce a great deal of stderr, and the tail is the part that
  // explains the ending.
  const tail = detail.length > 800 ? `…${detail.slice(-800)}` : detail;
  return `${fallback}. SSH reported: ${tail}`;
}
