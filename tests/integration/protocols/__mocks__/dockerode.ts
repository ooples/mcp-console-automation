/**
 * Mock implementation of dockerode for testing
 */

export class Container {
  id: string;
  private inspectData: any;

  constructor(id: string, options: any = {}) {
    this.id = id;
    this.inspectData = {
      Id: id,
      Name: options.name || `mock-container-${id}`,
      State: {
        Status: 'running',
        Running: true,
        Paused: false,
        Restarting: false,
        OOMKilled: false,
        Dead: false,
        Pid: 12345,
        ExitCode: 0,
        Error: '',
        StartedAt: new Date().toISOString(),
        FinishedAt: '0001-01-01T00:00:00Z'
      },
      Image: options.Image || 'ubuntu:latest',
      Created: new Date().toISOString(),
      Config: {
        Image: options.Image || 'ubuntu:latest',
        Cmd: options.Cmd || ['/bin/bash'],
        Env: options.Env || [],
        WorkingDir: options.WorkingDir || '/app'
      },
      NetworkSettings: {
        Ports: {},
        Networks: {}
      },
      Mounts: []
    };
  }

  async start() {
    this.inspectData.State.Status = 'running';
    this.inspectData.State.Running = true;
    return Promise.resolve();
  }

  async stop() {
    this.inspectData.State.Status = 'exited';
    this.inspectData.State.Running = false;
    return Promise.resolve();
  }

  async remove() {
    return Promise.resolve();
  }

  async kill() {
    this.inspectData.State.Status = 'exited';
    this.inspectData.State.Running = false;
    return Promise.resolve();
  }

  async inspect() {
    return Promise.resolve(this.inspectData);
  }

  exec(options: any) {
    const execId = `exec-${Date.now()}`;
    return Promise.resolve({
      id: execId,
      start: async (startOptions: any) => {
        const stream = new MockStream();
        if (startOptions?.Detach) {
          return Promise.resolve();
        }
        setTimeout(() => {
          stream.emit('data', Buffer.from('Mock exec output\n'));
          stream.emit('end');
        }, 100);
        return Promise.resolve(stream);
      },
      inspect: async () => {
        return Promise.resolve({
          ID: execId,
          Running: false,
          ExitCode: 0
        });
      }
    });
  }

  stats(options?: any) {
    const stream = new MockStream();
    setTimeout(() => {
      const stats = {
        read: new Date().toISOString(),
        cpu_stats: {
          cpu_usage: {
            total_usage: 1234567890,
            usage_in_kernelmode: 100000000,
            usage_in_usermode: 200000000
          },
          system_cpu_usage: 10000000000,
          online_cpus: 4
        },
        memory_stats: {
          usage: 128 * 1024 * 1024,
          max_usage: 256 * 1024 * 1024,
          limit: 512 * 1024 * 1024
        },
        networks: {
          eth0: {
            rx_bytes: 1024,
            tx_bytes: 2048
          }
        },
        blkio_stats: {
          io_service_bytes_recursive: [
            { op: 'Read', value: 4096 },
            { op: 'Write', value: 8192 }
          ]
        }
      };
      stream.emit('data', JSON.stringify(stats));
      if (!options?.stream) {
        stream.emit('end');
      }
    }, 100);
    return stream;
  }

  logs(options?: any) {
    const stream = new MockStream();
    setTimeout(() => {
      stream.emit('data', Buffer.from('Mock log entry 1\n'));
      stream.emit('data', Buffer.from('Mock log entry 2\n'));
      if (!options?.follow) {
        stream.emit('end');
      }
    }, 100);
    return stream;
  }
}

class MockStream {
  private listeners: Map<string, Function[]> = new Map();

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
    return this;
  }

  emit(event: string, data?: any) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => cb(data));
  }

  removeAllListeners() {
    this.listeners.clear();
  }
}

export default class Docker {
  private containers: Map<string, Container> = new Map();
  private images: Set<string> = new Set(['ubuntu:latest', 'alpine:latest', 'nginx:latest']);

  constructor(options?: any) {
    // Mock constructor
  }

  async createContainer(options: any) {
    const id = `container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const container = new Container(id, options);
    this.containers.set(id, container);
    return container;
  }

  async listContainers(options?: any) {
    return Array.from(this.containers.values()).map(c => ({
      Id: c.id,
      Names: [`/mock-container-${c.id}`],
      Image: 'ubuntu:latest',
      State: 'running',
      Status: 'Up 5 minutes',
      Created: Date.now() / 1000
    }));
  }

  getContainer(id: string) {
    let container = this.containers.get(id);
    if (!container) {
      container = new Container(id);
      this.containers.set(id, container);
    }
    return container;
  }

  getEvents(options?: any) {
    const stream = new MockStream();
    // Emit some mock events
    setTimeout(() => {
      stream.emit('data', JSON.stringify({
        Type: 'container',
        Action: 'start',
        Actor: {
          ID: 'mock-container-123',
          Attributes: {}
        }
      }));
    }, 100);
    return stream;
  }

  async version() {
    return {
      Version: '20.10.0',
      ApiVersion: '1.41',
      GoVersion: 'go1.16.0',
      GitCommit: 'abc1234',
      Os: 'linux',
      Arch: 'amd64'
    };
  }

  async info() {
    return {
      ID: 'mock-docker-daemon',
      Containers: this.containers.size,
      ContainersRunning: this.containers.size,
      ContainersPaused: 0,
      ContainersStopped: 0,
      Images: this.images.size,
      Driver: 'overlay2',
      MemoryLimit: true,
      SwapLimit: true,
      KernelVersion: '5.10.0',
      OperatingSystem: 'Ubuntu 20.04',
      NCPU: 4,
      MemTotal: 8 * 1024 * 1024 * 1024
    };
  }

  async ping() {
    return 'OK';
  }

  async pullImage(image: string) {
    const stream = new MockStream();
    this.images.add(image);
    setTimeout(() => {
      stream.emit('data', JSON.stringify({ status: 'Pulling from library/' + image }));
      stream.emit('data', JSON.stringify({ status: 'Pull complete' }));
      stream.emit('end');
    }, 100);
    return stream;
  }
}
