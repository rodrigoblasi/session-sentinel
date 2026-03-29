import { EventEmitter } from 'node:events';

/**
 * Global event bus for cross-module communication.
 * Used by insertEvent to broadcast new session events to WebSocket clients.
 */
export const eventBus = new EventEmitter();
