import type { SessionStatus, ParsedEvent } from '../shared/types.js';
import { QUESTION_TOOL_NAMES } from '../shared/constants.js';

/**
 * Pure function: given the current session status and a new parsed event,
 * returns the new status or null if no transition applies.
 */
export function transition(
  currentStatus: SessionStatus,
  event: ParsedEvent,
): SessionStatus | null {
  // Error events transition from any non-ended state
  if (event.type === 'system:api_error' || event.type === 'assistant:error') {
    if (currentStatus !== 'ended') return 'error';
    return null;
  }

  switch (currentStatus) {
    case 'starting':
      // starting → active when assistant produces output
      if (event.type === 'assistant:text' || event.type === 'assistant:tool_use') {
        return 'active';
      }
      return null;

    case 'active':
      // active → waiting when a question tool is used
      if (
        event.type === 'assistant:tool_use' &&
        event.toolName &&
        QUESTION_TOOL_NAMES.has(event.toolName)
      ) {
        return 'waiting';
      }
      return null;

    case 'waiting':
      // waiting → active when user responds (real prompt, not tool result)
      if (event.type === 'user:prompt') {
        return 'active';
      }
      return null;

    case 'idle':
      // idle → active on any meaningful activity
      if (
        event.type === 'assistant:text' ||
        event.type === 'assistant:tool_use' ||
        event.type === 'user:prompt'
      ) {
        return 'active';
      }
      return null;

    case 'error':
      // error → active on successful assistant response
      if (event.type === 'assistant:text' || event.type === 'assistant:tool_use') {
        return 'active';
      }
      return null;

    case 'ended':
      // ended → starting on resume (detected by SessionStart hook)
      if (event.type === 'progress:hook') {
        return 'starting';
      }
      // ended → starting on bridge_status (resume without hooks configured)
      if (event.type === 'system:bridge_status') {
        return 'starting';
      }
      return null;

    default:
      return null;
  }
}
