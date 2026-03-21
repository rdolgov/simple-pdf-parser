import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { formatWithOptions } from 'node:util';

export interface RollingConsoleLoggerConfig {
  enabled: boolean;
  dir: string;
  fileName: string;
  maxBytes: number;
  maxFiles: number;
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

interface InstalledConsoleLogger {
  close: () => Promise<void>;
  restore: () => void;
  getActiveLogPath: () => string;
}

export function installRollingConsoleLogger(config: RollingConsoleLoggerConfig): InstalledConsoleLogger {
  if (!config.enabled) {
    return {
      close: async () => {},
      restore: () => {},
      getActiveLogPath: () => join(config.dir, config.fileName)
    };
  }

  const fileLogger = new RollingFileLogger(config);
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  } satisfies Record<ConsoleMethod, (...args: unknown[]) => void>;

  const wrap = (method: ConsoleMethod, level: LogLevel) => (...args: unknown[]) => {
    originalConsole[method](...args);
    fileLogger.enqueue(level, args, (error) => {
      originalConsole.error('[llm-proxy] Failed to write log file entry', error);
    });
  };

  console.log = wrap('log', 'INFO');
  console.info = wrap('info', 'INFO');
  console.warn = wrap('warn', 'WARN');
  console.error = wrap('error', 'ERROR');
  console.debug = wrap('debug', 'DEBUG');

  return {
    close: () => fileLogger.close(),
    restore: () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
    },
    getActiveLogPath: () => fileLogger.getActiveLogPath()
  };
}

export class RollingFileLogger {
  private readonly config: RollingConsoleLoggerConfig;
  private readonly activeLogPath: string;
  private stream: WriteStream | null = null;
  private currentSize = 0;
  private ready: Promise<void>;
  private queue: Promise<void> = Promise.resolve();

  constructor(config: RollingConsoleLoggerConfig) {
    this.config = config;
    this.activeLogPath = join(config.dir, config.fileName);
    this.ready = this.initialize();
  }

  getActiveLogPath(): string {
    return this.activeLogPath;
  }

  enqueue(level: LogLevel, args: unknown[], onError: (error: unknown) => void): void {
    const entry = formatLogEntry(level, args);
    this.queue = this.queue
      .then(async () => {
        await this.ready;
        await this.write(entry);
      })
      .catch((error) => {
        onError(error);
      });
  }

  async close(): Promise<void> {
    await this.queue;
    await this.closeStream();
  }

  private async initialize(): Promise<void> {
    await mkdir(this.config.dir, { recursive: true });
    try {
      const stats = await stat(this.activeLogPath);
      this.currentSize = stats.size;
    } catch {
      this.currentSize = 0;
    }
    this.stream = createWriteStream(this.activeLogPath, { flags: 'a' });
  }

  private async write(entry: string): Promise<void> {
    const payload = Buffer.from(entry, 'utf8');
    if (this.currentSize + payload.length > this.config.maxBytes) {
      await this.rotate();
    }
    await this.writeBuffer(payload);
    this.currentSize += payload.length;
  }

  private async rotate(): Promise<void> {
    await this.closeStream();

    const archiveCount = Math.max(0, this.config.maxFiles - 1);
    if (archiveCount > 0) {
      await safeRemove(this.getArchivePath(archiveCount));
      for (let index = archiveCount - 1; index >= 1; index -= 1) {
        await safeRename(this.getArchivePath(index), this.getArchivePath(index + 1));
      }
      await safeRename(this.activeLogPath, this.getArchivePath(1));
    } else {
      await safeRemove(this.activeLogPath);
    }

    this.stream = createWriteStream(this.activeLogPath, { flags: 'a' });
    this.currentSize = 0;
  }

  private async closeStream(): Promise<void> {
    if (!this.stream) {
      return;
    }
    const stream = this.stream;
    this.stream = null;
    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async writeBuffer(payload: Buffer): Promise<void> {
    if (!this.stream) {
      this.stream = createWriteStream(this.activeLogPath, { flags: 'a' });
    }
    const stream = this.stream;
    await new Promise<void>((resolve, reject) => {
      stream.write(payload, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private getArchivePath(index: number): string {
    return `${this.activeLogPath}.${index}`;
  }
}

function formatLogEntry(level: LogLevel, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const message = formatWithOptions(
    {
      colors: false,
      depth: 8,
      maxArrayLength: 40,
      breakLength: 140
    },
    ...args.map((value) => value instanceof Error ? value.stack ?? value.message : value)
  );
  return `[${timestamp}] [${level}] ${message}\n`;
}

async function safeRename(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await rename(sourcePath, targetPath);
  } catch {
    // no-op when a rotated file does not exist yet
  }
}

async function safeRemove(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // no-op for missing paths
  }
}
