// Mock for strip-ansi ESM package
module.exports = function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
};
module.exports.default = module.exports;
