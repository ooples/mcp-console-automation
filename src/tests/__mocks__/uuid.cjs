// CommonJS shim for the `uuid` package.
//
// uuid v14 is published as ESM-only (its package.json is `"type": "module"` and
// every export resolves to an ESM file), so Jest's CommonJS runtime cannot
// `require()` it and throws "Must use import to load ES Module". This mirrors the
// approach already used for the other ESM-only deps in this folder (strip-ansi,
// ansi-regex, p-queue).
//
// It is backed by Node's built-in crypto.randomUUID (Node >= 16, and CI runs
// 18/20/22), so tests still receive real, unique RFC 4122 v4 UUIDs rather than a
// fixed stub.
const { randomUUID } = require('crypto');

function v4() {
  return randomUUID();
}

module.exports = { v4 };
