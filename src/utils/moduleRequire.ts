import { createRequire } from 'node:module';
import path from 'node:path';

const resolutionAnchor = process.argv[1]
  ? path.resolve(process.argv[1])
  : path.join(process.cwd(), 'index.js');

export const moduleRequire = createRequire(resolutionAnchor);
