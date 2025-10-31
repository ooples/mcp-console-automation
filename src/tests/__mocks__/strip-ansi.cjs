// Mock for strip-ansi package - CommonJS format
module.exports = function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
};
