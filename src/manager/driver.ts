// Re-export the SessionDriver interface and related types from shared/types.
// This module exists so consumers can import from the manager package directly.
export type {
  SessionDriver,
  TurnOpts,
  TurnHandle,
  StreamEvent,
} from '../shared/types.js';
