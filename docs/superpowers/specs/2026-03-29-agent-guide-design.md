# Agent Guide — Design Spec

**Date:** 2026-03-29
**Traces to:** Spec §12 (Documentation Deliverables), Success Criterion #8
**Deliverable:** `docs/agent-guide.md`
**Audience:** Human developers/agent builders who want their agents to use Sentinel's API

---

## Purpose

Phase 1 is complete — Monitor, Manager, Bridge, API, Dashboard, and Housekeeper are all implemented and tested. But no external agent can use Sentinel yet because there is no documentation. Success Criterion #8 states: "Documentation enables new agents to use Sentinel without human guidance."

The Agent Guide is the single document that bridges this gap.

## Format

Single markdown file: `docs/agent-guide.md`. Linear narrative, self-contained — concepts through API reference through workflows. No separate reference doc; the API has 11 endpoints which fits comfortably in one file.

## Structure

### Section 1 — Introduction (~2 paragraphs)

What Sentinel is, who this doc is for (developers building agents that interact with Claude Code sessions), what they'll learn. Links to the design spec for deeper architecture context.

### Section 2 — Key Concepts

The mental model needed before touching the API:

- **Session vs Run** — a Session is the logical unit (stable ID, persists across resumes, accumulated metrics). Each start/resume creates a new Run with its own tokens and owner.
- **Managed vs Unmanaged** — Managed sessions are created and controlled via Sentinel's API. Unmanaged sessions are user-opened in a terminal; Sentinel only monitors them, never interferes.
- **Ownership** — every managed session has an owner (agent name). Owner receives notifications. Ownership transfers when a different agent resumes the session.
- **Session statuses** — `starting`, `active`, `waiting`, `idle`, `ended`, `error`. Brief explanation of each status and what triggers transitions.
- **Housekeeping** — managed sessions idle for 15 minutes are auto-terminated (SIGTERM). Silent — no notification. Sessions can be resumed afterward.

### Section 3 — API Reference

Every endpoint documented with: method, path, description, query parameters, request body, curl example, and a representative response sample.

Grouped by purpose:

1. **Health** — `GET /health`
2. **Sessions** — `GET /sessions` (with filter params: status, type, owner, project, active, limit), `GET /sessions/:id` (full detail with runs, events, transcript, notifications, available_actions), `GET /sessions/:id/transcript`
3. **Lifecycle** — `POST /sessions` (create), `POST /sessions/:id/resume`, `POST /sessions/:id/message`, `DELETE /sessions/:id`
4. **Report & Events** — `GET /report` (environment snapshot), `GET /events` (global event log)
5. **Projects** — `GET /projects`
6. **WebSocket** — `ws://host:3100/ws` with event types: `session_update`, `status_change`, `event`, `notification`

### Section 4 — Notification Model

Consumer-facing explanation:

- Only managed sessions trigger notifications
- Only `waiting` and `error` statuses trigger them
- Dual delivery: owner's Discord thread (wakes the agent) + #sentinel-log (audit for operator)
- Notification payload fields: sessionId, label, status, project, gitBranch, pendingQuestion, errorMessage, waitingSince, apiUrl
- How to view notification history via `GET /sessions/:id` detail response (notifications array in response)

### Section 5 — Common Workflows

Step-by-step sequences using curl, showing the full request/response flow:

1. **Create a session and monitor it** — POST /sessions → poll GET /sessions/:id or connect WebSocket → handle result
2. **Handle a waiting notification** — receive notification → GET /sessions/:id for context → POST /sessions/:id/message to respond
3. **Resume an ended session** — GET /sessions/:id to check can_resume → POST /sessions/:id/resume
4. **Check what needs attention** — GET /report for overview, or GET /sessions?active=true for active list

### Section 6 — Best Practices

Short, actionable list:

- Use `GET /report` for overview instead of polling individual sessions
- Use WebSocket (`/ws`) for real-time updates instead of polling
- Let housekeeping handle idle sessions — don't manually terminate unless there's a specific reason
- Always provide a meaningful `owner` name to enable correct notification routing
- Use `label` when creating sessions for easier identification in the dashboard
- Check `available_actions` in session detail before attempting lifecycle operations

## Data Sources

All curl examples and response shapes will be verified against the actual implementation:

- Routes: `src/api/routes.ts`
- Types: `src/types/`
- Manager operations: `src/manager/session-manager.ts`
- Bridge: `src/bridge/agent-bridge.ts`
- DB queries: `src/db/queries.ts`

## What This Is NOT

- Not a CLAUDE.md snippet for LLM injection into other repos (that's a separate future deliverable)
- Not an OpenAPI spec (that's a separate Phase 2 item)
- Not architecture documentation (the design spec covers that)
