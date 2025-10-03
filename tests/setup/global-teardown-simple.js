/**
 * Simplified Global Jest Teardown (JavaScript)
 */

const fs = require('fs/promises');
const path = require('path');

module.exports = async function globalTeardown() {
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
