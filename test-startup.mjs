console.log('import.meta.url:', import.meta.url);
console.log('process.argv[1]:', process.argv[1]);
console.log('file URL from argv[1]:', `file://${process.argv[1]}`);
console.log('Do they match?', import.meta.url === `file://${process.argv[1]}`);
