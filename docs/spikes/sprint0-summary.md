# Sprint 0 — Consolidated Findings

**Date:** 2026-03-27
**Branch:** `spike/1-sprint0-investigations`
**Issue:** #1
**Investigations completed:** 7/7

---

## Decisions Summary

| # | Investigation | Decision | Impact |
|---|--------------|----------|--------|
| 1 | JSONL Format | Priority event ranking for Monitor; status inferred from JSONL signals, not stored field | Monitor event parsing, status state machine |
| 2 | Resume Identity | One JSONL = One Session; run boundaries via multi-signal detection (`SessionStart:resume` hook primary) | Session/Run mapping, `runs.start_type` column |
| 3 | Sub-agent Detection | Filesystem path is sole reliable linking mechanism; separate `sub_agents` table | New table, token rollup formula |
| 4 | SDK Interactive | Hybrid: SDK V2 primary (`createSession`/`send`), V1 fallback (`query`/`resume`), behind `SessionDriver` abstraction | Session Manager architecture, `@anthropic-ai/claude-agent-sdk` dependency |
| 5 | agent-notify.sh | Dual delivery via two `execFile` calls; 1900 char limit; non-fatal failures | Agent Bridge notification format |
| 6 | Claude Remote | Capture URL from `bridge_status` JSONL event; NOT viable for programmatic agent interaction | `sessions.remote_url` capture strategy |
| 7 | Handoff Detection | `entrypoint` field change at run boundary (primary); startup reconciliation (fallback) | Managed/unmanaged transition logic |

---

## Spec Amendments

### Data Model Changes

**New table: `sub_agents`**

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Agent ID from filename (e.g., `aeb3897ee3267e12c`) |
| session_id | TEXT FK | Parent session UUID |
| pattern | TEXT | `regular`, `compact`, `side_question` |
| agent_type | TEXT | From `.meta.json` (`Explore`, `Plan`, etc.) — NULL for compact/side_question |
| description | TEXT | From `.meta.json` |
| jsonl_path | TEXT | Absolute path to sub-agent JSONL |
| input_tokens | INTEGER | |
| output_tokens | INTEGER | |
| cache_read_tokens | INTEGER | |
| cache_create_tokens | INTEGER | |
| started_at | DATETIME | |
| ended_at | DATETIME | |

**New columns on `runs` table:**

| Column | Type | Description |
|--------|------|-------------|
| start_type | TEXT | `startup`, `resume`, `compact` — how this run began |
| remote_url | TEXT | Claude Remote URL for this specific run (may differ from previous) |
| sentinel_managed | BOOLEAN | Whether Sentinel initiated this run |

**New columns on `sessions` table:**

| Column | Type | Description |
|--------|------|-------------|
| last_entrypoint | TEXT | Most recent `entrypoint` value — for handoff comparison |

**Token fields — use 4 columns (not 3) everywhere:**

The spec's 3-column token model (`input_tokens`, `output_tokens`, `cache_hits`) should be 4 columns:
- `input_tokens` — prompt tokens (typically small due to caching)
- `output_tokens` — completion tokens
- `cache_read_tokens` — cache read input tokens (dominates in practice: 9.6M vs 163 input in a 5-turn session)
- `cache_create_tokens` — cache creation tokens

This applies to `sessions`, `runs`, `sub_agents`, and `transcript_cache`.

### Architecture Changes

**Session Manager uses SDK, not raw CLI:**
- Section 2 should clarify: "interactive sessions" are achieved via `@anthropic-ai/claude-agent-sdk` V2 API, not raw TTY/stdin management
- `SessionDriver` abstraction isolates the Manager from SDK version changes
- V1 fallback ensures stability if V2 breaks

**Session status is inferred, not stored by Claude:**
- There is no explicit status field in JSONL events
- Sentinel must maintain a status state machine driven by JSONL event signals:
  - `starting` → `SessionStart:startup` hook events
  - `active` → new `assistant` events with tool calls
  - `waiting` → `AskUserQuestion` tool_use detected, no subsequent user event
  - `idle` → no new JSONL events for 60+ seconds
  - `error` → `system:api_error` or `assistant.isApiErrorMessage`
  - `ended` → `last-prompt` event or prolonged inactivity (5+ min)

**Handoff detection via `entrypoint` field:**
- Managed sessions start with `entrypoint: sdk-cli`
- New run with `entrypoint: cli` triggers managed→unmanaged transition
- Crash recovery: reconcile on Sentinel restart

### New Constraints Discovered

1. **Claude Remote URL not available for SDK sessions.** `bridge_status` events only appear for `entrypoint: cli`. SDK V2 behavior untested — must verify in Sprint 1.

2. **Sub-agent linking only reliable via filesystem path.** `agent_progress` events only cover 47% of sub-agents. The parent session ID = conversation directory UUID.

3. **`hook_progress` events are 33% of all JSONL events.** Monitor must skip these for performance.

4. **Path encoding is lossy.** Directory names like `-home-blasi-session-sentinel` cannot be reliably decoded back to `/home/blasi/session-sentinel`. The real `cwd` must be read from event fields.

5. **Discord message limit is 2000 chars.** Sentinel must truncate notification payloads to 1900 chars.

6. **No `#sentinel-log` Discord channel exists yet.** Phase 1 routes audit notifications to the Jarvis channel. Dedicated channel is a Phase 2 task.

---

## Open Questions (deferred to Sprint 1+)

| # | Question | When to Resolve | Context |
|---|----------|----------------|---------|
| 1 | Does SDK V2 produce `bridge_status` events? | Sprint 1 sandbox | Affects Claude Remote URL capture for managed sessions |
| 2 | What is SDK V2 startup overhead vs V1? | Sprint 1 sandbox | Performance implications for Session Manager |
| 3 | Can concurrent resume cause data corruption? | Sprint 1 sandbox | Locking strategy for managed sessions |
| 4 | Mid-run user injection detection (Strategy A: promptId tracking) | Sprint 2 | Defense-in-depth for handoff detection |
| 5 | Per-project/per-session idle thresholds | Sprint 2+ | Housekeeping refinement based on real usage |

---

## Readiness Checklist

- [x] JSONL event parsing patterns documented (19 event types, priority ranking, code snippets)
- [x] Session identity and resume model validated (1 JSONL = 1 Session, multi-signal run detection)
- [x] Sub-agent detection strategy defined (filesystem path, 3 ID patterns, token rollup)
- [x] Session Manager interaction model chosen (SDK V2 primary, V1 fallback, `SessionDriver` abstraction)
- [x] Notification payload format designed (waiting + error templates, dual delivery, 1900 char limit)
- [x] Claude Remote URL capture strategy confirmed (JSONL `bridge_status`, not viable for agent interaction)
- [x] Handoff detection approach decided (`entrypoint` at run boundary + crash reconciliation)

**Sprint 0 is complete. Implementation planning for Sprint 1 can proceed.**
