import { ConsoleOutput } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';

/**
 * Pagination configuration options
 */
export interface PaginationOptions {
  defaultPageSize?: number;
  maxPageSize?: number;
  minPageSize?: number;
  enableContinuationTokens?: boolean;
  maxBufferSize?: number;
}

/**
 * Pagination request parameters
 */
export interface PaginationRequest {
  sessionId: string;
  offset?: number;
  limit?: number;
  continuationToken?: string;
}

/**
 * Pagination response with metadata
 */
export interface PaginationResponse {
  output: string;
  data: ConsoleOutput[];
  hasMore: boolean;
  nextToken?: string;
  totalLines: number;
  currentOffset: number;
  pageSize: number;
  timestamp: string;
}

/**
 * Continuation token structure
 */
interface ContinuationToken {
  sessionId: string;
  offset: number;
  limit: number;
  timestamp: number;
  checksum: string;
}

/**
 * Session buffer with efficient indexing
 */
interface SessionBuffer {
  sessionId: string;
  outputs: ConsoleOutput[];
  lineIndex: Map<number, number>; // line number -> array index
  createdAt: number;
  lastAccessed: number;
  totalLines: number;
}

/**
 * OutputPaginationManager provides efficient pagination for large console outputs
 */
export class OutputPaginationManager extends EventEmitter {
  private readonly logger: Logger;
  private readonly options: Required<PaginationOptions>;
  private readonly sessionBuffers: Map<string, SessionBuffer>;
  private readonly tokenCache: Map<string, ContinuationToken>;
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(options: PaginationOptions = {}) {
    super();

    this.logger = Logger.getInstance();

    // Set default options with validation
    this.options = {
      defaultPageSize: Math.min(Math.max(options.defaultPageSize || 1000, 100), 10000),
      maxPageSize: Math.min(options.maxPageSize || 10000, 50000),
      minPageSize: Math.max(options.minPageSize || 100, 10),
      enableContinuationTokens: options.enableContinuationTokens !== false,
      maxBufferSize: Math.max(options.maxBufferSize || 100000, 10000)
    };

    this.sessionBuffers = new Map();
    this.tokenCache = new Map();

    // Cleanup expired tokens and unused buffers every 30 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30 * 60 * 1000);

    this.logger.info('OutputPaginationManager initialized', {
      options: this.options
    });
  }

  /**
   * Add outputs to session buffer with efficient indexing
   */
  addOutputs(sessionId: string, outputs: ConsoleOutput[]): void {
    if (!outputs || outputs.length === 0) return;

    let buffer = this.sessionBuffers.get(sessionId);
    if (!buffer) {
      buffer = {
        sessionId,
        outputs: [],
        lineIndex: new Map(),
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        totalLines: 0
      };
      this.sessionBuffers.set(sessionId, buffer);
    }

    const startIndex = buffer.outputs.length;
    buffer.outputs.push(...outputs);

    // Build line index for efficient random access
    for (let i = 0; i < outputs.length; i++) {
      buffer.lineIndex.set(buffer.totalLines + i, startIndex + i);
    }

    buffer.totalLines += outputs.length;
    buffer.lastAccessed = Date.now();

    // Enforce buffer size limits
    if (buffer.outputs.length > this.options.maxBufferSize) {
      const overflow = buffer.outputs.length - this.options.maxBufferSize;
      this.trimBuffer(buffer, overflow);
    }

    this.emit('outputs-added', { sessionId, count: outputs.length, totalLines: buffer.totalLines });
  }

  /**
   * Get paginated output with continuation token support
   */
  getPaginatedOutput(request: PaginationRequest): PaginationResponse {
    const { sessionId, offset, limit, continuationToken } = request;

    const buffer = this.sessionBuffers.get(sessionId);
    if (!buffer) {
      return this.createEmptyResponse(sessionId, offset || 0, limit || this.options.defaultPageSize);
    }

    buffer.lastAccessed = Date.now();

    let actualOffset = offset || 0;
    let actualLimit = limit || this.options.defaultPageSize;

    // Parse continuation token if provided
    if (continuationToken && this.options.enableContinuationTokens) {
      try {
        const token = this.parseContinuationToken(continuationToken);
        if (token.sessionId === sessionId) {
          actualOffset = token.offset;
          actualLimit = token.limit;

          // Validate token integrity
          if (!this.validateToken(token, buffer)) {
            this.logger.warn('Invalid continuation token detected', {
              sessionId,
              tokenOffset: token.offset
            });
            return this.createErrorResponse(sessionId, 'Invalid continuation token');
          }
        }
      } catch (error) {
        this.logger.error('Failed to parse continuation token', { error, sessionId });
        return this.createErrorResponse(sessionId, 'Invalid continuation token format');
      }
    }

    // Validate and clamp parameters
    actualOffset = Math.max(0, Math.min(actualOffset, buffer.totalLines));
    actualLimit = Math.min(Math.max(actualLimit, this.options.minPageSize), this.options.maxPageSize);

    // Extract the requested range
    const endOffset = Math.min(actualOffset + actualLimit, buffer.totalLines);
    const requestedOutputs: ConsoleOutput[] = [];

    for (let lineNum = actualOffset; lineNum < endOffset; lineNum++) {
      const arrayIndex = buffer.lineIndex.get(lineNum);
      if (arrayIndex !== undefined && buffer.outputs[arrayIndex]) {
        requestedOutputs.push(buffer.outputs[arrayIndex]);
      }
    }

    const hasMore = endOffset < buffer.totalLines;
    let nextToken: string | undefined;

    // Generate continuation token for next page
    if (hasMore && this.options.enableContinuationTokens) {
      nextToken = this.createContinuationToken({
        sessionId,
        offset: endOffset,
        limit: actualLimit,
        timestamp: Date.now(),
        checksum: this.calculateBufferChecksum(buffer)
      });
    }

    const outputText = requestedOutputs.map(o => o.data).join('');

    this.logger.debug('Paginated output retrieved', {
      sessionId,
      offset: actualOffset,
      limit: actualLimit,
      returnedLines: requestedOutputs.length,
      hasMore,
      totalLines: buffer.totalLines
    });

    return {
      output: outputText,
      data: requestedOutputs,
      hasMore,
      nextToken,
      totalLines: buffer.totalLines,
      currentOffset: actualOffset,
      pageSize: requestedOutputs.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get output with backward compatibility (non-paginated)
   */
  getOutput(sessionId: string, limit?: number): ConsoleOutput[] {
    const buffer = this.sessionBuffers.get(sessionId);
    if (!buffer) return [];

    buffer.lastAccessed = Date.now();

    if (!limit) return buffer.outputs.slice();

    // Return last N items for backward compatibility
    return buffer.outputs.slice(-limit);
  }

  /**
   * Clear output buffer for session
   */
  clearOutput(sessionId: string): void {
    const buffer = this.sessionBuffers.get(sessionId);
    if (!buffer) return;

    buffer.outputs.length = 0;
    buffer.lineIndex.clear();
    buffer.totalLines = 0;
    buffer.lastAccessed = Date.now();

    // Invalidate all tokens for this session
    this.invalidateSessionTokens(sessionId);

    this.emit('output-cleared', { sessionId });
    this.logger.info('Output buffer cleared', { sessionId });
  }

  /**
   * Remove session buffer and cleanup resources
   */
  removeSession(sessionId: string): void {
    const buffer = this.sessionBuffers.get(sessionId);
    if (buffer) {
      this.sessionBuffers.delete(sessionId);
      this.invalidateSessionTokens(sessionId);

      this.emit('session-removed', { sessionId, totalLines: buffer.totalLines });
      this.logger.info('Session buffer removed', { sessionId });
    }
  }

  /**
   * Get buffer statistics for monitoring
   */
  getBufferStats(sessionId?: string): any {
    if (sessionId) {
      const buffer = this.sessionBuffers.get(sessionId);
      if (!buffer) return null;

      return {
        sessionId: buffer.sessionId,
        totalLines: buffer.totalLines,
        bufferSize: buffer.outputs.length,
        memoryUsageMB: this.calculateBufferMemoryUsage(buffer),
        createdAt: new Date(buffer.createdAt).toISOString(),
        lastAccessed: new Date(buffer.lastAccessed).toISOString(),
        ageMinutes: (Date.now() - buffer.createdAt) / (1000 * 60)
      };
    }

    // Global statistics
    const totalSessions = this.sessionBuffers.size;
    const totalLines = Array.from(this.sessionBuffers.values()).reduce((sum, b) => sum + b.totalLines, 0);
    const totalMemoryMB = Array.from(this.sessionBuffers.values()).reduce(
      (sum, b) => sum + this.calculateBufferMemoryUsage(b), 0
    );

    return {
      totalSessions,
      totalLines,
      totalMemoryMB,
      averageLinesPerSession: totalSessions > 0 ? Math.round(totalLines / totalSessions) : 0,
      activeTokens: this.tokenCache.size,
      options: this.options
    };
  }

  /**
   * Create continuation token
   */
  private createContinuationToken(token: ContinuationToken): string {
    const tokenId = uuidv4();
    this.tokenCache.set(tokenId, token);

    // Create encoded token
    const encoded = Buffer.from(JSON.stringify({
      id: tokenId,
      ts: token.timestamp,
      cs: token.checksum.substring(0, 8) // Short checksum for verification
    })).toString('base64url');

    return encoded;
  }

  /**
   * Parse continuation token
   */
  private parseContinuationToken(tokenString: string): ContinuationToken {
    const decoded = JSON.parse(Buffer.from(tokenString, 'base64url').toString());
    const token = this.tokenCache.get(decoded.id);

    if (!token) {
      throw new Error('Token expired or invalid');
    }

    // Verify short checksum
    if (token.checksum.substring(0, 8) !== decoded.cs) {
      throw new Error('Token integrity check failed');
    }

    return token;
  }

  /**
   * Validate token against current buffer state
   */
  private validateToken(token: ContinuationToken, buffer: SessionBuffer): boolean {
    // Check if buffer has been modified since token creation
    const currentChecksum = this.calculateBufferChecksum(buffer);
    return currentChecksum === token.checksum;
  }

  /**
   * Calculate buffer checksum for integrity verification
   */
  private calculateBufferChecksum(buffer: SessionBuffer): string {
    const data = `${buffer.sessionId}:${buffer.totalLines}:${buffer.lastAccessed}`;
    return createHash('md5').update(data).digest('hex');
  }

  /**
   * Calculate approximate memory usage of buffer
   */
  private calculateBufferMemoryUsage(buffer: SessionBuffer): number {
    let totalBytes = 0;
    for (const output of buffer.outputs) {
      totalBytes += (output.data?.length || 0) * 2; // Assume UTF-16 encoding
      totalBytes += 64; // Approximate overhead per ConsoleOutput object
    }
    totalBytes += buffer.lineIndex.size * 16; // Map overhead
    return Math.round(totalBytes / (1024 * 1024) * 100) / 100; // MB rounded to 2 decimals
  }

  /**
   * Trim buffer to stay within size limits
   */
  private trimBuffer(buffer: SessionBuffer, removeCount: number): void {
    if (removeCount <= 0) return;

    const actualRemoveCount = Math.min(removeCount, buffer.outputs.length);
    buffer.outputs.splice(0, actualRemoveCount);

    // Rebuild line index
    buffer.lineIndex.clear();
    for (let i = 0; i < buffer.outputs.length; i++) {
      buffer.lineIndex.set(i, i);
    }

    buffer.totalLines = buffer.outputs.length;

    this.logger.debug('Buffer trimmed', {
      sessionId: buffer.sessionId,
      removedLines: actualRemoveCount,
      remainingLines: buffer.totalLines
    });

    // Invalidate tokens since buffer structure changed
    this.invalidateSessionTokens(buffer.sessionId);
  }

  /**
   * Invalidate all tokens for a session
   */
  private invalidateSessionTokens(sessionId: string): void {
    const toDelete: string[] = [];
    for (const [tokenId, token] of this.tokenCache.entries()) {
      if (token.sessionId === sessionId) {
        toDelete.push(tokenId);
      }
    }

    toDelete.forEach(tokenId => this.tokenCache.delete(tokenId));
  }

  /**
   * Clean up expired tokens and unused buffers
   */
  private cleanup(): void {
    const now = Date.now();
    const maxTokenAge = 60 * 60 * 1000; // 1 hour
    const maxBufferIdleTime = 24 * 60 * 60 * 1000; // 24 hours

    // Clean expired tokens
    let expiredTokens = 0;
    for (const [tokenId, token] of this.tokenCache.entries()) {
      if (now - token.timestamp > maxTokenAge) {
        this.tokenCache.delete(tokenId);
        expiredTokens++;
      }
    }

    // Clean idle buffers
    let removedBuffers = 0;
    for (const [sessionId, buffer] of this.sessionBuffers.entries()) {
      if (now - buffer.lastAccessed > maxBufferIdleTime) {
        this.sessionBuffers.delete(sessionId);
        removedBuffers++;
      }
    }

    if (expiredTokens > 0 || removedBuffers > 0) {
      this.logger.info('Pagination cleanup completed', {
        expiredTokens,
        removedBuffers,
        activeTokens: this.tokenCache.size,
        activeBuffers: this.sessionBuffers.size
      });
    }
  }

  /**
   * Create empty response for non-existent sessions
   */
  private createEmptyResponse(sessionId: string, offset: number, limit: number): PaginationResponse {
    return {
      output: '',
      data: [],
      hasMore: false,
      totalLines: 0,
      currentOffset: offset,
      pageSize: 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create error response
   */
  private createErrorResponse(sessionId: string, error: string): PaginationResponse {
    return {
      output: `Error: ${error}`,
      data: [],
      hasMore: false,
      totalLines: 0,
      currentOffset: 0,
      pageSize: 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Shutdown cleanup
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.sessionBuffers.clear();
    this.tokenCache.clear();
    this.removeAllListeners();
    this.logger.info('OutputPaginationManager destroyed');
  }
}

// Utility function to generate UUID for tokens
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}