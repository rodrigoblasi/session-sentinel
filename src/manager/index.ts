import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as queries from '../db/queries.js';
import { DEFAULT_MANAGER_CONFIG } from '../shared/constants.js';
import type {
  SessionDriver,
  TurnHandle,
  StreamEvent,
  CreateSessionInput,
  ResumeSessionInput,
  SendMessageInput,
  ManagerConfig,
  Session,
  TerminateOptions,
} from '../shared/types.js';
import type { ManagerEvents, ManagerEventName } from '../shared/events.js';

export class SessionManager extends EventEmitter {
  private driver: SessionDriver;
  private activeTurns = new Map<string, TurnHandle>();
  private config: ManagerConfig;

  constructor(config: Partial<ManagerConfig> & { driver: SessionDriver }) {
    super();
    this.driver = config.driver;
    this.config = {
      driver: config.driver,
      notifyScript: config.notifyScript,
      defaultModel: config.defaultModel ?? DEFAULT_MANAGER_CONFIG.defaultModel,
      defaultEffort: config.defaultEffort ?? DEFAULT_MANAGER_CONFIG.defaultEffort,
      defaultPermissionMode: config.defaultPermissionMode ?? DEFAULT_MANAGER_CONFIG.defaultPermissionMode,
      defaultAllowedTools: config.defaultAllowedTools ?? [...DEFAULT_MANAGER_CONFIG.defaultAllowedTools],
    };
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const cwd = this.resolveCwd(input);
    const claudeSessionId = randomUUID();
    const projectName = input.project ?? cwd.split('/').pop() ?? 'unknown';

    // Insert session BEFORE starting the turn — Monitor will find it via claude_session_id
    const session = queries.upsertSession({
      claude_session_id: claudeSessionId,
      jsonl_path: '', // filled by Monitor when JSONL appears
      status: 'starting',
      type: 'managed',
      label: input.label,
      cwd,
      project_name: projectName,
      model: input.model ?? this.config.defaultModel,
      effort: input.effort ?? this.config.defaultEffort,
    });

    queries.updateSessionOwner(session.id, input.owner);
    queries.insertEvent({
      session_id: session.id,
      event_type: 'session_created',
      to_status: 'starting',
      actor: input.owner,
      detail: { prompt: input.prompt, project: projectName },
    });

    this.emit('manager:session_created', { session: queries.getSession(session.id)! });

    // Start the turn
    this.startBackgroundTurn(session.id, {
      prompt: input.prompt,
      cwd,
      model: input.model ?? this.config.defaultModel,
      effort: input.effort ?? this.config.defaultEffort,
      permissionMode: this.config.defaultPermissionMode,
      allowedTools: input.allowedTools ?? this.config.defaultAllowedTools,
      systemPrompt: input.systemPrompt,
      maxBudgetUsd: input.maxBudgetUsd,
      claudeSessionId,
    });

    return queries.getSession(session.id)!;
  }

  async sendMessage(sessionId: string, input: SendMessageInput): Promise<void> {
    const session = queries.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.type !== 'managed') throw new Error(`Session ${sessionId} is not managed`);

    const resumableStatuses = ['waiting', 'active', 'idle', 'ended'];
    if (!resumableStatuses.includes(session.status)) {
      throw new Error(`Session ${sessionId} is in status ${session.status}, cannot send message`);
    }

    queries.insertEvent({
      session_id: sessionId,
      event_type: 'message_sent',
      actor: session.owner ?? 'api',
      detail: { message: input.message.substring(0, 200) },
    });

    this.startBackgroundTurn(sessionId, {
      prompt: input.message,
      cwd: session.cwd ?? process.cwd(),
      model: session.model ?? this.config.defaultModel,
      resumeSessionId: session.claude_session_id,
    });
  }

  async resumeSession(sessionId: string, input: ResumeSessionInput): Promise<Session> {
    const session = queries.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const resumableStatuses = ['ended', 'error', 'idle'];
    if (!resumableStatuses.includes(session.status)) {
      throw new Error(`Cannot resume session ${sessionId} in status ${session.status}`);
    }

    // Update ownership
    queries.updateSessionOwner(sessionId, input.owner);
    queries.insertEvent({
      session_id: sessionId,
      event_type: 'session_resumed',
      from_status: session.status,
      to_status: 'starting',
      actor: input.owner,
      detail: { previous_owner: session.owner },
    });

    this.startBackgroundTurn(sessionId, {
      prompt: input.prompt,
      cwd: session.cwd ?? process.cwd(),
      model: input.model ?? session.model ?? this.config.defaultModel,
      effort: input.effort ?? session.effort ?? this.config.defaultEffort,
      permissionMode: this.config.defaultPermissionMode,
      allowedTools: this.config.defaultAllowedTools,
      resumeSessionId: session.claude_session_id,
    });

    return queries.getSession(sessionId)!;
  }

  async terminateSession(sessionId: string, opts?: TerminateOptions): Promise<void> {
    const session = queries.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const activeTurn = this.activeTurns.get(sessionId);
    if (activeTurn) {
      await activeTurn.interrupt();
      this.activeTurns.delete(sessionId);
    }

    queries.updateSessionStatus(sessionId, 'ended');
    queries.insertEvent({
      session_id: sessionId,
      event_type: opts?.eventType ?? 'session_terminated',
      from_status: session.status,
      to_status: 'ended',
      actor: opts?.actor ?? 'api',
      detail: opts?.detail,
    });

    this.emit('manager:session_terminated', { sessionId });
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.activeTurns.has(sessionId);
  }

  async stop(): Promise<void> {
    // Interrupt all active turns
    const interrupts = Array.from(this.activeTurns.entries()).map(
      async ([id, turn]) => {
        try { await turn.interrupt(); } catch {}
        this.activeTurns.delete(id);
      }
    );
    await Promise.allSettled(interrupts);
  }

  // --- Private ---

  private resolveCwd(input: CreateSessionInput): string {
    if (input.cwd) return input.cwd;
    if (input.project) {
      const project = queries.getProjectByName(input.project);
      if (!project) throw new Error(`Project not found: ${input.project}`);
      return project.cwd;
    }
    throw new Error('Either project or cwd must be provided');
  }

  private startBackgroundTurn(sessionId: string, opts: import('../shared/types.js').TurnOpts): void {
    const handle = this.driver.startTurn(opts);
    this.activeTurns.set(sessionId, handle);

    this.emit('manager:turn_started', { sessionId, prompt: opts.prompt });

    this.consumeStream(sessionId, handle).catch((err) => {
      this.emit('manager:error', { error: err, sessionId });
    });
  }

  private async consumeStream(sessionId: string, handle: TurnHandle): Promise<void> {
    try {
      for await (const event of handle.events) {
        // Minimal processing — Monitor handles JSONL data extraction.
        // We only track turn completion for cleanup and event emission.
        if (event.type === 'result_success') {
          this.emit('manager:turn_completed', { sessionId, success: true });
        } else if (event.type === 'result_error') {
          this.emit('manager:turn_completed', { sessionId, success: false });
        }
      }
    } finally {
      this.activeTurns.delete(sessionId);
    }
  }

  // Typed event emitter overrides
  emit<K extends ManagerEventName>(event: K, payload: ManagerEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends ManagerEventName>(event: K, listener: (payload: ManagerEvents[K]) => void): this {
    return super.on(event, listener);
  }
}
