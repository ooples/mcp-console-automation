/**
 * Test Framework Interface Contracts
 *
 * IMPORTANT: These are STUB interfaces to enable parallel agent development.
 * Each phase will fill in the REAL implementation while maintaining these contracts.
 *
 * Contract Ownership:
 * - Phase 1: TestRecording, RecordingStep, RecordingMetadata
 * - Phase 2: Assertion, SessionSnapshot, Matcher types
 * - Phase 3: TestSuite, TestDefinition, TestResult, TestReport
 * - Phase 4: ParallelExecutionConfig, RetryConfig, FlakeReport
 * - Phase 5: TestFixture, TestEnvironment, ParameterizedTest
 */

// ============================================================================
// PHASE 1: Test Recorder/Replay
// ============================================================================

export interface TestRecording {
  name: string;
  version: string;
  createdAt: string;
  duration: number;
  steps: RecordingStep[];
  metadata: RecordingMetadata;
}

export interface RecordingStep {
  type: 'create_session' | 'send_input' | 'send_key' | 'wait_for_output' | 'assert' | 'snapshot';
  timestamp: number;
  data: any;
  output?: string;
  sessionId?: string;
}

export interface RecordingMetadata {
  author?: string;
  description?: string;
  tags?: string[];
  environment?: Record<string, string>;
}

export interface ReplayResult {
  recording: string;
  status: 'success' | 'failure' | 'error';
  duration: number;
  steps: StepResult[];
  error?: Error;
}

export interface StepResult {
  step: RecordingStep;
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  error?: Error;
  output?: string;
}

export interface CodeGenerationOptions {
  language: 'javascript' | 'typescript' | 'python';
  framework?: 'jest' | 'mocha' | 'pytest';
  includeSetup?: boolean;
  includeTeardown?: boolean;
}

// ============================================================================
// PHASE 2: Assertion Framework
// ============================================================================

export interface Assertion {
  type: 'output_contains' | 'output_matches' | 'exit_code' | 'no_errors' | 'state_equals' | 'custom';
  expected: any;
  actual?: any;
  result?: 'pass' | 'fail';
  message?: string;
  operator?: string;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  message: string;
  stack?: string;
}

export interface SessionSnapshot {
  sessionId: string;
  timestamp: number;
  output: string;
  state: any; // Will be defined by Phase 2
  metadata: Record<string, any>;
  hash?: string;
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
  identical: boolean;
  similarity?: number; // 0-1
}

export interface MatcherFunction {
  (actual: any, expected: any): boolean;
}

export interface Matcher {
  name: string;
  fn: MatcherFunction;
  description: string;
  negatable?: boolean;
}

// ============================================================================
// PHASE 3: Test Suite Management
// ============================================================================

export interface TestSuite {
  name: string;
  description: string;
  tests: TestDefinition[];
  setup?: TestHook;
  teardown?: TestHook;
  config: SuiteConfig;
  tags?: string[];
}

export interface TestDefinition {
  name: string;
  description?: string;
  recording?: string; // Reference to TestRecording
  assertions: Assertion[];
  timeout: number;
  retry: number;
  skip?: boolean;
  tags?: string[];
  setup?: TestHook;
  teardown?: TestHook;
}

export interface TestHook {
  type: 'setup' | 'teardown' | 'beforeEach' | 'afterEach';
  fn: () => Promise<void> | void;
  timeout?: number;
}

export interface SuiteConfig {
  timeout?: number;
  retry?: number;
  parallel?: boolean;
  maxWorkers?: number;
  bail?: boolean; // Stop on first failure
  verbose?: boolean;
}

export interface TestResult {
  test: TestDefinition;
  status: 'pass' | 'fail' | 'skip' | 'timeout';
  duration: number;
  startTime: number;
  endTime: number;
  assertions: AssertionResult[];
  error?: Error;
  retries?: number;
  output?: string;
}

export interface TestSuiteResult {
  suite: TestSuite;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  startTime: number;
  endTime: number;
  tests: TestResult[];
}

export interface TestReport {
  format: 'html' | 'json' | 'junit' | 'markdown';
  suiteResults: TestSuiteResult[];
  summary: TestSummary;
  generatedAt: string;
  outputPath?: string;
}

export interface TestSummary {
  totalSuites: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  passRate: number; // 0-1
}

// ============================================================================
// PHASE 4: Enhanced Test Execution
// ============================================================================

export interface ParallelExecutionConfig {
  maxWorkers: number;
  timeout: number;
  isolateTests: boolean;
  failFast: boolean; // Stop all workers on first failure
  workerTimeout?: number;
}

export interface ParallelExecutionResult {
  config: ParallelExecutionConfig;
  totalTests: number;
  results: TestResult[];
  duration: number;
  workersUsed: number;
  speedup?: number; // Compared to sequential
}

export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier?: number; // For exponential backoff
  retryOnErrors?: string[]; // Retry only on specific errors
  retryOnTimeout?: boolean;
}

export interface RetryResult {
  test: TestDefinition;
  attempts: number;
  results: TestResult[];
  finalResult: TestResult;
  totalDuration: number;
}

export interface FlakeReport {
  testName: string;
  totalRuns: number;
  passes: number;
  failures: number;
  errors: number;
  flakeRate: number; // 0-1
  isFlaky: boolean; // true if flakeRate > threshold
  threshold?: number;
  failurePatterns?: string[];
}

export interface ExecutionMetrics {
  testName: string;
  duration: number;
  memoryUsed: number; // bytes
  cpuTime: number; // ms
  peakMemory: number;
  sessionCount: number;
}

// ============================================================================
// PHASE 5: Test Data Management
// ============================================================================

export interface TestFixture {
  name: string;
  data: any;
  format: 'json' | 'yaml' | 'csv' | 'sql';
  schema?: any; // JSON Schema for validation
  path?: string;
}

export interface TestEnvironment {
  name: string;
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
  seed?: (data: any) => Promise<void>;
  cleanup?: () => Promise<void>;
  config?: Record<string, any>;
}

export interface ParameterizedTest {
  test: TestDefinition;
  datasets: any[];
  results: TestResult[];
  strategy: 'all' | 'first-failure' | 'random-sample';
}

export interface DatasetConfig {
  name: string;
  source: 'file' | 'inline' | 'generated';
  path?: string;
  generator?: () => any[];
  count?: number; // For generated data
}

export interface FixtureMetadata {
  name: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  description?: string;
  tags?: string[];
}

export interface SeedData {
  fixtures: TestFixture[];
  order?: string[]; // Order to load fixtures
  cleanup?: boolean; // Cleanup after test
}

// ============================================================================
// SHARED TYPES (Used across multiple phases)
// ============================================================================

export type TestStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip' | 'timeout' | 'error';

export interface TestContext {
  sessionId?: string;
  environment?: TestEnvironment;
  fixtures?: TestFixture[];
  variables?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface TestError {
  message: string;
  stack?: string;
  code?: string;
  category?: 'assertion' | 'timeout' | 'setup' | 'teardown' | 'execution';
  recoverable?: boolean;
}

export interface TestLogger {
  log: (message: string, level?: 'info' | 'warn' | 'error' | 'debug') => void;
  startGroup: (name: string) => void;
  endGroup: () => void;
}

// ============================================================================
// PHASE AGENT CONTRACTS
// ============================================================================

/**
 * Phase 1 Agent: Test Recorder/Replay
 * MUST IMPLEMENT:
 * - TestRecorder class
 * - TestReplayEngine class
 * - CodeGenerator class
 * - 5 MCP tools (start_recording, stop_recording, list_recordings, replay_test, generate_test_code)
 */

/**
 * Phase 2 Agent: Assertion Framework
 * MUST IMPLEMENT:
 * - AssertionEngine class
 * - SnapshotManager class
 * - SnapshotDiffer class
 * - Matchers library (15+ matchers)
 * - 6 MCP tools (assert_output, assert_exit_code, assert_no_errors, save_snapshot, compare_snapshots, assert_state)
 */

/**
 * Phase 3 Agent: Test Suite Management
 * MUST IMPLEMENT:
 * - TestSuiteManager class
 * - TestRunner class
 * - TestReporter class (HTML, JSON, JUnit)
 * - 6 MCP tools (create_test_suite, add_test_to_suite, run_test_suite, get_test_results, generate_test_report, list_test_suites)
 */

/**
 * Phase 4 Agent: Enhanced Test Execution
 * MUST IMPLEMENT:
 * - ParallelExecutor class
 * - RetryManager class
 * - FlakeDetector class
 * - 5 MCP tools (run_test_parallel, retry_failed_tests, detect_flaky_tests, set_test_timeout, get_execution_metrics)
 */

/**
 * Phase 5 Agent: Test Data Management
 * MUST IMPLEMENT:
 * - TestDataLoader class
 * - DataParameterizer class
 * - TestEnvironment class
 * - FixtureManager class
 * - 5 MCP tools (load_test_data, parameterize_test, setup_test_env, teardown_test_env, seed_test_data)
 */
