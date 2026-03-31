export type SessionStatus = 'starting' | 'active' | 'waiting' | 'idle' | 'ended' | 'error';
export type SessionType = 'managed' | 'unmanaged';

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
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  pending_question: string | null;
  last_output: string | null;
  error_message: string | null;
  can_resume: boolean;
  parent_session_id: string | null;
  sub_agent_count: number;
  notifications_enabled?: boolean;
  notifications_target_override?: string | null;
  activity_state?: 'processing' | 'subagents' | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface Run {
  id: number;
  session_id: string;
  run_number: number;
  start_type: string;
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

export interface SubAgent {
  id: string;
  session_id: string;
  pattern: string;
  agent_type: string | null;
  description: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  started_at: string | null;
  ended_at: string | null;
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

export interface HierarchyBlock {
  sub_agents: SubAgent[];
  sub_agent_count: number;
  total_sub_agent_tokens: { input: number; output: number; cache_read: number; cache_create: number };
}

export interface SessionDetailResponse {
  session: Session;
  runs: Run[];
  events: SessionEvent[];
  transcript: TranscriptEntry[];
  notifications: Notification[];
  available_actions: string[];
  hierarchy: HierarchyBlock;
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
