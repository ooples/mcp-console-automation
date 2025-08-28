import { EventEmitter } from 'eventemitter3';

export interface StreamChunk {
  data: string;
  timestamp: Date;
  isError: boolean;
}

export class StreamManager extends EventEmitter {
  private chunks: StreamChunk[];
  private subscribers: Set<(chunk: StreamChunk) => void>;
  private isEnded: boolean;
  private maxChunks: number = 1000;

  constructor(_sessionId: string) {
    super();
    this.chunks = [];
    this.subscribers = new Set();
    this.isEnded = false;
  }

  addChunk(data: string, isError: boolean = false): void {
    if (this.isEnded) return;

    const chunk: StreamChunk = {
      data,
      timestamp: new Date(),
      isError
    };

    this.chunks.push(chunk);
    
    // Maintain max chunks limit
    if (this.chunks.length > this.maxChunks) {
      this.chunks.shift();
    }

    // Notify subscribers
    this.subscribers.forEach(subscriber => {
      try {
        subscriber(chunk);
      } catch (error) {
        console.error('Error in stream subscriber:', error);
      }
    });

    this.emit('chunk', chunk);
  }

  subscribe(callback: (chunk: StreamChunk) => void): () => void {
    this.subscribers.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  getChunks(since?: Date): StreamChunk[] {
    if (!since) {
      return [...this.chunks];
    }
    
    return this.chunks.filter(chunk => chunk.timestamp > since);
  }

  getFullOutput(): string {
    return this.chunks.map(c => c.data).join('');
  }

  clear(): void {
    this.chunks = [];
    this.emit('clear');
  }

  end(): void {
    this.isEnded = true;
    this.emit('end');
    this.subscribers.clear();
  }

  isStreaming(): boolean {
    return !this.isEnded && this.subscribers.size > 0;
  }

  getStats(): {
    chunks: number;
    subscribers: number;
    memoryBytes: number;
    isEnded: boolean;
  } {
    const memoryBytes = this.chunks.reduce((acc, chunk) => {
      return acc + (chunk.data.length * 2); // Approximate UTF-16 bytes
    }, 0);

    return {
      chunks: this.chunks.length,
      subscribers: this.subscribers.size,
      memoryBytes,
      isEnded: this.isEnded
    };
  }
}