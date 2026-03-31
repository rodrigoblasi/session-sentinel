import { getSessions, getEvents, getReport } from '$lib/api.js';

export async function load() {
  const [sessions, events, report] = await Promise.all([
    getSessions(),
    getEvents({ limit: '20' }),
    getReport(),
  ]);

  return { sessions, events, report };
}
