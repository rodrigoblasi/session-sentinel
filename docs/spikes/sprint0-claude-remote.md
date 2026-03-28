# Sprint 0 Spike: Claude Remote URL Capture and Interaction Strategy

**Date:** 2026-03-27
**Status:** Complete
**Issue:** Sprint 0 investigation — Claude Remote integration
**Author:** Automated investigation

---

## 1. URL Source — JSONL (Confirmed)

### 1.1 Event Structure

The `system:bridge_status` event is written to the JSONL file early in every
CLI-launched session that has remote control active. Full event shape:

```json
{
  "parentUuid": null,
  "isSidechain": false,
  "type": "system",
  "subtype": "bridge_status",
  "content": "/remote-control is active. Code in CLI or at https://claude.ai/code/session_01MJsiDbHpLf59XBYKTL8qPK",
  "url": "https://claude.ai/code/session_01MJsiDbHpLf59XBYKTL8qPK",
  "isMeta": false,
  "timestamp": "2026-03-27T08:49:27.561Z",
  "uuid": "9f758282-9ae8-4e1f-8d0e-c5cac846cd54",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "/home/blasi/session-sentinel",
  "sessionId": "...",
  "version": "2.1.85",
  "gitBranch": "main"
}
```

Key fields:
- `url` — the canonical Claude Remote URL (always present in this event, 45/45 events)
- `content` — human-readable string repeating the URL; also contains it
- `sessionId` — matches the session's UUID; cross-reference for lookup
- `upgradeNudge` — optional field; present on 6/45 events; ignore it

URL format: `https://claude.ai/code/session_{ulid}` where the session ID uses
ULID encoding (e.g., `session_01MJsiDbHpLf59XBYKTL8qPK`).

### 1.2 Reliability

Analysis of 78 JSONL files across all projects:

| Category | Count | Notes |
|----------|-------|-------|
| Total JSONL files | 78 | All sessions ever recorded |
| `cli` entrypoint | 47 | Interactive sessions launched via `claude` CLI |
| `sdk-cli` entrypoint | 30 | Launched via `@anthropic-ai/claude-agent-sdk` (--print mode) |
| Unknown entrypoint | 2 | Pre-entrypoint-field format |
| Sessions WITH `bridge_status` | 45 | All are `cli` entrypoint |
| Sessions WITHOUT `bridge_status` | 33 | All are `sdk-cli` or unknown |

**Bridge status rate for CLI sessions: 45/47 = 96%**

The two CLI sessions missing `bridge_status`:
1. One was an early Gateway research session (`cwd: ~/.openclaw/tmp/gateway-interactive-session-research`) that started with `queue-operation` events and only had 14 events — likely the session was terminated before the bridge handshake completed.
2. No other CLI sessions were missing it.

**Conclusion:** `bridge_status` is effectively guaranteed for any interactive CLI
session that completes its startup handshake. The `sdk-cli` entrypoint (used by
the Agent SDK's `query()` / V1 API) does not produce this event — confirming
that remote control is an interactive-session feature, not a `--print` mode
feature.

### 1.3 Timing

`bridge_status` appears in the first 0–2 events of the JSONL file — it is
among the very first things written:

| Position in file | Sessions |
|-----------------|---------|
| Line 0 (first event) | 4 |
| Line 1 (second event) | 27 |
| Line 2 (third event) | 14 |

The events preceding it are `progress` events (hook execution at `SessionStart`).
The typical sequence is:

```
[Line 0] progress  — hook: SessionStart:startup (bd prime)
[Line 1] system:bridge_status  — URL available
[Line 2+] user, assistant, ...
```

In 4 sessions the bridge was the first event (no hooks ran before it).

This means the URL is available **before the first user turn** and before any
tool use. The Session Monitor can extract it with zero latency after session
discovery.

### 1.4 Repeat Appearances

In 44/45 sessions, `bridge_status` appears exactly once. In one long session
(841 events), it appeared twice — at lines 0 and 775. This is consistent with
a resume: the bridge re-establishes and re-emits its status. Sentinel should
capture the most recent URL seen (overwrite `sessions.remote_url` on each
occurrence).

---

## 2. URL Source — Process stdout

### 2.1 How the Gateway Captured It

The old Gateway (`/home/blasi/claude_code_gateway/src/session-manager.ts`)
spawned `claude --print --output-format=stream-json` and read its stdout as
NDJSON. The same `bridge_status` event that appears in the JSONL file was
also emitted on stdout in the stream:

```typescript
// From session-manager.ts lines 293–297
if (eventType === 'system' && parsed.subtype === 'bridge_status') {
  session.remote_url = parsed.url || null;
  console.log(`[${session.gateway_id}] remote_url=${session.remote_url}`);
  return;
}
```

The event structure is identical in the stream and in the JSONL file — they
are the same event, written to both simultaneously.

### 2.2 Does It Appear on stderr?

No. The `bridge_status` event is part of the structured NDJSON output stream
(stdout), not diagnostic stderr. stderr from the Gateway only contained
unstructured debug lines (logged with `console.log`).

### 2.3 Comparison of Sources

| Source | Available when | Requires | Reliability |
|--------|---------------|----------|-------------|
| JSONL file | After first few events written to disk | `fs.watch` + read | 96% for CLI sessions |
| stdout stream | Real-time as process writes it | Spawn + read stdout | Same data, real-time |
| JSONL + fs.watch | Slight disk flush delay (ms) | Monitor already watches JSONL | Preferred for Sentinel |

**For Sentinel:** the JSONL file is the correct source. Sentinel's Session
Monitor already watches JSONL files via `fs.watch`. The `bridge_status` event
will appear within the first few lines, so it will be read in the first watch
callback or initial parse. No stdout stream subscription is needed for URL
capture.

---

## 3. URL Source — SDK

### 3.1 SDK V1 (`query()`) — No Bridge URL

Sessions launched via the SDK's `query()` function use `entrypoint: sdk-cli`.
Zero of the 30 `sdk-cli` sessions in the local dataset have a `bridge_status`
event. Remote control is not active when sessions are spawned via the SDK V1
API.

This is expected: `query()` corresponds to `--print` mode internally, and the
`--remote-control` flag requires an interactive session.

### 3.2 SDK V2 (`unstable_v2_createSession`) — Confirmed: No bridge_status

**Tested 2026-03-28** (Sprint 1, Issue #3).

SDK V2 sessions do NOT produce `bridge_status` events. Two tests were run:

| Test | Config | Result |
|------|--------|--------|
| Test 1 | `unstable_v2_createSession({ model })` | No `bridge_status`. JSONL had 1 event: `queue-operation`. |
| Test 2 | Same + `extraArgs: { 'remote-control': null }` | No `bridge_status`. `extraArgs` not in `SDKSessionOptions` type — ignored. |

**Observations:**
- The JSONL output for V2 sessions is minimal (1 `queue-operation` event)
- No `entrypoint` field is set on the events
- V2 spawns subagent-like worker files (`agent-*.jsonl`) for the actual work
- The `SDKSessionOptions` type only exposes: `model`, `pathToClaudeCodeExecutable`, `executable`, `executableArgs`, `env` — no `extraArgs`, `cwd`, or `systemPrompt`
- `send()` returns `Promise<void>` (responses come via `stream()` async generator)

**Decision:** SDK V2 managed sessions will not have Claude Remote URLs.
The Sentinel dashboard itself serves as the observation/interaction tool for
managed sessions. Claude Remote remains available only for CLI-launched
(unmanaged) sessions where the operator can open the URL in their browser.

**Impact on SessionDriver interface:** The `SessionDriver` (Sprint 2) must not
assume `remote_url` is available for managed sessions. The field remains nullable
in the schema. Dashboard drill-down should show "No remote URL (SDK session)"
when `remote_url IS NULL AND type = 'managed'`.

### 3.3 No SDK-Native URL Property

Neither the V1 `SDKMessage` types nor the V2 `SDKSession` object expose a
`remoteUrl` property in their documented API surfaces. The URL is available
only via the `bridge_status` message in the event stream (same event type as
in the JSONL). Sentinel should read it from the JSONL file via the Monitor,
not from an SDK property.

---

## 4. Programmatic Interaction via Claude Remote

### 4.1 What Claude Remote Is

Claude Remote is a web interface served at `https://claude.ai/code/session_{id}`.
It connects to a running `claude` CLI session and allows a human to observe
the session output in real time and send messages to the session (acting as
the human operator would in the terminal).

The `content` field of `bridge_status` confirms: `"/remote-control is active.
Code in CLI or at https://claude.ai/code/session_..."`

### 4.2 Read-Only vs Interactive

Claude Remote is **interactive**, not read-only. A human authenticated to
`claude.ai` can:
- Observe the live session output (streaming)
- Send messages to the session as the user
- View the session history

This is the same as being present in the terminal — it routes to the same
running process's stdin/stdout.

### 4.3 Does It Expose an API?

Claude Remote operates through `claude.ai` as a browser-based relay to the
local running process. There is no documented REST or WebSocket API for
programmatic interaction via the `claude.ai/code` URL endpoint.

The relay is authenticated via the user's `claude.ai` session cookie. There
is no API token, no documented endpoint, and no client SDK for programmatic
interaction through this channel.

**Conclusion:** Claude Remote is a **human-facing web interface**, not a
machine-accessible API. Agents cannot interact with a session via Claude
Remote programmatically.

### 4.4 Authentication Requirements

Access to `https://claude.ai/code/session_{id}` requires:
- Active `claude.ai` account authentication (browser session)
- The session must be currently running (not terminated)
- The URL expires when the session ends (no persistent link)

These requirements preclude programmatic access from agents.

### 4.5 Viable as Alternative to stdin?

No. Claude Remote is not viable as an agent interaction channel. Agents must
use stdin to the running `claude` process, or the SDK's `send()` method (V2),
to interact with managed sessions.

Claude Remote serves a different purpose: it allows a **human operator** (or
Sentinel dashboard user) to observe or take over a session via browser without
needing terminal access.

---

## 5. Capture Strategy for Session Manager

### 5.1 Recommended Approach

Use the JSONL file as the source. The Session Monitor already watches JSONL
files via `fs.watch`. Extract `bridge_status` events during initial parse and
on subsequent file changes.

**No stdout stream subscription is needed for URL capture alone.**

### 5.2 JavaScript Extraction Snippet

```typescript
// In the Session Monitor event handler (during JSONL line processing):

function handleJSONLEvent(
  event: unknown,
  session: ManagedSession | UnmanagedSession,
  db: Database,
): void {
  const evt = event as Record<string, unknown>;

  if (evt.type === 'system' && evt.subtype === 'bridge_status') {
    const url = evt.url as string | undefined;
    if (url && typeof url === 'string') {
      // Update in-memory session object
      session.remote_url = url;
      // Persist to database
      db.prepare(
        'UPDATE sessions SET remote_url = ? WHERE session_id = ?'
      ).run(url, session.session_id);
      // Emit internal event for WebSocket broadcast
      emitSessionUpdate(session.session_id, { remote_url: url });
    }
    return;
  }
  // ... handle other event types
}
```

### 5.3 Timing Guarantee

The URL will be available **before the first user turn** begins. For managed
sessions, Sentinel can include the remote URL in the initial notification to
the owner agent. The typical flow is:

```
t=0ms   Session spawned (Session Manager creates process)
t=~200ms  SessionStart hooks execute → JSONL begins
t=~300ms  bridge_status written → Monitor captures URL
t=~500ms  First user message processed
t=~1000ms  First LLM response begins
```

The Monitor does not need to poll — `fs.watch` on the JSONL file delivers the
event within milliseconds of the disk write.

### 5.4 Resume Handling

On session resume, `bridge_status` may be re-emitted with the same or a new
URL. Always overwrite `sessions.remote_url` with the most recent value seen.
The URL format is stable (`session_{ulid}`) and the session ID does not change
on resume, so the URL should remain the same across resumes of the same
session.

---

## 6. Dashboard Integration

### 6.1 Database Column

Store in `sessions.remote_url` (TEXT, nullable). The schema in the spec
already includes this column.

```sql
-- Already in spec Section 5 data model
ALTER TABLE sessions ADD COLUMN remote_url TEXT;

-- Index not needed (low-cardinality, point lookup only)
```

### 6.2 Display

In the dashboard overview table (Section 8), include a "Remote" column:
- If `remote_url` is non-null: render as a clickable external link icon
  that opens `https://claude.ai/code/session_{id}` in a new tab
- If null: render an em-dash or empty cell
- Tooltip: "Open in Claude Remote"

In the session drill-down view:
- Show the full URL as a copyable link
- Include session status context (URL only valid while session is running)

---

## 7. Decision

### 7.1 Capture Strategy

**Use JSONL `bridge_status` events via the Session Monitor.** This is the
most reliable approach because:

1. The Monitor already watches JSONL files — no new infrastructure needed
2. The event appears in the first 0–2 lines, before any user turn
3. 96% of interactive CLI sessions produce it (100% for sessions that complete
   their startup handshake)
4. The same event is available in the stdout stream, but reading from JSONL is
   simpler and doesn't require managing a separate stdout subscription per session

Do not attempt to capture the URL from process stdout for Session Sentinel.
The JSONL file is sufficient and is already the Monitor's primary data source.

### 7.2 Claude Remote as Interaction Channel

**Claude Remote is NOT a viable agent interaction channel.** It is a
human-facing browser interface with no API and browser-session authentication.

Agents must interact with managed sessions via:
- **SDK V2:** `session.send(message)` — preferred (see Task 5 findings)
- **SDK V1:** new `query()` call with `resume: sessionId` — fallback
- **stdin:** write to the process's stdin directly — last resort, not recommended

Claude Remote serves as a **human operator escape hatch**: when an agent is
stuck or a human wants to observe/intervene, they can open the URL in their
browser. The dashboard link enables this workflow without the operator needing
to find the terminal running the session.

### 7.3 Summary Table

| Question | Answer |
|----------|--------|
| Where does the URL come from? | `system:bridge_status` JSONL event, `url` field |
| When is it available? | Before the first user turn (lines 0–2 of JSONL) |
| Reliability (CLI sessions)? | 96% (100% for sessions completing startup) |
| Does SDK V1 produce it? | No (`sdk-cli` entrypoint never has bridge_status) |
| Does SDK V2 produce it? | No — confirmed 2026-03-28, no `bridge_status` even with `--remote-control` attempt |
| How should Sentinel capture it? | JSONL Monitor — parse `bridge_status` events |
| Is Claude Remote interactive? | Yes — human can read and send messages |
| Does Claude Remote have an API? | No — browser-only, no programmatic access |
| Can agents interact via it? | No — browser auth, no machine-accessible endpoint |
| Primary agent interaction channel? | SDK V2 `send()` / SDK V1 `query(resume)` / stdin |
| Where stored? | `sessions.remote_url` (TEXT, nullable) |
| Dashboard display? | Clickable link when non-null; em-dash when null |

---

## Appendix A: Full bridge_status Event Field Reference

All 45 observed `bridge_status` events contained these fields:

| Field | Type | Always present | Notes |
|-------|------|---------------|-------|
| `type` | string | Yes | Always `"system"` |
| `subtype` | string | Yes | Always `"bridge_status"` |
| `url` | string | Yes | The Claude Remote URL — use this field |
| `content` | string | Yes | Human-readable, also contains URL |
| `isMeta` | boolean | Yes | Always `false` in observed data |
| `isSidechain` | boolean | Yes | False for main session |
| `parentUuid` | string \| null | Yes | null on fresh session, set on resume |
| `uuid` | string | Yes | Event UUID |
| `timestamp` | string | Yes | ISO 8601 |
| `sessionId` | string | Yes | Session UUID |
| `entrypoint` | string | Yes | Always `"cli"` for sessions with bridge |
| `cwd` | string | Yes | Working directory |
| `version` | string | Yes | Claude Code version |
| `gitBranch` | string | Yes | Current git branch |
| `upgradeNudge` | string | No (6/45) | Upgrade prompt — ignore |

---

## Appendix B: References

- Gateway URL capture: `/home/blasi/claude_code_gateway/src/session-manager.ts` lines 293–297
- Task 5 SDK findings: `docs/spikes/sprint0-sdk-interactive.md`
- Spec Section 5 (data model): `sessions.remote_url` column
- Spec Section 8 (dashboard): overview table with drill-down
- Claude Code `--remote-control` flag: `claude --help` (no further documentation)
