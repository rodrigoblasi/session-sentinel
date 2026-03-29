import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes.js';
import type { SessionManager } from '../manager/index.js';

export interface ServerConfig {
  manager: SessionManager | null;
  logger?: boolean;
}

export function buildServer(config: ServerConfig): FastifyInstance {
  const app = Fastify({
    logger: config.logger ?? false,
  });

  app.register(cors, {
    origin: true,
  });

  registerRoutes(app, config.manager);

  return app;
}
