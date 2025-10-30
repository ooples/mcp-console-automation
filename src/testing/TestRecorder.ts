/**
 * TestRecorder - Records console interactions for test replay
 *
 * This class captures all console operations including session creation,
 * input, output, and timing information for later replay or code generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  TestRecording,
  RecordingStep,
  RecordingMetadata,
} from '../types/test-framework.js';

export interface RecorderOptions {
  name: string;
  author?: string;
  description?: string;
  tags?: string[];
  environment?: Record<string, string>;
  outputDir?: string;
}

export class TestRecorder {
  private recording: TestRecording | null = null;
  private isRecording = false;
  private startTime = 0;
  private outputDir: string;
  private currentSessionId: string | null = null;

  constructor(outputDir = 'data/recordings') {
    this.outputDir = outputDir;
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Start recording a new test session
   */
  public startRecording(options: RecorderOptions): void {
    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    this.startTime = Date.now();
    this.isRecording = true;
    this.currentSessionId = null;

    const metadata: RecordingMetadata = {
      author: options.author,
      description: options.description,
      tags: options.tags,
      environment: options.environment || this.captureEnvironment(),
    };

    this.recording = {
      name: options.name,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      duration: 0,
      steps: [],
      metadata,
    };

    if (options.outputDir) {
      this.outputDir = options.outputDir;
      this.ensureOutputDir();
    }
  }

  /**
   * Stop recording and save to file
   */
  public stopRecording(): TestRecording {
    if (!this.isRecording || !this.recording) {
      throw new Error('No recording in progress');
    }

    this.recording.duration = Date.now() - this.startTime;
    this.isRecording = false;

    // Save to file
    const filename = this.sanitizeFilename(this.recording.name) + '.json';
    const filepath = path.join(this.outputDir, filename);

    fs.writeFileSync(
      filepath,
      JSON.stringify(this.recording, null, 2),
      'utf-8'
    );

    const result = this.recording;
    this.recording = null;
    this.currentSessionId = null;

    return result;
  }

  /**
   * Record a create_session step
   */
  public recordCreateSession(
    sessionId: string,
    data: any,
    output?: string
  ): void {
    this.addStep({
      type: 'create_session',
      timestamp: this.getRelativeTimestamp(),
      data,
      output,
      sessionId,
    });
    this.currentSessionId = sessionId;
  }

  /**
   * Record a send_input step
   */
  public recordSendInput(
    input: string,
    sessionId?: string,
    output?: string
  ): void {
    this.addStep({
      type: 'send_input',
      timestamp: this.getRelativeTimestamp(),
      data: { input },
      output,
      sessionId: sessionId || this.currentSessionId || undefined,
    });
  }

  /**
   * Record a send_key step
   */
  public recordSendKey(key: string, sessionId?: string, output?: string): void {
    this.addStep({
      type: 'send_key',
      timestamp: this.getRelativeTimestamp(),
      data: { key },
      output,
      sessionId: sessionId || this.currentSessionId || undefined,
    });
  }

  /**
   * Record a wait_for_output step
   */
  public recordWaitForOutput(
    pattern: string,
    timeout: number,
    sessionId?: string,
    output?: string
  ): void {
    this.addStep({
      type: 'wait_for_output',
      timestamp: this.getRelativeTimestamp(),
      data: { pattern, timeout },
      output,
      sessionId: sessionId || this.currentSessionId || undefined,
    });
  }

  /**
   * Record an assertion step (for future Phase 2 integration)
   */
  public recordAssertion(assertion: any, sessionId?: string): void {
    this.addStep({
      type: 'assert',
      timestamp: this.getRelativeTimestamp(),
      data: assertion,
      sessionId: sessionId || this.currentSessionId || undefined,
    });
  }

  /**
   * Record a snapshot step (for future Phase 2 integration)
   */
  public recordSnapshot(snapshot: any, sessionId?: string): void {
    this.addStep({
      type: 'snapshot',
      timestamp: this.getRelativeTimestamp(),
      data: snapshot,
      sessionId: sessionId || this.currentSessionId || undefined,
    });
  }

  /**
   * Get current recording state
   */
  public getRecording(): TestRecording | null {
    return this.recording;
  }

  /**
   * Check if currently recording
   */
  public isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  /**
   * List all recordings in the output directory
   */
  public static listRecordings(outputDir = 'data/recordings'): string[] {
    if (!fs.existsSync(outputDir)) {
      return [];
    }

    return fs
      .readdirSync(outputDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.basename(file, '.json'));
  }

  /**
   * Load a recording from file
   */
  public static loadRecording(
    name: string,
    outputDir = 'data/recordings'
  ): TestRecording {
    const filename = name.endsWith('.json') ? name : `${name}.json`;
    const filepath = path.join(outputDir, filename);

    if (!fs.existsSync(filepath)) {
      throw new Error(`Recording not found: ${name}`);
    }

    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content) as TestRecording;
  }

  /**
   * Delete a recording file
   */
  public static deleteRecording(
    name: string,
    outputDir = 'data/recordings'
  ): void {
    const filename = name.endsWith('.json') ? name : `${name}.json`;
    const filepath = path.join(outputDir, filename);

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }

  // Private helper methods

  private addStep(step: RecordingStep): void {
    if (!this.isRecording || !this.recording) {
      throw new Error('Cannot add step: no recording in progress');
    }

    this.recording.steps.push(step);
  }

  private getRelativeTimestamp(): number {
    if (!this.isRecording) {
      throw new Error('Cannot get timestamp: no recording in progress');
    }
    return Date.now() - this.startTime;
  }

  private captureEnvironment(): Record<string, string> {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
      timestamp: new Date().toISOString(),
    };
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }

  /**
   * Get recording statistics
   */
  public getStats(): {
    steps: number;
    duration: number;
    sessionId: string | null;
  } | null {
    if (!this.recording) {
      return null;
    }

    return {
      steps: this.recording.steps.length,
      duration: Date.now() - this.startTime,
      sessionId: this.currentSessionId,
    };
  }

  /**
   * Cancel recording without saving
   */
  public cancelRecording(): void {
    if (!this.isRecording) {
      throw new Error('No recording in progress');
    }

    this.recording = null;
    this.isRecording = false;
    this.currentSessionId = null;
  }
}
