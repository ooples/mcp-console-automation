/**
 * WorkerPool - Manages worker threads for parallel test execution
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

export interface WorkerTask {
  id: string;
  test: any; // TestDefinition
  timeout: number;
}

export interface WorkerResult {
  taskId: string;
  result: any; // TestResult
  error?: Error;
}

export interface WorkerInfo {
  id: number;
  worker: Worker;
  busy: boolean;
  currentTask?: WorkerTask;
  tasksCompleted: number;
  startTime: number;
  lastHeartbeat: number;
}

export interface WorkerPoolConfig {
  maxWorkers: number;
  workerTimeout: number;
  heartbeatInterval: number;
  gracefulShutdownTimeout: number;
}

export class WorkerPool extends EventEmitter {
  private workers: Map<number, WorkerInfo> = new Map();
  private taskQueue: WorkerTask[] = [];
  private nextWorkerId = 0;
  private shuttingDown = false;
  private config: WorkerPoolConfig;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    super();
    this.config = {
      maxWorkers: config.maxWorkers || 4,
      workerTimeout: config.workerTimeout || 300000, // 5 minutes
      heartbeatInterval: config.heartbeatInterval || 5000,
      gracefulShutdownTimeout: config.gracefulShutdownTimeout || 30000,
    };
  }

  /**
   * Initialize worker pool
   */
  async initialize(): Promise<void> {
    if (this.workers.size > 0) {
      throw new Error('Worker pool already initialized');
    }

    // Create initial workers
    for (let i = 0; i < this.config.maxWorkers; i++) {
      await this.createWorker();
    }

    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();

    this.emit('initialized', { workerCount: this.workers.size });
  }

  /**
   * Create a new worker
   */
  private async createWorker(): Promise<WorkerInfo> {
    const workerId = this.nextWorkerId++;
    
    // Determine the correct worker path
    // In production/dist: __dirname points to dist/testing, use test-worker.js
    // In development/testing with ts-jest: __dirname points to src/testing, use compiled version from dist
    let workerPath = path.join(__dirname, 'test-worker.js');
    
    // If running from src (TypeScript), try to use the dist version
    if (__dirname.includes('/src/testing') || __dirname.includes('\\src\\testing')) {
      const distPath = path.join(__dirname, '../../dist/testing/test-worker.js');
      if (existsSync(distPath)) {
        workerPath = distPath;
      }
    }

    const worker = new Worker(workerPath, {
      workerData: { workerId },
    });

    const workerInfo: WorkerInfo = {
      id: workerId,
      worker,
      busy: false,
      tasksCompleted: 0,
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
    };

    // Handle worker messages
    worker.on('message', (message) => {
      this.handleWorkerMessage(workerId, message);
    });

    // Handle worker errors
    worker.on('error', (error) => {
      this.handleWorkerError(workerId, error);
    });

    // Handle worker exit
    worker.on('exit', (code) => {
      this.handleWorkerExit(workerId, code);
    });

    this.workers.set(workerId, workerInfo);
    this.emit('worker-created', { workerId });

    return workerInfo;
  }

  /**
   * Execute a task on an available worker
   */
  async executeTask(task: WorkerTask): Promise<WorkerResult> {
    if (this.shuttingDown) {
      throw new Error('Worker pool is shutting down');
    }

    return new Promise((resolve, reject) => {
      // Add to queue
      this.taskQueue.push(task);

      // Set up one-time listener for this task
      const resultHandler = (result: WorkerResult) => {
        if (result.taskId === task.id) {
          this.removeListener('task-complete', resultHandler);
          this.removeListener('task-error', errorHandler);
          resolve(result);
        }
      };

      const errorHandler = (error: { taskId: string; error: Error }) => {
        if (error.taskId === task.id) {
          this.removeListener('task-complete', resultHandler);
          this.removeListener('task-error', errorHandler);
          reject(error.error);
        }
      };

      this.on('task-complete', resultHandler);
      this.on('task-error', errorHandler);

      // Try to assign task immediately
      this.assignTasks();
    });
  }

  /**
   * Assign queued tasks to available workers
   */
  private assignTasks(): void {
    while (this.taskQueue.length > 0) {
      const availableWorker = this.findAvailableWorker();
      if (!availableWorker) {
        break; // No available workers
      }

      const task = this.taskQueue.shift()!;
      this.assignTaskToWorker(availableWorker, task);
    }
  }

  /**
   * Find an available worker
   */
  private findAvailableWorker(): WorkerInfo | undefined {
    for (const worker of this.workers.values()) {
      if (!worker.busy) {
        return worker;
      }
    }
    return undefined;
  }

  /**
   * Assign a task to a specific worker
   */
  private assignTaskToWorker(workerInfo: WorkerInfo, task: WorkerTask): void {
    workerInfo.busy = true;
    workerInfo.currentTask = task;
    workerInfo.lastHeartbeat = Date.now();

    // Send task to worker
    workerInfo.worker.postMessage({
      type: 'execute',
      task,
    });

    this.emit('task-assigned', { workerId: workerInfo.id, taskId: task.id });

    // Set timeout for task
    setTimeout(() => {
      if (workerInfo.currentTask?.id === task.id) {
        this.handleTaskTimeout(workerInfo, task);
      }
    }, task.timeout || this.config.workerTimeout);
  }

  /**
   * Handle worker message
   */
  private handleWorkerMessage(workerId: number, message: any): void {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    workerInfo.lastHeartbeat = Date.now();

    switch (message.type) {
      case 'heartbeat':
        // Worker is alive
        break;

      case 'result':
        this.handleTaskComplete(workerInfo, message.result);
        break;

      case 'error':
        this.handleTaskError(workerInfo, message.error);
        break;

      default:
        console.warn(`Unknown message type from worker ${workerId}:`, message.type);
    }
  }

  /**
   * Handle task completion
   */
  private handleTaskComplete(workerInfo: WorkerInfo, result: any): void {
    const task = workerInfo.currentTask;
    if (!task) return;

    workerInfo.busy = false;
    workerInfo.currentTask = undefined;
    workerInfo.tasksCompleted++;

    const workerResult: WorkerResult = {
      taskId: task.id,
      result,
    };

    this.emit('task-complete', workerResult);

    // Assign next task if available
    this.assignTasks();
  }

  /**
   * Handle task error
   */
  private handleTaskError(workerInfo: WorkerInfo, error: any): void {
    const task = workerInfo.currentTask;
    if (!task) return;

    workerInfo.busy = false;
    workerInfo.currentTask = undefined;

    this.emit('task-error', {
      taskId: task.id,
      error: error instanceof Error ? error : new Error(String(error)),
    });

    // Assign next task if available
    this.assignTasks();
  }

  /**
   * Handle task timeout
   */
  private handleTaskTimeout(workerInfo: WorkerInfo, task: WorkerTask): void {
    console.warn(`Task ${task.id} timed out on worker ${workerInfo.id}`);

    // Terminate the worker and create a new one
    this.terminateWorker(workerInfo.id, true);

    this.emit('task-error', {
      taskId: task.id,
      error: new Error(`Task timed out after ${task.timeout}ms`),
    });

    // Create replacement worker
    this.createWorker().catch((err) => {
      console.error('Failed to create replacement worker:', err);
    });
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(workerId: number, error: Error): void {
    console.error(`Worker ${workerId} error:`, error);

    const workerInfo = this.workers.get(workerId);
    if (workerInfo?.currentTask) {
      this.emit('task-error', {
        taskId: workerInfo.currentTask.id,
        error,
      });
    }

    this.emit('worker-error', { workerId, error });
  }

  /**
   * Handle worker exit
   */
  private handleWorkerExit(workerId: number, code: number): void {
    console.log(`Worker ${workerId} exited with code ${code}`);

    const workerInfo = this.workers.get(workerId);
    if (workerInfo?.currentTask) {
      this.emit('task-error', {
        taskId: workerInfo.currentTask.id,
        error: new Error(`Worker exited with code ${code}`),
      });
    }

    this.workers.delete(workerId);
    this.emit('worker-exit', { workerId, code });

    // Create replacement worker if not shutting down
    if (!this.shuttingDown && this.workers.size < this.config.maxWorkers) {
      this.createWorker().catch((err) => {
        console.error('Failed to create replacement worker:', err);
      });
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeatMonitoring(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [workerId, workerInfo] of this.workers.entries()) {
        const timeSinceHeartbeat = now - workerInfo.lastHeartbeat;
        if (timeSinceHeartbeat > this.config.heartbeatInterval * 3) {
          console.warn(`Worker ${workerId} missed heartbeat (${timeSinceHeartbeat}ms)`);
          this.handleWorkerError(workerId, new Error('Worker heartbeat timeout'));
          this.terminateWorker(workerId, true);
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeatMonitoring(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Terminate a specific worker
   */
  private async terminateWorker(workerId: number, force: boolean = false): Promise<void> {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;

    try {
      if (force) {
        await workerInfo.worker.terminate();
      } else {
        workerInfo.worker.postMessage({ type: 'shutdown' });
        // Wait a bit for graceful shutdown
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await workerInfo.worker.terminate();
      }
    } catch (error) {
      console.error(`Error terminating worker ${workerId}:`, error);
    }

    this.workers.delete(workerId);
  }

  /**
   * Get pool statistics
   */
  getStatistics() {
    const workers = Array.from(this.workers.values());
    return {
      totalWorkers: workers.length,
      busyWorkers: workers.filter((w) => w.busy).length,
      idleWorkers: workers.filter((w) => !w.busy).length,
      queuedTasks: this.taskQueue.length,
      totalTasksCompleted: workers.reduce((sum, w) => sum + w.tasksCompleted, 0),
      averageTasksPerWorker: workers.length > 0
        ? workers.reduce((sum, w) => sum + w.tasksCompleted, 0) / workers.length
        : 0,
    };
  }

  /**
   * Gracefully shutdown the worker pool
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    this.stopHeartbeatMonitoring();

    // Wait for active tasks to complete or timeout
    const shutdownStart = Date.now();
    while (this.workers.size > 0) {
      const busyWorkers = Array.from(this.workers.values()).filter((w) => w.busy);

      if (busyWorkers.length === 0) {
        break; // All workers idle
      }

      const elapsed = Date.now() - shutdownStart;
      if (elapsed > this.config.gracefulShutdownTimeout) {
        console.warn('Graceful shutdown timeout, forcing termination');
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Terminate all remaining workers
    const terminationPromises = Array.from(this.workers.keys()).map((workerId) =>
      this.terminateWorker(workerId, true)
    );

    await Promise.all(terminationPromises);

    this.emit('shutdown');
  }
}
