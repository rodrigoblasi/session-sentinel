import type { FastifyInstance } from 'fastify';
import * as queries from '../db/queries.js';
import type { SessionManager } from '../manager/index.js';
import type { SessionFilters, EventFilters, HierarchyBlock } from '../shared/types.js';

function enrichWithActivityState<T extends { status: string; updated_at: string; active_sub_agent_count?: number }>(session: T): T & { activity_state: 'processing' | 'subagents' | null } {
  let activity_state: 'processing' | 'subagents' | null = null;

  if (session.active_sub_agent_count && session.active_sub_agent_count > 0) {
    activity_state = 'subagents';
  } else if (session.status === 'active' && session.updated_at) {
    const updatedAt = new Date(session.updated_at + 'Z').getTime();
    if (Date.now() - updatedAt < 30_000) {
      activity_state = 'processing';
    }
  }

  return { ...session, activity_state };
}

export function registerRoutes(app: FastifyInstance, manager: SessionManager | null): void {

  // --- Health ---

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version: '0.2.0',
    timestamp: new Date().toISOString(),
  }));

  // --- Sessions ---

  app.get('/sessions', async (request) => {
    const query = request.query as Record<string, string>;
    const filters: SessionFilters = {};

    if (query.status) filters.status = query.status as any;
    if (query.type) filters.type = query.type as any;
    if (query.owner) filters.owner = query.owner;
    if (query.project) filters.project_name = query.project;
    if (query.active === 'true') filters.active = true;
    if (query.limit) filters.limit = parseInt(query.limit, 10);

    const sessions = queries.listSessions(filters);
    return sessions.map(enrichWithActivityState);
  });

  app.get('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = queries.getSession(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const runs = queries.getRuns(id);
    const events = queries.listEvents({ session_id: id, limit: 50 });
    const transcript = queries.getTranscript(id);
    const notifications = queries.listNotifications({ session_id: id });
    const available_actions = getAvailableActions(session);

    // TODO: consider pagination if sub_agent count grows beyond ~50 per session
    const subAgents = queries.getSubAgents(id);
    const hierarchy: HierarchyBlock = {
      sub_agents: [...subAgents].reverse(),
      sub_agent_count: subAgents.length,
      total_sub_agent_tokens: queries.getSubAgentTokenTotals(id),
    };

    const enrichedSession = enrichWithActivityState({
      ...session,
      active_sub_agent_count: queries.getSubAgents(id).filter(sa => !sa.ended_at).length,
    });

    return { session: enrichedSession, runs, events, transcript, notifications, available_actions, hierarchy };
  });

  app.get('/sessions/:id/transcript', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const session = queries.getSession(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return queries.getTranscript(id, limit);
  });

  // --- Notification settings ---

  app.patch('/sessions/:id/notifications', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> | null;

    if (!body || (body.enabled === undefined && body.target_agent === undefined)) {
      return reply.status(400).send({ error: 'At least one of enabled or target_agent is required' });
    }

    const updated = queries.updateNotificationSettings(id, {
      enabled: body.enabled as boolean | undefined,
      target_agent: body.target_agent as string | null | undefined,
    });

    if (!updated) return reply.status(404).send({ error: 'Session not found' });

    return queries.getSession(id);
  });

  // --- Session lifecycle (requires Manager) ---

  app.post('/sessions', async (request, reply) => {
    if (!manager) return reply.status(503).send({ error: 'Session Manager not available' });

    const body = request.body as Record<string, unknown>;
    if (!body.prompt || !body.owner) {
      return reply.status(400).send({ error: 'prompt and owner are required' });
    }

    try {
      const session = await manager.createSession({
        prompt: body.prompt as string,
        project: body.project as string | undefined,
        cwd: body.cwd as string | undefined,
        owner: body.owner as string,
        label: body.label as string | undefined,
        model: body.model as string | undefined,
        effort: body.effort as string | undefined,
        allowedTools: body.allowedTools as string[] | undefined,
        systemPrompt: body.systemPrompt as string | undefined,
        maxBudgetUsd: body.maxBudgetUsd as number | undefined,
      });
      return reply.status(201).send(session);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post('/sessions/:id/resume', async (request, reply) => {
    if (!manager) return reply.status(503).send({ error: 'Session Manager not available' });

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    if (!body.prompt || !body.owner) {
      return reply.status(400).send({ error: 'prompt and owner are required' });
    }

    try {
      const session = await manager.resumeSession(id, {
        prompt: body.prompt as string,
        owner: body.owner as string,
        model: body.model as string | undefined,
        effort: body.effort as string | undefined,
      });
      return reply.status(200).send(session);
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400;
      return reply.status(status).send({ error: err.message });
    }
  });

  app.post('/sessions/:id/message', async (request, reply) => {
    if (!manager) return reply.status(503).send({ error: 'Session Manager not available' });

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    if (!body.message) {
      return reply.status(400).send({ error: 'message is required' });
    }

    try {
      await manager.sendMessage(id, { message: body.message as string });
      return reply.status(202).send({ status: 'message_sent' });
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400;
      return reply.status(status).send({ error: err.message });
    }
  });

  app.delete('/sessions/:id', async (request, reply) => {
    if (!manager) return reply.status(503).send({ error: 'Session Manager not available' });

    const { id } = request.params as { id: string };
    try {
      await manager.terminateSession(id);
      return reply.status(200).send({ status: 'terminated' });
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400;
      return reply.status(status).send({ error: err.message });
    }
  });

  // --- Report ---

  app.get('/report', async () => {
    const stats = queries.getReportStats();
    const needsAttention = queries.listSessions({ status: 'waiting' as any })
      .concat(queries.listSessions({ status: 'error' as any }));
    const activeSessions = queries.listSessions({ status: 'active' as any });
    const recentEvents = queries.listEvents({ limit: 20 });

    // Group by project
    const allSessions = queries.listSessions({});
    const today = new Date().toISOString().slice(0, 10);
    const byProject: Record<string, { active: number; waiting: number; ended_today: number }> = {};
    for (const s of allSessions) {
      const proj = s.project_name ?? 'unknown';
      if (!byProject[proj]) byProject[proj] = { active: 0, waiting: 0, ended_today: 0 };
      if (s.status === 'active') byProject[proj].active++;
      if (s.status === 'waiting') byProject[proj].waiting++;
      if (s.status === 'ended' && s.updated_at?.startsWith(today)) byProject[proj].ended_today++;
    }

    return {
      summary: stats,
      needs_attention: needsAttention,
      active_sessions: activeSessions,
      recent_events: recentEvents,
      by_project: byProject,
    };
  });

  // --- Events ---

  app.get('/events', async (request) => {
    const query = request.query as Record<string, string>;
    const filters: EventFilters = {};

    if (query.session_id) filters.session_id = query.session_id;
    if (query.event_type) filters.event_type = query.event_type;
    if (query.limit) filters.limit = parseInt(query.limit, 10);

    return queries.listEvents(filters);
  });

  // --- Projects ---

  app.get('/projects', async () => {
    return queries.listProjects();
  });
}

function getAvailableActions(session: { status: string; type: string; can_resume: boolean }): string[] {
  const actions: string[] = [];

  if (session.type === 'managed') {
    if (['waiting', 'active', 'idle'].includes(session.status)) {
      actions.push('send_message');
    }
    if (['active', 'waiting', 'idle'].includes(session.status)) {
      actions.push('terminate');
    }
  }

  if (['ended', 'error', 'idle'].includes(session.status) && session.can_resume) {
    actions.push('resume');
  }

  return actions;
}
