// Performance test setup
import { jest } from '@jest/globals';

// Even longer timeout for performance tests
jest.setTimeout(300000);

// Performance test specific setup
beforeAll(async () => {
  // Setup performance monitoring
});

afterAll(async () => {
  // Cleanup performance monitoring
});