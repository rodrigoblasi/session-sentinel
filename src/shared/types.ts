// --- Session types ---

export type SessionStatus = 'starting' | 'active' | 'waiting' | 'idle' | 'ended' | 'error';
export type SessionType = 'managed' | 'unmanaged';
export type RunStartType = 'startup' | 'resume' | 'compact';
export type SubAgentPattern = 'regular' | 'compact' | 'side_question';

export interface Session {
  id: string;
  claude_session_id: string;
  label: string | null;
  status: SessionStatus;
  type: SessionType;
  owner: string | null;
  cwd: string | null;
  project_name: string | null;
  model: string | null;
  effort: string | null;
  git_branch: string | null;
  git_remote: string | null;
  jsonl_path: string;
  pid: number | null;
  remote_url: string | null;
  last_entrypoint: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  pending_question: string | null;
  last_output: string | null;
  error_message: string | null;
  can_resume: boolean;
  parent_session_id: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface SessionUpsert {
  claude_session_id: string;
  jsonl_path: string;
  status?: SessionStatus;
  type?: SessionType;
  label?: string;
  cwd?: string;
  project_name?: string;
  model?: string;
  effort?: string;
  git_branch?: string;
  git_remote?: string;
  last_entrypoint?: string;
}

export interface SessionFilters {
  status?: SessionStatus;
  type?: SessionType;
  owner?: string;
  project_name?: string;
  active?: boolean;
  limit?: number;
}

export interface Run {
  id: number;
  session_id: string;
  run_number: number;
  jsonl_path: string;
  start_type: RunStartType;
  type_during_run: SessionType;
  owner_during_run: string | null;
  model: string | null;
  effort: string | null;
  remote_url: string | null;
  sentinel_managed: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  started_at: string;
  ended_at: string | null;
}

export interface RunInsert {
  session_id: string;
  jsonl_path: string;
  start_type: RunStartType;
  type_during_run?: SessionType;
  owner_during_run?: string;
  model?: string;
  effort?: string;
  remote_url?: string;
  sentinel_managed?: boolean;
}

export interface SubAgent {
  id: string;
  session_id: string;
  pattern: SubAgentPattern;
  agent_type: string | null;
  description: string | null;
  jsonl_path: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  started_at: string | null;
  ended_at: string | null;
}

export interface SubAgentUpsert {
  id: string;
  session_id: string;
  pattern: SubAgentPattern;
  jsonl_path: string;
  agent_type?: string;
  description?: string;
}

export interface SessionEvent {
  id: number;
  session_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor: string;
  detail: string | null;
  created_at: string;
}

export interface EventInsert {
  session_id: string;
  event_type: string;
  from_status?: string;
  to_status?: string;
  actor?: string;
  detail?: object;
}

export interface EventFilters {
  session_id?: string;
  event_type?: string;
  limit?: number;
}

export interface TranscriptEntry {
  id: number;
  session_id: string;
  run_id: number | null;
  turn: number;
  role: string;
  content: string;
  tools_used: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  created_at: string;
}

export interface TranscriptInsert {
  session_id: string;
  run_id?: number;
  turn: number;
  role: string;
  content: string;
  tools_used?: string[];
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_create_tokens?: number;
}

export interface TokenDelta {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_create_tokens?: number;
}

// --- JSONL parsed event types ---

export type ParsedEventType =
  | 'assistant:text'
  | 'assistant:tool_use'
  | 'assistant:error'
  | 'user:prompt'
  | 'user:tool_result'
  | 'system:bridge_status'
  | 'system:api_error'
  | 'system:turn_duration'
  | 'system:stop_hook_summary'
  | 'system:compact_boundary'
  | 'progress:hook'
  | 'progress:agent'
  | 'last_prompt'
  | 'pr_link'
  | 'custom_title'
  | 'agent_name'
  | 'other';

export interface ParsedEvent {
  type: ParsedEventType;
  raw_type: string;
  timestamp: string | null;
  sessionId: string | null;
  entrypoint: string | null;
  cwd: string | null;
  gitBranch: string | null;
  slug: string | null;
  isSidechain: boolean;
  tokens: TokenDelta | null;
  model: string | null;
  toolName: string | null;
  toolInput: unknown | null;
  question: string | null;
  errorMessage: string | null;
  remoteUrl: string | null;
  lastPrompt: string | null;
  hookName: string | null;
  agentId: string | null;
  turnDurationMs: number | null;
  messageCount: number | null;
  stopReason: string | null;
  prUrl: string | null;
  customTitle: string | null;
  agentName: string | null;
  raw: unknown;
}

// --- Monitor types ---

export interface MonitorConfig {
  watchRoot: string;
  dbPath: string;
  idleThresholdMs: number;
  endedThresholdMs: number;
  pollIntervalMs: number;
}

export interface MonitorStats {
  filesWatched: number;
  sessionsByStatus: Record<SessionStatus, number>;
  totalTokensToday: number;
}

// --- Session Driver types (Sprint 2, ADR-0001) ---

export interface TurnOpts {
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  maxBudgetUsd?: number;
  maxTurns?: number;
  claudeSessionId?: string;
  resumeSessionId?: string;
}

export type StreamEvent =
  | { type: 'init'; sessionId: string; model: string; cwd: string; tools: string[]; permissionMode: string }
  | { type: 'text'; text: string; sessionId: string }
  | { type: 'tool_use'; toolName: string; toolInput: unknown; sessionId: string }
  | { type: 'tool_progress'; toolName: string; elapsedSeconds: number; sessionId: string }
  | { type: 'result_success'; result: string; costUsd: number; numTurns: number; durationMs: number; sessionId: string }
  | { type: 'result_error'; errors: string[]; costUsd: number; sessionId: string }
  | { type: 'status'; status: string; sessionId: string };

export interface TurnHandle {
  readonly events: AsyncGenerator<StreamEvent, void>;
  interrupt(): Promise<void>;
}

export interface SessionDriver {
  startTurn(opts: TurnOpts): TurnHandle;
}

// --- Session Manager types (Sprint 2) ---

export interface CreateSessionInput {
  prompt: string;
  project?: string;
  cwd?: string;
  owner: string;
  label?: string;
  model?: string;
  effort?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  maxBudgetUsd?: number;
}

export interface ResumeSessionInput {
  prompt: string;
  owner: string;
  model?: string;
  effort?: string;
}

export interface SendMessageInput {
  message: string;
}

export interface ManagerConfig {
  driver: SessionDriver;
  notifyScript?: string;
  defaultModel?: string;
  defaultEffort?: string;
  defaultPermissionMode?: string;
  defaultAllowedTools?: string[];
}

// --- Notification types (Sprint 2) ---

export interface NotificationPayload {
  sessionId: string;
  label: string | null;
  status: string;
  project: string | null;
  gitBranch: string | null;
  pendingQuestion: string | null;
  errorMessage: string | null;
  waitingSince: string | null;
  apiUrl: string;
}

export interface NotificationInsert {
  session_id: string;
  channel: string;
  destination: string;
  trigger: string;
  payload: NotificationPayload;
  delivered: boolean;
}

export interface NotificationFilters {
  session_id?: string;
  channel?: string;
  delivered?: boolean;
  limit?: number;
}

export interface Notification {
  id: number;
  session_id: string;
  channel: string;
  destination: string;
  trigger: string;
  payload: string;
  delivered: boolean;
  created_at: string;
}

// --- API types (Sprint 2) ---

export interface SessionDetailResponse {
  session: Session;
  runs: Run[];
  events: SessionEvent[];
  transcript: TranscriptEntry[];
  available_actions: string[];
}

export interface ReportSummary {
  total_sessions: number;
  active: number;
  waiting: number;
  idle: number;
  ended_today: number;
  errors_today: number;
  total_tokens_today: number;
}

export interface ReportResponse {
  summary: ReportSummary;
  needs_attention: Session[];
  active_sessions: Session[];
  recent_events: SessionEvent[];
  by_project: Record<string, { active: number; waiting: number; ended_today: number }>;
}

// --- WebSocket types (Sprint 2) ---

export type WsOutgoingMessage =
  | { type: 'session_update'; session: Session }
  | { type: 'status_change'; sessionId: string; from: string; to: string }
  | { type: 'event'; event: SessionEvent }
  | { type: 'notification'; sessionId: string; trigger: string; destination: string };

// --- Sprint 3: Housekeeping types ---

export interface TerminateOptions {
  actor?: string;
  eventType?: string;
  detail?: object;
}

export interface HousekeepConfig {
  intervalMs?: number;
  idleThresholdMs?: number;
}
