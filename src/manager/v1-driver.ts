import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SessionDriver, TurnOpts, TurnHandle, StreamEvent } from '../shared/types.js';

export class V1Driver implements SessionDriver {
  startTurn(opts: TurnOpts): TurnHandle {
    const options: Record<string, unknown> = {
      cwd: opts.cwd,
      allowDangerouslySkipPermissions: true,
    };

    if (opts.model) options.model = opts.model;
    if (opts.effort) options.effort = opts.effort;
    if (opts.permissionMode) options.permissionMode = opts.permissionMode;
    if (opts.allowedTools) options.allowedTools = opts.allowedTools;
    if (opts.disallowedTools) options.disallowedTools = opts.disallowedTools;
    if (opts.systemPrompt) options.systemPrompt = opts.systemPrompt;
    if (opts.maxBudgetUsd) options.maxBudgetUsd = opts.maxBudgetUsd;
    if (opts.maxTurns) options.maxTurns = opts.maxTurns;

    if (opts.resumeSessionId) {
      options.resume = opts.resumeSessionId;
    } else if (opts.claudeSessionId) {
      // Try sessionId option first; fall back to extraArgs for older SDK versions
      options.sessionId = opts.claudeSessionId;
      options.extraArgs = { 'session-id': opts.claudeSessionId };
    }

    const q = query({ prompt: opts.prompt, options: options as any });

    return {
      events: mapSdkStream(q),
      interrupt: () => q.interrupt(),
    };
  }
}

async function* mapSdkStream(
  source: AsyncGenerator<SDKMessage, void>,
): AsyncGenerator<StreamEvent, void> {
  for await (const msg of source) {
    const events = mapMessage(msg);
    for (const event of events) {
      yield event;
    }
  }
}

function mapMessage(msg: SDKMessage): StreamEvent[] {
  const sessionId = 'session_id' in msg ? (msg.session_id ?? '') : '';

  switch (msg.type) {
    case 'system': {
      if ('subtype' in msg && msg.subtype === 'init') {
        const init = msg as any;
        return [{
          type: 'init',
          sessionId: init.session_id ?? '',
          model: init.model ?? '',
          cwd: init.cwd ?? '',
          tools: init.tools ?? [],
          permissionMode: init.permissionMode ?? 'default',
        }];
      }
      if ('subtype' in msg && msg.subtype === 'status') {
        return [{
          type: 'status',
          status: (msg as any).status ?? '',
          sessionId,
        }];
      }
      return [];
    }

    case 'assistant': {
      const events: StreamEvent[] = [];
      const content = (msg as any).message?.content ?? [];
      for (const block of content) {
        if (block.type === 'text') {
          events.push({ type: 'text', text: block.text, sessionId });
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool_use',
            toolName: block.name,
            toolInput: block.input,
            sessionId,
          });
        }
      }
      return events;
    }

    case 'tool_progress': {
      return [{
        type: 'tool_progress',
        toolName: (msg as any).tool_name ?? '',
        elapsedSeconds: (msg as any).elapsed_time_seconds ?? 0,
        sessionId,
      }];
    }

    case 'result': {
      if ((msg as any).subtype === 'success') {
        return [{
          type: 'result_success',
          result: (msg as any).result ?? '',
          costUsd: (msg as any).total_cost_usd ?? 0,
          numTurns: (msg as any).num_turns ?? 0,
          durationMs: (msg as any).duration_ms ?? 0,
          sessionId,
        }];
      }
      return [{
        type: 'result_error',
        errors: (msg as any).errors ?? [],
        costUsd: (msg as any).total_cost_usd ?? 0,
        sessionId,
      }];
    }

    default:
      return [];
  }
}
