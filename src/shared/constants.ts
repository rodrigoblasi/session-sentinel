import type { SessionStatus, RunStartType } from './types.js';

export const DEFAULT_MONITOR_CONFIG = {
  watchRoot: `${process.env.HOME}/.claude/projects`,
  dbPath: './sentinel.db',
  idleThresholdMs: 60_000,
  endedThresholdMs: 300_000,
  pollIntervalMs: 5_000,
} as const;

export const SESSION_STATUSES: readonly SessionStatus[] = [
  'starting', 'active', 'waiting', 'idle', 'ended', 'error',
] as const;

// JSONL event types to skip during parsing (high volume, low value)
export const SKIP_EVENT_SUBTYPES = new Set([
  'hook_progress',
]);

// Tool names that trigger waiting status
export const QUESTION_TOOL_NAMES = new Set([
  'AskUserQuestion',
  'AskFollowupQuestions',
]);

// Hook names that indicate run start type
export const RUN_START_HOOKS: Record<string, RunStartType> = {
  'SessionStart:startup': 'startup',
  'SessionStart:resume': 'resume',
  'SessionStart:compact': 'compact',
};
