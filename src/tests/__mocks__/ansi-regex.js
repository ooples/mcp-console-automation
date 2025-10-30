// Mock for ansi-regex ESM package
export default function ansiRegex() {
  return /\x1b\[[0-9;]*m/g;
}
