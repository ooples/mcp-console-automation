// Mock for ansi-regex ESM package
module.exports = function ansiRegex() {
  return /\x1b\[[0-9;]*m/g;
};
module.exports.default = module.exports;
