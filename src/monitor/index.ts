import { EventEmitter } from 'node:events';
import path from 'node:path';
import { JsonlWatcher } from './watcher.js';
import { parseLine } from './parser.js';
import { transition } from './state-machine.js';
import { RunDetector, type RunBoundary } from './run-detector.js';
import {
  extractParentSessionId,
  parseAgentFilename,
  readMetaFile,
  isSubagentPath,
} from './subagent-detector.js';
import { initDb, closeDb } from '../db/connection.js';
import * as queries from '../db/queries.js';
import type {
  MonitorConfig,
  MonitorStats,
  ParsedEvent,
  Session,
  SessionStatus,
} from '../shared/types.js';
import type { MonitorEvents, MonitorEventName } from '../shared/events.js';
import { DEFAULT_MONITOR_CONFIG, QUESTION_TOOL_NAMES } from '../shared/constants.js';

export class SessionMonitor extends EventEmitter {
  private config: MonitorConfig;
  private watcher: JsonlWatcher;
  private runDetectors = new Map<string, RunDetector>();
  private lastActivity = new Map<string, number>();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<MonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
    this.watcher = new JsonlWatcher(this.config.watchRoot);
  }

  override emit<K extends MonitorEventName>(event: K, data: MonitorEvents[K]): boolean {
    return super.emit(event, data);
  }

  override on<K extends MonitorEventName>(event: K, listener: (data: MonitorEvents[K]) => void): this {
    return super.on(event, listener as (...args: any[]) => void);
  }

  async start(): Promise<void> {
    initDb(this.config.dbPath);

    this.watcher.on('new_file', ({ filePath }) => this.handleNewFile(filePath));
    this.watcher.on('lines', ({ filePath, newLines }) => this.handleLines(filePath, newLines));
    this.watcher.on('error', ({ error, context }) => {
      this.emit('monitor:error', { error, context });
    });

    await this.watcher.start();

    // Periodic check for idle/ended sessions
    this.idleTimer = setInterval(() => this.checkIdleSessions(), this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    closeDb();
  }

  getStats(): MonitorStats {
    const sessions = queries.listSessions({});
    const statusCounts: Record<SessionStatus, number> = {
      starting: 0, active: 0, waiting: 0, idle: 0, ended: 0, error: 0,
    };

    let totalTokens = 0;
    for (const s of sessions) {
      if (s.status in statusCounts) {
        statusCounts[s.status as SessionStatus]++;
      }
      totalTokens += s.output_tokens;
    }

    return {
      filesWatched: this.watcher.getWatchedFiles().length,
      sessionsByStatus: statusCounts,
      totalTokensToday: totalTokens,
    };
  }

  private handleNewFile(filePath: string): void {
    if (isSubagentPath(filePath)) {
      this.handleNewSubagent(filePath);
    }
    // Main session files are handled when their first lines are read
  }

  private handleLines(filePath: string, newLines: string[]): void {
    for (const line of newLines) {
      const event = parseLine(line);
      if (!event) continue;

      if (isSubagentPath(filePath)) {
        this.handleSubagentEvent(filePath, event);
      } else {
        this.handleSessionEvent(filePath, event);
      }
    }
  }

  private handleSessionEvent(filePath: string, event: ParsedEvent): void {
    // Skip sidechain events in parent JSONL
    if (event.isSidechain) return;

    const claudeId = event.sessionId ?? this.claudeIdFromPath(filePath);
    if (!claudeId) return;

    // Ensure session exists
    let session = queries.getSessionByClaudeId(claudeId);
    const isNew = !session;

    if (isNew) {
      session = queries.upsertSession({
        claude_session_id: claudeId,
        jsonl_path: filePath,
        cwd: event.cwd ?? undefined,
        project_name: event.cwd ? path.basename(event.cwd) : undefined,
        model: event.model ?? undefined,
        git_branch: event.gitBranch ?? undefined,
        label: event.slug ?? undefined,
        last_entrypoint: event.entrypoint ?? undefined,
      });

      // Register project
      if (event.cwd) {
        queries.upsertProject(path.basename(event.cwd), event.cwd);
      }

      this.emit('session:discovered', { session });
    }

    // Update session fields from event
    this.updateSessionFromEvent(session!, event);

    // Track activity
    this.lastActivity.set(session!.id, Date.now());

    // Run detection
    if (!this.runDetectors.has(session!.id)) {
      this.runDetectors.set(session!.id, new RunDetector());
    }
    const detector = this.runDetectors.get(session!.id)!;
    const boundary = detector.checkBoundary(event);
    detector.markEventSeen();

    if (boundary) {
      this.handleRunBoundary(session!, boundary, filePath);
    }

    // State machine transition
    const previousStatus = session!.status as SessionStatus;
    const newStatus = transition(previousStatus, event);
    if (newStatus) {
      queries.updateSessionStatus(session!.id, newStatus);
      session = queries.getSession(session!.id)!;
      this.emit('session:status_changed', {
        session,
        from: previousStatus,
        to: newStatus,
      });
    }

    // Token accumulation
    if (event.tokens) {
      queries.updateSessionTokens(session!.id, event.tokens);
      const currentRun = queries.getCurrentRun(session!.id);
      if (currentRun) {
        queries.updateRunTokens(currentRun.id, event.tokens);
      }
    }

    // Question detection
    if (event.question && event.toolName && QUESTION_TOOL_NAMES.has(event.toolName)) {
      queries.updateSessionPendingQuestion(session!.id, event.question);

      // Ensure status is waiting (may not have transitioned if first event)
      const currentStatus = (queries.getSession(session!.id)!).status as SessionStatus;
      if (currentStatus !== 'waiting') {
        queries.updateSessionStatus(session!.id, 'waiting');
        session = queries.getSession(session!.id)!;
        this.emit('session:status_changed', { session, from: currentStatus, to: 'waiting' });
      }

      session = queries.getSession(session!.id)!;
      this.emit('session:question_detected', { session, question: event.question });
    }

    // Bridge status (Remote URL)
    if (event.type === 'system:bridge_status' && event.remoteUrl) {
      queries.updateSessionRemoteUrl(session!.id, event.remoteUrl);
    }

    // Emit activity
    session = queries.getSession(session!.id)!;
    this.emit('session:activity', { session, event });
  }

  private handleRunBoundary(session: Session, boundary: RunBoundary, jsonlPath: string): void {
    // End previous run if exists
    const previousRun = queries.getCurrentRun(session.id);
    if (previousRun && !previousRun.ended_at) {
      queries.endRun(previousRun.id);
      this.emit('run:ended', { session, run: { ...previousRun, ended_at: new Date().toISOString() } as any });
    }

    const run = queries.insertRun({
      session_id: session.id,
      jsonl_path: jsonlPath,
      start_type: boundary.startType,
      remote_url: boundary.remoteUrl ?? undefined,
    });

    // Update entrypoint on session
    if (boundary.entrypoint) {
      queries.upsertSession({
        claude_session_id: session.claude_session_id,
        jsonl_path: jsonlPath,
        last_entrypoint: boundary.entrypoint,
      });
    }

    // Handle managed/unmanaged handoff
    if (boundary.isHandoff) {
      const newType = boundary.entrypoint === 'cli' ? 'unmanaged' : 'managed';
      queries.updateSessionType(session.id, newType);

      queries.insertEvent({
        session_id: session.id,
        event_type: 'type_change',
        from_status: boundary.previousEntrypoint === 'cli' ? 'unmanaged' : 'managed',
        to_status: newType,
        actor: 'monitor',
        detail: { entrypoint: boundary.entrypoint, previousEntrypoint: boundary.previousEntrypoint },
      });
    }

    const updatedSession = queries.getSession(session.id)!;
    this.emit('run:started', { session: updatedSession, run });
  }

  private handleNewSubagent(filePath: string): void {
    try {
      const parentId = extractParentSessionId(filePath);
      const filename = path.basename(filePath);
      const { agentId, pattern } = parseAgentFilename(filename);
      const meta = readMetaFile(filePath);

      const parentSession = queries.getSessionByClaudeId(parentId);
      if (!parentSession) return;

      queries.upsertSubAgent({
        id: agentId,
        session_id: parentSession.id,
        pattern,
        jsonl_path: filePath,
        agent_type: meta?.agentType,
        description: meta?.description,
      });

      const subagents = queries.getSubAgents(parentSession.id);
      const subagent = subagents.find((sa) => sa.id === agentId);
      if (subagent) {
        this.emit('subagent:detected', { session: parentSession, subagent });
      }
    } catch (error) {
      this.emit('monitor:error', { error: error as Error, context: `subagent ${filePath}` });
    }
  }

  private handleSubagentEvent(filePath: string, event: ParsedEvent): void {
    // Accumulate sub-agent tokens
    if (event.tokens && event.agentId) {
      try {
        queries.updateSubAgentTokens(event.agentId, event.tokens);

        // Also roll up to parent session
        const parentId = extractParentSessionId(filePath);
        const parentSession = queries.getSessionByClaudeId(parentId);
        if (parentSession) {
          queries.updateSessionTokens(parentSession.id, event.tokens);
        }
      } catch {
        // Non-fatal: sub-agent may not be registered yet
      }
    }
  }

  private updateSessionFromEvent(session: Session, event: ParsedEvent): void {
    const updates: Record<string, unknown> = {};
    if (event.slug && !session.label) updates.label = event.slug;
    if (event.model && event.model !== session.model) updates.model = event.model;
    if (event.cwd && !session.cwd) updates.cwd = event.cwd;
    if (event.gitBranch && event.gitBranch !== session.git_branch) updates.git_branch = event.gitBranch;
    if (event.entrypoint) updates.last_entrypoint = event.entrypoint;

    if (Object.keys(updates).length > 0) {
      queries.upsertSession({
        claude_session_id: session.claude_session_id,
        jsonl_path: session.jsonl_path,
        ...updates as any,
      });
    }
  }

  private checkIdleSessions(): void {
    const now = Date.now();
    const sessions = queries.listSessions({ active: true });

    for (const session of sessions) {
      const lastSeen = this.lastActivity.get(session.id);
      if (!lastSeen) continue;

      const idleMs = now - lastSeen;

      if (session.status === 'active' && idleMs >= this.config.idleThresholdMs) {
        queries.updateSessionStatus(session.id, 'idle');
        const updated = queries.getSession(session.id)!;
        this.emit('session:status_changed', { session: updated, from: 'active', to: 'idle' });
      }

      if (session.status === 'idle' && idleMs >= this.config.endedThresholdMs) {
        queries.updateSessionStatus(session.id, 'ended');
        const updated = queries.getSession(session.id)!;
        this.emit('session:status_changed', { session: updated, from: 'idle', to: 'ended' });
      }
    }
  }

  private claudeIdFromPath(filePath: string): string | null {
    const basename = path.basename(filePath, '.jsonl');
    // UUID pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(basename)) {
      return basename;
    }
    return null;
  }
}
