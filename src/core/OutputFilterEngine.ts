import { ConsoleOutput } from '../types/index.js';
import { Logger } from '../utils/logger.js';

/**
 * Filter options for server-side output filtering
 */
export interface FilterOptions {
  // Regex pattern matching
  grep?: string;
  grepIgnoreCase?: boolean;
  grepInvert?: boolean;
  
  // Line-based operations
  tail?: number;          // Last N lines
  head?: number;          // First N lines
  lineRange?: [number, number]; // [start, end] line numbers (1-indexed)
  
  // Time-based filtering
  since?: string;         // ISO timestamp or relative (e.g., "5m", "1h", "2d")
  until?: string;         // ISO timestamp or relative
  
  // Multi-pattern search
  multiPattern?: {
    patterns: string[];
    logic: 'AND' | 'OR';
    ignoreCase?: boolean;
  };
  
  // Performance optimizations
  maxLines?: number;      // Maximum lines to process
  streamingMode?: boolean; // Process in streaming mode for large outputs
  chunkSize?: number;     // Chunk size for streaming processing
}

/**
 * Result of filtering operation with metadata
 */
export interface FilterResult {
  success: boolean;
  filteredOutput?: ConsoleOutput[];
  output?: ConsoleOutput[]; // Legacy compatibility
  error?: string;
  metrics?: {
    totalLines: number;
    filteredLines: number;
    processingTimeMs: number;
    memoryUsageBytes: number;
    truncated: boolean;
    filterStats: {
      grepMatches?: number;
      timeFiltered?: number;
      lineRangeFiltered?: number;
      multiPatternMatches?: number;
    };
  };
  metadata?: {
    totalLines: number;
    filteredLines: number;
    processingTimeMs: number;
    memoryUsageBytes: number;
    truncated: boolean;
    filterStats: {
      grepMatches?: number;
      timeFiltered?: number;
      lineRangeFiltered?: number;
      multiPatternMatches?: number;
    };
  }; // Legacy compatibility
}

/**
 * Performance metrics for filter operations
 */
interface FilterMetrics {
  operationCount: number;
  totalProcessingTime: number;
  averageProcessingTime: number;
  maxProcessingTime: number;
  totalLinesProcessed: number;
  totalMemoryUsed: number;
  cacheHits: number;
  cacheMisses: number;
}

/**
 * High-performance server-side output filtering engine
 */
export class OutputFilterEngine {
  private logger: Logger;
  private metrics: FilterMetrics;
  private regexCache: Map<string, RegExp>;
  private timestampCache: Map<string, Date>;
  
  constructor() {
    this.logger = new Logger('OutputFilterEngine');
    this.metrics = {
      operationCount: 0,
      totalProcessingTime: 0,
      averageProcessingTime: 0,
      maxProcessingTime: 0,
      totalLinesProcessed: 0,
      totalMemoryUsed: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    this.regexCache = new Map();
    this.timestampCache = new Map();
  }

  /**
   * Main filtering method with comprehensive server-side processing
   */
  async filter(
    output: ConsoleOutput[],
    options: FilterOptions = {}
  ): Promise<FilterResult> {
    const startTime = performance.now();
    const initialMemory = this.getMemoryUsage();
    
    try {
      this.logger.debug('Starting filter operation', {
        outputLines: output.length,
        options: JSON.stringify(options, null, 2)
      });

      // Validate filter options
      const validation = this.validateFilterOptions(options);
      if (!validation.valid) {
        const endTime = performance.now();
        const finalMemory = this.getMemoryUsage();
        const processingTime = endTime - startTime;
        const inputSize = options.maxLines && output.length > options.maxLines ? options.maxLines : output.length;
        
        return {
          success: false,
          filteredOutput: [],
          output: [],
          error: validation.errors.join('; '),
          metrics: {
            totalLines: inputSize,
            filteredLines: 0,
            processingTimeMs: processingTime,
            memoryUsageBytes: finalMemory - initialMemory,
            truncated: false,
            filterStats: {}
          },
          metadata: {
            totalLines: inputSize,
            filteredLines: 0,
            processingTimeMs: processingTime,
            memoryUsageBytes: finalMemory - initialMemory,
            truncated: false,
            filterStats: {}
          }
        };
      }

      // Early exit for empty output
      if (output.length === 0) {
        return this.createEmptyResult(startTime, initialMemory);
      }

      let result = [...output]; // Start with copy to avoid mutation
      const filterStats: any = {};

      // Apply maxLines early to limit processing for performance
      if (options.maxLines && result.length > options.maxLines) {
        result = result.slice(0, options.maxLines);
      }

      // Apply streaming mode processing for large outputs
      if (options.streamingMode || result.length > 10000) {
        result = await this.processInStreamingMode(result, options);
      }

      // Step 1: Time-based filtering (most selective, apply first)
      if (options.since || options.until) {
        const timeResult = this.applyTimeFilter(result, options.since, options.until);
        result = timeResult.filtered;
        filterStats.timeFiltered = timeResult.removed;
      }

      // Step 2: Line-based operations (head/lineRange applied before, tail applied after pattern matching)
      if (options.lineRange) {
        const lineResult = this.applyLineRangeFilter(result, options.lineRange);
        result = lineResult.filtered;
        filterStats.lineRangeFiltered = lineResult.removed;
      }

      // Apply head before pattern matching
      if (options.head && !options.tail) {
        result = result.slice(0, options.head);
      } else if (options.head && options.tail) {
        // Apply head first
        result = result.slice(0, options.head);
      }

      // Step 3: Pattern matching (most CPU-intensive, apply after head reduction)
      if (options.grep) {
        const grepResult = this.applyGrepFilter(result, options.grep, options);
        result = grepResult.filtered;
        filterStats.grepMatches = grepResult.matches;
      }

      // Step 4: Multi-pattern search
      if (options.multiPattern) {
        const multiResult = this.applyMultiPatternFilter(result, options.multiPattern);
        result = multiResult.filtered;
        filterStats.multiPatternMatches = multiResult.matches;
      }

      // Apply tail after pattern matching for more intuitive behavior
      if (options.tail) {
        result = result.slice(-options.tail);
      }

      const endTime = performance.now();
      const finalMemory = this.getMemoryUsage();
      const processingTime = endTime - startTime;

      // Update metrics
      const inputSize = options.maxLines && output.length > options.maxLines ? options.maxLines : output.length;
      this.updateMetrics(processingTime, inputSize, finalMemory - initialMemory);

      const filterResult: FilterResult = {
        success: true,
        filteredOutput: result,
        output: result, // Legacy compatibility
        metrics: {
          totalLines: inputSize,
          filteredLines: result.length,
          processingTimeMs: processingTime,
          memoryUsageBytes: finalMemory - initialMemory,
          truncated: result.length < output.length,
          filterStats
        },
        metadata: {
          totalLines: inputSize,
          filteredLines: result.length,
          processingTimeMs: processingTime,
          memoryUsageBytes: finalMemory - initialMemory,
          truncated: result.length < output.length,
          filterStats
        } // Legacy compatibility
      };

      this.logger.debug('Filter operation completed', filterResult.metadata);
      return filterResult;

    } catch (error: any) {
      this.logger.error('Filter operation failed', error);
      
      const endTime = performance.now();
      const finalMemory = this.getMemoryUsage();
      const processingTime = endTime - startTime;
      const inputSize = options.maxLines && output.length > options.maxLines ? options.maxLines : output.length;
      
      return {
        success: false,
        filteredOutput: [],
        output: [],
        error: error.message,
        metrics: {
          totalLines: inputSize,
          filteredLines: 0,
          processingTimeMs: processingTime,
          memoryUsageBytes: finalMemory - initialMemory,
          truncated: false,
          filterStats: {}
        },
        metadata: {
          totalLines: inputSize,
          filteredLines: 0,
          processingTimeMs: processingTime,
          memoryUsageBytes: finalMemory - initialMemory,
          truncated: false,
          filterStats: {}
        }
      };
    }
  }

  /**
   * Process large outputs in streaming mode for memory efficiency
   */
  private async processInStreamingMode(
    output: ConsoleOutput[],
    options: FilterOptions
  ): Promise<ConsoleOutput[]> {
    // Streaming mode just returns the data as-is, allowing the caller
    // to process it in chunks if needed. The actual filtering happens
    // in the filter method.
    return output;
  }

  /**
   * Apply time-based filtering with flexible timestamp parsing
   */
  private applyTimeFilter(
    output: ConsoleOutput[],
    since?: string,
    until?: string
  ): { filtered: ConsoleOutput[]; removed: number } {
    if (!since && !until) {
      return { filtered: output, removed: 0 };
    }

    const sinceDate = since ? this.parseTimestamp(since) : null;
    const untilDate = until ? this.parseTimestamp(until) : null;

    const filtered = output.filter(item => {
      const itemDate = new Date(item.timestamp);
      
      if (sinceDate && itemDate < sinceDate) return false;
      if (untilDate && itemDate > untilDate) return false;
      
      return true;
    });

    return {
      filtered,
      removed: output.length - filtered.length
    };
  }

  /**
   * Apply line range filtering with 1-indexed line numbers
   */
  private applyLineRangeFilter(
    output: ConsoleOutput[],
    lineRange: [number, number]
  ): { filtered: ConsoleOutput[]; removed: number } {
    const [start, end] = lineRange;
    
    // Convert to 0-indexed and validate
    const startIdx = Math.max(0, start - 1);
    const endIdx = Math.min(output.length, end);
    
    if (startIdx >= output.length || endIdx <= startIdx) {
      return { filtered: [], removed: output.length };
    }

    const filtered = output.slice(startIdx, endIdx);
    
    return {
      filtered,
      removed: output.length - filtered.length
    };
  }

  /**
   * Apply regex grep filtering with caching and performance optimization
   */
  private applyGrepFilter(
    output: ConsoleOutput[],
    pattern: string,
    options: FilterOptions
  ): { filtered: ConsoleOutput[]; matches: number } {
    const regex = this.getOrCreateRegex(pattern, {
      ignoreCase: options.grepIgnoreCase || false,
      invert: options.grepInvert || false
    });

    let matches = 0;
    const filtered = output.filter(item => {
      const text = item.data;
      const isMatch = regex.test(text);
      
      if (isMatch) matches++;
      
      // Apply invert logic
      return options.grepInvert ? !isMatch : isMatch;
    });

    return { filtered, matches };
  }

  /**
   * Apply multi-pattern filtering with AND/OR logic
   */
  private applyMultiPatternFilter(
    output: ConsoleOutput[],
    multiPattern: NonNullable<FilterOptions['multiPattern']>
  ): { filtered: ConsoleOutput[]; matches: number } {
    const { patterns, logic, ignoreCase } = multiPattern;
    
    const regexes = patterns.map(pattern => 
      this.getOrCreateRegex(pattern, { ignoreCase: ignoreCase || false })
    );

    let matches = 0;
    const filtered = output.filter(item => {
      const text = item.data;
      const results = regexes.map(regex => regex.test(text));
      
      const isMatch = logic === 'AND' 
        ? results.every(result => result)
        : results.some(result => result);
      
      if (isMatch) matches++;
      
      return isMatch;
    });

    return { filtered, matches };
  }

  /**
   * Parse timestamp with flexible formats including relative timestamps
   */
  private parseTimestamp(timestamp: string): Date {
    // Check cache first
    if (this.timestampCache.has(timestamp)) {
      this.metrics.cacheHits++;
      return this.timestampCache.get(timestamp)!;
    }

    this.metrics.cacheMisses++;
    let date: Date;

    // Try ISO format first
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timestamp)) {
      date = new Date(timestamp);
    } else {
      // Handle relative timestamps (5m, 1h, 2d, etc.)
      const match = timestamp.match(/^(\d+)([smhd])$/);
      if (match) {
        const [, value, unit] = match;
        const multiplier = {
          's': 1000,          // seconds
          'm': 60 * 1000,     // minutes
          'h': 60 * 60 * 1000, // hours
          'd': 24 * 60 * 60 * 1000 // days
        }[unit] || 1000;
        
        date = new Date(Date.now() - parseInt(value) * multiplier);
      } else {
        // Fallback to Date constructor
        date = new Date(timestamp);
      }
    }

    // Cache the result
    this.timestampCache.set(timestamp, date);
    
    return date;
  }

  /**
   * Get or create regex with caching for performance
   */
  private getOrCreateRegex(pattern: string, options: { 
    ignoreCase?: boolean; 
    invert?: boolean 
  } = {}): RegExp {
    const cacheKey = `${pattern}:${JSON.stringify(options)}`;
    
    if (this.regexCache.has(cacheKey)) {
      this.metrics.cacheHits++;
      return this.regexCache.get(cacheKey)!;
    }

    this.metrics.cacheMisses++;
    
    // Don't use 'g' flag - we only test for match, not find all matches
    // The 'g' flag causes regex.test() to maintain state and skip matches
    let flags = '';
    if (options.ignoreCase) flags += 'i';
    
    try {
      const regex = new RegExp(pattern, flags);
      
      // Cache with size limit
      if (this.regexCache.size > 100) {
        // Remove oldest entry
        const firstKey = this.regexCache.keys().next().value;
        this.regexCache.delete(firstKey);
      }
      
      this.regexCache.set(cacheKey, regex);
      return regex;
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${pattern}`);
    }
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(processingTime: number, linesProcessed: number, memoryUsed: number): void {
    this.metrics.operationCount++;
    this.metrics.totalProcessingTime += processingTime;
    this.metrics.averageProcessingTime = this.metrics.totalProcessingTime / this.metrics.operationCount;
    this.metrics.maxProcessingTime = Math.max(this.metrics.maxProcessingTime, processingTime);
    this.metrics.totalLinesProcessed += linesProcessed;
    this.metrics.totalMemoryUsed += memoryUsed;
  }

  /**
   * Create empty result for early exit
   */
  private createEmptyResult(startTime: number, initialMemory: number): FilterResult {
    const endTime = performance.now();
    return {
      success: true,
      filteredOutput: [],
      output: [], // Legacy compatibility
      metrics: {
        totalLines: 0,
        filteredLines: 0,
        processingTimeMs: endTime - startTime,
        memoryUsageBytes: this.getMemoryUsage() - initialMemory,
        truncated: false,
        filterStats: {}
      },
      metadata: {
        totalLines: 0,
        filteredLines: 0,
        processingTimeMs: endTime - startTime,
        memoryUsageBytes: this.getMemoryUsage() - initialMemory,
        truncated: false,
        filterStats: {}
      } // Legacy compatibility
    };
  }

  /**
   * Clear caches to free memory
   */
  clearCaches(): void {
    this.regexCache.clear();
    this.timestampCache.clear();
    this.logger.debug('Filter engine caches cleared');
  }

  /**
   * Get performance metrics
   */
  getMetrics(): FilterMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this.metrics = {
      operationCount: 0,
      totalProcessingTime: 0,
      averageProcessingTime: 0,
      maxProcessingTime: 0,
      totalLinesProcessed: 0,
      totalMemoryUsed: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    regexCacheSize: number;
    timestampCacheSize: number;
    cacheHitRatio: number;
  } {
    const totalCacheRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
    
    return {
      regexCacheSize: this.regexCache.size,
      timestampCacheSize: this.timestampCache.size,
      cacheHitRatio: totalCacheRequests > 0 ? this.metrics.cacheHits / totalCacheRequests : 0
    };
  }

  /**
   * Validate filter options for security and correctness
   */
  validateFilterOptions(options: FilterOptions): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate regex patterns
    if (options.grep) {
      try {
        new RegExp(options.grep);
      } catch (error) {
        errors.push(`Invalid regex pattern: ${options.grep}`);
      }
    }

    if (options.multiPattern) {
      for (const pattern of options.multiPattern.patterns) {
        try {
          new RegExp(pattern);
        } catch (error) {
          errors.push(`Invalid regex pattern: ${pattern}`);
        }
      }
    }

    // Validate line ranges
    if (options.lineRange) {
      const [start, end] = options.lineRange;
      if (start < 1) {
        errors.push('Invalid line range: start must be >= 1');
      }
      if (end < start) {
        errors.push('Invalid line range: end must be >= start');
      }
    }

    // Validate limits
    if (options.head && options.head < 1) {
      errors.push('Head count must be >= 1');
    }
    
    if (options.tail && options.tail < 1) {
      errors.push('Tail count must be >= 1');
    }

    if (options.maxLines && options.maxLines < 1) {
      errors.push('Max lines must be >= 1');
    }

    // Validate timestamps
    if (options.since) {
      try {
        this.parseTimestamp(options.since);
      } catch (error) {
        errors.push(`Invalid since timestamp: ${options.since}`);
      }
    }

    if (options.until) {
      try {
        this.parseTimestamp(options.until);
      } catch (error) {
        errors.push(`Invalid until timestamp: ${options.until}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}