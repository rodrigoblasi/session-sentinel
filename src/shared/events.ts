import type { Session, Run, SubAgent, ParsedEvent } from './types.js';

export interface MonitorEvents {
  'session:discovered': { session: Session };
  'session:status_changed': { session: Session; from: string; to: string };
  'session:question_detected': { session: Session; question: string };
  'session:activity': { session: Session; event: ParsedEvent };
  'run:started': { session: Session; run: Run };
  'run:ended': { session: Session; run: Run };
  'subagent:detected': { session: Session; subagent: SubAgent };
  'monitor:error': { error: Error; context: string };
}

export type MonitorEventName = keyof MonitorEvents;
