import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock $env/dynamic/public before importing api
vi.mock('$env/dynamic/public', () => ({
  env: { PUBLIC_API_URL: 'http://test:3100' },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks are set up
const { getSessions, getSession, terminateSession, sendMessage, updateNotifications } = await import('../src/lib/api.js');

describe('API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getSessions calls GET /sessions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: 'ss-1' }]),
    });

    const result = await getSessions();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3100/sessions',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result).toEqual([{ id: 'ss-1' }]);
  });

  it('getSessions forwards query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await getSessions({ status: 'active' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3100/sessions?status=active',
      expect.any(Object),
    );
  });

  it('getSession calls GET /sessions/:id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ session: { id: 'ss-1' } }),
    });

    const result = await getSession('ss-1');
    expect(result.session.id).toBe('ss-1');
  });

  it('terminateSession calls DELETE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'terminated' }),
    });

    await terminateSession('ss-1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3100/sessions/ss-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('sendMessage calls POST with body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'message_sent' }),
    });

    await sendMessage('ss-1', 'hello');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3100/sessions/ss-1/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'hello' }),
      }),
    );
  });

  it('updateNotifications calls PATCH', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'ss-1', notifications_enabled: false }),
    });

    await updateNotifications('ss-1', { enabled: false });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3100/sessions/ss-1/notifications',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'Session not found' }),
    });

    await expect(getSession('bad-id')).rejects.toThrow('Session not found');
  });
});
