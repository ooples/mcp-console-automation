// Mock for strip-ansi package - ES Module format
export default function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
};
