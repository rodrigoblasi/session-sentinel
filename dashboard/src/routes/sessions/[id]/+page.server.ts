import type { PageServerLoad } from './$types';
import { getSessionById, getRunsForSession, getEventsForSession, getTranscriptForSession } from '$lib/db';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const session = getSessionById(params.id);
  if (!session) throw error(404, 'Session not found');

  const runs = getRunsForSession(params.id);
  const events = getEventsForSession(params.id);
  const transcript = getTranscriptForSession(params.id);

  return { session, runs, events, transcript };
};
