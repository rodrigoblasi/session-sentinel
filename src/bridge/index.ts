import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import * as queries from '../db/queries.js';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TRIGGERS } from '../shared/constants.js';
import type { Session, NotificationPayload } from '../shared/types.js';
import type { BridgeEvents, BridgeEventName } from '../shared/events.js';

export interface BridgeConfig {
  monitor: EventEmitter;
  notifyScript: string;
  apiBaseUrl: string;
}

export class AgentBridge extends EventEmitter {
  private config: BridgeConfig;

  constructor(config: BridgeConfig) {
    super();
    this.config = config;
    this.setupListeners();
  }

  stop(): void {
    this.config.monitor.removeAllListeners('session:status_changed');
  }

  private setupListeners(): void {
    this.config.monitor.on('session:status_changed', (data: { session: Session; from: string; to: string }) => {
      this.handleStatusChange(data.session, data.from, data.to);
    });
  }

  private handleStatusChange(session: Session, _from: string, to: string): void {
    if (session.type !== 'managed') return;
    if (!NOTIFICATION_TRIGGERS.has(to)) return;
    if (!session.owner) return;

    const payload = this.buildPayload(session, to);

    // Dual delivery: owner thread + sentinel-log
    this.deliver(session, NOTIFICATION_CHANNELS.OWNER_THREAD, `#${session.owner}`, to, payload);
    this.deliver(session, NOTIFICATION_CHANNELS.SENTINEL_LOG, '#sentinel-log', to, payload);
  }

  private buildPayload(session: Session, trigger: string): NotificationPayload {
    return {
      sessionId: session.id,
      label: session.label,
      status: trigger,
      project: session.project_name,
      gitBranch: session.git_branch,
      pendingQuestion: session.pending_question,
      errorMessage: session.error_message,
      waitingSince: trigger === 'waiting' ? new Date().toISOString() : null,
      apiUrl: `${this.config.apiBaseUrl}/sessions/${session.id}`,
    };
  }

  private deliver(
    session: Session,
    channel: string,
    destination: string,
    trigger: string,
    payload: NotificationPayload,
  ): void {
    const message = this.formatMessage(payload, trigger);

    execFile(this.config.notifyScript, [destination, message], (err) => {
      const delivered = !err;

      queries.insertNotification({
        session_id: session.id,
        channel,
        destination,
        trigger,
        payload,
        delivered,
      });

      if (delivered) {
        this.emit('bridge:notification_sent', {
          sessionId: session.id,
          destination,
          trigger,
        });
      } else {
        this.emit('bridge:notification_failed', {
          sessionId: session.id,
          destination,
          error: err!,
        });
      }
    });
  }

  private formatMessage(payload: NotificationPayload, trigger: string): string {
    const parts = [
      `[Session Sentinel] Session ${payload.sessionId}`,
      payload.label ? `(${payload.label})` : '',
      `is now **${trigger}**`,
    ];

    if (payload.project) parts.push(`| Project: ${payload.project}`);
    if (payload.gitBranch) parts.push(`| Branch: ${payload.gitBranch}`);

    if (trigger === 'waiting' && payload.pendingQuestion) {
      parts.push(`\nQuestion: ${payload.pendingQuestion}`);
    }
    if (trigger === 'error' && payload.errorMessage) {
      parts.push(`\nError: ${payload.errorMessage}`);
    }

    parts.push(`\nDetails: ${payload.apiUrl}`);
    return parts.filter(Boolean).join(' ');
  }

  // Typed event emitter overrides
  emit<K extends BridgeEventName>(event: K, payload: BridgeEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends BridgeEventName>(event: K, listener: (payload: BridgeEvents[K]) => void): this {
    return super.on(event, listener);
  }
}
