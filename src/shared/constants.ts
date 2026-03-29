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

// --- Sprint 2 constants ---

export const DEFAULT_MANAGER_CONFIG = {
  defaultModel: 'claude-sonnet-4-6',
  defaultEffort: 'high',
  defaultPermissionMode: 'bypassPermissions',
  defaultAllowedTools: [
    'Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write',
    'Agent', 'NotebookEdit', 'WebFetch', 'WebSearch',
  ],
} as const;

export const API_PORT = 3100;
export const API_HOST = '0.0.0.0';

export const NOTIFICATION_CHANNELS = {
  OWNER_THREAD: 'discord_owner',
  SENTINEL_LOG: 'discord_sentinel_log',
} as const;

export const NOTIFICATION_TRIGGERS = new Set(['waiting', 'error']);

// --- Sprint 3: Housekeeping constants ---

export const HOUSEKEEP_INTERVAL_MS = 60_000;       // sweep every 60s
export const HOUSEKEEP_IDLE_THRESHOLD_MS = 15 * 60_000; // 15 min idle = auto-kill
