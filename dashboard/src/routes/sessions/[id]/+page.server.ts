import { getSession } from '$lib/api.js';
import { error } from '@sveltejs/kit';

export async function load({ params }) {
  try {
    return await getSession(params.id);
  } catch (err: any) {
    if (err.message?.includes('404') || err.message?.includes('not found')) {
      error(404, 'Session not found');
    }
    throw err;
  }
}
