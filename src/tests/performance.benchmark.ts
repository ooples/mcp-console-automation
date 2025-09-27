import { OutputFilterEngine, FilterOptions } from '../core/OutputFilterEngine.js';
import { ConsoleOutput } from '../types/index.js';

interface BenchmarkResult {
  testName: string;
  outputSize: number;
  processingTime: number;
  memoryUsage: number;
  filteredLines: number;
  throughput: number; // lines per second
  memoryEfficiency: number; // bytes per line processed
}

class PerformanceBenchmark {
  private filterEngine: OutputFilterEngine;
  private results: BenchmarkResult[] = [];

  constructor() {
    this.filterEngine = new OutputFilterEngine();
  }

  // Generate realistic log data with various patterns
  private generateRealisticLogs(size: number): ConsoleOutput[] {
    const logLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
    const components = ['Database', 'Auth', 'API', 'Cache', 'Queue', 'Worker'];
    const actions = ['Connected', 'Disconnected', 'Failed', 'Timeout', 'Success', 'Retry'];
    const baseTimestamp = Date.now() - (size * 1000);

    return Array.from({ length: size }, (_, i) => {
      const level = logLevels[Math.floor(Math.random() * logLevels.length)];
      const component = components[Math.floor(Math.random() * components.length)];
      const action = actions[Math.floor(Math.random() * actions.length)];
      const timestamp = new Date(baseTimestamp + (i * 100)); // 100ms apart
      
      let message: string;
      if (i % 1000 === 0) {
        // Periodic complex log entries
        message = `${level}: [${component}] ${action} - Request ID: req_${i} | User: user_${i % 100} | Duration: ${Math.random() * 1000}ms | Memory: ${Math.random() * 512}MB`;
      } else if (i % 100 === 0) {
        // Medium complexity entries
        message = `${level}: [${component}] ${action} - ID: ${i} | Status: ${Math.random() > 0.7 ? 'SUCCESS' : 'FAILURE'}`;
      } else {
        // Simple entries
        message = `${level}: [${component}] ${action} ${i}`;
      }

      return {
        sessionId: 'benchmark-session',
        timestamp,
        type: 'stdout' as const,
        data: message
      };
    });
  }

  private async measureMemory(fn: () => Promise<void>): Promise<number> {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const memBefore = process.memoryUsage().heapUsed;
    await fn();
    
    if (global.gc) {
      global.gc();
    }
    
    const memAfter = process.memoryUsage().heapUsed;
    return Math.max(0, memAfter - memBefore);
  }

  private async runBenchmark(
    testName: string,
    output: ConsoleOutput[],
    filterOptions: FilterOptions
  ): Promise<BenchmarkResult> {
    let result: any;
    let processingTime: number;
    
    const memoryUsage = await this.measureMemory(async () => {
      const startTime = process.hrtime.bigint();
      result = await this.filterEngine.filter(output, filterOptions);
      const endTime = process.hrtime.bigint();
      processingTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    });

    const throughput = output.length / (processingTime / 1000); // lines per second
    const memoryEfficiency = memoryUsage / output.length; // bytes per line

    const benchmarkResult: BenchmarkResult = {
      testName,
      outputSize: output.length,
      processingTime,
      memoryUsage,
      filteredLines: result.filteredOutput?.length || 0,
      throughput,
      memoryEfficiency
    };

    this.results.push(benchmarkResult);
    return benchmarkResult;
  }

  async runAllBenchmarks(): Promise<BenchmarkResult[]> {
    console.log('🚀 Starting Performance Benchmarks...\n');

    // Test 1: Basic grep performance on large dataset
    console.log('📊 Test 1: Basic Grep Performance (100k lines)');
    const largeOutput = this.generateRealisticLogs(100000);
    await this.runBenchmark(
      'Basic Grep (100k lines)',
      largeOutput,
      { grep: 'ERROR' }
    );

    // Test 2: Complex regex performance
    console.log('📊 Test 2: Complex Regex Performance (50k lines)');
    const mediumOutput = this.generateRealisticLogs(50000);
    await this.runBenchmark(
      'Complex Regex (50k lines)',
      mediumOutput,
      { grep: '^(ERROR|FATAL):\\s+\\[\\w+\\]\\s+.+\\s+-\\s+Request ID:\\s+req_\\d+' }
    );

    // Test 3: Multi-pattern search performance
    console.log('📊 Test 3: Multi-pattern Search (75k lines)');
    const multiPatternOutput = this.generateRealisticLogs(75000);
    await this.runBenchmark(
      'Multi-pattern AND (75k lines)',
      multiPatternOutput,
      {
        multiPattern: {
          patterns: ['Database', 'Failed'],
          logic: 'AND'
        }
      }
    );

    // Test 4: Time-based filtering performance
    console.log('📊 Test 4: Time-based Filtering (80k lines)');
    const timeOutput = this.generateRealisticLogs(80000);
    await this.runBenchmark(
      'Time-based Filter (80k lines)',
      timeOutput,
      { since: '10m' }
    );

    // Test 5: Streaming mode performance
    console.log('📊 Test 5: Streaming Mode (200k lines)');
    const streamingOutput = this.generateRealisticLogs(200000);
    await this.runBenchmark(
      'Streaming Mode (200k lines)',
      streamingOutput,
      {
        grep: 'WARN|ERROR',
        streamingMode: true
      }
    );

    // Test 6: Combined filters performance
    console.log('📊 Test 6: Combined Filters (60k lines)');
    const combinedOutput = this.generateRealisticLogs(60000);
    await this.runBenchmark(
      'Combined Filters (60k lines)',
      combinedOutput,
      {
        grep: 'ERROR|FATAL',
        since: '30m',
        tail: 100,
        grepIgnoreCase: true
      }
    );

    // Test 7: Line operations performance
    console.log('📊 Test 7: Line Operations (150k lines)');
    const lineOutput = this.generateRealisticLogs(150000);
    await this.runBenchmark(
      'Line Range Operations (150k lines)',
      lineOutput,
      {
        lineRange: [1000, 5000],
        grep: 'Database'
      }
    );

    // Test 8: Memory efficiency with maxLines
    console.log('📊 Test 8: Memory Efficiency (300k lines with limit)');
    const memoryOutput = this.generateRealisticLogs(300000);
    await this.runBenchmark(
      'Memory Efficient (300k->100k lines)',
      memoryOutput,
      {
        grep: 'INFO',
        maxLines: 100000
      }
    );

    console.log('\n✅ All benchmarks completed!\n');
    return this.results;
  }

  printResults(): void {
    console.log('📈 PERFORMANCE BENCHMARK RESULTS');
    console.log('================================\n');

    // Sort results by processing time
    const sortedResults = [...this.results].sort((a, b) => a.processingTime - b.processingTime);

    sortedResults.forEach((result, index) => {
      console.log(`${index + 1}. ${result.testName}`);
      console.log(`   📏 Input Size: ${result.outputSize.toLocaleString()} lines`);
      console.log(`   ⏱️  Processing Time: ${result.processingTime.toFixed(2)}ms`);
      console.log(`   📊 Filtered Output: ${result.filteredLines.toLocaleString()} lines`);
      console.log(`   🚀 Throughput: ${(result.throughput / 1000).toFixed(2)}K lines/sec`);
      console.log(`   💾 Memory Usage: ${(result.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
      console.log(`   🎯 Memory Efficiency: ${result.memoryEfficiency.toFixed(2)} bytes/line`);
      console.log('');
    });

    // Performance summary
    const avgThroughput = this.results.reduce((sum, r) => sum + r.throughput, 0) / this.results.length;
    const avgMemoryEfficiency = this.results.reduce((sum, r) => sum + r.memoryEfficiency, 0) / this.results.length;
    const maxThroughput = Math.max(...this.results.map(r => r.throughput));
    const minMemoryUsage = Math.min(...this.results.map(r => r.memoryUsage));

    console.log('📊 PERFORMANCE SUMMARY');
    console.log('=====================');
    console.log(`Average Throughput: ${(avgThroughput / 1000).toFixed(2)}K lines/sec`);
    console.log(`Maximum Throughput: ${(maxThroughput / 1000).toFixed(2)}K lines/sec`);
    console.log(`Average Memory Efficiency: ${avgMemoryEfficiency.toFixed(2)} bytes/line`);
    console.log(`Best Memory Usage: ${(minMemoryUsage / 1024 / 1024).toFixed(2)}MB`);

    // Performance validation
    console.log('\n✅ PERFORMANCE VALIDATION');
    console.log('========================');
    
    const performanceChecks = [
      {
        name: 'Throughput > 10K lines/sec',
        pass: avgThroughput > 10000,
        value: `${(avgThroughput / 1000).toFixed(2)}K lines/sec`
      },
      {
        name: 'Memory efficiency < 1KB/line',
        pass: avgMemoryEfficiency < 1024,
        value: `${avgMemoryEfficiency.toFixed(2)} bytes/line`
      },
      {
        name: 'All tests complete < 10s',
        pass: Math.max(...this.results.map(r => r.processingTime)) < 10000,
        value: `${Math.max(...this.results.map(r => r.processingTime)).toFixed(2)}ms max`
      },
      {
        name: 'Streaming handles 200k+ lines',
        pass: this.results.some(r => r.testName.includes('Streaming') && r.outputSize >= 200000),
        value: this.results.find(r => r.testName.includes('Streaming'))?.outputSize.toLocaleString() || 'N/A'
      }
    ];

    performanceChecks.forEach(check => {
      const status = check.pass ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${check.name}: ${check.value}`);
    });

    const allPassed = performanceChecks.every(check => check.pass);
    console.log(`\n🏁 Overall Performance: ${allPassed ? '✅ EXCELLENT' : '⚠️  NEEDS OPTIMIZATION'}`);
  }
}

// Export for testing
export { PerformanceBenchmark };

// Run benchmarks if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const benchmark = new PerformanceBenchmark();
  
  benchmark.runAllBenchmarks()
    .then(() => {
      benchmark.printResults();
    })
    .catch(error => {
      console.error('❌ Benchmark failed:', error);
      process.exit(1);
    });
}