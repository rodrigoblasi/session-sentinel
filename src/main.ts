import { SessionMonitor } from './monitor/index.js';
import { SessionManager } from './manager/index.js';
import { V1Driver } from './manager/v1-driver.js';
import { Housekeeper } from './manager/housekeeper.js';
import { AgentBridge } from './bridge/index.js';
import { buildServer } from './api/server.js';
import { API_PORT, API_HOST } from './shared/constants.js';

// --- Configuration from environment ---
const config = {
  apiPort: parseInt(process.env.SENTINEL_PORT ?? String(API_PORT), 10),
  apiHost: process.env.SENTINEL_HOST ?? API_HOST,
  notifyScript: process.env.SENTINEL_NOTIFY_SCRIPT ?? '/usr/local/bin/agent-notify.sh',
  apiBaseUrl: process.env.SENTINEL_API_URL ?? `http://localhost:${API_PORT}`,
};

// --- Initialize modules ---
const monitor = new SessionMonitor();

const driver = new V1Driver();
const manager = new SessionManager({
  driver,
  notifyScript: config.notifyScript,
});

const housekeeper = new Housekeeper(manager);

const bridge = new AgentBridge({
  monitor,
  notifyScript: config.notifyScript,
  apiBaseUrl: config.apiBaseUrl,
});

const app = buildServer({
  manager,
  monitor,
  bridge,
  logger: true,
});

// --- Graceful shutdown ---
async function shutdown() {
  console.log('\nShutting down...');
  await app.close();
  bridge.stop();
  housekeeper.stop();
  await manager.stop();
  await monitor.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Start ---
console.log('Session Sentinel starting...');
await monitor.start();
console.log(`Monitoring ${monitor.getStats().filesWatched} files`);

housekeeper.start();
console.log('Housekeeper started (15 min idle auto-kill for managed sessions)');

await app.listen({ port: config.apiPort, host: config.apiHost });
console.log(`API listening on http://${config.apiHost}:${config.apiPort}`);
console.log(`WebSocket on ws://${config.apiHost}:${config.apiPort}/ws`);
console.log('Press Ctrl+C to stop.');
