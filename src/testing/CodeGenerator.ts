/**
 * CodeGenerator - Generates test code from recordings
 *
 * This class converts test recordings into executable test code
 * in multiple languages (JavaScript, TypeScript, Python).
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestRecording, RecordingStep, CodeGenerationOptions } from '../types/test-framework.js';
import { TestRecorder } from './TestRecorder.js';

interface TemplateData {
  testName: string;
  description: string;
  setup: string;
  teardown: string;
  steps: string[];
  imports: string[];
  sessionId: string;
}

export class CodeGenerator {
  private templatesDir: string;

  constructor(templatesDir = 'src/testing/templates') {
    this.templatesDir = templatesDir;
  }

  /**
   * Generate test code from a recording
   */
  public generateCode(
    recording: TestRecording,
    options: CodeGenerationOptions
  ): string {
    const templateData = this.prepareTemplateData(recording, options);
    const template = this.loadTemplate(options.language);

    return this.renderTemplate(template, templateData, options);
  }

  /**
   * Generate code from a recording file
   */
  public generateCodeFromFile(
    recordingName: string,
    options: CodeGenerationOptions,
    recordingsDir = 'data/recordings'
  ): string {
    const recording = TestRecorder.loadRecording(recordingName, recordingsDir);
    return this.generateCode(recording, options);
  }

  /**
   * Generate code and save to file
   */
  public generateAndSaveCode(
    recording: TestRecording,
    options: CodeGenerationOptions,
    outputPath: string
  ): void {
    const code = this.generateCode(recording, options);
    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, code, 'utf-8');
  }

  /**
   * Prepare template data from recording
   */
  private prepareTemplateData(
    recording: TestRecording,
    options: CodeGenerationOptions
  ): TemplateData {
    const testName = this.sanitizeTestName(recording.name);
    const description = recording.metadata.description || `Test: ${recording.name}`;
    const sessionId = this.extractSessionId(recording);

    const imports = this.generateImports(options);
    const setup = this.generateSetup(recording, options);
    const teardown = this.generateTeardown(recording, options);
    const steps = this.generateSteps(recording, options);

    return {
      testName,
      description,
      setup,
      teardown,
      steps,
      imports,
      sessionId,
    };
  }

  /**
   * Generate import statements
   */
  private generateImports(options: CodeGenerationOptions): string[] {
    const imports: string[] = [];

    switch (options.language) {
      case 'javascript':
      case 'typescript':
        imports.push("import { ConsoleManager } from '@mcp/console-automation';");
        if (options.framework === 'jest') {
          imports.push("import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';");
        } else if (options.framework === 'mocha') {
          imports.push("import { describe, it, before, after } from 'mocha';");
          imports.push("import { expect } from 'chai';");
        }
        break;

      case 'python':
        if (options.framework === 'pytest') {
          imports.push('import pytest');
          imports.push('from console_automation import ConsoleManager');
        } else {
          imports.push('import unittest');
          imports.push('from console_automation import ConsoleManager');
        }
        break;
    }

    return imports;
  }

  /**
   * Generate setup code
   */
  private generateSetup(recording: TestRecording, options: CodeGenerationOptions): string {
    if (!options.includeSetup) {
      return '';
    }

    const lines: string[] = [];

    switch (options.language) {
      case 'javascript':
      case 'typescript':
        lines.push('const manager = new ConsoleManager();');
        lines.push('let sessionId;');
        break;

      case 'python':
        lines.push('self.manager = ConsoleManager()');
        lines.push('self.session_id = None');
        break;
    }

    return lines.join('\n');
  }

  /**
   * Generate teardown code
   */
  private generateTeardown(recording: TestRecording, options: CodeGenerationOptions): string {
    if (!options.includeTeardown) {
      return '';
    }

    const lines: string[] = [];

    switch (options.language) {
      case 'javascript':
      case 'typescript':
        lines.push('if (sessionId) {');
        lines.push('  await manager.stopSession(sessionId);');
        lines.push('}');
        break;

      case 'python':
        lines.push('if self.session_id:');
        lines.push('    self.manager.stop_session(self.session_id)');
        break;
    }

    return lines.join('\n');
  }

  /**
   * Generate test steps
   */
  private generateSteps(recording: TestRecording, options: CodeGenerationOptions): string[] {
    const steps: string[] = [];

    for (const step of recording.steps) {
      const code = this.generateStepCode(step, options);
      if (code) {
        steps.push(code);
      }
    }

    return steps;
  }

  /**
   * Generate code for a single step
   */
  private generateStepCode(step: RecordingStep, options: CodeGenerationOptions): string {
    const lang = options.language;

    switch (step.type) {
      case 'create_session':
        return this.generateCreateSessionCode(step, lang);

      case 'send_input':
        return this.generateSendInputCode(step, lang);

      case 'send_key':
        return this.generateSendKeyCode(step, lang);

      case 'wait_for_output':
        return this.generateWaitForOutputCode(step, lang);

      case 'assert':
        return this.generateAssertCode(step, lang);

      default:
        return `// Step type '${step.type}' not yet implemented`;
    }
  }

  /**
   * Generate create_session code
   */
  private generateCreateSessionCode(step: RecordingStep, lang: string): string {
    const data = JSON.stringify(step.data, null, 2);

    switch (lang) {
      case 'javascript':
      case 'typescript':
        return `const result = await manager.createSession(${data});\nsessionId = result.sessionId;`;

      case 'python':
        return `result = self.manager.create_session(${data})\nself.session_id = result['session_id']`;

      default:
        return '';
    }
  }

  /**
   * Generate send_input code
   */
  private generateSendInputCode(step: RecordingStep, lang: string): string {
    const input = step.data.input;
    const escaped = this.escapeString(input);

    switch (lang) {
      case 'javascript':
      case 'typescript':
        return `await manager.sendInput({ sessionId, input: "${escaped}" });`;

      case 'python':
        return `self.manager.send_input(self.session_id, "${escaped}")`;

      default:
        return '';
    }
  }

  /**
   * Generate send_key code
   */
  private generateSendKeyCode(step: RecordingStep, lang: string): string {
    const key = step.data.key;

    switch (lang) {
      case 'javascript':
      case 'typescript':
        return `await manager.sendKey({ sessionId, key: "${key}" });`;

      case 'python':
        return `self.manager.send_key(self.session_id, "${key}")`;

      default:
        return '';
    }
  }

  /**
   * Generate wait_for_output code
   */
  private generateWaitForOutputCode(step: RecordingStep, lang: string): string {
    const pattern = step.data.pattern;
    const timeout = step.data.timeout;
    const escaped = this.escapeString(pattern);

    switch (lang) {
      case 'javascript':
      case 'typescript':
        return `await manager.waitForOutput({ sessionId, pattern: "${escaped}", timeout: ${timeout} });`;

      case 'python':
        return `self.manager.wait_for_output(self.session_id, "${escaped}", ${timeout})`;

      default:
        return '';
    }
  }

  /**
   * Generate assert code (Phase 2)
   */
  private generateAssertCode(step: RecordingStep, lang: string): string {
    return `// Assertions will be implemented in Phase 2`;
  }

  /**
   * Load template file
   */
  private loadTemplate(language: string): string {
    const filename = `${language}.template`;
    const filepath = path.join(this.templatesDir, filename);

    if (!fs.existsSync(filepath)) {
      throw new Error(`Template not found: ${filepath}`);
    }

    return fs.readFileSync(filepath, 'utf-8');
  }

  /**
   * Render template with data
   */
  private renderTemplate(
    template: string,
    data: TemplateData,
    options: CodeGenerationOptions
  ): string {
    let result = template;

    // Replace placeholders
    result = result.replace(/\{\{TEST_NAME\}\}/g, data.testName);
    result = result.replace(/\{\{DESCRIPTION\}\}/g, data.description);
    result = result.replace(/\{\{IMPORTS\}\}/g, data.imports.join('\n'));
    result = result.replace(/\{\{SETUP\}\}/g, this.indent(data.setup, 2));
    result = result.replace(/\{\{TEARDOWN\}\}/g, this.indent(data.teardown, 2));
    result = result.replace(/\{\{STEPS\}\}/g, data.steps.map(s => this.indent(s, 2)).join('\n\n'));

    // Framework-specific replacements
    if (options.framework === 'jest') {
      result = result.replace(/\{\{FRAMEWORK_SETUP\}\}/g, 'beforeAll');
      result = result.replace(/\{\{FRAMEWORK_TEARDOWN\}\}/g, 'afterAll');
    } else if (options.framework === 'mocha') {
      result = result.replace(/\{\{FRAMEWORK_SETUP\}\}/g, 'before');
      result = result.replace(/\{\{FRAMEWORK_TEARDOWN\}\}/g, 'after');
    }

    return result;
  }

  // Helper methods

  private sanitizeTestName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^[0-9]/, '_$&');
  }

  private extractSessionId(recording: TestRecording): string {
    const createStep = recording.steps.find(s => s.type === 'create_session');
    return createStep?.sessionId || 'session';
  }

  private escapeString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  private indent(text: string, spaces: number): string {
    if (!text) return '';
    const indentation = ' '.repeat(spaces);
    return text
      .split('\n')
      .map(line => line ? indentation + line : line)
      .join('\n');
  }
}
