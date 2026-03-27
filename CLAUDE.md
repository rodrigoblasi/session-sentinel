# Session Sentinel

## What is this project

Control plane for development agent sessions. Monitors, manages, and brokers interactions between human operators, AI agents (OpenClaw ecosystem), and Claude Code sessions.

**Codename:** Project Session Sentinel
**Status:** Design complete, implementation pending
**Repo:** https://github.com/rodrigoblasi/session-sentinel

---

## Before you start — mandatory

```bash
cd /home/blasi/session-sentinel

# 1. Read the design spec — it is the source of truth
cat docs/specs/2026-03-27-session-sentinel-design.md

# 2. Check open issues
gh issue list

# 3. Read the issue you'll work on
gh issue view N
```

**Do not implement what is not in the spec or the issue.** If scope is unclear, comment on the issue and wait.

---

## Design spec

The full design is in `docs/specs/2026-03-27-session-sentinel-design.md`. Read it completely before any implementation work. Key sections:

- **Section 2** — Session mode: interactive only (not --print)
- **Section 3** — Key concepts: Session vs Run, Managed vs Unmanaged, Ownership
- **Section 4** — Architecture: 4 modules (Monitor, Manager, Bridge, Control Plane)
- **Section 5** — Data model: SQLite tables (sessions, runs, session_events, transcript_cache, notifications, projects)
- **Section 6** — Notification model: dual delivery (agent thread + sentinel-log), automatic for managed
- **Section 7** — API design: endpoints, filters, rich responses, GET /report
- **Section 8** — Dashboard UI: overview table + drill-down + event log
- **Section 11** — Sprint 0: investigations that must happen before implementation

---

## Stack

- **Runtime:** Node.js + TypeScript
- **HTTP:** Fastify
- **Database:** SQLite (better-sqlite3)
- **Frontend:** SvelteKit
- **Real-time:** WebSocket
- **Observability:** OpenTelemetry
- **Tests:** Vitest
- **Deploy:** systemd on homeserver01

---

## GitHub workflow

- **Issues** are the source of truth. Every change traces to an issue.
- **Planning:** GitHub Projects (Kanban view)
- **CI/CD:** GitHub Actions
- One issue at a time. Complete, review, merge, then next.

### Commit conventions

```
feat(scope): add X — closes #N
fix(scope): fix Y — closes #N
perf(scope): optimize Z
docs(scope): document W
chore: bump version / update deps
```

---

## Key concepts (from spec)

### Session vs Run
- **Session** = logical unit (stable ID, persists across resumes, accumulated metrics)
- **Run** = each execution (each start/resume creates a new Run with its own JSONL, owner, tokens)

### Managed vs Unmanaged
- **Managed** = Sentinel controls (created/resumed via API). Auto-notifies owner. Can interact, kill, housekeep.
- **Unmanaged** = User controls (opened in terminal). Sentinel only monitors. Never interferes.

### Ownership
- Every managed session has an owner (agent name). Owner receives notifications.
- Ownership changes on resume by different agent. Notifications follow current owner.

### Notifications
- Only for managed sessions, only for actionable states: **waiting** and **error**
- Dual delivery: agent's Discord thread + #sentinel-log channel
- Housekeeping (idle auto-kill) is silent — no notifications

### Interactive sessions only
- Sentinel uses `claude` interactive mode, NOT `claude --print`
- Process stays alive, stdin/stdout open
- Messages sent via stdin to living process

### Claude Remote
- Enabled by default on all managed sessions
- Dashboard links to Claude Remote URL for direct observation/interaction

---

## Architecture overview

```
~/.claude/projects/**/*.jsonl
    ↓ fs.watch
Session Monitor (observe all, never interfere)
    ↓ internal events
    ├── Session Manager (create, resume, kill managed sessions)
    ├── Agent Bridge (notify owners, deliver context)
    └── Control Plane (REST API + WebSocket + Dashboard)
            │
            └── SQLite + OpenTelemetry
```

---

## Sandbox

Tests and experiments in `sandbox/` only. Never point at real project directories for testing.

---

## Predecessor

This project replaces `claude-code-gateway` (discontinued). The old Gateway is kept as learning reference at `/home/blasi/claude_code_gateway/`. Key lessons learned:

- `--print` mode (one-shot) doesn't support real interactive sessions
- Manual watch registration for notifications is fragile
- Flat session model (1 JSONL = 1 session) makes resumes and handoffs confusing
- Sub-agent sessions were misidentified as new independent sessions
- Dashboard needs two levels: overview table + rich drill-down
