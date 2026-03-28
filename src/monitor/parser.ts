import type { ParsedEvent, ParsedEventType, TokenDelta } from '../shared/types.js';
import { QUESTION_TOOL_NAMES } from '../shared/constants.js';

export function parseLine(line: string): ParsedEvent | null {
  if (!line.trim()) return null;

  let raw: any;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  if (!raw.type) return null;

  const rawType: string = raw.type;

  // Progress events — skip noise, keep SessionStart hooks and agent_progress
  if (rawType === 'progress' && raw.data) {
    const subtype: string = raw.data.type;

    if (subtype === 'hook_progress') {
      // Keep only SessionStart hooks (for run detection)
      if (raw.data.hookEvent !== 'SessionStart') return null;

      return makeEvent('progress:hook', raw, {
        hookName: raw.data.hookName ?? null,
      });
    }

    if (subtype === 'agent_progress') {
      return makeEvent('progress:agent', raw, {
        agentId: raw.data.agentId ?? null,
      });
    }

    // Skip other progress subtypes (query_update, search_results_received, waiting_for_task)
    return null;
  }

  // System events — dispatch by subtype
  if (rawType === 'system') {
    const subtype: string = raw.subtype;

    if (subtype === 'bridge_status') {
      return makeEvent('system:bridge_status', raw, {
        remoteUrl: raw.url ?? null,
      });
    }

    if (subtype === 'api_error') {
      const errorMsg = raw.error?.error?.error?.message
        ?? raw.error?.error?.message
        ?? raw.error?.message
        ?? 'Unknown API error';
      return makeEvent('system:api_error', raw, {
        errorMessage: errorMsg,
      });
    }

    if (subtype === 'turn_duration') {
      return makeEvent('system:turn_duration', raw, {
        turnDurationMs: raw.durationMs ?? null,
        messageCount: raw.messageCount ?? null,
      });
    }

    if (subtype === 'stop_hook_summary') {
      return makeEvent('system:stop_hook_summary', raw, {});
    }

    if (subtype === 'compact_boundary') {
      return makeEvent('system:compact_boundary', raw, {});
    }

    return null;
  }

  // Assistant events
  if (rawType === 'assistant') {
    const msg = raw.message;
    if (!msg) return null;

    // Error response
    if (msg.isApiErrorMessage) {
      const errorText = extractTextFromContent(msg.content);
      return makeEvent('assistant:error', raw, {
        errorMessage: errorText || 'API error',
        tokens: extractTokens(msg.usage),
        model: msg.model ?? null,
        stopReason: msg.stop_reason ?? null,
      });
    }

    // Tool use detection
    const toolUse = findToolUse(msg.content);
    if (toolUse) {
      const question = extractQuestion(toolUse);
      return makeEvent('assistant:tool_use', raw, {
        toolName: toolUse.name,
        toolInput: toolUse.input ?? null,
        question,
        tokens: extractTokens(msg.usage),
        model: msg.model ?? null,
        stopReason: msg.stop_reason ?? null,
      });
    }

    // Plain text response
    return makeEvent('assistant:text', raw, {
      tokens: extractTokens(msg.usage),
      model: msg.model ?? null,
      stopReason: msg.stop_reason ?? null,
    });
  }

  // User events
  if (rawType === 'user') {
    const isToolResult = !!raw.toolUseResult || !!raw.sourceToolUseID;
    return makeEvent(isToolResult ? 'user:tool_result' : 'user:prompt', raw, {});
  }

  // last-prompt
  if (rawType === 'last-prompt') {
    return makeEvent('last_prompt', raw, {
      lastPrompt: raw.lastPrompt ?? null,
    });
  }

  // pr-link
  if (rawType === 'pr-link') {
    return makeEvent('pr_link', raw, {
      prUrl: raw.prUrl ?? null,
    });
  }

  // custom-title
  if (rawType === 'custom-title') {
    return makeEvent('custom_title', raw, {
      customTitle: raw.customTitle ?? null,
    });
  }

  // agent-name
  if (rawType === 'agent-name') {
    return makeEvent('agent_name', raw, {
      agentName: raw.agentName ?? null,
    });
  }

  // Skip everything else (file-history-snapshot, queue-operation)
  return null;
}

function makeEvent(type: ParsedEventType, raw: any, extra: Partial<ParsedEvent>): ParsedEvent {
  return {
    type,
    raw_type: raw.type,
    timestamp: raw.timestamp ?? null,
    sessionId: raw.sessionId ?? null,
    entrypoint: raw.entrypoint ?? null,
    cwd: raw.cwd ?? null,
    gitBranch: raw.gitBranch ?? null,
    slug: raw.slug ?? null,
    isSidechain: raw.isSidechain ?? false,
    tokens: null,
    model: null,
    toolName: null,
    toolInput: null,
    question: null,
    errorMessage: null,
    remoteUrl: null,
    lastPrompt: null,
    hookName: null,
    agentId: raw.agentId ?? null,
    turnDurationMs: null,
    messageCount: null,
    stopReason: null,
    prUrl: null,
    customTitle: null,
    agentName: null,
    raw,
    ...extra,
  };
}

function extractTokens(usage: any): TokenDelta | null {
  if (!usage) return null;
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_create_tokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function findToolUse(content: any[]): any | null {
  if (!Array.isArray(content)) return null;
  return content.find((block: any) => block.type === 'tool_use') ?? null;
}

function extractQuestion(toolUse: any): string | null {
  if (!QUESTION_TOOL_NAMES.has(toolUse.name)) return null;

  const input = toolUse.input;
  if (!input) return null;

  return input.question
    ?? input.questions?.[0]?.question
    ?? input.text
    ?? null;
}

function extractTextFromContent(content: any[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');
}
