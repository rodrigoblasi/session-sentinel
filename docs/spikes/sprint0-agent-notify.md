# Sprint 0: agent-notify.sh Review

**Date:** 2026-03-27
**Spec ref:** Section 6 (Notification Model), Section 11.4 (Sprint 0 investigation)
**Script path:** `/home/blasi/.openclaw/scripts/agent-notify.sh`

---

## 1. Script Interface

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `[message]` | positional arg | — | Message text (required unless using `--file` or stdin pipe) |
| `--agent` | `jarvis\|mars\|moon` | `jarvis` | Target agent (controls which Discord channel) |
| `--title` | string | — | Bold title prepended to message body, on its own line |
| `--tag` | string | — | Short prefix tag rendered as `**[TAG]**` at start of message |
| `--source` | string | — | Source identifier appended as italic footer `— via SOURCE` |
| `--file` | path | — | Read message body from file (alternative to positional arg) |
| `--json` | flag | false | Output JSON result `{"ok": true/false, "agent": ..., "channel": ..., "msg_id": ...}` instead of human text |
| `--dry-run` | flag | false | Print payload without sending to Discord |

### Input modes (mutually exclusive, in priority order)

1. Positional argument: `agent-notify.sh "message text" [options]`
2. `--file` option: `agent-notify.sh --file /tmp/report.txt [options]`
3. Stdin pipe: `echo "message" | agent-notify.sh [options]`

### Agent → channel mapping

| Agent | Channel name | Channel ID |
|-------|-------------|------------|
| `jarvis` | `#jarvis` | `1482916867902410782` |
| `mars` | `#mars` | `1480666426376458292` |
| `moon` | `#moon` | `1480666429585096858` |

All three channels are in guild `1480557182926848091` (Malibu Workshop Discord server).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSHOP_BOT_TOKEN` | required (from `~/.openclaw/.env`) | Discord bot token for `workshop_helper` |
| `AGENT_NOTIFY_LOG` | `/tmp/agent-notify.log` | Path for activity log |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Message sent successfully (or dry-run completed) |
| `1` | Error: no message, invalid agent, or Discord send failed |

---

## 2. Discord Message Format

The script builds a **plain-text Discord message** using Discord's markdown formatting. There are no embed objects or structured payloads — just a `content` string in the POST body.

### Format assembly

```
**[TAG]** **TITLE**
MESSAGE BODY
_— via SOURCE_
```

- `**[TAG]**` — bold bracket tag, prepended when `--tag` is set
- `**TITLE**` — bold title on its own line (newline added after), when `--title` is set
- `MESSAGE BODY` — raw message text, inline after tag/title
- `_— via SOURCE_` — italic footer on its own line (newline before), when `--source` is set

The `\n` sequences in the shell template are converted to real newlines via `printf '%b'` before JSON encoding.

### JSON encoding

Python3 is used to produce safe JSON: `json.dumps({'content': message_string})`. Unicode characters are escaped (e.g., the em-dash `—` becomes `\u2014` in the JSON).

### Discord API call

```
POST https://discord.com/api/v10/channels/{CHANNEL_ID}/messages
Authorization: Bot {WORKSHOP_BOT_TOKEN}
Content-Type: application/json
Body: {"content": "...formatted message..."}
```

### Message length limit

The script has **no built-in length truncation**. The Discord API maximum for `content` is **2000 characters**. Sentinel must truncate before calling the script if message components could exceed this limit.

In practice:
- The structural overhead (tag, title, source footer) takes ~50 characters
- Sentinel should budget **1900 characters** for the variable content (pending question, error message)
- Truncate with a `…` suffix if content exceeds the budget

### Error handling

- Curl uses `-sf` (silent + fail on HTTP errors) but with `|| true` to prevent immediate exit
- The script checks for a `msg_id` in the response to detect success
- On failure: logs to `AGENT_NOTIFY_LOG`, prints error to stderr, exits 1
- No retry logic — single attempt only

---

## 3. Dry-run Output

### Full parameter test (waiting notification scenario)

```
$ /home/blasi/.openclaw/scripts/agent-notify.sh \
  "Test notification from Session Sentinel" \
  --agent jarvis \
  --tag SENTINEL \
  --title "Session Waiting" \
  --source session-sentinel \
  --dry-run

=== DRY RUN ===
Agent:   jarvis
Channel: 1482916867902410782
Payload: {"content": "**[SENTINEL]** **Session Waiting**\nTest notification from Session Sentinel\n_\u2014 via session-sentinel_"}
```

### Minimal test (--json + no --agent)

```
$ /home/blasi/.openclaw/scripts/agent-notify.sh \
  "Test" \
  --tag SENTINEL \
  --dry-run \
  --json

⚠️  agent-notify.sh: --agent not specified, defaulting to 'jarvis'. If you are moon or mars, use --agent moon or --agent mars.
=== DRY RUN ===
Agent:   jarvis
Channel: 1482916867902410782
Payload: {"content": "**[SENTINEL]** Test"}
```

**Note:** The `--json` flag has no effect during `--dry-run`. The dry-run block exits before the JSON output logic runs. `--json` only applies to real sends.

### Pipe input test (error notification scenario)

```
$ echo "Piped message test" | /home/blasi/.openclaw/scripts/agent-notify.sh \
  --agent moon \
  --tag SENTINEL \
  --title "Error Detected" \
  --source session-sentinel \
  --dry-run

=== DRY RUN ===
Agent:   moon
Channel: 1480666429585096858
Payload: {"content": "**[SENTINEL]** **Error Detected**\nPiped message test\n_\u2014 via session-sentinel_"}
```

---

## 4. Sentinel Integration Plan

### 4.1 Calling convention from Node.js

Use `child_process.execFile` — not `exec` — to avoid shell injection risk when passing session data as arguments.

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const AGENT_NOTIFY = '/home/blasi/.openclaw/scripts/agent-notify.sh';

interface NotifyOptions {
  agent: 'jarvis' | 'mars' | 'moon';
  tag: string;
  title: string;
  source: string;
}

async function notify(message: string, opts: NotifyOptions): Promise<void> {
  const args = [
    message,
    '--agent', opts.agent,
    '--tag', opts.tag,
    '--title', opts.title,
    '--source', opts.source,
  ];

  try {
    await execFileAsync(AGENT_NOTIFY, args, { timeout: 10_000 });
  } catch (err) {
    // log to OpenTelemetry / SQLite notifications table, do not throw
    // notifications are best-effort — session lifecycle continues regardless
  }
}
```

**Important:** notifications are fire-and-forget from the session lifecycle perspective. A failed notification must never block session state transitions.

### 4.2 Notification templates

#### Waiting notification

Triggered when: `session.status` transitions to `waiting` (AskUserQuestion detected in JSONL).

Fields:
- `session_id` — Sentinel ID (e.g., `ss-abc123`)
- `label` — human-readable session label
- `project` — project name
- `branch` — git branch
- `pending_question` — truncated to 300 characters with `…` if longer
- `waiting_since` — ISO timestamp of when status entered `waiting`
- `owner` — agent name
- `api_url` — `GET http://localhost:3000/sessions/{id}`

**Message body (template):**

```
session: ss-abc123 (feat/auth)
project: wow-bot | branch: feat/auth-rework
status: waiting since 2026-03-27T14:32:00Z

question: Should I proceed with dropping the legacy column, or keep it for backward compatibility? The migration is ready but this is destructive…

owner: jarvis
details: GET http://localhost:3000/sessions/ss-abc123
```

**Shell call:**

```typescript
const message = [
  `session: ${session.id} (${session.label})`,
  `project: ${session.project_name} | branch: ${session.git_branch}`,
  `status: waiting since ${session.waiting_since}`,
  ``,
  `question: ${truncate(session.pending_question, 300)}`,
  ``,
  `owner: ${session.owner}`,
  `details: GET http://localhost:3000/sessions/${session.id}`,
].join('\n');

await notify(message, {
  agent: session.owner as AgentName,
  tag: 'SENTINEL',
  title: 'Session Waiting',
  source: 'session-sentinel',
});
```

**Rendered Discord message:**

```
**[SENTINEL]** **Session Waiting**
session: ss-abc123 (feat/auth)
project: wow-bot | branch: feat/auth-rework
status: waiting since 2026-03-27T14:32:00Z

question: Should I proceed with dropping the legacy column...

owner: jarvis
details: GET http://localhost:3000/sessions/ss-abc123
— via session-sentinel
```

---

#### Error notification

Triggered when: `session.status` transitions to `error`.

Fields:
- `session_id`, `label`, `project`, `branch`
- `error_message` — truncated to 300 characters
- `owner`
- `api_url`

**Message body (template):**

```
session: ss-abc123 (feat/auth)
project: wow-bot | branch: feat/auth-rework
status: error

error: ENOENT: no such file or directory, open '/home/blasi/wow-bot/src/auth/legacy.ts'…

owner: jarvis
details: GET http://localhost:3000/sessions/ss-abc123
```

**Shell call:**

```typescript
const message = [
  `session: ${session.id} (${session.label})`,
  `project: ${session.project_name} | branch: ${session.git_branch}`,
  `status: error`,
  ``,
  `error: ${truncate(session.error_message, 300)}`,
  ``,
  `owner: ${session.owner}`,
  `details: GET http://localhost:3000/sessions/${session.id}`,
].join('\n');

await notify(message, {
  agent: session.owner as AgentName,
  tag: 'SENTINEL',
  title: 'Session Error',
  source: 'session-sentinel',
});
```

### 4.3 Truncation helper

```typescript
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
```

---

## 5. Dual Delivery Implementation

### Current state of sentinel-log channel

The `#sentinel-log` channel does **not exist** in the current agent-notify.sh configuration. The script only supports three targets: `jarvis`, `mars`, `moon`. There is no `sentinel-log` entry in `AGENT_CHANNELS`.

### Options for dual delivery

**Option A: Call the script twice (recommended for Phase 1)**

Sentinel calls `agent-notify.sh` twice per notification event:
1. Once with `--agent {owner}` (wakes up the responsible agent)
2. Once with `--agent jarvis` (as the operator/log channel, until sentinel-log exists)

Two independent `execFile` calls, both fire-and-forget. Failure of one does not block the other. Both results are logged to the `notifications` SQLite table with their respective `destination` field.

```typescript
async function notifyDual(
  message: string,
  opts: NotifyOptions,
  sentinelLogAgent: AgentName = 'jarvis'
): Promise<void> {
  // Deliver to owner's thread
  const ownerDelivery = notify(message, opts);

  // Deliver to sentinel-log (currently routed to operator's agent)
  const logDelivery = notify(message, {
    ...opts,
    agent: sentinelLogAgent,
    title: `[LOG] ${opts.title}`,
  });

  await Promise.allSettled([ownerDelivery, logDelivery]);
}
```

**Option B: Add sentinel-log to agent-notify.sh**

Add a `sentinel-log` entry to the `AGENT_CHANNELS` array in the script, pointing to a dedicated Discord channel. This requires:
1. Creating a `#sentinel-log` channel in the Malibu Workshop Discord server
2. Adding the channel ID to the script
3. Ensuring the `workshop_helper` bot has permission to post there

This is cleaner long-term but requires Discord server configuration. Recommend as a follow-up task after Phase 1 is working.

### Recommendation

**Use Option A for Phase 1.** Route audit copy to Jarvis channel (the operator's primary agent). Create a dedicated sentinel-log channel and update the script as a follow-up task before Phase 2.

The dual delivery is always two sequential-but-independent `execFile` calls. The `notifications` table records each delivery separately with `destination: 'owner'` or `destination: 'sentinel-log'`.

---

## 6. Limitations and Considerations

### Rate limits

The Discord API enforces a global rate limit of 50 requests per second and per-channel limits. With 50-100 sessions/day, Sentinel will never approach this limit. No rate-limiting logic needed in Phase 1.

However, if notification storms occur (e.g., many sessions erroring simultaneously), add a simple per-channel queue with a 200ms delay between sends.

### Error handling

- The script has no retry logic. A single Discord API timeout or 5xx response causes exit 1.
- Sentinel must treat all notification failures as non-fatal. Log the failure to SQLite (`notifications.delivered = false`) and OpenTelemetry, then continue.
- Do not re-notify on a subsequent JSONL event for the same waiting state. Once a waiting notification is sent for session X, do not send another until the session transitions out of `waiting` and back in.

### Message truncation

- Discord maximum `content` length: **2000 characters**
- Script structural overhead (`**[SENTINEL]** **Session Waiting**\n...\n_— via session-sentinel_`): ~60 characters
- Safe budget for message body: **1900 characters**
- Sentinel truncates `pending_question` and `error_message` at **300 characters** in the message body, which leaves ~1600 characters headroom for session metadata lines
- For the full question text, the agent should call `GET /sessions/:id` which returns the complete `pending_question` field

### --json flag behavior with --dry-run

The `--json` flag is ignored when `--dry-run` is active. The dry-run exit path runs before the output format selection. This is fine for Sentinel — in production, `--json` is not needed because `execFile` captures stdout and the exit code signals success/failure.

### No multi-target support per invocation

The script targets exactly one agent per call. Dual delivery always requires two invocations.

### Default agent warning

When `--agent` is omitted, the script prints a warning to stderr: `⚠️ agent-notify.sh: --agent not specified, defaulting to 'jarvis'`. Sentinel must always pass `--agent` explicitly to suppress this warning noise in logs.

---

## 7. Decision: How Agent Bridge Will Call agent-notify.sh

**Calling convention:** `execFile` with explicit `--agent`, `--tag SENTINEL`, `--title`, `--source session-sentinel`. Never omit `--agent`.

**Notification triggers:** `waiting` and `error` status transitions only. Housekeeping kills are silent (no notification). One notification per state entry — no re-notification while the session stays in the same status.

**Dual delivery:** Two `execFile` calls via `Promise.allSettled`. First call targets the session owner. Second call targets the audit destination (Jarvis channel for Phase 1, dedicated sentinel-log channel when created).

**Failure handling:** All notification failures are non-fatal. Logged to SQLite `notifications` table (`delivered: false`) and as an OpenTelemetry span event. Session lifecycle continues regardless.

**Message length:** Truncate `pending_question` and `error_message` at 300 characters before passing to the script. Total message body budget: 1900 characters.

**sentinel-log channel:** Does not exist yet. Phase 1 routes audit copy to Jarvis (operator's agent). Creating a dedicated `#sentinel-log` channel and adding it to agent-notify.sh is a follow-up task for Phase 2 setup.
