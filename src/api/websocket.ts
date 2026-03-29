import type { FastifyInstance } from 'fastify';
import type { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { Session, SessionEvent, WsOutgoingMessage } from '../shared/types.js';

const clients = new Set<WebSocket>();

export function registerWebSocket(app: FastifyInstance, monitor: EventEmitter | null): void {
  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  if (!monitor) return;

  monitor.on('session:discovered', (data: { session: Session }) => {
    broadcast({ type: 'session_update', session: data.session });
  });

  monitor.on('session:status_changed', (data: { session: Session; from: string; to: string }) => {
    broadcast({
      type: 'status_change',
      sessionId: data.session.id,
      from: data.from,
      to: data.to,
    });
  });

  monitor.on('session:activity', (data: { session: Session }) => {
    broadcast({ type: 'session_update', session: data.session });
  });
}

function broadcast(message: WsOutgoingMessage): void {
  const json = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(json);
    }
  }
}
