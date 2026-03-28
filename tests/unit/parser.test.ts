import { describe, it, expect } from 'vitest';
import { parseLine } from '../../src/monitor/parser.js';

describe('parseLine', () => {
  it('returns null for empty or invalid lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('{}')).toBeNull();
  });

  it('skips hook_progress events', () => {
    const line = JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Read' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    expect(parseLine(line)).toBeNull();
  });

  it('parses SessionStart hook_progress as progress:hook (not skipped)', () => {
    const line = JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
      cwd: '/home/user/project',
      gitBranch: 'main',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('progress:hook');
    expect(event?.hookName).toBe('SessionStart:startup');
    expect(event?.entrypoint).toBe('cli');
  });

  it('parses assistant text event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 3,
          output_tokens: 20,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 100,
        },
      },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      slug: 'my-session',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('assistant:text');
    expect(event?.model).toBe('claude-opus-4-6');
    expect(event?.tokens).toEqual({
      input_tokens: 3,
      output_tokens: 20,
      cache_read_tokens: 5000,
      cache_create_tokens: 100,
    });
    expect(event?.stopReason).toBe('end_turn');
    expect(event?.slug).toBe('my-session');
  });

  it('parses assistant tool_use event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading file' },
          { type: 'tool_use', id: 'toolu_001', name: 'Read', input: { file_path: '/README.md' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('assistant:tool_use');
    expect(event?.toolName).toBe('Read');
  });

  it('parses AskUserQuestion as question event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_001',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Which env?' }] },
        }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('assistant:tool_use');
    expect(event?.toolName).toBe('AskUserQuestion');
    expect(event?.question).toBe('Which env?');
  });

  it('parses assistant error event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        isApiErrorMessage: true,
        content: [{ type: 'text', text: 'Error occurred' }],
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('assistant:error');
    expect(event?.errorMessage).toBe('Error occurred');
  });

  it('parses user prompt (not tool result)', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Hello world' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      promptId: 'prompt-001',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('user:prompt');
  });

  it('parses user tool_result (not a real prompt)', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'file contents here' },
      toolUseResult: true,
      sourceToolUseID: 'toolu_001',
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('user:tool_result');
  });

  it('parses system:bridge_status', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'bridge_status',
      url: 'https://claude.ai/code/session_test',
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('system:bridge_status');
    expect(event?.remoteUrl).toBe('https://claude.ai/code/session_test');
  });

  it('parses system:api_error', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'api_error',
      error: { status: 529, error: { error: { message: 'Overloaded' } } },
      retryAttempt: 1,
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('system:api_error');
    expect(event?.errorMessage).toBe('Overloaded');
  });

  it('parses system:turn_duration', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'turn_duration',
      durationMs: 5000,
      messageCount: 4,
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('system:turn_duration');
    expect(event?.turnDurationMs).toBe(5000);
    expect(event?.messageCount).toBe(4);
  });

  it('parses last-prompt', () => {
    const line = JSON.stringify({
      type: 'last-prompt',
      lastPrompt: 'Do the thing',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('last_prompt');
    expect(event?.lastPrompt).toBe('Do the thing');
  });

  it('parses agent_progress', () => {
    const line = JSON.stringify({
      type: 'progress',
      data: { type: 'agent_progress', agentId: 'a1234567890abcdef', prompt: 'Explore files' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('progress:agent');
    expect(event?.agentId).toBe('a1234567890abcdef');
  });

  it('extracts common fields from all events', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'test' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'sdk-cli',
      cwd: '/home/user/project',
      gitBranch: 'feat/x',
      isSidechain: true,
      agentId: 'a123',
      promptId: 'p1',
    });
    const event = parseLine(line);
    expect(event?.sessionId).toBe('uuid-1');
    expect(event?.entrypoint).toBe('sdk-cli');
    expect(event?.cwd).toBe('/home/user/project');
    expect(event?.gitBranch).toBe('feat/x');
    expect(event?.isSidechain).toBe(true);
    expect(event?.agentId).toBe('a123');
  });
});
