# Sprint 0 Spike: Resume & Session Identity

**Date:** 2026-03-27
**Author:** Sprint 0 investigation
**Status:** Complete
**Depends on:** Task 2 (JSONL Format Study)
**Feeds into:** Session Monitor, Session Manager, data model design

---

## 1. How Claude Code Represents Sessions in the Filesystem

### 1.1 One JSONL File per Session

Each Claude Code session is a single JSONL file:

```
~/.claude/projects/{encoded-cwd}/{uuid}.jsonl
```

- **sessionId** = the UUID in the filename
- **slug** = human-readable auto-generated name (e.g., `"scalable-hatching-music"`)
- The sessionId is immutable for the life of the file
- The slug is assigned after the first turn and does not change on resume

### 1.2 Verified Identity Invariants

Across 78 JSONL files (22,787 events):

| Property | Finding |
|---|---|
| sessionId uniqueness per file | Every file contains exactly one sessionId (Strategy 1: zero violations) |
| sessionId = filename UUID | Confirmed in all files |
| slug uniqueness across files | All 61 observed slugs are unique to a single file (Strategy 6: zero sharing) |
| slug stability on resume | Slug does not change on resume (verified in fa52c6bb: slug `scalable-hatching-music` persists across 2 runs) |

---

## 2. Resume Behavior

### 2.1 Confirmed: `--resume` Appends to the Same JSONL File

**This is the central finding.** When a session is resumed via `claude --resume` or `claude --continue`, new events are appended to the same JSONL file. The session ID does not change.

#### Evidence from CLI documentation (official)

From Claude Code docs (code.claude.com/docs/en/how-claude-code-works):

> "Resuming a session with Claude Code, using commands like `claude --continue` or `claude --resume`, allows you to pick up exactly where you left off within the same session ID. New messages are appended to the existing conversation, and the full history is restored."

> "To explore a different path without altering the original session, you can use the `--fork-session` flag. This creates a new, independent session ID while retaining the conversation history up to that point, ensuring the original session remains unaffected."

#### Evidence from `--help` flags

| Flag | Description | Implication |
|---|---|---|
| `-r, --resume [value]` | "Resume a conversation by session ID" | Reuses same session ID |
| `-c, --continue` | "Continue the most recent conversation in the current directory" | Reuses same session ID |
| `--fork-session` | "When resuming, create a new session ID instead of reusing the original (use with --resume or --continue)" | Proves default = same ID. Fork is opt-in. |
| `--session-id <uuid>` | "Use a specific session ID for the conversation" | Explicit ID control |

The existence of `--fork-session` is definitive proof: if resume already created a new file, this flag would be unnecessary.

#### Evidence from static data analysis

**3 files with strong resume evidence** (timestamp gap + multiple bridge_status or last-prompt events):

| File | Project | Gaps | bridge_status | last-prompt | SessionStart hooks |
|---|---|---|---|---|---|
| `fa52c6bb` | claude-code-gateway | 1 (2.5h) | 2 (different URLs) | 2 | 0 |
| `4e23878d` | finance.blasi | 1 (18.7h) | 1 | 2 | 4 (2 startup + 2 resume) |
| `93f9adb8` | finance.blasi | 4 (up to 10.6h) | 1 | 3 | 5 (2 startup + 2 resume + 1 compact) |

**8 files with `SessionStart:resume` hook events** (confirming resume within same file):

| File | Project | startup hooks | resume hooks | compact hooks |
|---|---|---|---|---|
| `df5c13be` | finance.blasi | 2 | 6 | 0 |
| `7d2171b6` | finance.blasi | 2 | 4 | 0 |
| `93f9adb8` | finance.blasi | 2 | 2 | 1 |
| `4e23878d` | finance.blasi | 2 | 2 | 0 |
| `2912bb4e` | finance.blasi | 2 | 2 | 0 |
| `a71a73a9` | finance.blasi | 2 | 2 | 0 |
| `172f1b6d` | finance.blasi | 1 | 1 | 1 |
| `6c664e98` | finance.blasi | 1 | 1 | 0 |

### 2.2 Resume Boundary Pattern in JSONL

From detailed analysis of fa52c6bb (the clearest example), the resume boundary looks like this:

```
[Run 1 end]
  L773  system:stop_hook_summary     (turn completion)
  L774  system:turn_duration         (turn timing)
  L775  last-prompt                  (exit breadcrumb, no timestamp)
[Run 2 start]
  L776  system:bridge_status         (NEW Remote URL)
  L777  user                         (first prompt of new run)
  L779  assistant                    (first response)
  ...
```

Key observations:
- **`last-prompt` event** marks the end of a run (written at clean session exit)
- **`system:bridge_status` event** with a new URL marks the start of a new run
- The slug remains the same across the boundary (`scalable-hatching-music`)
- The sessionId remains the same
- There is a timestamp gap between the last event of Run 1 and the bridge_status of Run 2

### 2.3 SessionStart Hook as Resume Discriminator

The `hookName` field on `SessionStart` hook_progress events distinguishes the type of session start:

| hookName | Meaning | Count in dataset |
|---|---|---|
| `SessionStart:startup` | Fresh new session | 111 |
| `SessionStart:resume` | Resumed session (`--resume` or `--continue`) | 20 |
| `SessionStart:compact` | Auto-compact or manual `/compact` triggered restart | 2 |

This is the most reliable resume detection signal because:
1. It appears at the very start of a new run
2. It explicitly labels the start type
3. It appears in pairs (one per configured hook)

**Important caveat:** SessionStart hooks only appear if the user has hooks configured. Files without hooks (like fa52c6bb from the gateway project) do not emit these events. In that case, the `system:bridge_status` event is the next best signal.

### 2.4 Bridge Status as Resume Signal

When Claude Remote is enabled, each run gets its own `system:bridge_status` event with a unique URL:

```
Run 1:  url=https://claude.ai/code/session_017k5uLJrFtacDkDw6mhrbn4
Run 2:  url=https://claude.ai/code/session_01KjorjZj4mhZVAqRVodpRV2
```

Multiple `bridge_status` events in a single file = confirmed resume. However, not all sessions have bridge_status (depends on whether Remote is enabled).

### 2.5 What Does NOT Change on Resume

| Property | Changes on resume? |
|---|---|
| sessionId | No |
| slug | No |
| JSONL file path | No |
| Session-scoped permissions | Reset (must re-approve) |
| Claude Remote URL | Yes (new URL per run) |

### 2.6 `--fork-session` Creates a New Session

The `--fork-session` flag (used with `--resume` or `--continue`) creates a new session ID:
- A new JSONL file is created with a new UUID
- Conversation history is copied up to the fork point
- The original session remains unaffected
- This is semantically a new Session, not a new Run within the same Session

### 2.7 Concurrent Resume Warning

From Claude Code docs:

> "If you attempt to resume the same session in multiple terminals simultaneously, both terminals will write to the same session file, leading to interleaved messages and a potentially jumbled conversation history."

This means Sentinel must be aware that a resumed session could have interleaved events if concurrency occurs. The recommendation is to use `--fork-session` for parallel work.

---

## 3. Run Detection Strategy for Sentinel

### 3.1 Run Boundary Signals (Priority Order)

To detect where one run ends and another begins within a single JSONL file:

| Priority | Signal | Reliability | Notes |
|---|---|---|---|
| 1 | `SessionStart:resume` hookName | High | Explicit label, but only present if hooks are configured |
| 2 | `SessionStart:compact` hookName | High | Explicit label for compact-triggered restart |
| 3 | New `system:bridge_status` event | High | New Remote URL = new run. Only present if Remote is enabled |
| 4 | `last-prompt` event followed by new events | High | `last-prompt` = clean exit; events after = new run |
| 5 | Timestamp gap > threshold | Medium | Gap alone is ambiguous (could be idle period vs. resume) |
| 6 | `SessionStart:startup` after events already exist | Medium | Indicates the file was reused (unusual) |

### 3.2 Recommended Detection Algorithm

```
For each new event appended to a JSONL file:
  1. If event is `progress/hook_progress` with hookEvent="SessionStart"
     AND hookName contains ":resume" or ":compact":
       -> Mark: new Run boundary
  2. If event is `system:bridge_status` AND this file already has a bridge_status:
       -> Mark: new Run boundary (new Remote URL)
  3. If previous event was `last-prompt` AND this event is NOT last-prompt:
       -> Mark: new Run boundary
  4. If timestamp gap from previous event > 30 minutes
     AND this event is `SessionStart` hook OR `bridge_status` OR first `user` event:
       -> Mark: probable new Run boundary (corroborate with other signals)
```

### 3.3 Run Numbering

Sentinel should assign run numbers sequentially within a session:
- Run 1 = initial session creation (SessionStart:startup)
- Run 2 = first resume (SessionStart:resume)
- Run N = Nth resume

For the initial scan of existing files, Sentinel must parse the entire JSONL to discover all run boundaries retroactively.

---

## 4. Mapping to Sentinel's Session + Runs Model

### 4.1 Concept Mapping

| Claude Code Concept | Sentinel Concept | Linking Strategy |
|---|---|---|
| JSONL file (UUID) | **Session** (`ss-*`) | `sessions.claude_session_id` = JSONL UUID. One-to-one mapping. |
| Each start/resume/compact cycle | **Run** | Detect via run boundary signals (Section 3). Each run gets a row in `runs` table. |
| `--fork-session` resume | **New Session** + **New Run** | New UUID = new JSONL = new Session. Original session unchanged. |
| slug | Session label | `sessions.label` = slug. Stable within session. |
| Claude Remote URL | Per-run attribute | `runs.remote_url` (different URL per run). Also update `sessions.remote_url` to latest. |

### 4.2 Example: Session with 3 Runs

```
Session (ss-abc123)
  claude_session_id = "93f9adb8-b272-4e3b-89b4-77c2491cca8e"
  label = "sleepy-swimming-metcalfe"

  Run 1: startup
    started_at = 2026-03-22T10:29:12Z
    ended_at   = 2026-03-22T13:05:33Z
    type       = SessionStart:startup

  Run 2: resume
    started_at = 2026-03-22T23:39:17Z
    ended_at   = 2026-03-23T01:59:03Z
    type       = SessionStart:resume

  Run 3: compact
    started_at = 2026-03-23T01:59:03Z
    ended_at   = 2026-03-23T03:53:04Z
    type       = SessionStart:compact
```

---

## 5. Impact on Data Model

### 5.1 `sessions` Table

The spec's `sessions` table is correct as-is. Key fields:

| Field | Source |
|---|---|
| `claude_session_id` | JSONL filename UUID (stable across resumes) |
| `label` | slug from JSONL events |
| `jsonl_path` | Path to the JSONL file (does not change on resume) |
| `remote_url` | Latest `system:bridge_status` URL (changes per run) |

### 5.2 `runs` Table

The spec's `runs` table needs one addition:

| Column | Type | Description |
|---|---|---|
| `start_type` | TEXT | `'startup'`, `'resume'`, or `'compact'` -- how this run was initiated |
| `remote_url` | TEXT | Claude Remote URL for this specific run |

The existing `jsonl_path` column in `runs` should point to the same JSONL file as the session (since resume appends to the same file). The column is still useful for:
- Distinguishing the JSONL range (by line number or timestamp) that belongs to this run
- Future `--fork-session` support where the path would differ

**Alternative:** Replace `jsonl_path` in `runs` with `start_line` and `end_line` (line offsets into the JSONL), since all runs share the same file.

### 5.3 Session Discovery vs. Run Discovery

| When | What Sentinel does |
|---|---|
| New JSONL file appears | Create new Session + Run 1 |
| Resume boundary detected in existing file | Create new Run (N+1) for existing Session |
| `--fork-session` creates new JSONL | Create new Session + Run 1 (independent from original) |

---

## 6. Items Requiring Manual Verification

The following items could not be fully verified from static analysis alone:

| Item | What to test | Expected result | Status |
|---|---|---|---|
| `--resume` with specific session ID | Run `claude --resume <uuid>` on a known session | New events append to same JSONL, new bridge_status appears | **Confirmed by official docs** |
| `--continue` behavior | Run `claude --continue` in a project directory | Same as --resume but picks most recent session | **Confirmed by official docs** |
| `--fork-session` behavior | Run `claude --resume <uuid> --fork-session` | New JSONL file created with new UUID | **Confirmed by official docs** |
| SessionStart hook timing | Resume a session with hooks enabled | `SessionStart:resume` hooks should fire before first prompt | **Confirmed by static data** (8 files show this pattern) |
| Concurrent resume behavior | Resume same session in two terminals | Interleaved events in JSONL | **Confirmed by official docs** (documented as problematic) |

---

## 7. Decisions

### 7.1 Primary Decision: One JSONL = One Session

**Decision:** Sentinel maps one JSONL file (one Claude session ID) to one Sentinel Session. Resumes create new Runs within the same Session.

**Rationale:**
- Claude Code's default behavior appends to the same file on resume
- The sessionId is stable across resumes (no change)
- The slug is stable across resumes (no change)
- The spec's Session + Runs model aligns perfectly with this behavior
- `--fork-session` is an explicit opt-in that creates a genuinely new session

### 7.2 Run Detection Decision

**Decision:** Use a multi-signal approach for run boundary detection (Section 3.2), with `SessionStart:resume` hook as the primary signal when available, and `bridge_status` / `last-prompt` as fallbacks.

**Rationale:**
- No single signal is universally present (hooks require configuration, bridge_status requires Remote)
- Combining signals reduces false positives from timestamp gaps alone
- The `last-prompt` -> new events pattern is reliable and does not depend on configuration

### 7.3 Data Model Addition

**Decision:** Add `start_type` column to the `runs` table (`startup` | `resume` | `compact`). Consider adding `start_line` / `end_line` columns for JSONL offset tracking instead of duplicating `jsonl_path`.

---

## 8. Scripts Produced

| Script | Purpose | Location |
|---|---|---|
| `resume-detector.mjs` | Scan all JSONL files for resume evidence across 6 strategies | `sandbox/sprint0/resume-detector.mjs` |
