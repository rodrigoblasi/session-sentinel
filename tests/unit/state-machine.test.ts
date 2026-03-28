import { describe, it, expect } from 'vitest';
import { transition } from '../../src/monitor/state-machine.js';
import type { ParsedEvent, SessionStatus } from '../../src/shared/types.js';

function makeEvent(overrides: Partial<ParsedEvent>): ParsedEvent {
  return {
    type: 'other',
    raw_type: 'unknown',
    timestamp: '2026-03-27T10:00:00Z',
    sessionId: null,
    entrypoint: null,
    cwd: null,
    gitBranch: null,
    slug: null,
    isSidechain: false,
    tokens: null,
    model: null,
    toolName: null,
    toolInput: null,
    question: null,
    errorMessage: null,
    remoteUrl: null,
    lastPrompt: null,
    hookName: null,
    agentId: null,
    turnDurationMs: null,
    messageCount: null,
    stopReason: null,
    prUrl: null,
    customTitle: null,
    agentName: null,
    raw: {},
    ...overrides,
  };
}

describe('transition', () => {
  it('starting → active on assistant:text', () => {
    const result = transition('starting', makeEvent({ type: 'assistant:text' }));
    expect(result).toBe('active');
  });

  it('starting → active on assistant:tool_use', () => {
    const result = transition('starting', makeEvent({ type: 'assistant:tool_use' }));
    expect(result).toBe('active');
  });

  it('active → waiting on AskUserQuestion', () => {
    const result = transition('active', makeEvent({
      type: 'assistant:tool_use',
      toolName: 'AskUserQuestion',
      question: 'Which env?',
    }));
    expect(result).toBe('waiting');
  });

  it('active stays active on non-question tool_use', () => {
    const result = transition('active', makeEvent({
      type: 'assistant:tool_use',
      toolName: 'Read',
    }));
    expect(result).toBeNull();
  });

  it('waiting → active on user:prompt', () => {
    const result = transition('waiting', makeEvent({ type: 'user:prompt' }));
    expect(result).toBe('active');
  });

  it('waiting stays waiting on user:tool_result', () => {
    const result = transition('waiting', makeEvent({ type: 'user:tool_result' }));
    expect(result).toBeNull();
  });

  it('idle → active on assistant event', () => {
    const result = transition('idle', makeEvent({ type: 'assistant:text' }));
    expect(result).toBe('active');
  });

  it('idle → active on user:prompt', () => {
    const result = transition('idle', makeEvent({ type: 'user:prompt' }));
    expect(result).toBe('active');
  });

  it('any → error on system:api_error', () => {
    for (const status of ['starting', 'active', 'waiting', 'idle'] as SessionStatus[]) {
      const result = transition(status, makeEvent({ type: 'system:api_error' }));
      expect(result).toBe('error');
    }
  });

  it('any → error on assistant:error', () => {
    const result = transition('active', makeEvent({ type: 'assistant:error' }));
    expect(result).toBe('error');
  });

  it('error → active on successful assistant event', () => {
    const result = transition('error', makeEvent({ type: 'assistant:text' }));
    expect(result).toBe('active');
  });

  it('ended → starting on progress:hook (resume)', () => {
    const result = transition('ended', makeEvent({
      type: 'progress:hook',
      hookName: 'SessionStart:resume',
    }));
    expect(result).toBe('starting');
  });

  it('ended stays ended on last_prompt', () => {
    const result = transition('ended', makeEvent({ type: 'last_prompt' }));
    expect(result).toBeNull();
  });

  it('returns null when no transition applies', () => {
    const result = transition('active', makeEvent({ type: 'system:turn_duration' }));
    expect(result).toBeNull();
  });
});
