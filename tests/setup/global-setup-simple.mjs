/**
 * Simplified Global Jest Setup (JavaScript)
 * This is a minimal version that doesn't require TypeScript compilation
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GLOBAL_CONFIG = {
  testDataDir: path.join(process.cwd(), 'tests', 'data'),
  logLevel: process.env.CI ? 'warn' : 'debug',
  testTimeout: 30000
};

export default async function globalSetup() {
  console.log('🚀 Starting global test setup...');

  try {
    // Set test environment variables
    setupEnvironmentVariables();

    // Create test data directory
    await ensureTestDataDirectory();

    console.log('✅ Global test setup completed successfully');
  } catch (error) {
    console.error('❌ Global test setup failed:', error);
    throw error;
  }
}

function setupEnvironmentVariables() {
  const testEnvVars = {
    NODE_ENV: 'test',
    LOG_LEVEL: GLOBAL_CONFIG.logLevel,
    TEST_TIMEOUT: GLOBAL_CONFIG.testTimeout.toString(),
    DISABLE_TELEMETRY: 'true',
    JEST_WORKER_ID: process.env.JEST_WORKER_ID || '1'
  };

  Object.entries(testEnvVars).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

async function ensureTestDataDirectory() {
  try {
    await fs.access(GLOBAL_CONFIG.testDataDir);
  } catch {
    await fs.mkdir(GLOBAL_CONFIG.testDataDir, { recursive: true });
  }

  // Create subdirectories for different test types
  const subdirs = [
    'fixtures',
    'temp',
    'logs',
    'recordings',
    'snapshots'
  ];

  for (const subdir of subdirs) {
    const dirPath = path.join(GLOBAL_CONFIG.testDataDir, subdir);
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
}
