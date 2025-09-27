import { fileURLToPath } from 'url';
import * as path from 'path';

// Test with the actual compiled file path
const testPath = String.raw`C:\Users\yolan\source\repos\mcp-console-automation\dist\mcp\ultra-persistent-server.js`;
console.log('Testing path:', testPath);

// Simulate what happens when Claude starts it
process.argv[1] = testPath;
console.log('argv[1]:', process.argv[1]);
console.log('argv[1] normalized:', path.normalize(process.argv[1]));
