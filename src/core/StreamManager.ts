import { EventEmitter } from 'eventemitter3';

export interface StreamChunk {
  data: string;
  timestamp: Date;
  isError: boolean;
  sequenceId: number;
  size: number;
}

export interface StreamBuffer {
  data: string;
  timestamp: Date;
  flushed: boolean;
  size: number;
}

export interface OutputCaptureConfig {
  enableRealTimeCapture: boolean;
  bufferFlushInterval: number;
  maxChunkSize: number;
  enablePolling: boolean;
  pollingInterval: number;
  immediateFlush: boolean;
  chunkCombinationTimeout: number;
}

export class StreamManager extends EventEmitter {
  private chunks: StreamChunk[];
  private subscribers: Set<(chunk: StreamChunk) => void>;
  private realtimeSubscribers: Set<(data: string, timestamp: Date) => void>;
  private isEnded: boolean;
  private maxChunks: number = 1000;
  private sequenceCounter: number = 0;
  
  // Enhanced buffering system
  private outputBuffer: StreamBuffer[];
  private pendingBuffer: string = '';
  private bufferFlushTimer: NodeJS.Timeout | null = null;
  private chunkCombinationTimer: NodeJS.Timeout | null = null;
  private config: OutputCaptureConfig;
  
  // Output polling mechanism
  private pollingTimer: NodeJS.Timeout | null = null;
  private lastOutputTime: Date = new Date();
  private outputListeners: Map<string, (data: string) => void> = new Map();

  constructor(
    private sessionId: string,
    config?: Partial<OutputCaptureConfig>
  ) {
    super();
    this.chunks = [];
    this.subscribers = new Set();
    this.realtimeSubscribers = new Set();
    this.isEnded = false;
    this.outputBuffer = [];
    
    // Default configuration for immediate output capture
    this.config = {
      enableRealTimeCapture: true,
      bufferFlushInterval: 10, // 10ms for near-immediate flush
      maxChunkSize: 8192,
      enablePolling: true,
      pollingInterval: 50, // 50ms polling interval
      immediateFlush: true,
      chunkCombinationTimeout: 20, // 20ms to combine rapid chunks
      ...config
    };
    
    this.initializeBuffering();
    
    if (this.config.enablePolling) {
      this.startOutputPolling();
    }
  }

  /**
   * Initialize the buffering system for immediate output capture
   */
  private initializeBuffering(): void {
    // Setup automatic buffer flushing
    if (this.config.bufferFlushInterval > 0) {
      this.bufferFlushTimer = setInterval(() => {
        this.flushBuffer();
      }, this.config.bufferFlushInterval);
    }
  }

  /**
   * Start output polling mechanism
   */
  private startOutputPolling(): void {
    this.pollingTimer = setInterval(() => {
      this.pollForOutput();
    }, this.config.pollingInterval);
  }

  /**
   * Poll for any pending output that might not have been captured
   */
  private pollForOutput(): void {
    if (this.pendingBuffer.length > 0) {
      this.flushPendingBuffer();
    }
    
    // Emit polling event for external listeners
    this.emit('poll', {
      sessionId: this.sessionId,
      timestamp: new Date(),
      hasData: this.pendingBuffer.length > 0
    });
  }

  /**
   * Add chunk with immediate processing and real-time capture
   */
  addChunk(data: string, isError: boolean = false): void {
    if (this.isEnded) return;

    const timestamp = new Date();
    this.lastOutputTime = timestamp;

    // Handle immediate flush if configured
    if (this.config.immediateFlush) {
      this.processImmediateChunk(data, isError, timestamp);
    } else {
      // Add to pending buffer for batch processing
      this.addToPendingBuffer(data, isError, timestamp);
    }

    // Notify real-time subscribers immediately
    if (this.config.enableRealTimeCapture) {
      this.realtimeSubscribers.forEach(subscriber => {
        try {
          subscriber(data, timestamp);
        } catch (error) {
          console.error('Error in realtime subscriber:', error);
        }
      });
    }
  }

  /**
   * Process chunk immediately without buffering
   */
  private processImmediateChunk(data: string, isError: boolean, timestamp: Date): void {
    const chunk: StreamChunk = {
      data,
      timestamp,
      isError,
      sequenceId: ++this.sequenceCounter,
      size: Buffer.byteLength(data, 'utf8')
    };

    this.chunks.push(chunk);
    
    // Maintain max chunks limit
    if (this.chunks.length > this.maxChunks) {
      this.chunks.shift();
    }

    // Notify subscribers immediately
    this.notifySubscribers(chunk);

    // Emit chunk event
    this.emit('chunk', chunk);
    this.emit('immediate-output', { chunk, sessionId: this.sessionId });
  }

  /**
   * Add data to pending buffer for batch processing
   */
  private addToPendingBuffer(data: string, isError: boolean, timestamp: Date): void {
    this.pendingBuffer += data;
    
    // Add to buffer structure
    this.outputBuffer.push({
      data,
      timestamp,
      flushed: false,
      size: Buffer.byteLength(data, 'utf8')
    });

    // Setup chunk combination timer
    if (this.chunkCombinationTimer) {
      clearTimeout(this.chunkCombinationTimer);
    }

    this.chunkCombinationTimer = setTimeout(() => {
      this.flushPendingBuffer();
    }, this.config.chunkCombinationTimeout);

    // Force flush if buffer gets too large
    if (this.pendingBuffer.length > this.config.maxChunkSize) {
      this.flushPendingBuffer();
    }
  }

  /**
   * Flush pending buffer to create chunks
   */
  private flushPendingBuffer(): void {
    if (this.pendingBuffer.length === 0) return;

    const data = this.pendingBuffer;
    const timestamp = new Date();
    
    // Determine if any of the buffered data was from stderr
    const hasErrors = this.outputBuffer.some(buf => !buf.flushed);
    
    const chunk: StreamChunk = {
      data,
      timestamp,
      isError: hasErrors,
      sequenceId: ++this.sequenceCounter,
      size: Buffer.byteLength(data, 'utf8')
    };

    this.chunks.push(chunk);
    
    // Maintain max chunks limit
    if (this.chunks.length > this.maxChunks) {
      this.chunks.shift();
    }

    // Mark buffer entries as flushed
    this.outputBuffer.forEach(buf => buf.flushed = true);
    
    // Clear pending buffer
    this.pendingBuffer = '';
    
    // Clear combination timer
    if (this.chunkCombinationTimer) {
      clearTimeout(this.chunkCombinationTimer);
      this.chunkCombinationTimer = null;
    }

    // Notify subscribers
    this.notifySubscribers(chunk);

    // Emit events
    this.emit('chunk', chunk);
    this.emit('buffer-flushed', { chunk, sessionId: this.sessionId });
  }

  /**
   * Flush entire buffer system
   */
  private flushBuffer(): void {
    this.flushPendingBuffer();
    
    // Clean up old buffer entries
    const cutoff = Date.now() - (5 * 60 * 1000); // 5 minutes
    this.outputBuffer = this.outputBuffer.filter(buf => 
      buf.timestamp.getTime() > cutoff
    );
  }

  /**
   * Notify all subscribers safely
   */
  private notifySubscribers(chunk: StreamChunk): void {
    this.subscribers.forEach(subscriber => {
      try {
        subscriber(chunk);
      } catch (error) {
        console.error('Error in stream subscriber:', error);
      }
    });
  }

  /**
   * Subscribe to chunk events
   */
  subscribe(callback: (chunk: StreamChunk) => void): () => void {
    this.subscribers.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Subscribe to real-time output events (immediate, no buffering)
   */
  subscribeRealtime(callback: (data: string, timestamp: Date) => void): () => void {
    this.realtimeSubscribers.add(callback);
    
    return () => {
      this.realtimeSubscribers.delete(callback);
    };
  }

  /**
   * Register output listener for polling mechanism
   */
  registerOutputListener(listenerId: string, callback: (data: string) => void): void {
    this.outputListeners.set(listenerId, callback);
  }

  /**
   * Unregister output listener
   */
  unregisterOutputListener(listenerId: string): void {
    this.outputListeners.delete(listenerId);
  }

  /**
   * Force immediate flush of all pending buffers
   */
  forceFlush(): void {
    this.flushPendingBuffer();
    this.flushBuffer();
    this.emit('force-flush', { sessionId: this.sessionId, timestamp: new Date() });
  }

  /**
   * Get chunks since a specific time or sequence ID
   */
  getChunks(since?: Date | number): StreamChunk[] {
    if (!since) {
      return [...this.chunks];
    }
    
    if (typeof since === 'number') {
      // Filter by sequence ID
      return this.chunks.filter(chunk => chunk.sequenceId > since);
    }
    
    // Filter by timestamp
    return this.chunks.filter(chunk => chunk.timestamp > since);
  }

  /**
   * Get latest chunks up to a limit
   */
  getLatestChunks(limit: number = 10): StreamChunk[] {
    return this.chunks.slice(-limit);
  }

  /**
   * Get full output with options for filtering
   */
  getFullOutput(options?: {
    includeErrors?: boolean;
    since?: Date;
    maxLength?: number;
  }): string {
    let chunks = this.chunks;
    
    if (options?.since) {
      chunks = chunks.filter(c => c.timestamp > options.since!);
    }
    
    if (options?.includeErrors === false) {
      chunks = chunks.filter(c => !c.isError);
    }
    
    let output = chunks.map(c => c.data).join('');
    
    if (options?.maxLength && output.length > options.maxLength) {
      output = output.substring(0, options.maxLength) + '...[truncated]';
    }
    
    return output;
  }

  /**
   * Get pending buffer content
   */
  getPendingOutput(): string {
    return this.pendingBuffer;
  }

  /**
   * Get buffer statistics
   */
  getBufferStats(): {
    pendingSize: number;
    bufferEntries: number;
    lastOutputTime: Date;
    isPolling: boolean;
  } {
    return {
      pendingSize: this.pendingBuffer.length,
      bufferEntries: this.outputBuffer.length,
      lastOutputTime: this.lastOutputTime,
      isPolling: this.pollingTimer !== null
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<OutputCaptureConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    // Restart timers if intervals changed
    if (oldConfig.bufferFlushInterval !== this.config.bufferFlushInterval) {
      if (this.bufferFlushTimer) {
        clearInterval(this.bufferFlushTimer);
      }
      this.initializeBuffering();
    }
    
    if (oldConfig.pollingInterval !== this.config.pollingInterval ||
        oldConfig.enablePolling !== this.config.enablePolling) {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }
      if (this.config.enablePolling) {
        this.startOutputPolling();
      }
    }
    
    this.emit('config-updated', { oldConfig, newConfig: this.config });
  }

  /**
   * Clear all buffers and chunks
   */
  clear(): void {
    this.chunks = [];
    this.outputBuffer = [];
    this.pendingBuffer = '';
    
    if (this.chunkCombinationTimer) {
      clearTimeout(this.chunkCombinationTimer);
      this.chunkCombinationTimer = null;
    }
    
    this.emit('clear');
  }

  /**
   * End the stream and cleanup all resources
   */
  end(): void {
    this.isEnded = true;
    
    // Flush any pending output before ending
    this.forceFlush();
    
    // Clean up timers
    if (this.bufferFlushTimer) {
      clearInterval(this.bufferFlushTimer);
      this.bufferFlushTimer = null;
    }
    
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    
    if (this.chunkCombinationTimer) {
      clearTimeout(this.chunkCombinationTimer);
      this.chunkCombinationTimer = null;
    }
    
    // Clear subscribers
    this.subscribers.clear();
    this.realtimeSubscribers.clear();
    this.outputListeners.clear();
    
    this.emit('end');
  }

  /**
   * Check if stream is actively capturing output
   */
  isStreaming(): boolean {
    return !this.isEnded && (
      this.subscribers.size > 0 || 
      this.realtimeSubscribers.size > 0 ||
      this.outputListeners.size > 0
    );
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): {
    chunks: number;
    subscribers: number;
    realtimeSubscribers: number;
    outputListeners: number;
    memoryBytes: number;
    pendingBytes: number;
    bufferEntries: number;
    isEnded: boolean;
    config: OutputCaptureConfig;
    lastOutputTime: Date;
    sequenceCounter: number;
  } {
    const memoryBytes = this.chunks.reduce((acc, chunk) => {
      return acc + (chunk.data.length * 2); // Approximate UTF-16 bytes
    }, 0);

    const pendingBytes = Buffer.byteLength(this.pendingBuffer, 'utf8');

    return {
      chunks: this.chunks.length,
      subscribers: this.subscribers.size,
      realtimeSubscribers: this.realtimeSubscribers.size,
      outputListeners: this.outputListeners.size,
      memoryBytes,
      pendingBytes,
      bufferEntries: this.outputBuffer.length,
      isEnded: this.isEnded,
      config: { ...this.config },
      lastOutputTime: this.lastOutputTime,
      sequenceCounter: this.sequenceCounter
    };
  }

  /**
   * Process console output - compatibility method for ConsoleManager
   */
  processOutput(output: any): void {
    if (typeof output === 'string') {
      this.addChunk(output);
    } else if (output && typeof output.data === 'string') {
      this.addChunk(output.data, output.type === 'stderr');
    }
  }

  /**
   * Add error patterns - compatibility method
   */
  addPatterns(patterns: any[]): void {
    // This is a no-op for StreamManager as it doesn't handle patterns
    // The actual pattern handling is done by ErrorDetector
  }

  /**
   * Remove error patterns - compatibility method
   */
  removePatterns(patterns: any[]): void {
    // This is a no-op for StreamManager as it doesn't handle patterns
    // The actual pattern handling is done by ErrorDetector
  }
}