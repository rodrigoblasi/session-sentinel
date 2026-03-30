# Phase 3 Design: Operator Dashboard

**Status:** Approved
**Date:** 2026-03-29
**Scope:** Sprint 3 (Dashboard) + Sprint 4 (Advanced Housekeeping + API Cleanup)

---

## 1. Overview

Phase 3 delivers an operator dashboard for real-time session management and advanced housekeeping automation. The dashboard is the primary deliverable — it enables manual oversight during OpenClaw agent integration testing. Housekeeping automation follows once operational patterns are learned.

### Sprint breakdown

| Sprint | Focus | Deliverables |
|--------|-------|-------------|
| **Sprint 3** | Dashboard + API support | Full dashboard (3 levels), notification management UI, activity indicators, deploy |
| **Sprint 4** | Automation + cleanup | Advanced housekeeping rules, Fastify schema migration, dashboard polish |

### Deferred to Phase 4+

- OpenTelemetry full integration
- Docker deployment
- Multi-runtime support

---

## 2. Dashboard Architecture

### Stack

- **Framework:** SvelteKit 5 with adapter-node
- **Port:** 3002 (dev and production)
- **Data source:** REST API at port 3100 (not direct SQLite access)
- **Real-time:** WebSocket at `ws://host:3100/ws`
- **Deploy:** systemd unit on homeserver01, alongside Sentinel API

### Key architectural decisions

**API client, not direct DB.** The existing dashboard prototype (`$lib/db.ts`) reads SQLite directly. Sprint 3 replaces this with an API client module (`$lib/api.ts`) that calls the Sentinel REST API. Reasons:
- Decouples dashboard from server filesystem
- Dashboard consumes the same API as agents (dogfooding)
- Tests the API through real usage

**WebSocket for real-time.** The dashboard connects to the existing WebSocket endpoint. Any event triggers `invalidateAll()` to refresh SvelteKit load functions. This is the simplest correct approach — granular updates can be optimized later if needed.

**Environment configuration.** API base URL via `PUBLIC_API_URL` env var (defaults to `http://localhost:3100`).

**CORS.** Fastify already has `@fastify/cors`. Origins configured via `CORS_ORIGINS` env var (comma-separated, e.g., `http://localhost:3002,http://192.168.1.12:3002`). Defaults to `http://localhost:3002`.

---

## 3. Dashboard: Three-Level Navigation

### Level 1 — Sessions Table (always visible)

The main view. All sessions in a sortable, filterable table with real-time updates.

**Columns** (matching Gateway predecessor):

| Column | Content |
|--------|---------|
| Status | Badge with color: active (green), waiting (yellow), idle (orange), ended (gray), error (red) |
| Label | Session label or truncated claude_session_id. Links to Level 2 |
| Type | Badge: `managed` (blue) / `unmanaged` (muted) |
| Project | Project name |
| Branch | Git branch (monospace) |
| Model | Model name (e.g., opus-4-6), shortened |
| Effort | Effort level (max, high, etc.) |
| Duration | Elapsed time |
| Tokens | Output token count, formatted (K/M) |
| 🔔 | Notification status icon (see Section 5) |

**Row styling:**
- Alternating row backgrounds for readability
- Selected row highlighted (opens Level 2 side panel)
- Sub-agents indented with `↳` prefix and reduced opacity (driven by `parent_session_id` field in list response, no extra API calls)
- Pending questions shown as expandable sub-row under waiting sessions
- Error messages shown as expandable sub-row under error sessions
- Ended sessions use muted text colors

**Filters:**
- Pill tabs: All, Active, Waiting, Managed, Unmanaged
- Free-text search: label, id, branch
- Session count display (matching filter / total visible — not all-time)

**Sorting:** All columns sortable. Default: status priority (waiting → active → idle → ended).

**Activity indicator:** See Section 6.

### Level 2 — Side Panel (quick detail)

Clicking a session row opens a side panel (~38% width) on the right. The table remains visible and navigable.

**Side panel sections:**

1. **Header** — Session label + status badge + activity sparkles + "Open full ↗" link
2. **Stats cards** — Turns, Duration (with last activity), Tokens (in/out breakdown)
3. **Token breakdown** — Visual bars: Input, Output, Cache hits (with values)
4. **Tools used** — Colored badges with counts (Read ×56, Bash ×40, etc.)
5. **Details** — Grid: Session ID, Type/Effort, Branch, Owner, Model
6. **Actions** — Terminate, Send Message, Resume CLI (see Section 7)
7. **Notifications** — Current state: active/disabled, target agent, subscribed events
8. **Runs** — List with run number, owner, duration, tokens, status. Active run highlighted
9. **Audit log** — Compact event list, filterable by "all" or "this session"

### Level 3 — Deep Analysis (full page)

Clicking "Open full ↗" in the side panel navigates to `/sessions/[id]`. Full page width for deep investigation.

**Top bar:** Back link, session label, status badge, activity sparkles, action buttons (Terminate, Send Message, Resume CLI).

**Stats bar:** Inline metadata — Owner, Model, Effort, Branch, Project, Turns, Duration, Tokens, Runs.

**Tabs:**

#### Timeline (unified)

Single chronological stream that interleaves conversation turns and system events. This replaces separate "transcript" and "event timeline" views — they show the same narrative.

**Conversation turns** appear as cards:
- User turns: blue left border, role badge, turn number, timestamp, token count, content
- Assistant turns: green left border, role badge, turn number, timestamp, tool chips (Read ×2, Edit ×1, etc.), token count, content (truncated with expand)
- "Show tool call details ▾" expander for assistant turns

**System events** appear as compact inline entries:
- Status transitions (green/yellow/red dot)
- Notifications sent (with trigger, destination, delivery status)
- Sub-agent spawned/ended (purple, with model and task)
- Run started/ended

**Run separators** mark boundaries between runs with label, owner, type, duration, tokens.

**Filters:** All, User turns, Assistant turns, Events, Sub-agents. Free-text search.

#### Tools

- Overview cards: one per tool type, with count, percentage, proportional bar
- Tool calls by turn: chronological list showing which tools were called per turn

#### Notifications

- History cards: trigger type (waiting/error), message content, destination, delivery status, timestamp

#### Runs

- Run cards: one per run, with status, owner, type, duration, tokens, turns, tool calls
- Active run shows sparkle animation

---

## 4. Dark Mode Theme

Google Midnight-inspired palette. Not pure black — deep blue-gray tones.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#1a1a2e` | Page background |
| `--bg-surface` | `#202038` | Cards, panels, top bar |
| `--bg-elevated` | `#2a2a45` | Hover states, inputs, dropdowns |
| `--bg-hover` | `#32325a` | Row hover, interactive elements |
| `--bg-row-alt` | `#1e1e35` | Alternating table rows (verify contrast with --text-secondary meets ~4.5:1) |
| `--border` | `#3a3a5c` | Strong borders |
| `--border-subtle` | `#2e2e4a` | Subtle separators |
| `--text-primary` | `#e8eaed` | Primary text |
| `--text-secondary` | `#9aa0a6` | Secondary text |
| `--text-muted` | `#6b6b8a` | Muted/disabled text |
| `--accent-blue` | `#8ab4f8` | Links, user turns, Read tool |
| `--accent-green` | `#81c995` | Active status, assistant turns, Bash tool |
| `--accent-yellow` | `#fdd663` | Waiting status, notifications, Edit tool |
| `--accent-orange` | `#fcad70` | Idle status, Glob tool |
| `--accent-red` | `#f28b82` | Error status, danger actions, Grep tool |
| `--accent-purple` | `#c58af9` | Sub-agents, cache hits, Agent tool |
| `--accent-gray` | `#6b6b8a` | Ended status, disabled |

---

## 5. Notification Management

The notification bell icon (🔔) in each table row provides at-a-glance status and click-to-manage.

### Bell states

| Visual | State | Meaning |
|--------|-------|---------|
| 🔔 + green dot | Active | Notifications enabled, delivering to agent |
| 🔔 + red pulse | Fired | Notification was recently sent (session is waiting/error) |
| 🔕 | Disabled | Notifications muted (subscription exists but paused) |
| — | N/A | Unmanaged session, notifications not applicable |

### Popover (click bell)

Opens a popover with:
- **Toggle:** Enable/disable notifications for this session
- **Deliver to:** Dropdown to reassign to different agent (jarvis, friday, operator, etc.)
- **Trigger events:** Read-only display of current triggers: `waiting` and `error` (the only two supported by the bridge in Sprint 3)
- **Channels:** Read-only display (discord_owner, sentinel-log) — automatic dual delivery
- **Footer:** Session type and owner info

### API support required

The current notification model is automatic — the bridge fires on status changes for managed sessions with an owner. There is no subscription table. To support dashboard control, Sprint 3 adds two columns to the `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN notifications_target_override TEXT;
```

- `notifications_enabled`: when false, the bridge skips this session. Default true (preserves current behavior).
- `notifications_target_override`: when set, the bridge delivers to this agent instead of `session.owner`. Null = use owner.

New endpoint: `PATCH /sessions/:id/notifications`

Request body:
```json
{
  "enabled": true,
  "target_agent": "jarvis"
}
```

The bridge checks `notifications_enabled` before firing and uses `notifications_target_override ?? session.owner` as the delivery target.

---

## 6. Activity Indicator

Shows when Claude Code is actively processing. Uses the same sparkle animation as Claude Code's CLI (blue dancing dots).

### States

| Visual | State | Data source | Meaning |
|--------|-------|-------------|---------|
| Blue sparkles ✦✦✦ | Processing | Last JSONL event (tool_call or assistant output) within 30s | Claude is working. Don't interrupt. |
| Purple sparkles ✦✦✦ + "N agents" | Sub-agents active | sub_agents table: `ended_at IS NULL` for this session | Multiple processes running |
| (nothing) | Waiting/Idle/Ended | Session status | Not processing |

### API support required

New field in session API response: `activity_state: 'processing' | 'subagents' | null`

Derived server-side from:
- `processing`: last JSONL event timestamp < 30 seconds ago
- `subagents`: session has children in sub_agents table where `ended_at IS NULL`
- `null`: all other states

The WebSocket already pushes `session_updated` events, so sparkles update in real-time.

### Sparkle animation (CSS)

Replicates Claude Code's visual language:
- Three dots animating with offset delays (0s, 0.2s, 0.4s)
- Scale + translateY + opacity keyframes over 1.6s ease-in-out
- Subtle glow effect (box-shadow pulse)
- Blue for direct processing, purple for sub-agent delegation

---

## 7. Operator Actions

Available in Level 2 (side panel) and Level 3 (full page header).

| Action | API call | Conditions |
|--------|----------|------------|
| **Terminate** | `DELETE /sessions/:id` | Managed sessions only, status in [active, waiting, idle] |
| **Send Message** | `POST /sessions/:id/message` | Managed sessions, status in [active, waiting] |
| **Resume CLI** | Display command | can_resume=true, status in [ended, error, idle] |

**Terminate** shows a confirmation dialog before executing.

**Send Message** opens a text input. The API already supports this endpoint.

**Resume CLI** displays a copyable command: `claude --resume {claude_session_id}`.

---

## 8. Migration from Debug Dashboard

The existing debug dashboard (`dashboard/src/`) has working code that will be migrated:

### Keep
- SvelteKit route structure: `/` (overview) and `/sessions/[id]` (detail)
- WebSocket connection pattern (`onMount` → connect, `onDestroy` → close)
- Status color mapping, token formatting, timeAgo helpers
- Svelte 5 runes mode ($props, $derived, $state)

### Replace
- `$lib/db.ts` (direct SQLite) → `$lib/api.ts` (REST API client)
- `+page.server.ts` load functions → call API client instead of DB queries
- adapter-auto → adapter-node
- Raw tables → designed components with theme tokens
- Inline styles → CSS with design system variables

### Add
- Side panel component (Level 2)
- Notification popover component
- Activity sparkle component
- Unified timeline component (Level 3)
- Filter/sort logic for table
- Dark theme with CSS custom properties

---

## 9. Sprint 4 Scope (Preview)

### Advanced Housekeeping

Real operational pain points to address:

1. **Per-project thresholds** — Some tasks are long-running (large refactors). Configurable idle timeout override per project.
2. **Concurrent session limits** — Maximum number of live managed processes. New session creation blocked or oldest idle killed when limit reached.
3. **Overnight cleanup** — Sessions left running overnight should have shorter idle thresholds or be killed at a specific time.

Implementation approach: configuration table in SQLite (`housekeeping_rules`) with project-level overrides. The housekeeper reads rules on each sweep.

### Fastify Schema Migration

Follow-up from ADR-0003:
- Add JSON Schema to all 11 routes for automatic request validation
- Declare `required` arrays in response schemas
- Evaluate migration from static OpenAPI YAML to @fastify/swagger auto-generation

### Dashboard Polish

Based on Sprint 3 operational feedback:
- UX improvements discovered during real agent integration testing
- Performance optimizations if needed (granular WebSocket updates, virtual scrolling for large tables)

---

## 10. Testing Strategy

### Dashboard tests (Vitest)
- API client module (`$lib/api.ts`): unit tests with mocked fetch responses
- Filter/sort logic: unit tests for table filtering and column sorting
- No E2E browser tests in Sprint 3 — internal tool, manual testing during integration is sufficient

### API tests (existing pattern)
- New notification PATCH endpoint: happy path + validation + 404 for missing subscription
- Activity state field: verify derivation logic from JSONL timestamps

---

## 11. Deploy

### SvelteKit dashboard
- Build: `npm run build` (adapter-node produces `build/`)
- Run: `node build/index.js` with `PORT=3002` and `PUBLIC_API_URL=http://localhost:3100`
- systemd unit: `sentinel-dashboard.service` alongside existing `sentinel.service`

### CORS update
- Configure via `CORS_ORIGINS` env var (comma-separated)
- Default: `http://localhost:3002`
- Production: include LAN IP (e.g., `http://localhost:3002,http://192.168.1.12:3002`)
