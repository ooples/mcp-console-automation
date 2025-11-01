/**
 * Matchers - Comprehensive matcher library for assertions
 * Phase 2: Assertion Framework
 */

export class Matchers {
  /**
   * Check if actual string contains expected substring
   */
  toContain(actual: string, expected: string): boolean {
    if (typeof actual !== 'string' || typeof expected !== 'string') {
      throw new Error(
        'toContain requires both actual and expected to be strings'
      );
    }
    return actual.includes(expected);
  }

  /**
   * Check if actual matches regex pattern
   */
  toMatch(actual: string, pattern: RegExp | string): boolean {
    if (typeof actual !== 'string') {
      throw new Error('toMatch requires actual to be a string');
    }
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return regex.test(actual);
  }

  /**
   * Check deep equality (objects, arrays, primitives)
   */
  toEqual(actual: any, expected: any): boolean {
    return actual === expected;
  }

  /**
   * Check deep equality for objects and arrays
   */
  toDeepEqual(actual: any, expected: any): boolean {
    // Handle primitives and same reference
    if (actual === expected) {
      return true;
    }

    // Handle null/undefined
    if (actual == null || expected == null) {
      return actual === expected;
    }

    // Handle different types
    if (typeof actual !== typeof expected) {
      return false;
    }

    // Handle Date objects
    if (actual instanceof Date && expected instanceof Date) {
      return actual.getTime() === expected.getTime();
    }

    // Handle RegExp objects
    if (actual instanceof RegExp && expected instanceof RegExp) {
      return actual.toString() === expected.toString();
    }

    // Handle arrays
    if (Array.isArray(actual) && Array.isArray(expected)) {
      if (actual.length !== expected.length) {
        return false;
      }
      for (let i = 0; i < actual.length; i++) {
        if (!this.toDeepEqual(actual[i], expected[i])) {
          return false;
        }
      }
      return true;
    }

    // Handle objects
    if (typeof actual === 'object' && typeof expected === 'object') {
      const actualKeys = Object.keys(actual);
      const expectedKeys = Object.keys(expected);

      if (actualKeys.length !== expectedKeys.length) {
        return false;
      }

      for (const key of actualKeys) {
        if (!expectedKeys.includes(key)) {
          return false;
        }
        if (!this.toDeepEqual(actual[key], expected[key])) {
          return false;
        }
      }

      return true;
    }

    return false;
  }

  /**
   * Check if actual is greater than expected
   */
  toBeGreaterThan(actual: number, expected: number): boolean {
    if (typeof actual !== 'number' || typeof expected !== 'number') {
      throw new Error(
        'toBeGreaterThan requires both actual and expected to be numbers'
      );
    }
    return actual > expected;
  }

  /**
   * Check if actual is greater than or equal to expected
   */
  toBeGreaterThanOrEqual(actual: number, expected: number): boolean {
    if (typeof actual !== 'number' || typeof expected !== 'number') {
      throw new Error(
        'toBeGreaterThanOrEqual requires both actual and expected to be numbers'
      );
    }
    return actual >= expected;
  }

  /**
   * Check if actual is less than expected
   */
  toBeLessThan(actual: number, expected: number): boolean {
    if (typeof actual !== 'number' || typeof expected !== 'number') {
      throw new Error(
        'toBeLessThan requires both actual and expected to be numbers'
      );
    }
    return actual < expected;
  }

  /**
   * Check if actual is less than or equal to expected
   */
  toBeLessThanOrEqual(actual: number, expected: number): boolean {
    if (typeof actual !== 'number' || typeof expected !== 'number') {
      throw new Error(
        'toBeLessThanOrEqual requires both actual and expected to be numbers'
      );
    }
    return actual <= expected;
  }

  /**
   * Check if string starts with prefix
   */
  toStartWith(actual: string, prefix: string): boolean {
    if (typeof actual !== 'string' || typeof prefix !== 'string') {
      throw new Error(
        'toStartWith requires both actual and prefix to be strings'
      );
    }
    return actual.startsWith(prefix);
  }

  /**
   * Check if string ends with suffix
   */
  toEndWith(actual: string, suffix: string): boolean {
    if (typeof actual !== 'string' || typeof suffix !== 'string') {
      throw new Error(
        'toEndWith requires both actual and suffix to be strings'
      );
    }
    return actual.endsWith(suffix);
  }

  /**
   * Check if array includes item
   */
  toInclude(actual: any[], item: any): boolean {
    if (!Array.isArray(actual)) {
      throw new Error('toInclude requires actual to be an array');
    }
    return actual.some((el) => this.toDeepEqual(el, item));
  }

  /**
   * Check if collection has expected length
   */
  toHaveLength(actual: any[] | string, expected: number): boolean {
    if (typeof expected !== 'number') {
      throw new Error('toHaveLength requires expected to be a number');
    }
    if (Array.isArray(actual) || typeof actual === 'string') {
      return actual.length === expected;
    }
    throw new Error('toHaveLength requires actual to be an array or string');
  }

  /**
   * Check if value is empty (array, string, object)
   */
  toBeEmpty(actual: any[] | string | object): boolean {
    if (Array.isArray(actual) || typeof actual === 'string') {
      return actual.length === 0;
    }
    if (typeof actual === 'object' && actual !== null) {
      return Object.keys(actual).length === 0;
    }
    throw new Error(
      'toBeEmpty requires actual to be an array, string, or object'
    );
  }

  /**
   * Check if function throws an error
   */
  toThrow(fn: () => any, expectedError?: string | RegExp): boolean {
    try {
      fn();
      return false;
    } catch (error: any) {
      if (expectedError === undefined) {
        return true;
      }
      if (typeof expectedError === 'string') {
        return error.message.includes(expectedError);
      }
      if (expectedError instanceof RegExp) {
        return expectedError.test(error.message);
      }
      return false;
    }
  }

  /**
   * Check if output contains error pattern
   */
  toContainError(actual: string, pattern?: string | RegExp): boolean {
    if (typeof actual !== 'string') {
      throw new Error('toContainError requires actual to be a string');
    }

    const defaultErrorPatterns = [
      /error\b/i,
      /exception\b/i,
      /fatal\b/i,
      /failed\b/i,
      /cannot/i,
      /unable to/i,
      /permission denied/i,
      /command not found/i,
    ];

    if (pattern === undefined) {
      // Check any default error pattern
      return defaultErrorPatterns.some((p) => p.test(actual));
    }

    if (typeof pattern === 'string') {
      return actual.toLowerCase().includes(pattern.toLowerCase());
    }

    if (pattern instanceof RegExp) {
      return pattern.test(actual);
    }

    return false;
  }

  /**
   * Check if value matches custom pattern
   */
  toMatchPattern(actual: any, pattern: (value: any) => boolean): boolean {
    if (typeof pattern !== 'function') {
      throw new Error('toMatchPattern requires pattern to be a function');
    }
    return pattern(actual);
  }

  /**
   * Check if value is truthy
   */
  toBeTruthy(actual: any): boolean {
    return !!actual;
  }

  /**
   * Check if value is falsy
   */
  toBeFalsy(actual: any): boolean {
    return !actual;
  }

  /**
   * Check if value is null
   */
  toBeNull(actual: any): boolean {
    return actual === null;
  }

  /**
   * Check if value is undefined
   */
  toBeUndefined(actual: any): boolean {
    return actual === undefined;
  }

  /**
   * Check if value is defined (not null or undefined)
   */
  toBeDefined(actual: any): boolean {
    return actual !== undefined && actual !== null;
  }

  /**
   * Check if value is of expected type
   */
  toBeType(actual: any, expectedType: string): boolean {
    const types = [
      'string',
      'number',
      'boolean',
      'object',
      'function',
      'symbol',
      'bigint',
    ];
    if (!types.includes(expectedType)) {
      throw new Error(`Invalid type: ${expectedType}`);
    }
    return typeof actual === expectedType;
  }

  /**
   * Check if value is instance of class
   */
  toBeInstanceOf(actual: any, expectedClass: any): boolean {
    return actual instanceof expectedClass;
  }

  /**
   * Check if object has property
   */
  toHaveProperty(actual: object, property: string): boolean {
    if (typeof actual !== 'object' || actual === null) {
      throw new Error('toHaveProperty requires actual to be an object');
    }
    return property in actual;
  }

  /**
   * Check if object has property with specific value
   */
  toHavePropertyValue(actual: object, property: string, value: any): boolean {
    if (!this.toHaveProperty(actual, property)) {
      return false;
    }
    return this.toDeepEqual((actual as any)[property], value);
  }

  /**
   * Check if number is close to expected (within delta)
   */
  toBeCloseTo(actual: number, expected: number, delta: number = 0.01): boolean {
    if (
      typeof actual !== 'number' ||
      typeof expected !== 'number' ||
      typeof delta !== 'number'
    ) {
      throw new Error('toBeCloseTo requires all parameters to be numbers');
    }
    return Math.abs(actual - expected) <= delta;
  }

  /**
   * Check if array/string contains all items
   */
  toContainAll(actual: any[] | string, items: any[]): boolean {
    if (!Array.isArray(items)) {
      throw new Error('toContainAll requires items to be an array');
    }

    if (typeof actual === 'string') {
      return items.every((item) => actual.includes(String(item)));
    }

    if (Array.isArray(actual)) {
      return items.every((item) => this.toInclude(actual, item));
    }

    throw new Error('toContainAll requires actual to be an array or string');
  }

  /**
   * Check if array/string contains any of the items
   */
  toContainAny(actual: any[] | string, items: any[]): boolean {
    if (!Array.isArray(items)) {
      throw new Error('toContainAny requires items to be an array');
    }

    if (typeof actual === 'string') {
      return items.some((item) => actual.includes(String(item)));
    }

    if (Array.isArray(actual)) {
      return items.some((item) => this.toInclude(actual, item));
    }

    throw new Error('toContainAny requires actual to be an array or string');
  }

  /**
   * Check if string matches JSON schema structure
   */
  toMatchJSON(actual: string, expected: object): boolean {
    if (typeof actual !== 'string') {
      throw new Error('toMatchJSON requires actual to be a string');
    }

    try {
      const parsed = JSON.parse(actual);
      return this.toDeepEqual(parsed, expected);
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if value is between min and max (inclusive)
   */
  toBeBetween(actual: number, min: number, max: number): boolean {
    if (
      typeof actual !== 'number' ||
      typeof min !== 'number' ||
      typeof max !== 'number'
    ) {
      throw new Error('toBeBetween requires all parameters to be numbers');
    }
    return actual >= min && actual <= max;
  }

  /**
   * Check if date is before expected date
   */
  toBeBefore(actual: Date, expected: Date): boolean {
    if (!(actual instanceof Date) || !(expected instanceof Date)) {
      throw new Error(
        'toBeBefore requires both actual and expected to be Date objects'
      );
    }
    return actual.getTime() < expected.getTime();
  }

  /**
   * Check if date is after expected date
   */
  toBeAfter(actual: Date, expected: Date): boolean {
    if (!(actual instanceof Date) || !(expected instanceof Date)) {
      throw new Error(
        'toBeAfter requires both actual and expected to be Date objects'
      );
    }
    return actual.getTime() > expected.getTime();
  }

  /**
   * Check if array is sorted in ascending order
   */
  toBeSorted(actual: any[], ascending: boolean = true): boolean {
    if (!Array.isArray(actual)) {
      throw new Error('toBeSorted requires actual to be an array');
    }

    if (actual.length <= 1) {
      return true;
    }

    for (let i = 0; i < actual.length - 1; i++) {
      const comparison = actual[i] <= actual[i + 1];
      if (ascending ? !comparison : comparison) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if array has unique elements
   */
  toHaveUniqueElements(actual: any[]): boolean {
    if (!Array.isArray(actual)) {
      throw new Error('toHaveUniqueElements requires actual to be an array');
    }

    const seen = new Set();
    for (const item of actual) {
      const key = JSON.stringify(item);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
    }

    return true;
  }
}
