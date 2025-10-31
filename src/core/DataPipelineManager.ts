/**
 * Data Pipeline Integration Manager
 * Handles data flow, transformations, and integration with external data sources
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  DataFlowDefinition,
  DataInput,
  DataOutput,
  DataTransformation,
  DataValidation,
  ValidationRule,
  DataSource,
  DataDestination,
  WorkflowExecution,
} from '../types/workflow.js';
import { Logger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface DataPipelineExecution {
  id: string;
  pipelineId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  metrics: DataPipelineMetrics;
  errors: DataError[];
  logs: DataLog[];
}

export interface DataPipelineMetrics {
  recordsProcessed: number;
  recordsFiltered: number;
  recordsTransformed: number;
  recordsValidated: number;
  recordsFailed: number;
  processingTimeMs: number;
  throughputRecordsPerSecond: number;
  memoryUsageMB: number;
}

export interface DataError {
  timestamp: Date;
  stage: string;
  recordId?: string;
  error: string;
  data?: any;
}

export interface DataLog {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  recordCount?: number;
}

export class DataPipelineManager extends EventEmitter {
  private pipelines: Map<string, DataFlowDefinition>;
  private executions: Map<string, DataPipelineExecution>;
  private dataConnectors: Map<string, DataConnector>;
  private transformationFunctions: Map<string, TransformationFunction>;
  private logger: Logger;

  constructor() {
    super();
    this.pipelines = new Map();
    this.executions = new Map();
    this.dataConnectors = new Map();
    this.transformationFunctions = new Map();
    this.logger = new Logger('DataPipelineManager');

    this.registerBuiltInTransformations();
    this.registerBuiltInConnectors();
  }

  /**
   * Register a data pipeline definition
   */
  registerPipeline(id: string, definition: DataFlowDefinition): void {
    this.pipelines.set(id, definition);
    this.logger.info(`Data pipeline registered: ${id}`);
    this.emit('pipeline-registered', id, definition);
  }

  /**
   * Execute a data pipeline
   */
  async executePipeline(
    pipelineId: string,
    inputs: Record<string, any>,
    context?: any
  ): Promise<string> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }

    const executionId = uuidv4();
    const execution: DataPipelineExecution = {
      id: executionId,
      pipelineId,
      status: 'pending',
      startTime: new Date(),
      inputs,
      outputs: {},
      metrics: {
        recordsProcessed: 0,
        recordsFiltered: 0,
        recordsTransformed: 0,
        recordsValidated: 0,
        recordsFailed: 0,
        processingTimeMs: 0,
        throughputRecordsPerSecond: 0,
        memoryUsageMB: 0,
      },
      errors: [],
      logs: [],
    };

    this.executions.set(executionId, execution);

    try {
      execution.status = 'running';
      this.emit('pipeline-started', executionId);

      // Load data from inputs
      const data = await this.loadInputData(
        pipeline,
        inputs,
        execution,
        context
      );

      // Apply validations
      const validatedData = await this.validateData(pipeline, data, execution);

      // Apply transformations
      const transformedData = await this.transformData(
        pipeline,
        validatedData,
        execution
      );

      // Save outputs
      await this.saveOutputData(pipeline, transformedData, execution, context);

      execution.status = 'completed';
      execution.endTime = new Date();
      execution.metrics.processingTimeMs =
        execution.endTime.getTime() - execution.startTime.getTime();

      if (execution.metrics.processingTimeMs > 0) {
        execution.metrics.throughputRecordsPerSecond =
          (execution.metrics.recordsProcessed /
            execution.metrics.processingTimeMs) *
          1000;
      }

      this.emit('pipeline-completed', executionId);

      return executionId;
    } catch (error: any) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.errors.push({
        timestamp: new Date(),
        stage: 'pipeline',
        error: error.message,
        data: { pipelineId, inputs },
      });

      this.emit('pipeline-failed', executionId, error);
      throw error;
    }
  }

  /**
   * Load data from input sources
   */
  private async loadInputData(
    pipeline: DataFlowDefinition,
    inputs: Record<string, any>,
    execution: DataPipelineExecution,
    context?: any
  ): Promise<Record<string, any>> {
    const data: Record<string, any> = {};

    this.addLog(
      execution,
      'info',
      'input',
      `Loading data from ${pipeline.inputs.length} input sources`
    );

    for (const input of pipeline.inputs) {
      try {
        const inputData = await this.loadFromSource(input, inputs, context);
        data[input.name] = inputData;

        const recordCount = Array.isArray(inputData) ? inputData.length : 1;
        execution.metrics.recordsProcessed += recordCount;

        this.addLog(
          execution,
          'info',
          'input',
          `Loaded ${recordCount} records from ${input.name}`
        );
      } catch (error: any) {
        execution.errors.push({
          timestamp: new Date(),
          stage: 'input',
          error: `Failed to load input ${input.name}: ${error.message}`,
        });

        if (input.required) {
          throw error;
        } else {
          data[input.name] = input.defaultValue;
          this.addLog(
            execution,
            'warn',
            'input',
            `Using default value for ${input.name}: ${error.message}`
          );
        }
      }
    }

    return data;
  }

  /**
   * Load data from a specific source
   */
  private async loadFromSource(
    input: DataInput,
    inputs: Record<string, any>,
    context?: any
  ): Promise<any> {
    switch (input.source.type) {
      case 'variable':
        return (
          inputs[input.source.config.name] ||
          context?.[input.source.config.name]
        );

      case 'file':
        return await this.loadFromFile(input.source.config);

      case 'api':
        return await this.loadFromApi(input.source.config);

      case 'database':
        return await this.loadFromDatabase(input.source.config);

      case 'environment':
        return process.env[input.source.config.name];

      case 'user_input':
        return inputs[input.name];

      default:
        throw new Error(`Unsupported input source type: ${input.source.type}`);
    }
  }

  /**
   * Load data from file
   */
  private async loadFromFile(config: any): Promise<any> {
    const filePath = config.path;
    const format = config.format || path.extname(filePath).toLowerCase();

    const content = await fs.readFile(filePath, 'utf8');

    switch (format) {
      case '.json':
        return JSON.parse(content);

      case '.csv':
        return this.parseCsv(content, config.options || {});

      case '.txt':
        return content.split('\n').filter((line) => line.trim());

      case '.xml':
        return this.parseXml(content);

      default:
        return content;
    }
  }

  /**
   * Load data from API
   */
  private async loadFromApi(config: any): Promise<any> {
    const response = await fetch(config.url, {
      method: config.method || 'GET',
      headers: config.headers || {},
      body: config.body ? JSON.stringify(config.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return await response.json();
    } else if (contentType.includes('text/')) {
      return await response.text();
    } else {
      return await response.arrayBuffer();
    }
  }

  /**
   * Load data from database
   */
  private async loadFromDatabase(config: any): Promise<any> {
    const connector = this.dataConnectors.get(config.connector);
    if (!connector) {
      throw new Error(`Database connector not found: ${config.connector}`);
    }

    return await connector.query(config.query, config.parameters);
  }

  /**
   * Validate data against pipeline validation rules
   */
  private async validateData(
    pipeline: DataFlowDefinition,
    data: Record<string, any>,
    execution: DataPipelineExecution
  ): Promise<Record<string, any>> {
    if (!pipeline.validations || pipeline.validations.length === 0) {
      return data;
    }

    this.addLog(
      execution,
      'info',
      'validation',
      `Validating data with ${pipeline.validations.length} validation rules`
    );

    const validatedData = { ...data };
    let validationErrors = 0;

    for (const validation of pipeline.validations) {
      try {
        const fieldData = this.getNestedValue(validatedData, validation.field);

        if (Array.isArray(fieldData)) {
          // Validate each item in array
          for (let i = 0; i < fieldData.length; i++) {
            const isValid = await this.validateValue(
              fieldData[i],
              validation.rules,
              execution
            );
            if (!isValid) {
              validationErrors++;
              execution.errors.push({
                timestamp: new Date(),
                stage: 'validation',
                recordId: `${validation.field}[${i}]`,
                error: `Validation failed for field ${validation.field}[${i}]`,
                data: fieldData[i],
              });
            }
          }
        } else {
          // Validate single value
          const isValid = await this.validateValue(
            fieldData,
            validation.rules,
            execution
          );
          if (!isValid) {
            validationErrors++;
            execution.errors.push({
              timestamp: new Date(),
              stage: 'validation',
              recordId: validation.field,
              error: `Validation failed for field ${validation.field}`,
              data: fieldData,
            });
          }
        }

        execution.metrics.recordsValidated++;
      } catch (error: any) {
        validationErrors++;
        execution.errors.push({
          timestamp: new Date(),
          stage: 'validation',
          error: `Validation error for ${validation.field}: ${error.message}`,
        });
      }
    }

    execution.metrics.recordsFailed += validationErrors;

    if (validationErrors > 0) {
      this.addLog(
        execution,
        'warn',
        'validation',
        `${validationErrors} validation errors found`
      );
    } else {
      this.addLog(execution, 'info', 'validation', 'All validations passed');
    }

    return validatedData;
  }

  /**
   * Validate a single value against rules
   */
  private async validateValue(
    value: any,
    rules: ValidationRule[],
    execution: DataPipelineExecution
  ): Promise<boolean> {
    for (const rule of rules) {
      const isValid = this.applyValidationRule(value, rule);
      if (!isValid) {
        this.addLog(
          execution,
          'debug',
          'validation',
          `Validation rule failed: ${rule.type} - ${rule.message || 'No message'}`
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Apply a single validation rule
   */
  private applyValidationRule(value: any, rule: ValidationRule): boolean {
    switch (rule.type) {
      case 'required':
        return value !== undefined && value !== null && value !== '';

      case 'type':
        return typeof value === rule.value;

      case 'range':
        if (typeof value !== 'number') return false;
        const [min, max] = rule.value as [number, number];
        return value >= min && value <= max;

      case 'pattern':
        if (typeof value !== 'string') return false;
        return new RegExp(rule.value as string).test(value);

      case 'custom':
        // Custom validation function
        try {
          const func = new Function('value', rule.value as string);
          return Boolean(func(value));
        } catch {
          return false;
        }

      default:
        return true;
    }
  }

  /**
   * Transform data through the pipeline
   */
  private async transformData(
    pipeline: DataFlowDefinition,
    data: Record<string, any>,
    execution: DataPipelineExecution
  ): Promise<Record<string, any>> {
    if (!pipeline.transformations || pipeline.transformations.length === 0) {
      return data;
    }

    this.addLog(
      execution,
      'info',
      'transformation',
      `Applying ${pipeline.transformations.length} transformations`
    );

    let transformedData = { ...data };

    for (const transformation of pipeline.transformations) {
      try {
        transformedData = await this.applyTransformation(
          transformation,
          transformedData,
          execution
        );
        execution.metrics.recordsTransformed++;

        this.addLog(
          execution,
          'debug',
          'transformation',
          `Applied transformation: ${transformation.type} -> ${transformation.output}`
        );
      } catch (error: any) {
        execution.errors.push({
          timestamp: new Date(),
          stage: 'transformation',
          error: `Transformation failed (${transformation.id}): ${error.message}`,
          data: transformation,
        });
        throw error;
      }
    }

    return transformedData;
  }

  /**
   * Apply a single transformation
   */
  private async applyTransformation(
    transformation: DataTransformation,
    data: Record<string, any>,
    execution: DataPipelineExecution
  ): Promise<Record<string, any>> {
    const inputData = transformation.input.map((inputName) =>
      this.getNestedValue(data, inputName)
    );

    let result: any;

    switch (transformation.type) {
      case 'map':
        result = await this.applyMapTransformation(
          inputData[0],
          transformation.config
        );
        break;

      case 'filter':
        result = await this.applyFilterTransformation(
          inputData[0],
          transformation.config
        );
        execution.metrics.recordsFiltered += Array.isArray(inputData[0])
          ? inputData[0].length - (Array.isArray(result) ? result.length : 0)
          : 0;
        break;

      case 'reduce':
        result = await this.applyReduceTransformation(
          inputData[0],
          transformation.config
        );
        break;

      case 'merge':
        result = await this.applyMergeTransformation(
          inputData,
          transformation.config
        );
        break;

      case 'split':
        result = await this.applySplitTransformation(
          inputData[0],
          transformation.config
        );
        break;

      case 'validate':
        result = await this.applyValidateTransformation(
          inputData[0],
          transformation.config
        );
        break;

      case 'format':
        result = await this.applyFormatTransformation(
          inputData[0],
          transformation.config
        );
        break;

      case 'encrypt':
        result = await this.applyEncryptTransformation(
          inputData[0],
          transformation.config
        );
        break;

      default: {
        // Check for custom transformation function
        const customFunction = this.transformationFunctions.get(
          transformation.type
        );
        if (customFunction) {
          result = await customFunction.apply(
            inputData,
            transformation.config,
            execution
          );
        } else {
          throw new Error(
            `Unsupported transformation type: ${transformation.type}`
          );
        }
        break;
      }
    }

    // Set the result in the output field
    return this.setNestedValue({ ...data }, transformation.output, result);
  }

  /**
   * Save outputs to destinations
   */
  private async saveOutputData(
    pipeline: DataFlowDefinition,
    data: Record<string, any>,
    execution: DataPipelineExecution,
    context?: any
  ): Promise<void> {
    if (!pipeline.outputs || pipeline.outputs.length === 0) {
      execution.outputs = data;
      return;
    }

    this.addLog(
      execution,
      'info',
      'output',
      `Saving data to ${pipeline.outputs.length} output destinations`
    );

    for (const output of pipeline.outputs) {
      try {
        const outputData = this.getNestedValue(data, output.name);
        await this.saveToDestination(output, outputData, context);

        execution.outputs[output.name] = outputData;

        this.addLog(
          execution,
          'info',
          'output',
          `Saved output: ${output.name}`
        );
      } catch (error: any) {
        execution.errors.push({
          timestamp: new Date(),
          stage: 'output',
          error: `Failed to save output ${output.name}: ${error.message}`,
        });
        throw error;
      }
    }
  }

  /**
   * Save data to a destination
   */
  private async saveToDestination(
    output: DataOutput,
    data: any,
    context?: any
  ): Promise<void> {
    switch (output.destination.type) {
      case 'variable':
        // Data is already in execution outputs
        break;

      case 'file':
        await this.saveToFile(data, output.destination.config, output.format);
        break;

      case 'api':
        await this.saveToApi(data, output.destination.config);
        break;

      case 'database':
        await this.saveToDatabase(data, output.destination.config);
        break;

      case 'notification':
        await this.sendNotification(data, output.destination.config);
        break;

      default:
        throw new Error(
          `Unsupported output destination type: ${output.destination.type}`
        );
    }
  }

  // Built-in transformation implementations
  private async applyMapTransformation(
    data: any[],
    config: any
  ): Promise<any[]> {
    if (!Array.isArray(data)) {
      throw new Error('Map transformation requires array input');
    }

    const mappingFunction = config.function || config.expression;
    const func = new Function('item', 'index', `return ${mappingFunction}`);

    return data.map((item, index) => func(item, index));
  }

  private async applyFilterTransformation(
    data: any[],
    config: any
  ): Promise<any[]> {
    if (!Array.isArray(data)) {
      throw new Error('Filter transformation requires array input');
    }

    const filterFunction = config.function || config.expression;
    const func = new Function('item', 'index', `return ${filterFunction}`);

    return data.filter((item, index) => func(item, index));
  }

  private async applyReduceTransformation(
    data: any[],
    config: any
  ): Promise<any> {
    if (!Array.isArray(data)) {
      throw new Error('Reduce transformation requires array input');
    }

    const reduceFunction = config.function || config.expression;
    const func = new Function(
      'accumulator',
      'item',
      'index',
      `return ${reduceFunction}`
    );

    return data.reduce(
      (acc, item, index) => func(acc, item, index),
      config.initialValue
    );
  }

  private async applyMergeTransformation(
    dataArrays: any[],
    config: any
  ): Promise<any> {
    if (config.strategy === 'concat' && dataArrays.every(Array.isArray)) {
      return dataArrays.flat();
    } else if (config.strategy === 'object') {
      return Object.assign({}, ...dataArrays);
    } else {
      return dataArrays;
    }
  }

  private async applySplitTransformation(
    data: any,
    config: any
  ): Promise<any[]> {
    if (typeof data === 'string') {
      return data.split(config.delimiter || '\n');
    } else if (Array.isArray(data)) {
      const chunkSize = config.chunkSize || 1;
      const result = [];
      for (let i = 0; i < data.length; i += chunkSize) {
        result.push(data.slice(i, i + chunkSize));
      }
      return result;
    }
    throw new Error('Split transformation requires string or array input');
  }

  private async applyValidateTransformation(
    data: any,
    config: any
  ): Promise<any> {
    // Re-validate data with additional rules
    return data; // Implement validation logic
  }

  private async applyFormatTransformation(
    data: any,
    config: any
  ): Promise<any> {
    if (config.type === 'json') {
      return JSON.stringify(data, null, config.indent || 2);
    } else if (config.type === 'csv') {
      return this.formatAsCsv(data, config.options || {});
    } else if (config.type === 'template') {
      return this.applyTemplate(data, config.template);
    }
    return data;
  }

  private async applyEncryptTransformation(
    data: any,
    config: any
  ): Promise<any> {
    // Implement encryption logic
    return data; // Placeholder
  }

  // File I/O helpers
  private async saveToFile(
    data: any,
    config: any,
    format?: string
  ): Promise<void> {
    let content: string;

    if (format === 'json' || config.format === 'json') {
      content = JSON.stringify(data, null, 2);
    } else if (format === 'csv' || config.format === 'csv') {
      content = this.formatAsCsv(data, config.csvOptions || {});
    } else if (format === 'txt' || config.format === 'txt') {
      content = Array.isArray(data) ? data.join('\n') : String(data);
    } else {
      content = String(data);
    }

    await fs.writeFile(config.path, content, config.encoding || 'utf8');
  }

  private async saveToApi(data: any, config: any): Promise<void> {
    const response = await fetch(config.url, {
      method: config.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...config.headers },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  private async saveToDatabase(data: any, config: any): Promise<void> {
    const connector = this.dataConnectors.get(config.connector);
    if (!connector) {
      throw new Error(`Database connector not found: ${config.connector}`);
    }

    await connector.insert(config.table, data);
  }

  private async sendNotification(data: any, config: any): Promise<void> {
    this.emit('notification', {
      type: config.type || 'info',
      message: config.message || 'Data pipeline notification',
      data,
    });
  }

  // Utility methods
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private setNestedValue(obj: any, path: string, value: any): any {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((current, key) => {
      if (!(key in current)) current[key] = {};
      return current[key];
    }, obj);
    target[lastKey] = value;
    return obj;
  }

  private addLog(
    execution: DataPipelineExecution,
    level: 'debug' | 'info' | 'warn' | 'error',
    stage: string,
    message: string,
    recordCount?: number
  ): void {
    const log: DataLog = {
      timestamp: new Date(),
      level,
      stage,
      message,
      recordCount,
    };

    execution.logs.push(log);

    // Log with appropriate level
    switch (level) {
      case 'debug':
        this.logger.debug(`[${execution.id}] ${stage}: ${message}`);
        break;
      case 'info':
        this.logger.info(`[${execution.id}] ${stage}: ${message}`);
        break;
      case 'warn':
        this.logger.warn(`[${execution.id}] ${stage}: ${message}`);
        break;
      case 'error':
        this.logger.error(`[${execution.id}] ${stage}: ${message}`);
        break;
    }
  }

  private parseCsv(content: string, options: any): any[] {
    const lines = content.split('\n').filter((line) => line.trim());
    const delimiter = options.delimiter || ',';
    const hasHeader = options.hasHeader !== false;

    if (lines.length === 0) return [];

    const headers = hasHeader ? lines[0].split(delimiter) : null;
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line, index) => {
      const values = line.split(delimiter);
      if (headers) {
        const obj: any = {};
        headers.forEach((header, i) => {
          obj[header.trim()] = values[i]?.trim() || '';
        });
        return obj;
      } else {
        return values.map((v) => v.trim());
      }
    });
  }

  private formatAsCsv(data: any[], options: any): string {
    if (!Array.isArray(data) || data.length === 0) return '';

    const delimiter = options.delimiter || ',';
    const includeHeader = options.includeHeader !== false;

    const firstItem = data[0];
    const headers = Object.keys(firstItem);

    let csv = '';
    if (includeHeader) {
      csv += headers.join(delimiter) + '\n';
    }

    data.forEach((item) => {
      const values = headers.map((header) => {
        const value = item[header];
        return typeof value === 'string' && value.includes(delimiter)
          ? `"${value}"`
          : String(value || '');
      });
      csv += values.join(delimiter) + '\n';
    });

    return csv;
  }

  private parseXml(content: string): any {
    // Simple XML parsing - in production, use a proper XML parser
    return { xml: content };
  }

  private applyTemplate(data: any, template: string): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = this.getNestedValue(data, path);
      return value !== undefined ? String(value) : match;
    });
  }

  // Built-in connectors and transformations registration
  private registerBuiltInConnectors(): void {
    // Register built-in database connectors
    // Implementation would include SQLite, PostgreSQL, MySQL, etc.
  }

  private registerBuiltInTransformations(): void {
    // Register custom transformation functions
    // Users can register their own transformations
  }

  /**
   * Register a custom data connector
   */
  registerConnector(name: string, connector: DataConnector): void {
    this.dataConnectors.set(name, connector);
    this.logger.info(`Data connector registered: ${name}`);
  }

  /**
   * Register a custom transformation function
   */
  registerTransformation(name: string, func: TransformationFunction): void {
    this.transformationFunctions.set(name, func);
    this.logger.info(`Transformation function registered: ${name}`);
  }

  /**
   * Get pipeline execution by ID
   */
  getExecution(executionId: string): DataPipelineExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Get all pipeline executions
   */
  getAllExecutions(): DataPipelineExecution[] {
    return Array.from(this.executions.values());
  }

  /**
   * Cancel a running pipeline execution
   */
  cancelExecution(executionId: string): void {
    const execution = this.executions.get(executionId);
    if (execution && execution.status === 'running') {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.errors.push({
        timestamp: new Date(),
        stage: 'pipeline',
        error: 'Pipeline execution cancelled by user',
      });

      this.emit('pipeline-cancelled', executionId);
    }
  }
}

// Interface for data connectors
export interface DataConnector {
  name: string;
  type: string;
  query(sql: string, parameters?: any[]): Promise<any>;
  insert(table: string, data: any): Promise<void>;
  update(table: string, data: any, conditions: any): Promise<void>;
  delete(table: string, conditions: any): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// Interface for transformation functions
export interface TransformationFunction {
  apply(
    inputs: any[],
    config: any,
    execution: DataPipelineExecution
  ): Promise<any>;
}
