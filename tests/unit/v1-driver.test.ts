import { describe, it, expect, vi, beforeEach } from 'vitest';
import { V1Driver } from '../../src/manager/v1-driver.js';
import type { TurnOpts, StreamEvent } from '../../src/shared/types.js';

// Mock the claude-agent-sdk module
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query as mockQuery } from '@anthropic-ai/claude-agent-sdk';

describe('V1Driver', () => {
  let driver: V1Driver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new V1Driver();
  });

  describe('startTurn', () => {
    it('calls query() with correct options for new session', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'system' as const,
          subtype: 'init' as const,
          session_id: 'test-session-id',
          model: 'claude-sonnet-4-6',
          cwd: '/tmp/test',
          tools: ['Read', 'Edit'],
          permissionMode: 'bypassPermissions' as const,
          apiKeySource: 'unknown' as const,
          claude_code_version: '2.1.85',
          mcp_servers: [],
          slash_commands: [],
          output_style: '',
          skills: [],
          plugins: [],
          uuid: 'uuid-1',
          agents: [],
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const opts: TurnOpts = {
        prompt: 'Hello',
        cwd: '/tmp/test',
        model: 'claude-sonnet-4-6',
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Edit'],
        claudeSessionId: 'forced-uuid',
      };

      const handle = driver.startTurn(opts);

      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(mockQuery).mock.calls[0][0];
      expect(callArgs.prompt).toBe('Hello');
      expect(callArgs.options?.cwd).toBe('/tmp/test');
      expect(callArgs.options?.model).toBe('claude-sonnet-4-6');
      expect(callArgs.options?.permissionMode).toBe('bypassPermissions');
      expect(callArgs.options?.allowedTools).toEqual(['Read', 'Edit']);

      // Consume the stream
      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('init');
    });

    it('calls query() with resume option for existing session', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'result' as const,
          subtype: 'success' as const,
          result: 'Done',
          total_cost_usd: 0.05,
          num_turns: 1,
          duration_ms: 5000,
          duration_api_ms: 4000,
          is_error: false,
          usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0 },
          modelUsage: {},
          permission_denials: [],
          uuid: 'uuid-2',
          session_id: 'existing-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({
        prompt: 'Continue',
        cwd: '/tmp/test',
        resumeSessionId: 'existing-session',
      });

      const callArgs = vi.mocked(mockQuery).mock.calls[0][0];
      expect(callArgs.options?.resume).toBe('existing-session');

      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('result_success');
      if (events[0].type === 'result_success') {
        expect(events[0].costUsd).toBe(0.05);
      }
    });

    it('maps assistant text messages to text events', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'assistant' as const,
          message: {
            content: [{ type: 'text' as const, text: 'Here is my analysis' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          parent_tool_use_id: null,
          uuid: 'uuid-3',
          session_id: 'test-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({ prompt: 'Test', cwd: '/tmp' });
      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      if (events[0].type === 'text') {
        expect(events[0].text).toBe('Here is my analysis');
      }
    });

    it('maps tool_use blocks to tool_use events', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'assistant' as const,
          message: {
            content: [
              { type: 'tool_use' as const, name: 'Read', id: 'tool-1', input: { file_path: '/tmp/x' } },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
          },
          parent_tool_use_id: null,
          uuid: 'uuid-4',
          session_id: 'test-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({ prompt: 'Test', cwd: '/tmp' });
      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_use');
      if (events[0].type === 'tool_use') {
        expect(events[0].toolName).toBe('Read');
      }
    });

    it('maps error results to result_error events', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'result' as const,
          subtype: 'error_during_execution' as const,
          errors: ['Something went wrong'],
          total_cost_usd: 0.01,
          num_turns: 1,
          duration_ms: 1000,
          duration_api_ms: 800,
          is_error: true,
          usage: { input_tokens: 50, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
          modelUsage: {},
          permission_denials: [],
          uuid: 'uuid-5',
          session_id: 'test-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({ prompt: 'Test', cwd: '/tmp' });
      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('result_error');
    });
  });

  describe('interrupt', () => {
    it('calls interrupt on the query handle', async () => {
      const interruptFn = vi.fn().mockResolvedValue(undefined);
      const mockMessages = (async function* () {
        // never yields — simulates long-running turn
        await new Promise(() => {}); // hang forever
      })();
      Object.assign(mockMessages, { interrupt: interruptFn });

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({ prompt: 'Test', cwd: '/tmp' });
      await handle.interrupt();

      expect(interruptFn).toHaveBeenCalledOnce();
    });
  });
});
