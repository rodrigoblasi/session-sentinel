import type { FastifyInstance } from 'fastify';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function registerDocs(app: FastifyInstance): Promise<void> {
  const specPath = path.join(__dirname, 'openapi.yaml');
  const specYaml = fs.readFileSync(specPath, 'utf8');
  const spec = yaml.load(specYaml) as Record<string, unknown>;

  // Serve raw JSON spec
  app.get('/docs/openapi.json', async (_request, reply) => {
    reply.header('content-type', 'application/json');
    return spec;
  });

  // Serve Swagger UI HTML (loads from CDN)
  app.get('/docs', async (_request, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Sentinel API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
      });
    };
  </script>
</body>
</html>`;
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(html);
  });
}
