import { EventEmitter } from 'node:events';
import * as queries from '../db/queries.js';
import { HOUSEKEEP_INTERVAL_MS, HOUSEKEEP_IDLE_THRESHOLD_MS } from '../shared/constants.js';
import type { SessionManager } from './index.js';
import type { HousekeepConfig } from '../shared/types.js';
import type { HousekeeperEvents, HousekeeperEventName } from '../shared/events.js';

export class Housekeeper extends EventEmitter {
  private manager: SessionManager;
  private intervalMs: number;
  private idleThresholdMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(manager: SessionManager, config: HousekeepConfig = {}) {
    super();
    this.manager = manager;
    this.intervalMs = config.intervalMs ?? HOUSEKEEP_INTERVAL_MS;
    this.idleThresholdMs = config.idleThresholdMs ?? HOUSEKEEP_IDLE_THRESHOLD_MS;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        this.emit('housekeeper:error', { error: err });
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<void> {
    const now = Date.now();
    const idleManagedSessions = queries.listSessions({
      type: 'managed',
      status: 'idle',
    });

    let terminated = 0;

    for (const session of idleManagedSessions) {
      const updatedAt = new Date(session.updated_at + 'Z').getTime();
      const idleMs = now - updatedAt;

      if (idleMs >= this.idleThresholdMs) {
        try {
          await this.manager.terminateSession(session.id, {
            actor: 'housekeeper',
            eventType: 'housekeep',
            detail: { reason: 'idle_auto_kill', idle_ms: idleMs },
          });
          this.emit('housekeeper:terminated', { sessionId: session.id, idleMs });
          terminated++;
        } catch (err) {
          this.emit('housekeeper:error', { error: err as Error, sessionId: session.id });
        }
      }
    }

    this.emit('housekeeper:sweep', {
      checked: idleManagedSessions.length,
      terminated,
    });
  }

  // Typed event emitter overrides
  override emit<K extends HousekeeperEventName>(event: K, payload: HousekeeperEvents[K]): boolean {
    return super.emit(event, payload);
  }

  override on<K extends HousekeeperEventName>(event: K, listener: (payload: HousekeeperEvents[K]) => void): this {
    return super.on(event, listener as (...args: any[]) => void);
  }
}
