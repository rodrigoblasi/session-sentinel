# Session Sentinel — Agent Guide

This guide is for developers building agents that interact with Claude Code sessions through Session Sentinel's REST API. It covers the concepts you need to understand, the full API reference with examples, and common integration patterns.

Session Sentinel is a control plane for Claude Code sessions. It monitors all sessions passively via JSONL filesystem watching, manages session lifecycle (create, resume, terminate) for agent-driven sessions, and notifies agents when sessions need attention. For the full architecture, see the [design spec](specs/2026-03-27-session-sentinel-design.md).

**Base URL:** `http://<host>:3100`

---

## Key Concepts

### Session vs Run

A **Session** is the logical unit — it has a stable ID (format: `ss-<ulid>`), persists across resumes, and accumulates metrics (tokens, events, transcript). A **Run** is each execution: every start or resume creates a new Run with its own token counts and owner.

Think of it like a browser tab (session) vs page loads within it (runs). Closing and reopening a tab preserves the session; each page load is a new run.

### Managed vs Unmanaged

| | Managed | Unmanaged |
|---|---------|-----------|
| **Created by** | Sentinel API (`POST /sessions`) | User in terminal |
| **Controlled by** | Sentinel (create, resume, terminate, message) | User |
| **Notifications** | Automatic (waiting, error) | Never |
| **Housekeeping** | Auto-killed after 15 min idle | Never touched |
| **Sentinel's role** | Full lifecycle control | Monitor only — observe, never interfere |

### Ownership

Every managed session has an **owner** — the agent name that created or last resumed it. The owner receives notifications when the session needs attention. Ownership transfers when a different agent resumes the session.

### Session Statuses

| Status | Meaning |
|--------|---------|
| `starting` | Session process is launching |
| `active` | Producing output (tool calls, text generation) |
| `waiting` | Blocked on user input (asked a question via AskUserQuestion) |
| `idle` | Alive but no recent activity |
| `ended` | Process exited (may be resumable — check `can_resume`) |
| `error` | Something went wrong (API error, crash) |

**Transitions:** `starting → active → waiting/idle → ended/error`. Waiting sessions return to `active` when they receive a message. Ended sessions return to `starting` on resume.

### Housekeeping

Managed sessions that are **idle for 15 minutes** (no JSONL activity) are automatically terminated. This is silent — no notification is sent. The session remains resumable (`can_resume: true`). Waiting sessions are never auto-killed — they are legitimately waiting for input.
