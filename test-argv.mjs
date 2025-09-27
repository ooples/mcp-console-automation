console.log('Testing with Windows path...');
console.log('process.argv[1]:', process.argv[1]);
console.log('import.meta.url:', import.meta.url);

// Try to normalize the path
import { fileURLToPath } from 'url';
import { normalize } from 'path';

const metaPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];

console.log('metaPath:', metaPath);
console.log('argvPath:', argvPath); 
console.log('normalized metaPath:', normalize(metaPath));
console.log('normalized argvPath:', normalize(argvPath));
console.log('Do they match?', normalize(metaPath) === normalize(argvPath));
