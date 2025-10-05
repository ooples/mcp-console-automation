// Mock for p-queue ESM package
class PQueue {
  constructor(options) {
    this.concurrency = options?.concurrency || Infinity;
    this.queue = [];
    this.running = 0;
  }

  async add(fn) {
    if (this.running < this.concurrency) {
      this.running++;
      try {
        return await fn();
      } finally {
        this.running--;
        this._processNext();
      }
    } else {
      return new Promise((resolve, reject) => {
        this.queue.push({ fn, resolve, reject });
      });
    }
  }

  async _processNext() {
    if (this.queue.length > 0 && this.running < this.concurrency) {
      const { fn, resolve, reject } = this.queue.shift();
      this.running++;
      try {
        resolve(await fn());
      } catch (error) {
        reject(error);
      } finally {
        this.running--;
        this._processNext();
      }
    }
  }

  clear() {
    this.queue = [];
  }

  get size() {
    return this.queue.length;
  }

  get pending() {
    return this.running;
  }
}

module.exports = PQueue;
module.exports.default = PQueue;
