// Mock for ansi-regex ESM package - CommonJS format
module.exports = function ansiRegex() {
  return /\x1b\[[0-9;]*m/g;
};
