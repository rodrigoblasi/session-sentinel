import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export interface WatcherEvents {
  lines: { filePath: string; newLines: string[] };
  new_file: { filePath: string };
  error: { error: Error; context: string };
}

export class JsonlWatcher extends EventEmitter {
  private watchRoot: string;
  private offsets = new Map<string, number>();
  private watchers: fs.FSWatcher[] = [];
  private scanTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(watchRoot: string) {
    super();
    this.watchRoot = watchRoot;
  }

  async start(): Promise<void> {
    this.running = true;

    // Initial scan for existing JSONL files
    this.scanDirectory(this.watchRoot);

    // Watch for changes
    try {
      const watcher = fs.watch(this.watchRoot, { recursive: true }, (eventType, filename) => {
        if (!filename || !this.running) return;

        const fullPath = path.join(this.watchRoot, filename);
        if (!fullPath.endsWith('.jsonl')) return;

        this.handleFileChange(fullPath);
      });

      watcher.on('error', (error) => {
        this.emit('error', { error, context: 'fs.watch' });
      });

      this.watchers.push(watcher);
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'start watch' });
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  getWatchedFiles(): string[] {
    return [...this.offsets.keys()];
  }

  private scanDirectory(dir: string): void {
    try {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const fullPath = path.join(entry.parentPath ?? entry.path ?? dir, entry.name);
          if (!this.offsets.has(fullPath)) {
            // For existing files, start from current end (don't replay history)
            const stats = fs.statSync(fullPath);
            this.offsets.set(fullPath, stats.size);
          }
        }
      }
    } catch (error) {
      this.emit('error', { error: error as Error, context: `scan ${dir}` });
    }
  }

  private handleFileChange(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;

      const stats = fs.statSync(filePath);
      const isNew = !this.offsets.has(filePath);

      if (isNew) {
        this.offsets.set(filePath, 0);
        this.emit('new_file', { filePath });
      }

      const offset = this.offsets.get(filePath) ?? 0;
      if (stats.size <= offset) return;

      // Read only new bytes
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stats.size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      fs.closeSync(fd);

      this.offsets.set(filePath, stats.size);

      const text = buffer.toString('utf-8');
      const newLines = text.split('\n').filter((line) => line.trim().length > 0);

      if (newLines.length > 0) {
        this.emit('lines', { filePath, newLines });
      }
    } catch (error) {
      this.emit('error', { error: error as Error, context: `read ${filePath}` });
    }
  }
}
