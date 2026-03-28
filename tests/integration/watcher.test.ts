import { describe, it, expect, afterEach } from 'vitest';
import { JsonlWatcher } from '../../src/monitor/watcher.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('JsonlWatcher', () => {
  let tmpDir: string;
  let watcher: JsonlWatcher;

  afterEach(async () => {
    if (watcher) await watcher.stop();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects new JSONL file and emits lines', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watcher-'));
    watcher = new JsonlWatcher(tmpDir);

    const lines: string[] = [];
    watcher.on('lines', ({ filePath, newLines }) => {
      lines.push(...newLines);
    });

    await watcher.start();

    // Create a JSONL file after watcher is running
    const jsonlPath = path.join(tmpDir, 'test-session.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"user","sessionId":"test"}\n');

    // Wait for fs.watch to pick up the change
    await sleep(500);

    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain('"type":"user"');
  });

  it('reads incremental appends', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watcher-'));
    watcher = new JsonlWatcher(tmpDir);

    const allLines: string[] = [];
    watcher.on('lines', ({ newLines }) => {
      allLines.push(...newLines);
    });

    await watcher.start();

    const jsonlPath = path.join(tmpDir, 'incremental.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"user","n":1}\n');
    await sleep(500);

    fs.appendFileSync(jsonlPath, '{"type":"assistant","n":2}\n');
    await sleep(500);

    expect(allLines).toHaveLength(2);
  });

  it('emits new_file event for new JSONL', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watcher-'));
    watcher = new JsonlWatcher(tmpDir);

    const newFiles: string[] = [];
    watcher.on('new_file', ({ filePath }) => {
      newFiles.push(filePath);
    });

    await watcher.start();

    fs.writeFileSync(path.join(tmpDir, 'new-session.jsonl'), '{"type":"user"}\n');
    await sleep(500);

    expect(newFiles).toHaveLength(1);
    expect(newFiles[0]).toContain('new-session.jsonl');
  });

  it('ignores non-JSONL files', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watcher-'));
    watcher = new JsonlWatcher(tmpDir);

    const lines: string[] = [];
    watcher.on('lines', ({ newLines }) => {
      lines.push(...newLines);
    });

    await watcher.start();

    fs.writeFileSync(path.join(tmpDir, 'not-jsonl.txt'), 'hello\n');
    await sleep(500);

    expect(lines).toHaveLength(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
