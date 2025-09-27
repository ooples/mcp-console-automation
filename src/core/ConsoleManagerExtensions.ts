/**
 * Extensions to ConsoleManager for Enhanced Streaming
 * This file contains the enhanced streaming methods that integrate with the existing ConsoleManager
 */

import { StreamManager, StreamingConfig, StreamRequest, StreamResponse, StreamStats } from './StreamManager.js';
import { Logger } from '../utils/logger.js';

export interface EnhancedStreamingOptions {
  enableEnhancedStreaming: boolean;
  streamingConfig?: Partial<StreamingConfig>;
  fallbackToLegacy?: boolean;
}

export interface ConsoleManagerStreamingExtensions {
  // Enhanced streaming managers
  enhancedStreamManagers: Map<string, StreamManager>;
  
  // Enhanced streaming methods
  initializeEnhancedStreaming(sessionId: string, config?: Partial<StreamingConfig>): void;
  getEnhancedStream(sessionId: string): StreamManager | undefined;
  getStreamData(request: StreamRequest): StreamResponse;
  addStreamData(sessionId: string, data: string, isError?: boolean): void;
  closeEnhancedStream(sessionId: string): void;
  getStreamingStats(sessionId: string): any;
  
  // Memory management
  getStreamingMemoryUsage(): number;
  optimizeStreamingMemory(): void;
  setStreamingMemoryLimit(limit: number): void;
}

/**
 * Enhanced Streaming Integration for ConsoleManager
 * This class provides the enhanced streaming functionality as a mixin/extension
 */
export class ConsoleManagerStreamingMixin {
  private enhancedStreamManagers = new Map<string, StreamManager>();
  private logger: Logger;
  private streamingEnabled: boolean = true;
  private globalStreamingConfig: StreamingConfig;
  private memoryLimit: number = 10 * 1024 * 1024; // 10MB default limit
  
  constructor(logger: Logger, config?: Partial<StreamingConfig>) {
    this.logger = logger;
    
    // Default enhanced streaming configuration
    this.globalStreamingConfig = {
      bufferSize: 1024,              // 1KB chunks
      maxBufferSize: 8192,           // 8KB max buffer
      maxMemoryUsage: 2097152,       // 2MB per session
      flushInterval: 50,             // 50ms flush interval
      enableFiltering: true,
      enableCompression: false,
      retentionPolicy: 'rolling',
      retentionSize: 100,            // Keep 100 most recent chunks
      retentionTime: 600000,         // 10 minutes
      ...config
    };
  }
  
  /**
   * Initialize enhanced streaming for a session
   */
  initializeEnhancedStreaming(sessionId: string, config?: Partial<StreamingConfig>): void {
    if (!this.streamingEnabled) {
      this.logger.warn(`Enhanced streaming disabled, skipping initialization for session ${sessionId}`);
      return;
    }
    
    if (this.enhancedStreamManagers.has(sessionId)) {
      this.logger.debug(`Enhanced streaming already initialized for session ${sessionId}`);
      return;
    }
    
    // Merge session-specific config with global config
    const sessionConfig = {
      ...this.globalStreamingConfig,
      ...config
    };
    
    // Create enhanced stream manager
    const streamManager = new StreamManager(sessionId, undefined, sessionConfig);
    
    // Set up event handlers for monitoring
    streamManager.on('memory-status', (status) => {
      this.logger.debug(`Memory status for session ${sessionId}:`, status);
      
      if (status.pressure === 'high') {
        this.logger.warn(`High memory pressure detected for session ${sessionId}`, status);
      }
    });
    
    streamManager.on('forced-cleanup', (event) => {
      this.logger.warn(`Forced cleanup triggered for session ${sessionId}:`, event);
    });
    
    streamManager.on('chunk-dropped', (event) => {
      this.logger.warn(`Chunk dropped for session ${sessionId}:`, event);
    });
    
    this.enhancedStreamManagers.set(sessionId, streamManager);
    
    this.logger.info(`Enhanced streaming initialized for session ${sessionId}`, {
      bufferSize: sessionConfig.bufferSize,
      maxMemoryUsage: sessionConfig.maxMemoryUsage,
      retentionPolicy: sessionConfig.retentionPolicy
    });
  }
  
  /**
   * Get enhanced stream manager for a session
   */
  getEnhancedStream(sessionId: string): StreamManager | undefined {
    return this.enhancedStreamManagers.get(sessionId);
  }
  
  /**
   * Get streaming data with advanced options
   */
  getStreamData(request: StreamRequest): StreamResponse {
    const streamManager = this.enhancedStreamManagers.get(request.sessionId);

    if (!streamManager) {
      throw new Error(`No enhanced streaming available for session ${request.sessionId}`);
    }

    // Convert since parameter to proper type if needed
    let since: Date | number | undefined;
    if (request.since) {
      if (typeof request.since === 'string') {
        // Convert string to Date
        since = new Date(request.since);
      } else {
        since = request.since;
      }
    }

    // Get chunks based on the request
    const chunks = since
      ? streamManager.getChunks(since)
      : streamManager.getLatestChunks(request.limit || 100);

    // Apply filtering if specified
    let filteredChunks = chunks;
    if (request.filter) {
      filteredChunks = chunks.filter(chunk => {
        const filter = request.filter!;

        // Apply regex filter
        if (filter.regex && !filter.regex.test(chunk.data)) {
          return false;
        }

        // Apply include filter
        if (filter.include && filter.include.length > 0) {
          const matchesInclude = filter.include.some(pattern =>
            chunk.data.toLowerCase().includes(pattern.toLowerCase())
          );
          if (!matchesInclude) {
            return false;
          }
        }

        // Apply exclude filter
        if (filter.exclude && filter.exclude.length > 0) {
          const matchesExclude = filter.exclude.some(pattern =>
            chunk.data.toLowerCase().includes(pattern.toLowerCase())
          );
          if (matchesExclude) {
            return false;
          }
        }

        // Apply custom filter
        if (filter.customFilter && !filter.customFilter(chunk)) {
          return false;
        }

        return true;
      });
    }

    const streamStats = streamManager.getStats();

    // Map the stream manager stats to StreamStats interface
    const stats: StreamStats = {
      totalChunks: streamStats.chunks,
      totalBytes: streamStats.memoryBytes,
      filteredChunks: filteredChunks.length,
      filteredBytes: filteredChunks.reduce((sum, chunk) => sum + chunk.size, 0),
      memoryUsage: streamStats.memoryBytes,
      averageChunkSize: streamStats.chunks > 0 ? streamStats.memoryBytes / streamStats.chunks : 0,
      bufferUtilization: 0, // Not available in current stats
      droppedChunks: 0, // Not available in current stats
      compressionRatio: undefined
    };

    return {
      sessionId: request.sessionId,
      chunks: filteredChunks,
      hasMore: chunks.length === (request.limit || 100),
      nextCursor: filteredChunks.length > 0
        ? filteredChunks[filteredChunks.length - 1].timestamp.toISOString()
        : undefined,
      stats
    };
  }
  
  /**
   * Add data to enhanced streaming
   */
  addStreamData(sessionId: string, data: string, isError: boolean = false): void {
    const streamManager = this.enhancedStreamManagers.get(sessionId);
    
    if (!streamManager) {
      // If enhanced streaming isn't initialized, attempt to initialize it
      this.initializeEnhancedStreaming(sessionId);
      const newStreamManager = this.enhancedStreamManagers.get(sessionId);
      
      if (!newStreamManager) {
        this.logger.warn(`Failed to initialize enhanced streaming for session ${sessionId}, data will be lost`);
        return;
      }
      
      newStreamManager.addChunk(data, isError);
      return;
    }

    streamManager.addChunk(data, isError);
  }
  
  /**
   * Close enhanced streaming for a session
   */
  closeEnhancedStream(sessionId: string): void {
    const streamManager = this.enhancedStreamManagers.get(sessionId);

    if (streamManager) {
      streamManager.end();
      this.enhancedStreamManagers.delete(sessionId);
      this.logger.debug(`Enhanced streaming closed for session ${sessionId}`);
    }
  }
  
  /**
   * Get streaming statistics for a session
   */
  getStreamingStats(sessionId: string): any {
    const streamManager = this.enhancedStreamManagers.get(sessionId);
    
    if (!streamManager) {
      return null;
    }
    
    return streamManager.getStats();
  }
  
  /**
   * Get total memory usage across all streaming sessions
   */
  getStreamingMemoryUsage(): number {
    let totalMemory = 0;
    
    for (const [sessionId, streamManager] of this.enhancedStreamManagers) {
      const stats = streamManager.getStats();
      totalMemory += stats.memoryBytes;
    }
    
    return totalMemory;
  }
  
  /**
   * Optimize memory usage across all streaming sessions
   */
  optimizeStreamingMemory(): void {
    const totalMemory = this.getStreamingMemoryUsage();
    
    if (totalMemory > this.memoryLimit) {
      this.logger.warn(`Total streaming memory usage (${totalMemory} bytes) exceeds limit (${this.memoryLimit} bytes), optimizing...`);
      
      // Sort sessions by memory usage (highest first)
      const sessionsByMemory = Array.from(this.enhancedStreamManagers.entries())
        .map(([sessionId, streamManager]) => ({
          sessionId,
          streamManager,
          memoryUsage: streamManager.getStats().memoryBytes
        }))
        .sort((a, b) => b.memoryUsage - a.memoryUsage);
      
      // Clear the highest memory usage sessions until we're under the limit
      let currentMemory = totalMemory;
      
      for (const session of sessionsByMemory) {
        if (currentMemory <= this.memoryLimit) {
          break;
        }
        
        this.logger.info(`Clearing enhanced stream for session ${session.sessionId} to free ${session.memoryUsage} bytes`);
        session.streamManager.clear();
        currentMemory -= session.memoryUsage;
      }
      
      this.logger.info(`Memory optimization complete. Memory usage reduced from ${totalMemory} to ${currentMemory} bytes`);
    }
  }
  
  /**
   * Set the global memory limit for streaming
   */
  setStreamingMemoryLimit(limit: number): void {
    this.memoryLimit = limit;
    this.logger.info(`Streaming memory limit set to ${limit} bytes`);
  }
  
  /**
   * Clean up all enhanced streaming resources
   */
  destroyEnhancedStreaming(): void {
    for (const [sessionId, streamManager] of this.enhancedStreamManagers) {
      streamManager.end();
    }

    this.enhancedStreamManagers.clear();
    this.logger.info('All enhanced streaming resources cleaned up');
  }
  
  /**
   * Get comprehensive streaming status
   */
  getEnhancedStreamingStatus(): any {
    const sessions = Array.from(this.enhancedStreamManagers.entries()).map(([sessionId, streamManager]) => {
      const stats = streamManager.getStats();
      return {
        sessionId,
        stats,
        isActive: true
      };
    });
    
    return {
      totalSessions: sessions.length,
      totalMemoryUsage: this.getStreamingMemoryUsage(),
      memoryLimit: this.memoryLimit,
      memoryUtilization: (this.getStreamingMemoryUsage() / this.memoryLimit) * 100,
      sessions,
      globalConfig: this.globalStreamingConfig
    };
  }
  
  /**
   * Enable or disable enhanced streaming globally
   */
  setStreamingEnabled(enabled: boolean): void {
    this.streamingEnabled = enabled;
    
    if (!enabled) {
      // Close all existing streams
      this.destroyEnhancedStreaming();
    }
    
    this.logger.info(`Enhanced streaming ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// Export types for integration
export type { StreamingConfig, StreamRequest, StreamResponse, StreamStats } from './StreamManager.js';