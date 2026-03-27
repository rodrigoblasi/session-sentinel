# Session Sentinel

> Control plane for development agent sessions

Session Sentinel monitors, manages, and brokers interactions between human operators, AI agents, and coding sessions. It acts as the central nervous system for multi-agent development workflows — knowing what every session is doing, notifying agents when action is needed, and giving operators full visibility through a real-time dashboard.

---

## The Problem

When running multiple AI coding sessions across different projects, things get chaotic fast:

- Sessions need human input ("Should I proceed with approach A or B?") but you're working on something else
- Agents that could handle routine interactions have no way to know a session needs attention
- There's no single place to see what's running, what's waiting, what failed
- Handing off a session between a human and an agent (or between agents) requires manual coordination
- With 50-100 sessions per day, keeping track of everything is impossible

## The Solution

Session Sentinel sits between your coding sessions and your agents. It:

**Monitors everything** — Automatically discovers and tracks all sessions via filesystem watching. Every status change, every question, every error is captured and stored.

**Manages what you delegate** — Agents can create, resume, and interact with sessions through a clean API. Sessions that go idle are automatically cleaned up. Sessions can be resumed later.

**Notifies intelligently** — When a managed session needs attention (waiting for input, encountered an error), the owning agent gets a notification. No manual subscription required — it just works.

**Delivers rich context** — When an agent investigates a session, it gets everything in one API call: what the session is doing, what it's asking, what it did before, what the project looks like, and what actions are available.

**Gives you control** — A real-time dashboard shows all sessions across all projects. Drill into any session to see its full history, timeline of who operated it, and take actions.

---

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                   Session Sentinel                       │
│                                                          │
│   Session Monitor ──── Session Manager ──── Agent Bridge │
│   (watch all)          (manage delegated)   (notify)     │
│         │                     │                  │       │
│         └─────────── Control Plane ──────────────┘       │
│                  REST API + WebSocket + Dashboard         │
│                           │                              │
│              SQLite + OpenTelemetry                       │
└─────────────────────────────────────────────────────────┘
         ↕                  ↕                    ↕
   Claude Code         AI Agents            Operator
   (sessions)       (OpenClaw etc)         (browser)
```

### Session Lifecycle

1. **You start a session** in your terminal — Sentinel discovers it automatically
2. **You stop working** and exit — Sentinel knows the session can be resumed
3. **You tell an agent** to continue the work — the agent resumes the session via Sentinel's API
4. **The session needs input** — Sentinel notifies the agent on Discord
5. **The agent investigates and responds** — or escalates to you
6. **Session goes idle** — Sentinel auto-terminates it after a threshold. Can be resumed anytime.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Session** | A logical unit of work. Persists across resumes. Stable ID, accumulated metrics. |
| **Run** | Each time a session is started or resumed. A session can have many runs, each with different operators. |
| **Managed** | Sentinel controls the session (created/resumed via API). Gets automatic notifications. |
| **Unmanaged** | User controls the session (opened in terminal). Sentinel only observes, never interferes. |
| **Owner** | The agent currently responsible for a managed session. Receives notifications. Changes on handoff. |

---

## Features

### For Agents
- **Create sessions** — `POST /sessions` with project name, prompt, and model
- **Resume sessions** — `POST /sessions/:id/resume` to take over an existing session
- **Send messages** — `POST /sessions/:id/message` to respond to a waiting session
- **Get context** — `GET /sessions/:id` returns everything needed to make a decision
- **Environment report** — `GET /report` for a full snapshot of all sessions
- **Automatic notifications** — No setup required. Own a session, get notified.

### For Operators
- **Real-time dashboard** — All sessions in a filterable table, live updates via WebSocket
- **Session drill-down** — Full history, run timeline, transcript, pending questions
- **Event log** — Every transition, notification, and housekeeping action logged
- **Actions** — Terminate sessions, view resume commands, inspect notification history
- **Claude Remote integration** — Direct links to observe/interact with sessions via browser

### For Operations
- **SQLite persistence** — Survives restarts. Full history queryable.
- **OpenTelemetry** — Traces, metrics, and structured logs. Export to Grafana/Jaeger.
- **Automatic housekeeping** — Idle sessions auto-terminated. Resources stay clean.
- **Project registry** — Knows where your projects live. Agents reference by name, not path.

---

## API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service status and session counts |
| `GET` | `/sessions` | List sessions with filters |
| `GET` | `/sessions/:id` | Full session detail with context |
| `GET` | `/sessions/:id/transcript` | Conversation history by turn |
| `POST` | `/sessions` | Create a new managed session |
| `POST` | `/sessions/:id/resume` | Resume an ended session |
| `POST` | `/sessions/:id/message` | Send input to a waiting session |
| `DELETE` | `/sessions/:id` | Terminate a managed session |
| `GET` | `/report` | Environment snapshot |
| `GET` | `/events` | Global event log |
| `GET` | `/projects` | Known projects and paths |
| `WS` | `/ws` | Real-time updates |

### Key Filters

```bash
# What needs attention right now?
curl sentinel:5000/sessions?needs_attention=true

# What's my agent working on?
curl sentinel:5000/sessions?owner=jarvis&active=true

# What can be resumed in this project?
curl sentinel:5000/sessions?project=wow-bot&can_resume=true

# Give me the full picture
curl sentinel:5000/report
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| HTTP | Fastify |
| Database | SQLite (better-sqlite3) |
| Frontend | SvelteKit |
| Real-time | WebSocket |
| Observability | OpenTelemetry |
| Tests | Vitest |
| Deploy | systemd |

---

## Project Status

**Phase:** Design complete, implementation starting

- [Design Spec](docs/specs/2026-03-27-session-sentinel-design.md) — Full architecture, data model, API design, and requirements
- [Kanban Board](https://github.com/users/rodrigoblasi/projects/3) — Sprint planning and progress tracking

---

## Background

Session Sentinel is a ground-up rewrite of [Claude Code Gateway](https://github.com/rodrigoblasi/Claude-Code-Gateway), which served as the proof of concept. Key lessons from the Gateway informed this design:

- Interactive sessions (not one-shot `--print` mode) are essential for real agent interaction
- Notifications must be automatic, not manually configured per session
- Session identity must survive resumes and handoffs (the Session + Runs model)
- The API must deliver rich context so agents can decide efficiently
- The dashboard needs both a bird's-eye view and deep drill-down capability

---

## License

MIT
