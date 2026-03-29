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

### Source of truth

- **Issues** are the source of truth. Every change traces to an issue.
- **Planning:** GitHub Projects (Kanban view)
- **CI/CD:** GitHub Actions
- **GitHub is the conversation channel for history.** Everything recorded there (PRs, issues, comments) is a taken decision. Decisions not documented on GitHub are lost between sessions.

### Branch strategy

**No direct commits to `main`.** All work goes through branches and PRs.

| Branch pattern | Purpose | Example |
|----------------|---------|---------|
| `main` | Always deployable. Protected. | — |
| `feat/N-short-description` | New feature from issue #N | `feat/12-session-monitor` |
| `fix/N-short-description` | Bug fix from issue #N | `fix/15-stale-detection` |
| `chore/N-short-description` | Infra, deps, CI from issue #N | `chore/8-github-actions` |
| `docs/N-short-description` | Documentation from issue #N | `docs/3-agent-guide` |
| `spike/N-short-description` | Investigation/spike from issue #N | `spike/1-jsonl-study` |

Rules:
- Branch name always includes the issue number
- One branch per issue. One issue per branch.
- Branch is deleted after merge.
- PR title follows commit convention: `feat(scope): description — closes #N`

### Pull Requests

- Every PR requires a description with: what changed, why, how to test
- PR must reference the issue it closes: `closes #N` in the body
- Merge strategy: **squash merge** to keep main history clean
- After merge, the Kanban card moves to Done automatically
- **Comment on PRs** to record decisions, risks, and context — this becomes the historical record
- Create follow-up issues when identifying future work, risks, or pending decisions during PR review

### Post-merge cleanup

After every PR merge, run this cleanup to keep the repo clean:

```bash
# 1. Switch to main and pull latest
git checkout main && git pull

# 2. Delete the local feature branch (already merged)
git branch -d <branch-name>

# 3. Prune remote-tracking references to deleted branches
git fetch --prune
```

This is mandatory after every merge. No orphan branches should exist locally or remotely.

To audit for stale branches: `git branch --merged main`

### Issue discipline

One issue at a time. Complete, review, merge, then move to next. Never have two unmerged issues in flight.

### GitHub Labels

Issues and PRs must use labels consistently:

**Type labels (required — every issue has exactly one):**

| Label | Color | Description |
|-------|-------|-------------|
| `type: feature` | `#1d76db` | New functionality |
| `type: bug` | `#d73a4a` | Something broken |
| `type: spike` | `#d4c5f9` | Investigation/research, no deliverable code |
| `type: chore` | `#ededed` | Infra, deps, CI, config |
| `type: docs` | `#0075ca` | Documentation |
| `type: refactor` | `#f9d0c4` | Code improvement, no behavior change |

**Module labels (required — what part of the system):**

| Label | Color | Description |
|-------|-------|-------------|
| `module: monitor` | `#4ade80` | Session Monitor (JSONL watching, discovery) |
| `module: manager` | `#60a5fa` | Session Manager (spawn, resume, kill, housekeep) |
| `module: bridge` | `#facc15` | Agent Bridge (notifications, context delivery) |
| `module: api` | `#c084fc` | REST API / WebSocket |
| `module: dashboard` | `#f472b6` | SvelteKit UI |
| `module: infra` | `#8899aa` | CI/CD, deploy, config, observability |
| `module: docs` | `#0075ca` | Documentation, agent guide, OpenAPI spec |

**Priority labels (required):**

| Label | Color | Description |
|-------|-------|-------------|
| `priority: critical` | `#b60205` | Blocks everything, fix now |
| `priority: high` | `#d93f0b` | Current sprint, do next |
| `priority: medium` | `#fbca04` | Planned, not urgent |
| `priority: low` | `#0e8a16` | Nice to have, backlog |

**Sprint labels:**

| Label | Color | Description |
|-------|-------|-------------|
| `sprint: 0` | `#e8e8e8` | Investigation / setup |
| `sprint: 1` | `#e8e8e8` | Core foundation |
| `sprint: 2` | `#e8e8e8` | (defined during planning) |
| `sprint: 3` | `#e8e8e8` | (defined during planning) |

**Status labels (for visibility on issues not yet on the board):**

| Label | Color | Description |
|-------|-------|-------------|
| `status: blocked` | `#b60205` | Waiting on dependency or decision |
| `status: needs-spec` | `#fbca04` | Needs more detail before implementation |
| `status: ready` | `#0e8a16` | Fully specified, ready to pick up |

### GitHub Project (Kanban)

Board columns:

| Column | What goes here |
|--------|---------------|
| **Backlog** | Issues created but not in current sprint |
| **Sprint** | Issues planned for current sprint |
| **In Progress** | Someone is actively working on this |
| **In Review** | PR open, awaiting review |
| **Done** | Merged and closed |

### Issue quality standards

Every issue must have:
- Clear title (what changes)
- Context (why this change is needed)
- Implementation notes (how — specific files, types, logic)
- Acceptance criteria (testable, specific)
- Labels: type + module + priority + sprint
- Dependencies (which issues must merge first)

If an issue is missing these, **enrich it before starting**.

### Architecture Decision Records (ADRs)

**Structural and architectural decisions must be recorded as ADRs.** Whenever a question arises about *how* to build something (not *what* to build), and the answer involves choosing between approaches with different trade-offs, it becomes an ADR.

| Item | Detail |
|------|--------|
| **Location** | `docs/decisions/NNNN-short-title.md` (sequential numbering) |
| **When to create** | Before implementing a choice that affects architecture, dependencies, integration strategy, or cross-module patterns |
| **Format** | Context → Problem → Options (with pros/cons/risk) → Recommendation → Decision (filled by operator) → Consequences → References |
| **Status values** | `Proposed` → `Accepted` / `Rejected` / `Superseded by ADR-NNNN` |
| **GitHub link** | After writing the ADR, post a summary + file link as a comment on the relevant issue. This connects the GitHub discussion history to the ADR. |

Examples of ADR-worthy questions:
- Which SDK version/API to use for session management
- How to handle notification delivery (script, webhook, queue)
- WebSocket architecture (per-session channels vs. global broadcast)
- How to handle SDK breaking changes (pin, abstract, dual-driver)

Examples of what is NOT an ADR:
- Bug fixes (just fix it)
- Implementation details that don't affect other modules
- Variable naming, code style (covered by linting)

**If in doubt, write the ADR.** The cost of documenting a decision is low. The cost of re-discovering why a decision was made is high.

### Commit conventions

```
feat(scope): add X — closes #N
fix(scope): fix Y — closes #N
perf(scope): optimize Z
docs(scope): document W
chore: bump version / update deps
spike(scope): investigate X — closes #N
```

Scope matches module names: `monitor`, `manager`, `bridge`, `api`, `dashboard`, `infra`, `docs`.

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
