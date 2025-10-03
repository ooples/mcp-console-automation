/**
 * Test Data Loader
 *
 * Implements fixture loading from multiple formats (JSON, YAML, CSV)
 * with caching and optional schema validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { TestFixture, FixtureMetadata } from '../types/test-framework.js';

export interface LoaderOptions {
  cache?: boolean;
  validateSchema?: boolean;
  encoding?: BufferEncoding;
}

export class TestDataLoader {
  private cache: Map<string, TestFixture>;
  private metadata: Map<string, FixtureMetadata>;

  constructor() {
    this.cache = new Map();
    this.metadata = new Map();
  }

  /**
   * Load a fixture from file
   */
  async loadFixture(
    filePath: string,
    options: LoaderOptions = {}
  ): Promise<TestFixture> {
    const opts = {
      cache: true,
      validateSchema: false,
      encoding: 'utf-8' as BufferEncoding,
      ...options,
    };

    // Check cache first
    if (opts.cache && this.cache.has(filePath)) {
      return this.cache.get(filePath)!;
    }

    // Resolve absolute path
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Fixture file not found: ${absolutePath}`);
    }

    // Determine format from extension
    const ext = path.extname(absolutePath).toLowerCase();
    const format = this.getFormatFromExtension(ext);

    // Load file content
    const content = await fs.promises.readFile(absolutePath, opts.encoding);

    // Parse based on format
    const data = await this.parseContent(content, format);

    // Create fixture
    const fixture: TestFixture = {
      name: path.basename(absolutePath, ext),
      data,
      format,
      path: absolutePath,
    };

    // Validate schema if requested
    if (opts.validateSchema && fixture.schema) {
      this.validateSchema(fixture.data, fixture.schema);
    }

    // Cache if enabled
    if (opts.cache) {
      this.cache.set(filePath, fixture);
    }

    return fixture;
  }

  /**
   * Load JSON fixture
   */
  async loadJSON(filePath: string, options?: LoaderOptions): Promise<any> {
    const fixture = await this.loadFixture(filePath, options);
    if (fixture.format !== 'json') {
      throw new Error(`Expected JSON format, got ${fixture.format}`);
    }
    return fixture.data;
  }

  /**
   * Load YAML fixture
   */
  async loadYAML(filePath: string, options?: LoaderOptions): Promise<any> {
    const fixture = await this.loadFixture(filePath, options);
    if (fixture.format !== 'yaml') {
      throw new Error(`Expected YAML format, got ${fixture.format}`);
    }
    return fixture.data;
  }

  /**
   * Load CSV fixture
   */
  async loadCSV(filePath: string, options?: LoaderOptions): Promise<any[]> {
    const fixture = await this.loadFixture(filePath, options);
    if (fixture.format !== 'csv') {
      throw new Error(`Expected CSV format, got ${fixture.format}`);
    }
    return fixture.data;
  }

  /**
   * Load multiple fixtures
   */
  async loadFixtures(
    filePaths: string[],
    options?: LoaderOptions
  ): Promise<TestFixture[]> {
    return Promise.all(filePaths.map((path) => this.loadFixture(path, options)));
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cached fixture
   */
  getCached(filePath: string): TestFixture | undefined {
    return this.cache.get(filePath);
  }

  /**
   * Check if fixture is cached
   */
  isCached(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  /**
   * Store fixture metadata
   */
  setMetadata(name: string, metadata: FixtureMetadata): void {
    this.metadata.set(name, metadata);
  }

  /**
   * Get fixture metadata
   */
  getMetadata(name: string): FixtureMetadata | undefined {
    return this.metadata.get(name);
  }

  /**
   * Parse content based on format
   */
  private async parseContent(
    content: string,
    format: TestFixture['format']
  ): Promise<any> {
    switch (format) {
      case 'json':
        return JSON.parse(content);

      case 'yaml':
        return yaml.load(content);

      case 'csv':
        return this.parseCSV(content);

      case 'sql':
        // For SQL, just return the raw content
        // Actual SQL execution would be handled by the test environment
        return content;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Parse CSV content into array of objects
   */
  private parseCSV(content: string): any[] {
    const lines = content.trim().split('\n');
    if (lines.length === 0) {
      return [];
    }

    // First line is headers
    const headers = this.parseCSVLine(lines[0]);

    // Parse remaining lines as data
    const data: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === 0) continue; // Skip empty lines

      const row: any = {};
      headers.forEach((header, index) => {
        const value = values[index] || '';
        // Try to parse as number or boolean
        row[header] = this.parseValue(value);
      });
      data.push(row);
    }

    return data;
  }

  /**
   * Parse a single CSV line (handles quoted values)
   */
  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    // Add last value
    values.push(current.trim());

    return values;
  }

  /**
   * Parse value (convert to number or boolean if possible)
   */
  private parseValue(value: string): any {
    // Try boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Try number
    const num = Number(value);
    if (!isNaN(num) && value !== '') return num;

    // Return as string
    return value;
  }

  /**
   * Get format from file extension
   */
  private getFormatFromExtension(ext: string): TestFixture['format'] {
    const normalized = ext.toLowerCase().replace('.', '');

    switch (normalized) {
      case 'json':
        return 'json';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'csv':
        return 'csv';
      case 'sql':
        return 'sql';
      default:
        throw new Error(`Unsupported file extension: ${ext}`);
    }
  }

  /**
   * Validate data against JSON schema
   */
  private validateSchema(data: any, schema: any): void {
    // Basic validation - in production you'd use a library like ajv
    if (!schema) return;

    if (schema.type === 'array' && !Array.isArray(data)) {
      throw new Error('Schema validation failed: expected array');
    }

    if (schema.type === 'object' && typeof data !== 'object') {
      throw new Error('Schema validation failed: expected object');
    }

    // Check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in data)) {
          throw new Error(`Schema validation failed: missing required field "${field}"`);
        }
      }
    }

    // Note: For production use, integrate a proper JSON Schema validator like ajv
  }
}
