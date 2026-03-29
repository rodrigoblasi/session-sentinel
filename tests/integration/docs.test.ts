import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { initDb, closeDb } from '../../src/db/connection.js';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('OpenAPI docs', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `sentinel-docs-${Date.now()}.db`);
    initDb(dbPath);
    app = buildServer({ manager: null as any });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  describe('GET /docs/openapi.json', () => {
    it('returns valid OpenAPI 3.1 spec', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');

      const spec = response.json();
      expect(spec.openapi).toBe('3.1.0');
      expect(spec.info.title).toBe('Session Sentinel API');
      expect(spec.paths).toBeDefined();
      expect(spec.components?.schemas).toBeDefined();
    });

    it('includes all API endpoints', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
      const spec = response.json();
      const paths = Object.keys(spec.paths);

      expect(paths).toContain('/health');
      expect(paths).toContain('/sessions');
      expect(paths).toContain('/sessions/{id}');
      expect(paths).toContain('/sessions/{id}/transcript');
      expect(paths).toContain('/sessions/{id}/resume');
      expect(paths).toContain('/sessions/{id}/message');
      expect(paths).toContain('/report');
      expect(paths).toContain('/events');
      expect(paths).toContain('/projects');
    });

    it('includes all component schemas', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs/openapi.json' });
      const spec = response.json();
      const schemas = Object.keys(spec.components.schemas);

      expect(schemas).toContain('Session');
      expect(schemas).toContain('Run');
      expect(schemas).toContain('SubAgent');
      expect(schemas).toContain('HierarchyBlock');
      expect(schemas).toContain('SessionEvent');
      expect(schemas).toContain('TranscriptEntry');
      expect(schemas).toContain('Notification');
      expect(schemas).toContain('Project');
      expect(schemas).toContain('ReportSummary');
      expect(schemas).toContain('Error');
    });
  });

  describe('GET /docs', () => {
    it('returns Swagger UI HTML', async () => {
      const response = await app.inject({ method: 'GET', url: '/docs' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('swagger-ui');
      expect(response.body).toContain('/docs/openapi.json');
    });
  });
});
