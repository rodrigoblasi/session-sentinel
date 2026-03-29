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

// --- Sprint 2 events ---

export interface ManagerEvents {
  'manager:session_created': { session: Session };
  'manager:turn_started': { sessionId: string; prompt: string };
  'manager:turn_completed': { sessionId: string; success: boolean };
  'manager:session_terminated': { sessionId: string };
  'manager:error': { error: Error; sessionId?: string };
}

export type ManagerEventName = keyof ManagerEvents;

export interface BridgeEvents {
  'bridge:notification_sent': { sessionId: string; destination: string; trigger: string };
  'bridge:notification_failed': { sessionId: string; destination: string; error: Error };
}

export type BridgeEventName = keyof BridgeEvents;

// --- Sprint 3 events ---

export interface HousekeeperEvents {
  'housekeeper:sweep': { checked: number; terminated: number };
  'housekeeper:terminated': { sessionId: string; idleMs: number };
  'housekeeper:error': { error: Error; sessionId?: string };
}

export type HousekeeperEventName = keyof HousekeeperEvents;
