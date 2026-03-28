import { getSessions, getRecentEvents, getStats } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  return {
    sessions: getSessions(),
    events: getRecentEvents(50),
    stats: getStats(),
    timestamp: new Date().toISOString(),
  };
};
