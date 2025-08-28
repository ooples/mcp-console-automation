import { ErrorDetector } from '../src/core/ErrorDetector';

describe('ErrorDetector', () => {
  let detector: ErrorDetector;

  beforeEach(() => {
    detector = new ErrorDetector();
  });

  describe('detect', () => {
    it('should detect generic error messages', () => {
      const text = 'Error: Something went wrong\nNormal output\nERROR: Failed to connect';
      const errors = detector.detect(text);
      
      expect(errors).toHaveLength(2);
      expect(errors[0].match).toContain('Error: Something went wrong');
      expect(errors[1].match).toContain('ERROR: Failed to connect');
    });

    it('should detect exceptions', () => {
      const text = 'Exception: NullPointerException\nStack trace follows';
      const errors = detector.detect(text);
      
      expect(errors).toHaveLength(1);
      expect(errors[0].pattern.type).toBe('exception');
    });

    it('should detect warnings', () => {
      const text = 'Warning: Deprecated function used';
      const errors = detector.detect(text);
      
      expect(errors).toHaveLength(1);
      expect(errors[0].pattern.type).toBe('warning');
      expect(errors[0].pattern.severity).toBe('low');
    });

    it('should return line numbers', () => {
      const text = 'Line 1\nLine 2\nError: On line 3\nLine 4';
      const errors = detector.detect(text);
      
      expect(errors).toHaveLength(1);
      expect(errors[0].line).toBe(3);
    });

    it('should detect multiple error types', () => {
      const text = `
        Fatal: System crashed
        Warning: Low memory
        Error: File not found
        Exception: ArrayIndexOutOfBounds
      `;
      const errors = detector.detect(text);
      
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });

    it('should use custom patterns', () => {
      const customPatterns = [{
        pattern: /CUSTOM_ERROR/,
        type: 'error' as const,
        description: 'Custom error',
        severity: 'high' as const
      }];
      
      const text = 'CUSTOM_ERROR: Something specific';
      const errors = detector.detect(text, customPatterns);
      
      const customError = errors.find(e => e.pattern.description === 'Custom error');
      expect(customError).toBeDefined();
    });
  });

  describe('analyzeStackTrace', () => {
    it('should detect Python tracebacks', () => {
      const pythonTrace = `
Traceback (most recent call last):
  File "script.py", line 10, in <module>
    main()
  File "script.py", line 5, in main
    raise ValueError("Test error")
ValueError: Test error
      `;
      
      const result = detector.analyzeStackTrace(pythonTrace);
      expect(result.language).toBe('python');
      expect(result.frames).toHaveLength(2);
    });

    it('should detect Java stack traces', () => {
      const javaTrace = `
Exception in thread "main" java.lang.NullPointerException
    at com.example.MyClass.method1(MyClass.java:10)
    at com.example.MyClass.main(MyClass.java:5)
      `;
      
      const result = detector.analyzeStackTrace(javaTrace);
      expect(result.language).toBe('java');
      expect(result.frames).toHaveLength(2);
    });

    it('should detect Node.js stack traces', () => {
      const nodeTrace = `
Error: Test error
    at Object.<anonymous> (/path/to/file.js:10:15)
    at Module._compile (internal/modules/cjs/loader.js:1085:14)
    at Object.Module._extensions..js (internal/modules/cjs/loader.js:1114:10)
      `;
      
      const result = detector.analyzeStackTrace(nodeTrace);
      expect(result.language).toBe('javascript');
      expect(result.frames.length).toBeGreaterThan(0);
    });
  });

  describe('getSeverityScore', () => {
    it('should calculate severity scores correctly', () => {
      const errors = [
        {
          pattern: { pattern: /test/, type: 'error' as const, description: '', severity: 'low' as const },
          match: 'test',
          line: 1
        },
        {
          pattern: { pattern: /test/, type: 'error' as const, description: '', severity: 'critical' as const },
          match: 'test',
          line: 2
        },
        {
          pattern: { pattern: /test/, type: 'error' as const, description: '', severity: 'medium' as const },
          match: 'test',
          line: 3
        }
      ];
      
      const score = detector.getSeverityScore(errors);
      expect(score).toBe(7); // 1 + 4 + 2
    });

    it('should return 0 for empty errors array', () => {
      const score = detector.getSeverityScore([]);
      expect(score).toBe(0);
    });
  });

  describe('pattern management', () => {
    it('should add new patterns', () => {
      const initialCount = detector.getPatterns().length;
      
      detector.addPattern({
        pattern: /NEW_PATTERN/,
        type: 'error',
        description: 'New pattern',
        severity: 'medium'
      });
      
      expect(detector.getPatterns().length).toBe(initialCount + 1);
    });

    it('should remove patterns', () => {
      const pattern = /TEMP_PATTERN/;
      detector.addPattern({
        pattern,
        type: 'error',
        description: 'Temporary',
        severity: 'low'
      });
      
      const countAfterAdd = detector.getPatterns().length;
      detector.removePattern(pattern);
      
      expect(detector.getPatterns().length).toBe(countAfterAdd - 1);
    });
  });
});