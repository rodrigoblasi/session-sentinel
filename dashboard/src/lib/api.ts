import { env } from '$env/dynamic/public';
import type {
  Session, SessionDetailResponse, SessionEvent,
  ReportResponse,
} from './types.js';

const base = env.PUBLIC_API_URL ?? 'http://localhost:3100';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- Queries ---

export function getSessions(params?: Record<string, string>): Promise<Session[]> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return api(`/sessions${qs}`);
}

export function getSession(id: string): Promise<SessionDetailResponse> {
  return api(`/sessions/${id}`);
}

export function getReport(): Promise<ReportResponse> {
  return api('/report');
}

export function getEvents(params?: Record<string, string>): Promise<SessionEvent[]> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return api(`/events${qs}`);
}

// --- Actions ---

export function terminateSession(id: string): Promise<{ status: string }> {
  return api(`/sessions/${id}`, { method: 'DELETE' });
}

export function sendMessage(id: string, message: string): Promise<{ status: string }> {
  return api(`/sessions/${id}/message`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function updateNotifications(
  id: string,
  body: { enabled?: boolean; target_agent?: string | null },
): Promise<Session> {
  return api(`/sessions/${id}/notifications`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// --- WebSocket ---

export function getWsUrl(): string {
  return base.replace(/^https/, 'wss').replace(/^http(?!s)/, 'ws') + '/ws';
}
