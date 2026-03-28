import { describe, it, expect } from 'vitest';
import { RunDetector } from '../../src/monitor/run-detector.js';
import { parseLine } from '../../src/monitor/parser.js';
import fs from 'node:fs';
import path from 'node:path';

describe('RunDetector', () => {
  it('detects initial startup as run boundary', () => {
    const detector = new RunDetector();
    const line = JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    });
    const event = parseLine(line)!;
    const boundary = detector.checkBoundary(event);

    expect(boundary).not.toBeNull();
    expect(boundary?.startType).toBe('startup');
    expect(boundary?.entrypoint).toBe('cli');
  });

  it('detects resume hook as run boundary', () => {
    const detector = new RunDetector();

    // First startup
    const startup = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T08:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    }))!;
    detector.checkBoundary(startup);

    // Some events happen...
    detector.markEventSeen();

    // Resume hook
    const resume = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:resume' },
      timestamp: '2026-03-27T12:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    }))!;
    const boundary = detector.checkBoundary(resume);

    expect(boundary).not.toBeNull();
    expect(boundary?.startType).toBe('resume');
  });

  it('detects last-prompt followed by new event as run boundary', () => {
    const detector = new RunDetector();

    // Startup
    const startup = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T08:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    }))!;
    detector.checkBoundary(startup);
    detector.markEventSeen();

    // last-prompt
    const lastPrompt = parseLine(JSON.stringify({
      type: 'last-prompt',
      lastPrompt: 'some prompt',
      sessionId: 'uuid-1',
    }))!;
    detector.checkBoundary(lastPrompt);

    // New event after last-prompt
    const newEvent = parseLine(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'continue' },
      timestamp: '2026-03-27T12:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
      promptId: 'p1',
    }))!;
    const boundary = detector.checkBoundary(newEvent);

    expect(boundary).not.toBeNull();
    expect(boundary?.startType).toBe('resume');
  });

  it('detects entrypoint change for handoff', () => {
    const detector = new RunDetector();

    // Startup with sdk-cli
    const startup = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T08:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'sdk-cli',
    }))!;
    detector.checkBoundary(startup);
    detector.markEventSeen();

    // Resume with cli (user took over)
    const resume = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:resume' },
      timestamp: '2026-03-27T12:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    }))!;
    const boundary = detector.checkBoundary(resume);

    expect(boundary?.entrypoint).toBe('cli');
    expect(boundary?.previousEntrypoint).toBe('sdk-cli');
    expect(boundary?.isHandoff).toBe(true);
  });

  it('processes full resume fixture correctly', () => {
    const fixturePath = path.join(process.cwd(), 'sandbox/fixtures/session-with-resume.jsonl');
    const lines = fs.readFileSync(fixturePath, 'utf-8').trim().split('\n');

    const detector = new RunDetector();
    const boundaries: any[] = [];

    for (const line of lines) {
      const event = parseLine(line);
      if (!event) continue;
      const boundary = detector.checkBoundary(event);
      if (boundary) boundaries.push(boundary);
      detector.markEventSeen();
    }

    expect(boundaries).toHaveLength(2);
    expect(boundaries[0].startType).toBe('startup');
    expect(boundaries[1].startType).toBe('resume');
  });
});
