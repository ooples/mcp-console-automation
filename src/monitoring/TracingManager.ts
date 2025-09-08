import { EventEmitter } from 'events';
import { initTracer, JaegerTracer, SpanContext } from 'jaeger-client';
import { Span, Tracer, Tags, FORMAT_HTTP_HEADERS } from 'opentracing';
import { v4 as uuidv4 } from 'uuid';
import { TraceSpan, TraceLog } from '../types/index.js';
import { Logger } from '../utils/logger.js';

export class TracingManager extends EventEmitter {
  private logger: Logger;
  private tracer: Tracer | null = null;
  private activeSpans: Map<string, Span> = new Map();
  private traceSpans: Map<string, TraceSpan> = new Map();
  private enabled: boolean = false;

  constructor() {
    super();
    this.logger = new Logger('TracingManager');
  }

  initialize(config?: {
    serviceName?: string;
    agentHost?: string;
    agentPort?: number;
    samplingType?: string;
    samplingParam?: number;
  }): void {
    const jaegerConfig = {
      serviceName: config?.serviceName || 'console-automation-mcp',
      sampler: {
        type: config?.samplingType || 'const',
        param: config?.samplingParam || 1
      },
      reporter: {
        agentHost: config?.agentHost || 'localhost',
        agentPort: config?.agentPort || 6832,
        logSpans: true
      }
    };

    try {
      this.tracer = initTracer(jaegerConfig);
      this.enabled = true;
      this.logger.info('Distributed tracing initialized with Jaeger');
    } catch (error) {
      this.logger.error(`Failed to initialize tracing: ${error}`);
      this.enabled = false;
    }
  }

  // Start a new trace span
  startSpan(operationName: string, parentSpan?: Span | SpanContext, tags?: Record<string, any>): string | null {
    if (!this.enabled || !this.tracer) {
      return null;
    }

    try {
      const spanOptions: any = {};
      
      if (parentSpan) {
        if (parentSpan instanceof SpanContext) {
          spanOptions.childOf = parentSpan;
        } else {
          spanOptions.childOf = parentSpan.context();
        }
      }

      if (tags) {
        spanOptions.tags = tags;
      }

      const span = this.tracer.startSpan(operationName, spanOptions);
      const spanId = uuidv4();
      
      // Store the span for later reference
      this.activeSpans.set(spanId, span);

      // Create our internal span representation
      const traceSpan: TraceSpan = {
        traceId: this.getTraceId(span),
        spanId: spanId,
        parentSpanId: parentSpan ? this.getSpanId(parentSpan) : undefined,
        operationName,
        startTime: new Date(),
        tags: tags || {},
        logs: [],
        status: 'ok'
      };

      this.traceSpans.set(spanId, traceSpan);
      this.emit('span-started', traceSpan);

      return spanId;
    } catch (error) {
      this.logger.error(`Failed to start span: ${error}`);
      return null;
    }
  }

  // Finish a trace span
  finishSpan(spanId: string, error?: Error): void {
    if (!this.enabled || !spanId) {
      return;
    }

    const span = this.activeSpans.get(spanId);
    const traceSpan = this.traceSpans.get(spanId);

    if (!span || !traceSpan) {
      this.logger.warn(`Span not found: ${spanId}`);
      return;
    }

    try {
      if (error) {
        span.setTag(Tags.ERROR, true);
        span.log({
          event: 'error',
          message: error.message,
          stack: error.stack
        });
        traceSpan.status = 'error';
        traceSpan.logs.push({
          timestamp: new Date(),
          fields: {
            event: 'error',
            message: error.message,
            stack: error.stack
          }
        });
      }

      span.finish();
      traceSpan.endTime = new Date();
      traceSpan.duration = traceSpan.endTime.getTime() - traceSpan.startTime.getTime();

      this.activeSpans.delete(spanId);
      this.emit('span-finished', traceSpan);

    } catch (finishError) {
      this.logger.error(`Failed to finish span: ${finishError}`);
    }
  }

  // Add tags to a span
  setSpanTag(spanId: string, key: string, value: any): void {
    if (!this.enabled || !spanId) {
      return;
    }

    const span = this.activeSpans.get(spanId);
    const traceSpan = this.traceSpans.get(spanId);

    if (span && traceSpan) {
      span.setTag(key, value);
      traceSpan.tags[key] = value;
    }
  }

  // Add log entries to a span
  logSpanEvent(spanId: string, event: string, fields?: Record<string, any>): void {
    if (!this.enabled || !spanId) {
      return;
    }

    const span = this.activeSpans.get(spanId);
    const traceSpan = this.traceSpans.get(spanId);

    if (span && traceSpan) {
      const logFields = { event, ...fields };
      span.log(logFields);
      
      traceSpan.logs.push({
        timestamp: new Date(),
        fields: logFields
      });
    }
  }

  // Create a session trace
  startSessionTrace(sessionId: string, command: string, args: string[] = []): string | null {
    const spanId = this.startSpan('console_session', undefined, {
      'session.id': sessionId,
      'session.command': command,
      'session.args': args.join(' '),
      'component': 'console-manager'
    });

    if (spanId) {
      this.logger.debug(`Started session trace: ${sessionId} -> ${spanId}`);
    }

    return spanId;
  }

  // Create a command execution trace
  startCommandTrace(sessionId: string, command: string, parentSpanId?: string): string | null {
    const parentSpan = parentSpanId ? this.activeSpans.get(parentSpanId) : undefined;
    
    const spanId = this.startSpan('command_execution', parentSpan, {
      'session.id': sessionId,
      'command.name': command,
      'component': 'command-executor'
    });

    if (spanId) {
      this.logger.debug(`Started command trace: ${command} -> ${spanId}`);
    }

    return spanId;
  }

  // Create an error detection trace
  startErrorDetectionTrace(sessionId: string, parentSpanId?: string): string | null {
    const parentSpan = parentSpanId ? this.activeSpans.get(parentSpanId) : undefined;
    
    const spanId = this.startSpan('error_detection', parentSpan, {
      'session.id': sessionId,
      'component': 'error-detector'
    });

    return spanId;
  }

  // Get trace context for HTTP headers
  getTraceContext(spanId: string): Record<string, string> {
    if (!this.enabled || !this.tracer || !spanId) {
      return {};
    }

    const span = this.activeSpans.get(spanId);
    if (!span) {
      return {};
    }

    const headers: Record<string, string> = {};
    this.tracer.inject(span.context(), FORMAT_HTTP_HEADERS, headers);
    return headers;
  }

  // Extract trace context from HTTP headers
  extractTraceContext(headers: Record<string, string>): SpanContext | null {
    if (!this.enabled || !this.tracer) {
      return null;
    }

    try {
      return this.tracer.extract(FORMAT_HTTP_HEADERS, headers) as SpanContext;
    } catch (error) {
      this.logger.warn(`Failed to extract trace context: ${error}`);
      return null;
    }
  }

  // Get all trace spans
  getTraceSpans(): TraceSpan[] {
    return Array.from(this.traceSpans.values());
  }

  // Get specific trace span
  getTraceSpan(spanId: string): TraceSpan | undefined {
    return this.traceSpans.get(spanId);
  }

  // Get spans for a specific trace ID
  getSpansByTraceId(traceId: string): TraceSpan[] {
    return Array.from(this.traceSpans.values()).filter(span => span.traceId === traceId);
  }

  // Search spans by operation name
  searchSpans(operationName: string, limit: number = 100): TraceSpan[] {
    return Array.from(this.traceSpans.values())
      .filter(span => span.operationName.includes(operationName))
      .slice(0, limit);
  }

  // Get performance statistics for operations
  getOperationStats(operationName: string): {
    count: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    errorRate: number;
  } {
    const spans = Array.from(this.traceSpans.values())
      .filter(span => span.operationName === operationName && span.duration);

    if (spans.length === 0) {
      return {
        count: 0,
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        errorRate: 0
      };
    }

    const durations = spans.map(span => span.duration!);
    const errors = spans.filter(span => span.status === 'error').length;

    return {
      count: spans.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      errorRate: errors / spans.length
    };
  }

  // Clean up old spans to prevent memory leaks
  cleanupOldSpans(maxAge: number = 3600000): void { // 1 hour default
    const cutoff = Date.now() - maxAge;
    
    Array.from(this.traceSpans.entries()).forEach(([spanId, span]) => {
      if (span.startTime.getTime() < cutoff) {
        this.traceSpans.delete(spanId);
      }
    });
  }

  // Helper methods
  private getTraceId(span: Span): string {
    const context = span.context() as any;
    return context.toTraceId ? context.toTraceId() : context._traceId || uuidv4();
  }

  private getSpanId(span: Span | SpanContext): string {
    if (span instanceof SpanContext) {
      const context = span as any;
      return context.toSpanId ? context.toSpanId() : context._spanId || uuidv4();
    } else {
      const context = span.context() as any;
      return context.toSpanId ? context.toSpanId() : context._spanId || uuidv4();
    }
  }

  // Enable/disable tracing
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.logger.info(`Tracing ${enabled ? 'enabled' : 'disabled'}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Get tracing statistics
  getStats(): {
    enabled: boolean;
    activeSpans: number;
    totalSpans: number;
    tracerInitialized: boolean;
  } {
    return {
      enabled: this.enabled,
      activeSpans: this.activeSpans.size,
      totalSpans: this.traceSpans.size,
      tracerInitialized: this.tracer !== null
    };
  }

  destroy(): void {
    // Finish all active spans
    this.activeSpans.forEach((span, spanId) => {
      try {
        span.finish();
      } catch (error) {
        this.logger.error(`Error finishing span ${spanId}: ${error}`);
      }
    });

    this.activeSpans.clear();
    this.traceSpans.clear();
    this.removeAllListeners();

    if (this.tracer) {
      try {
        (this.tracer as JaegerTracer).close();
      } catch (error) {
        this.logger.error(`Error closing tracer: ${error}`);
      }
    }

    this.enabled = false;
    this.logger.info('TracingManager destroyed');
  }
}