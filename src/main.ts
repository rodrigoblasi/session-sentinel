import { SessionMonitor } from './monitor/index.js';

const monitor = new SessionMonitor();

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await monitor.stop();
  process.exit(0);
});

console.log('Session Sentinel starting...');
await monitor.start();
console.log('Monitoring', monitor.getStats().filesWatched, 'files');
console.log('Press Ctrl+C to stop.');
