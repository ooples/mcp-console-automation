/**
 * Matchers Test Suite
 * Tests all 30+ matcher functions for 100% coverage
 */

import { Matchers } from '../testing/Matchers.js';

describe('Matchers', () => {
  let matchers: Matchers;

  beforeEach(() => {
    matchers = new Matchers();
  });

  describe('toContain', () => {
    it('should return true when string contains substring', () => {
      expect(matchers.toContain('hello world', 'world')).toBe(true);
      expect(matchers.toContain('hello world', 'hello')).toBe(true);
    });

    it('should return false when string does not contain substring', () => {
      expect(matchers.toContain('hello world', 'foo')).toBe(false);
    });

    it('should throw error for non-string inputs', () => {
      expect(() => matchers.toContain(123 as any, 'test')).toThrow();
    });
  });

  describe('toMatch', () => {
    it('should match with regex pattern', () => {
      expect(matchers.toMatch('hello123', /\d+/)).toBe(true);
      expect(
        matchers.toMatch('test@example.com', /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/)
      ).toBe(true);
    });

    it('should match with string pattern', () => {
      expect(matchers.toMatch('hello world', 'world')).toBe(true);
    });

    it('should return false for non-matching pattern', () => {
      expect(matchers.toMatch('hello', /\d+/)).toBe(false);
    });
  });

  describe('toEqual', () => {
    it('should compare primitives with === equality', () => {
      expect(matchers.toEqual(5, 5)).toBe(true);
      expect(matchers.toEqual('test', 'test')).toBe(true);
      expect(matchers.toEqual(true, true)).toBe(true);
      expect(matchers.toEqual(5, 6)).toBe(false);
    });
  });

  describe('toDeepEqual', () => {
    it('should deeply compare objects', () => {
      expect(matchers.toDeepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(matchers.toDeepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    });

    it('should deeply compare arrays', () => {
      expect(matchers.toDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(matchers.toDeepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it('should handle nested structures', () => {
      expect(
        matchers.toDeepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })
      ).toBe(true);
      expect(
        matchers.toDeepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }])
      ).toBe(true);
    });

    it('should handle Date objects', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-01');
      const date3 = new Date('2024-01-02');
      expect(matchers.toDeepEqual(date1, date2)).toBe(true);
      expect(matchers.toDeepEqual(date1, date3)).toBe(false);
    });

    it('should handle RegExp objects', () => {
      expect(matchers.toDeepEqual(/test/g, /test/g)).toBe(true);
      expect(matchers.toDeepEqual(/test/g, /test/i)).toBe(false);
    });

    it('should handle null and undefined', () => {
      expect(matchers.toDeepEqual(null, null)).toBe(true);
      expect(matchers.toDeepEqual(undefined, undefined)).toBe(true);
      expect(matchers.toDeepEqual(null, undefined)).toBe(false);
    });
  });

  describe('toBeGreaterThan', () => {
    it('should return true when actual > expected', () => {
      expect(matchers.toBeGreaterThan(10, 5)).toBe(true);
      expect(matchers.toBeGreaterThan(5, 10)).toBe(false);
    });

    it('should throw error for non-number inputs', () => {
      expect(() => matchers.toBeGreaterThan('5' as any, 3)).toThrow();
    });
  });

  describe('toBeGreaterThanOrEqual', () => {
    it('should return true when actual >= expected', () => {
      expect(matchers.toBeGreaterThanOrEqual(10, 5)).toBe(true);
      expect(matchers.toBeGreaterThanOrEqual(5, 5)).toBe(true);
      expect(matchers.toBeGreaterThanOrEqual(5, 10)).toBe(false);
    });
  });

  describe('toBeLessThan', () => {
    it('should return true when actual < expected', () => {
      expect(matchers.toBeLessThan(5, 10)).toBe(true);
      expect(matchers.toBeLessThan(10, 5)).toBe(false);
    });
  });

  describe('toBeLessThanOrEqual', () => {
    it('should return true when actual <= expected', () => {
      expect(matchers.toBeLessThanOrEqual(5, 10)).toBe(true);
      expect(matchers.toBeLessThanOrEqual(5, 5)).toBe(true);
      expect(matchers.toBeLessThanOrEqual(10, 5)).toBe(false);
    });
  });

  describe('toStartWith', () => {
    it('should return true when string starts with prefix', () => {
      expect(matchers.toStartWith('hello world', 'hello')).toBe(true);
      expect(matchers.toStartWith('hello world', 'world')).toBe(false);
    });

    it('should throw error for non-string inputs', () => {
      expect(() => matchers.toStartWith(123 as any, 'test')).toThrow();
    });
  });

  describe('toEndWith', () => {
    it('should return true when string ends with suffix', () => {
      expect(matchers.toEndWith('hello world', 'world')).toBe(true);
      expect(matchers.toEndWith('hello world', 'hello')).toBe(false);
    });
  });

  describe('toInclude', () => {
    it('should return true when array includes item', () => {
      expect(matchers.toInclude([1, 2, 3], 2)).toBe(true);
      expect(matchers.toInclude([1, 2, 3], 4)).toBe(false);
    });

    it('should handle object comparison', () => {
      expect(matchers.toInclude([{ a: 1 }, { b: 2 }], { a: 1 })).toBe(true);
    });

    it('should throw error for non-array input', () => {
      expect(() => matchers.toInclude('string' as any, 's')).toThrow();
    });
  });

  describe('toHaveLength', () => {
    it('should check array length', () => {
      expect(matchers.toHaveLength([1, 2, 3], 3)).toBe(true);
      expect(matchers.toHaveLength([1, 2, 3], 2)).toBe(false);
    });

    it('should check string length', () => {
      expect(matchers.toHaveLength('hello', 5)).toBe(true);
      expect(matchers.toHaveLength('hello', 3)).toBe(false);
    });

    it('should throw error for invalid inputs', () => {
      expect(() => matchers.toHaveLength(123 as any, 3)).toThrow();
    });
  });

  describe('toBeEmpty', () => {
    it('should check empty arrays', () => {
      expect(matchers.toBeEmpty([])).toBe(true);
      expect(matchers.toBeEmpty([1])).toBe(false);
    });

    it('should check empty strings', () => {
      expect(matchers.toBeEmpty('')).toBe(true);
      expect(matchers.toBeEmpty('hello')).toBe(false);
    });

    it('should check empty objects', () => {
      expect(matchers.toBeEmpty({})).toBe(true);
      expect(matchers.toBeEmpty({ a: 1 })).toBe(false);
    });
  });

  describe('toThrow', () => {
    it('should return true when function throws', () => {
      expect(
        matchers.toThrow(() => {
          throw new Error('test');
        })
      ).toBe(true);
      expect(
        matchers.toThrow(() => {
          return 'ok';
        })
      ).toBe(false);
    });

    it('should match error message with string', () => {
      expect(
        matchers.toThrow(() => {
          throw new Error('test error');
        }, 'test')
      ).toBe(true);
      expect(
        matchers.toThrow(() => {
          throw new Error('test error');
        }, 'other')
      ).toBe(false);
    });

    it('should match error message with regex', () => {
      expect(
        matchers.toThrow(() => {
          throw new Error('test error 123');
        }, /\d+/)
      ).toBe(true);
    });
  });

  describe('toContainError', () => {
    it('should detect default error patterns', () => {
      expect(matchers.toContainError('Error: something went wrong')).toBe(true);
      expect(matchers.toContainError('Exception occurred')).toBe(true);
      expect(matchers.toContainError('Fatal error')).toBe(true);
      expect(matchers.toContainError('Command not found')).toBe(true);
      expect(matchers.toContainError('All tests passed')).toBe(false);
    });

    it('should match custom error pattern string', () => {
      expect(matchers.toContainError('Custom error occurred', 'custom')).toBe(
        true
      );
    });

    it('should match custom error pattern regex', () => {
      expect(matchers.toContainError('Error code: 500', /\d{3}/)).toBe(true);
    });
  });

  describe('toMatchPattern', () => {
    it('should match with custom function', () => {
      const isEven = (n: number) => n % 2 === 0;
      expect(matchers.toMatchPattern(4, isEven)).toBe(true);
      expect(matchers.toMatchPattern(5, isEven)).toBe(false);
    });

    it('should throw error for non-function pattern', () => {
      expect(() =>
        matchers.toMatchPattern(5, 'not a function' as any)
      ).toThrow();
    });
  });

  describe('toBeTruthy', () => {
    it('should check truthy values', () => {
      expect(matchers.toBeTruthy(true)).toBe(true);
      expect(matchers.toBeTruthy(1)).toBe(true);
      expect(matchers.toBeTruthy('hello')).toBe(true);
      expect(matchers.toBeTruthy(false)).toBe(false);
      expect(matchers.toBeTruthy(0)).toBe(false);
      expect(matchers.toBeTruthy('')).toBe(false);
    });
  });

  describe('toBeFalsy', () => {
    it('should check falsy values', () => {
      expect(matchers.toBeFalsy(false)).toBe(true);
      expect(matchers.toBeFalsy(0)).toBe(true);
      expect(matchers.toBeFalsy('')).toBe(true);
      expect(matchers.toBeFalsy(null)).toBe(true);
      expect(matchers.toBeFalsy(undefined)).toBe(true);
      expect(matchers.toBeFalsy(true)).toBe(false);
    });
  });

  describe('toBeNull', () => {
    it('should check null value', () => {
      expect(matchers.toBeNull(null)).toBe(true);
      expect(matchers.toBeNull(undefined)).toBe(false);
      expect(matchers.toBeNull(0)).toBe(false);
    });
  });

  describe('toBeUndefined', () => {
    it('should check undefined value', () => {
      expect(matchers.toBeUndefined(undefined)).toBe(true);
      expect(matchers.toBeUndefined(null)).toBe(false);
      expect(matchers.toBeUndefined(0)).toBe(false);
    });
  });

  describe('toBeDefined', () => {
    it('should check defined values', () => {
      expect(matchers.toBeDefined(0)).toBe(true);
      expect(matchers.toBeDefined('')).toBe(true);
      expect(matchers.toBeDefined(false)).toBe(true);
      expect(matchers.toBeDefined(null)).toBe(false);
      expect(matchers.toBeDefined(undefined)).toBe(false);
    });
  });

  describe('toBeType', () => {
    it('should check value types', () => {
      expect(matchers.toBeType('hello', 'string')).toBe(true);
      expect(matchers.toBeType(123, 'number')).toBe(true);
      expect(matchers.toBeType(true, 'boolean')).toBe(true);
      expect(matchers.toBeType({}, 'object')).toBe(true);
      expect(matchers.toBeType(() => {}, 'function')).toBe(true);
      expect(matchers.toBeType('hello', 'number')).toBe(false);
    });

    it('should throw error for invalid type', () => {
      expect(() => matchers.toBeType(5, 'invalid' as any)).toThrow();
    });
  });

  describe('toBeInstanceOf', () => {
    it('should check instanceof', () => {
      expect(matchers.toBeInstanceOf(new Date(), Date)).toBe(true);
      expect(matchers.toBeInstanceOf(new Error(), Error)).toBe(true);
      expect(matchers.toBeInstanceOf([], Array)).toBe(true);
      expect(matchers.toBeInstanceOf({}, Date)).toBe(false);
    });
  });

  describe('toHaveProperty', () => {
    it('should check object has property', () => {
      expect(matchers.toHaveProperty({ a: 1, b: 2 }, 'a')).toBe(true);
      expect(matchers.toHaveProperty({ a: 1, b: 2 }, 'c')).toBe(false);
    });

    it('should throw error for non-object', () => {
      expect(() => matchers.toHaveProperty(null as any, 'test')).toThrow();
    });
  });

  describe('toHavePropertyValue', () => {
    it('should check property value', () => {
      expect(matchers.toHavePropertyValue({ a: 1, b: 2 }, 'a', 1)).toBe(true);
      expect(matchers.toHavePropertyValue({ a: 1, b: 2 }, 'a', 2)).toBe(false);
    });

    it('should deeply compare property values', () => {
      expect(matchers.toHavePropertyValue({ a: { b: 1 } }, 'a', { b: 1 })).toBe(
        true
      );
    });
  });

  describe('toBeCloseTo', () => {
    it('should check if numbers are close', () => {
      expect(matchers.toBeCloseTo(10, 10.005, 0.01)).toBe(true);
      expect(matchers.toBeCloseTo(10, 10.1, 0.01)).toBe(false);
      expect(matchers.toBeCloseTo(0.1 + 0.2, 0.3, 0.0001)).toBe(true);
    });

    it('should use default delta', () => {
      expect(matchers.toBeCloseTo(10, 10.005)).toBe(true);
    });
  });

  describe('toContainAll', () => {
    it('should check array contains all items', () => {
      expect(matchers.toContainAll([1, 2, 3, 4], [2, 3])).toBe(true);
      expect(matchers.toContainAll([1, 2, 3], [2, 5])).toBe(false);
    });

    it('should check string contains all substrings', () => {
      expect(matchers.toContainAll('hello world', ['hello', 'world'])).toBe(
        true
      );
      expect(matchers.toContainAll('hello world', ['hello', 'foo'])).toBe(
        false
      );
    });
  });

  describe('toContainAny', () => {
    it('should check array contains any item', () => {
      expect(matchers.toContainAny([1, 2, 3], [2, 5])).toBe(true);
      expect(matchers.toContainAny([1, 2, 3], [5, 6])).toBe(false);
    });

    it('should check string contains any substring', () => {
      expect(matchers.toContainAny('hello world', ['foo', 'world'])).toBe(true);
      expect(matchers.toContainAny('hello world', ['foo', 'bar'])).toBe(false);
    });
  });

  describe('toMatchJSON', () => {
    it('should parse and match JSON', () => {
      expect(matchers.toMatchJSON('{"a":1,"b":2}', { a: 1, b: 2 })).toBe(true);
      expect(matchers.toMatchJSON('{"a":1,"b":2}', { a: 1, b: 3 })).toBe(false);
    });

    it('should return false for invalid JSON', () => {
      expect(matchers.toMatchJSON('not json', {})).toBe(false);
    });
  });

  describe('toBeBetween', () => {
    it('should check if number is between min and max', () => {
      expect(matchers.toBeBetween(5, 1, 10)).toBe(true);
      expect(matchers.toBeBetween(1, 1, 10)).toBe(true);
      expect(matchers.toBeBetween(10, 1, 10)).toBe(true);
      expect(matchers.toBeBetween(0, 1, 10)).toBe(false);
      expect(matchers.toBeBetween(11, 1, 10)).toBe(false);
    });
  });

  describe('toBeBefore', () => {
    it('should check if date is before another', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-02');
      expect(matchers.toBeBefore(date1, date2)).toBe(true);
      expect(matchers.toBeBefore(date2, date1)).toBe(false);
    });
  });

  describe('toBeAfter', () => {
    it('should check if date is after another', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-02');
      expect(matchers.toBeAfter(date2, date1)).toBe(true);
      expect(matchers.toBeAfter(date1, date2)).toBe(false);
    });
  });

  describe('toBeSorted', () => {
    it('should check if array is sorted ascending', () => {
      expect(matchers.toBeSorted([1, 2, 3, 4], true)).toBe(true);
      expect(matchers.toBeSorted([1, 3, 2, 4], true)).toBe(false);
      expect(matchers.toBeSorted([1], true)).toBe(true);
      expect(matchers.toBeSorted([], true)).toBe(true);
    });

    it('should check if array is sorted descending', () => {
      expect(matchers.toBeSorted([4, 3, 2, 1], false)).toBe(true);
      expect(matchers.toBeSorted([4, 2, 3, 1], false)).toBe(false);
    });
  });

  describe('toHaveUniqueElements', () => {
    it('should check if array has unique elements', () => {
      expect(matchers.toHaveUniqueElements([1, 2, 3, 4])).toBe(true);
      expect(matchers.toHaveUniqueElements([1, 2, 2, 3])).toBe(false);
    });

    it('should handle object uniqueness', () => {
      expect(matchers.toHaveUniqueElements([{ a: 1 }, { b: 2 }])).toBe(true);
      expect(matchers.toHaveUniqueElements([{ a: 1 }, { a: 1 }])).toBe(false);
    });
  });
});
