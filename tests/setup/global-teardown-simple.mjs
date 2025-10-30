/**
 * Simplified Global Jest Teardown (JavaScript)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalTeardown() {
  console.log('🧹 Starting global test teardown...');

  try {
    // Clean up temp files
    const tempDir = path.join(process.cwd(), 'tests', 'data', 'temp');

    try {
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        await fs.unlink(path.join(tempDir, file)).catch(() => {});
      }
    } catch (error) {
      // Directory might not exist
    }

    console.log('✅ Global test teardown completed');

  } catch (error) {
    console.error('❌ Global test teardown failed:', error);
  }
};
