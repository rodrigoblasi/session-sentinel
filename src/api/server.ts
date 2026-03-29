import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerRoutes } from './routes.js';
import { registerWebSocket } from './websocket.js';
import type { SessionManager } from '../manager/index.js';
import type { EventEmitter } from 'node:events';

export interface ServerConfig {
  manager: SessionManager | null;
  monitor?: EventEmitter | null;
  bridge?: EventEmitter | null;
  logger?: boolean;
}

export function buildServer(config: ServerConfig): FastifyInstance {
  const app = Fastify({
    logger: config.logger ?? false,
  });

  app.register(cors, { origin: true });

  // WebSocket plugin must be registered before WS routes so its onRoute hook
  // intercepts them. We use app.register to create an encapsulated scope where
  // the plugin is available when the route is defined.
  app.register(async (instance) => {
    await instance.register(websocket);
    registerWebSocket(instance, config.monitor ?? null, config.bridge ?? null);
  });

  registerRoutes(app, config.manager);

  return app;
}
