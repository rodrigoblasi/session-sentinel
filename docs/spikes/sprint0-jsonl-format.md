# Sprint 0 Spike: JSONL Format Study

**Date:** 2026-03-27
**Author:** Sprint 0 investigation
**Status:** Complete
**Depends on:** Nothing (foundational investigation)
**Feeds into:** Tasks 3 (Resume), 4 (Sub-agents), 7 (Claude Remote), 8 (Handoff)

---

## 1. File Organization

### 1.1 Directory Structure

```
~/.claude/projects/
  {encoded-cwd}/                          # one directory per project working directory
    {uuid}.jsonl                          # main session transcript (one file per session)
    {uuid}/                               # companion directory (same UUID as .jsonl)
      subagents/
        agent-{agentId}.jsonl             # subagent transcript
        agent-{agentId}.meta.json         # subagent metadata (type, description)
      tool-results/
        {hash}.txt                        # stored tool output (large results)
```

### 1.2 Path Encoding

The `{encoded-cwd}` directory name is the absolute working directory path with all `/` characters replaced by `-`. Example:

| Real CWD | Encoded directory |
|---|---|
| `/home/blasi/finance.blasi/development` | `-home-blasi-finance-blasi-development` |
| `/home/blasi/.openclaw/tmp/gateway-consultation` | `-home-blasi--openclaw-tmp-gateway-consultation` |
| `/tmp` | `-tmp` |

**Warning:** The encoding is lossy (dots, underscores, and slashes all map to `-`). The real `cwd` must be read from events inside the JSONL, not decoded from the directory name.

### 1.3 Session Identity

- **sessionId** = the UUID portion of the filename (`{uuid}.jsonl`)
- **slug** = human-readable auto-generated name (e.g., `"joyful-exploring-allen"`, `"scalable-hatching-music"`)
- The slug appears on events after the first turn (not always on the very first event)
- The sessionId is consistent across the main JSONL and all subagent JSONLs within the same session

### 1.4 Subagent File Structure

Each subagent gets its own JSONL file under `{uuid}/subagents/`. Agent IDs follow these patterns:

| Pattern | Example | Description |
|---|---|---|
| `a<17-char hex>` | `aeb3897ee3267e12c` | Regular subagent (Agent tool call) |
| `acompact-<16-char hex>` | `acompact-767ece576f2b74e8` | Auto-compact subagent (context compaction) |
| `aside_question-<16-char hex>` | `aside_question-c5e5c961a7749e08` | Side-question subagent |

The `.meta.json` files contain:
```json
{"agentType": "Explore", "description": "Adversarial review of diff"}
```

Observed `agentType` values: `Explore` (78), `general-purpose` (27), `Plan` (1), `claude-code-guide` (2).

Compact subagents (`acompact-*`) have no `.meta.json` file.

---

## 2. Common Fields

These fields appear on 90%+ of all JSONL events (verified across 22,752 events, 78 sessions):

| Field | Frequency | Description |
|---|---|---|
| `type` | 100% | Event type discriminator |
| `sessionId` | 97% | Session UUID (matches filename) |
| `timestamp` | 97% | ISO 8601 timestamp |
| `parentUuid` | 95% | Parent message UUID (for threading); `null` for root events |
| `isSidechain` | 95% | `true` if this event belongs to a subagent |
| `uuid` | 95% | Unique event identifier |
| `userType` | 95% | Always `"external"` in observed data |
| `entrypoint` | 95% | `"cli"` or `"sdk-cli"` |
| `cwd` | 95% | Absolute working directory path |
| `version` | 95% | Claude Code version (e.g., `"2.1.85"`) |
| `gitBranch` | 95% | Git branch name at time of event |
| `slug` | 92% | Session slug name (appears after first turn) |

**Missing on:** `file-history-snapshot`, `last-prompt`, `custom-title`, `agent-name`, `queue-operation`, `pr-link` -- these lightweight events carry only the essential fields.

### 2.1 Subagent Event Fields

Subagent events carry two additional fields:

| Field | Description |
|---|---|
| `agentId` | Subagent identifier (e.g., `"aeb3897ee3267e12c"`) |
| `isSidechain` | Always `true` for subagent events |

The `sessionId` on subagent events points to the **parent session**, not a separate session.

---

## 3. Complete Event Type Catalog

### 3.1 Summary Table

| Event Type | Count | % | Sentinel Interest |
|---|---|---|---|
| `progress` (hook_progress) | 7,531 | 33.1% | Low -- hook execution noise |
| `assistant` | 6,106 | 26.8% | **Critical** -- tokens, tools, questions, model |
| `user` | 4,286 | 18.8% | **High** -- turn boundaries, prompts |
| `progress` (agent_progress) | 2,874 | 12.6% | **High** -- subagent activity signal |
| `file-history-snapshot` | 679 | 3.0% | Low -- file backup metadata |
| `system:stop_hook_summary` | 413 | 1.8% | **Medium** -- turn completion signal |
| `queue-operation` | 376 | 1.7% | Medium -- plan-mode queued prompts |
| `system:turn_duration` | 233 | 1.0% | **High** -- turn timing, message count |
| `system:api_error` | 99 | 0.4% | **High** -- error detection |
| `last-prompt` | 64 | 0.3% | Medium -- session resume breadcrumb |
| `system:bridge_status` | 46 | 0.2% | **Critical** -- Claude Remote URL |
| `pr-link` | 33 | 0.1% | Medium -- PR creation tracking |
| `system:compact_boundary` | 3 | 0.0% | **High** -- compaction event |
| `system:local_command` | 2 | 0.0% | Low -- local command output |
| `custom-title` | 2 | 0.0% | Medium -- session naming |
| `agent-name` | 2 | 0.0% | Medium -- session naming |
| `progress` (query_update) | 1 | 0.0% | Low -- web search progress |
| `progress` (search_results_received) | 1 | 0.0% | Low -- web search results |
| `progress` (waiting_for_task) | 1 | 0.0% | Medium -- background task wait |

### 3.2 Detailed Event Schemas

#### 3.2.1 `assistant`

The most important event type for Sentinel. Emitted for each assistant response (including streaming chunks and final responses).

```json
{
  "parentUuid": "e8915c98-...",
  "isSidechain": false,
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg_01Ui95X7...",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "thinking",
        "thinking": "",
        "signature": "Es0FCkYI..."
      },
      {
        "type": "text",
        "text": "Here is my response..."
      },
      {
        "type": "tool_use",
        "id": "toolu_0114bEtz...",
        "name": "Read",
        "input": { "file_path": "/path/to/file" },
        "caller": { "type": "direct" }
      }
    ],
    "stop_reason": "tool_use",
    "stop_sequence": null,
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 15241,
      "cache_read_input_tokens": 8811,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 0,
        "ephemeral_1h_input_tokens": 15241
      },
      "output_tokens": 55,
      "service_tier": "standard",
      "inference_geo": "not_available"
    }
  },
  "requestId": "req_011CZQ...",
  "type": "assistant",
  "uuid": "b785d3eb-...",
  "timestamp": "2026-03-25T18:26:00.371Z",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "/home/blasi/finance.blasi/development",
  "sessionId": "0ae38a42-...",
  "version": "2.1.83",
  "gitBranch": "development"
}
```

**Key fields for Sentinel:**
- `message.usage` -- token accumulation (see Section 4)
- `message.content[]` -- tool calls, text output, thinking blocks
- `message.content[].type === "tool_use"` -- tool call detection
- `message.content[].name` -- tool name (e.g., `Read`, `Bash`, `AskUserQuestion`)
- `message.model` -- which model is being used
- `message.stop_reason` -- `"end_turn"`, `"tool_use"`, or `"stop_sequence"`
- `requestId` -- API request ID for correlation
- `error` / `isApiErrorMessage` -- present on error responses

**Models observed:** `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `<synthetic>`

**Stop reasons observed:** `tool_use` (4,777), `end_turn` (753), `stop_sequence` (13)

#### 3.2.2 `user`

Emitted for each user input. Includes real user prompts, tool results, and system-injected messages.

```json
{
  "parentUuid": "65ddc2d6-...",
  "isSidechain": false,
  "type": "user",
  "message": {
    "role": "user",
    "content": "<command-message>bmad-quick-dev</command-message>\n<command-args>tech-spec.md</command-args>"
  },
  "uuid": "a6087105-...",
  "timestamp": "2026-03-25T18:25:55.972Z",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "/home/blasi/finance.blasi/development",
  "sessionId": "0ae38a42-...",
  "version": "2.1.83",
  "gitBranch": "development"
}
```

**Important discriminator fields on user events:**

| Field | Purpose |
|---|---|
| `toolUseResult` | Present when this is a tool result (not a real user prompt) |
| `sourceToolUseID` | ID of the tool_use this result responds to |
| `isCompactSummary` | `true` when this is a post-compact conversation summary |
| `isVisibleInTranscriptOnly` | `true` for transcript-only messages (not sent to API) |
| `isMeta` | Metadata message flag |
| `promptId` | Present on real user prompts (useful for turn counting) |
| `permissionMode` | Permission level: `"default"`, `"bypassPermissions"`, `"plan"`, `"dontAsk"` |
| `slug` | Session slug (appears after first turn) |

**Distinguishing real user prompts from tool results:** A real user prompt has NO `toolUseResult` and NO `sourceToolUseID`. Tool results are injected by Claude Code and have both fields set. This distinction is critical for accurate turn counting.

**Skill/command detection:** User prompts containing `<command-message>` tags indicate a slash command or skill invocation.

#### 3.2.3 `progress`

Container event type with subtypes in `data.type`. Five subtypes observed:

**`hook_progress`** (33.1% of all events -- the most common type):
```json
{
  "type": "progress",
  "data": {
    "type": "hook_progress",
    "hookEvent": "SessionStart",
    "hookName": "SessionStart:startup",
    "command": "python3 ~/.claude/hooks/live_session_tracker.py"
  },
  "parentToolUseID": "95734889-...",
  "toolUseID": "95734889-...",
  "timestamp": "2026-03-25T18:25:44.068Z",
  ...common fields...
}
```

Hook events observed: `SessionStart`, `PreToolUse:*`, `PostToolUse:*`, `Stop`.

**`agent_progress`** (12.6% -- subagent activity):
```json
{
  "type": "progress",
  "data": {
    "type": "agent_progress",
    "message": {
      "type": "user",
      "message": { "role": "user", "content": [...] }
    },
    "prompt": "Research task — read these files..."
  },
  ...common fields...
}
```

This is how subagent activity appears in the **parent session's** JSONL. The subagent's own detailed transcript is in `subagents/agent-{id}.jsonl`.

**`waiting_for_task`** (rare):
```json
{
  "type": "progress",
  "data": {
    "type": "waiting_for_task",
    "taskDescription": "Push feature branch",
    "taskType": "local_bash"
  }
}
```

**`query_update`** and **`search_results_received`** (rare -- web search):
```json
{
  "data": { "type": "query_update", "query": "Claude API down overloaded today March 2026" }
}
{
  "data": { "type": "search_results_received", "resultCount": 10, "query": "..." }
}
```

#### 3.2.4 `system:bridge_status`

Emitted when Claude Remote is activated. Contains the URL needed for dashboard links.

```json
{
  "type": "system",
  "subtype": "bridge_status",
  "content": "/remote-control is active. Code in CLI or at https://claude.ai/code/session_018cLE...",
  "url": "https://claude.ai/code/session_018cLEumEvHfaSrLVkeqeGcB",
  "upgradeNudge": "Please upgrade to the latest version...",
  "isMeta": false,
  ...common fields...
}
```

**Key field:** `url` -- the Claude Remote URL. Always appears early in the session (before the first user prompt).

#### 3.2.5 `system:stop_hook_summary`

Emitted at the end of each turn after stop hooks run.

```json
{
  "type": "system",
  "subtype": "stop_hook_summary",
  "hookCount": 2,
  "hookInfos": [
    { "command": "python3 ~/.claude/hooks/live_session_tracker.py", "durationMs": 79 },
    { "command": "~/.tmux/plugins/tmux-agent-status/hooks/better-hook.sh Stop", "durationMs": 34 }
  ],
  "hookErrors": [],
  "preventedContinuation": false,
  "stopReason": "",
  "hasOutput": false,
  "level": "suggestion",
  ...common fields...
}
```

**Sentinel use:** Reliable signal that a turn has completed. Paired with `system:turn_duration`.

#### 3.2.6 `system:turn_duration`

Emitted after each turn completes (after stop hooks).

```json
{
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 659552,
  "messageCount": 303,
  ...common fields...
}
```

**Key fields:**
- `durationMs` -- total turn duration in milliseconds
- `messageCount` -- number of API messages in the turn (includes tool calls/results)

#### 3.2.7 `system:api_error`

Emitted when the API returns an error (with retry information).

```json
{
  "type": "system",
  "subtype": "api_error",
  "level": "error",
  "error": {
    "status": 529,
    "requestID": "req_011CZT...",
    "error": {
      "type": "error",
      "error": {
        "type": "overloaded_error",
        "message": "Overloaded. https://docs.claude.com/en/api/errors"
      }
    }
  },
  "retryInMs": 553.85,
  "retryAttempt": 1,
  "maxRetries": 10,
  ...common fields...
}
```

**Sentinel use:** Detect error state. Multiple consecutive api_errors with increasing retryAttempt indicate degraded service. An api_error without subsequent recovery suggests the session may be stuck.

#### 3.2.8 `system:compact_boundary`

Emitted when conversation context is compacted (manual `/compact` or auto-compact).

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "logicalParentUuid": "7a7bf5a4-...",
  "compactMetadata": {
    "trigger": "manual",
    "preTokens": 177039,
    "preCompactDiscoveredTools": ["TaskCreate", "TaskList", "TaskUpdate", "WebFetch"]
  },
  "level": "info",
  ...common fields...
}
```

**Key fields:**
- `compactMetadata.trigger` -- `"manual"` or `"auto"`
- `compactMetadata.preTokens` -- token count before compaction
- `logicalParentUuid` -- last message UUID before compaction (the conversation thread breaks here)

#### 3.2.9 `system:local_command`

Emitted when a local command runs (e.g., plugin reload).

```json
{
  "type": "system",
  "subtype": "local_command",
  "content": "<local-command-stdout>Reloaded: 2 plugins ...</local-command-stdout>",
  "level": "info",
  ...common fields...
}
```

#### 3.2.10 `file-history-snapshot`

Records file backup checkpoints. No common fields beyond `type`.

```json
{
  "type": "file-history-snapshot",
  "messageId": "a6087105-...",
  "snapshot": {
    "messageId": "a6087105-...",
    "trackedFileBackups": {},
    "timestamp": "2026-03-25T18:25:56.106Z"
  },
  "isSnapshotUpdate": false
}
```

**Sentinel use:** Low priority. `trackedFileBackups` is usually empty in observed data. The presence of snapshots indicates active file editing.

#### 3.2.11 `queue-operation`

Plan-mode queue operations (enqueue/dequeue prompts).

```json
{
  "type": "queue-operation",
  "operation": "enqueue",
  "content": "the queued prompt text...",
  "timestamp": "2026-03-27T08:55:12.172Z",
  "sessionId": "fa52c6bb-..."
}
```

**Sentinel use:** Indicates plan-mode usage. `operation: "enqueue"` means a prompt was queued; presence of these events means the session is in plan mode.

#### 3.2.12 `last-prompt`

Written at session end. Records the last user prompt for resume context.

```json
{
  "type": "last-prompt",
  "lastPrompt": "the last user prompt text...",
  "sessionId": "0ae38a42-..."
}
```

**Sentinel use:** Only 3 fields (type, lastPrompt, sessionId). Indicates the session wrote its exit breadcrumb. Useful for resume detection -- a new session that starts where this one left off is a resume.

#### 3.2.13 `pr-link`

Written when a PR is created during the session.

```json
{
  "type": "pr-link",
  "sessionId": "0c47fcf6-...",
  "prNumber": 181,
  "prUrl": "https://github.com/rodrigoblasi/finance.blasi/pull/181",
  "prRepository": "rodrigoblasi/finance.blasi",
  "timestamp": "2026-03-23T04:21:48.109Z"
}
```

**Sentinel use:** Track PRs created by sessions for reporting.

#### 3.2.14 `custom-title` and `agent-name`

Session naming events. Minimal fields.

```json
{"type": "custom-title", "customTitle": "rename-enrichment-landscape-docs", "sessionId": "26ad1495-..."}
{"type": "agent-name", "agentName": "rename-enrichment-landscape-docs", "sessionId": "26ad1495-..."}
```

**Sentinel use:** Override the auto-generated slug with a human-assigned name. `agent-name` appears to be set when sessions are spawned by the Agent tool.

### 3.3 Event Types in Karma but NOT in Observed Data

| Type | Notes |
|---|---|
| `summary` (SessionTitleMessage) | Karma parses `{"type": "summary", "summary": "...", "leafUuid": "..."}`. Not found in any local JSONL. May be environment-specific or a newer/older version feature. |
| `result` | Gateway code handles `result` events from the streaming protocol, but these are NOT persisted in JSONL files. |

---

## 4. Token Accumulation Strategy

### 4.1 Where Tokens Come From

Tokens are in `assistant` events at `message.usage`:

```json
{
  "input_tokens": 3,
  "output_tokens": 55,
  "cache_read_input_tokens": 8811,
  "cache_creation_input_tokens": 15241,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 15241
  },
  "service_tier": "standard",
  "inference_geo": "not_available"
}
```

### 4.2 Accumulation Rules

For a complete session:

```
total_input  = SUM(assistant.message.usage.input_tokens)
total_output = SUM(assistant.message.usage.output_tokens)
total_cache_read = SUM(assistant.message.usage.cache_read_input_tokens)
total_cache_create = SUM(assistant.message.usage.cache_creation_input_tokens)
```

**Important observations from real data:**

1. `input_tokens` is very small (typically single digits per assistant event) because most input comes from cache
2. `cache_read_input_tokens` dominates -- often 100,000+ per event
3. `cache_creation_input_tokens` grows when new context is added (first turn, new files read, etc.)
4. `output_tokens` is the main cost driver alongside cache creation

**Example from a 5-turn session (0ae38a42):**
- Input tokens: 163
- Output tokens: 34,939
- Cache read: 9,695,613
- Cache creation: 657,641

### 4.3 Per-Turn vs Per-Session

For per-turn tracking, accumulate between consecutive non-tool-result `user` events. Each `assistant` event's `message.usage` is additive (not cumulative -- each event reports its own usage, not running totals).

### 4.4 Subagent Tokens

Subagent tokens are in their own JSONL files (`subagents/agent-*.jsonl`). They are NOT included in the main session JSONL's assistant events. To get total session token cost, sum tokens from both the main JSONL and all subagent JSONLs.

The parent session does see `progress/agent_progress` events that indicate subagent activity, but these do NOT contain token usage.

---

## 5. Status Inference

### 5.1 Status State Machine

Sentinel must infer session status from JSONL events and file modification time. There is no explicit "status" field.

| Status | Signal | How to detect |
|---|---|---|
| **starting** | `progress/hook_progress` with `hookEvent: "SessionStart"` | First events in file, before any `user` or `assistant` |
| **active** | `assistant` events appearing | File is growing with new `assistant` events |
| **waiting** | `AskUserQuestion` tool call | `assistant.message.content[].type === "tool_use"` AND `name === "AskUserQuestion"` or `"AskFollowupQuestions"` |
| **idle** | No new events, file not growing | `mtime` older than threshold (e.g., 60s) but no end signal |
| **error** | `system:api_error` | `system.subtype === "api_error"`, especially repeated errors |
| **turn_complete** | `system:stop_hook_summary` + `system:turn_duration` | These two events always appear together at the end of a turn |
| **ended** | `last-prompt` event | Written at clean session end. Or: file not modified for extended period |
| **compacted** | `system:compact_boundary` | Not a terminal state -- session continues after compaction |

### 5.2 Turn Completion Sequence

The end of every turn follows this exact pattern:

```
assistant (final response, stop_reason: "end_turn")
  -> file-history-snapshot (optional, only if files were modified)
  -> system:stop_hook_summary (hook execution report)
  -> system:turn_duration (timing + message count)
```

When `stop_reason === "tool_use"`, the assistant is calling a tool and the turn continues (no stop_hook_summary until the full turn ends).

### 5.3 Question Detection (Waiting State)

```javascript
// In an assistant event:
for (const block of event.message.content) {
  if (block.type === "tool_use" &&
      (block.name === "AskUserQuestion" || block.name === "AskFollowupQuestions")) {
    const question = block.input?.question
      || block.input?.questions?.[0]?.question
      || block.input?.text
      || "(question)";
    // Session is now WAITING
  }
}
```

The `AskUserQuestion` tool has structured question format:
```json
{
  "name": "AskUserQuestion",
  "input": {
    "questions": [{
      "question": "What mode do you want?",
      "header": "Mode",
      "options": [
        { "label": "Option A", "description": "..." },
        { "label": "Option B", "description": "..." }
      ],
      "multiSelect": false
    }]
  }
}
```

### 5.4 Error Detection

Two error signals:

1. **`system:api_error`** -- API-level errors (overload, rate limit, etc.)
   - Has `retryAttempt` and `maxRetries` -- Claude Code retries automatically
   - If retries exhaust without recovery, the session may stall
   - Sentinel should flag persistent api_errors (e.g., 3+ consecutive with increasing retryAttempt)

2. **`assistant` with `error` field** -- Response-level errors
   - `isApiErrorMessage: true` on the assistant event
   - The `error` field contains the error details

### 5.5 File Modification Time as Status Signal

Since there is no explicit "session ended" event in all cases, Sentinel must also monitor `mtime`:

- File growing (mtime changing) = session is active or in-progress
- File not modified for 30-60s after last `assistant` event = likely idle (between turns)
- File not modified for 5+ minutes with no `system:turn_duration` = likely ended or stuck
- `last-prompt` event present = confirmed session ended cleanly

---

## 6. Tool Call Detection

### 6.1 Pattern

Tool calls are in `assistant.message.content[]` blocks:

```javascript
for (const block of event.message.content) {
  if (block.type === "tool_use") {
    // block.name = tool name (e.g., "Read", "Bash", "Edit")
    // block.id = tool_use ID (e.g., "toolu_0114bEtz...")
    // block.input = tool parameters
    // block.caller.type = "direct" or other
  }
}
```

### 6.2 Special Tools

| Tool Name | Sentinel Significance |
|---|---|
| `AskUserQuestion` / `AskFollowupQuestions` | Triggers WAITING state + notification |
| `Agent` | Spawns a subagent -- look for corresponding `subagents/` JSONL |
| `Skill` | Invokes a skill/plugin -- `block.input.skill` has the skill name |
| `Bash` | Command execution |
| `Read` / `Write` / `Edit` | File operations |
| `Glob` / `Grep` | Search operations |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Task management |
| `WebSearch` / `WebFetch` | Web access |

### 6.3 Tool Results

Tool results appear as `user` events with `toolUseResult` field set and `sourceToolUseID` pointing back to the original `tool_use` block. These are NOT real user prompts.

---

## 7. Resume and Session Continuity

### 7.1 Resume Signals

When a session is resumed:
1. A new set of `progress/hook_progress` events with `hookEvent: "SessionStart"` appears
2. A new `system:bridge_status` event may appear (new Remote URL)
3. A new `user` event with the resume prompt appears
4. The `parentUuid` on the first new event after resume may be `null` (fresh context) or point to a `compact_boundary`

### 7.2 Compact Boundary as Resume Marker

When a session is resumed with `/compact` or auto-compact:
- `system:compact_boundary` event marks the break point
- `logicalParentUuid` points to the last message before compaction
- After the boundary, `parentUuid` references change (new context chain)

### 7.3 last-prompt as End Marker

A `last-prompt` event at the end of a JSONL indicates a clean session exit. A session that has `last-prompt` followed by new events was resumed.

---

## 8. Decisions for Session Monitor Implementation

### 8.1 File Discovery

Use `fs.watch` on `~/.claude/projects/` (recursive). Watch for:
- New `.jsonl` files = new session
- `.jsonl` file growth = session activity
- New files in `subagents/` = subagent spawned

### 8.2 Event Parsing Priority

When tailing a JSONL file, Sentinel should focus on these event types (in order of priority):

1. `assistant` -- tokens, tools, questions, status
2. `system:bridge_status` -- Remote URL
3. `system:api_error` -- error state
4. `system:turn_duration` -- turn completion
5. `system:stop_hook_summary` -- turn completion confirmation
6. `system:compact_boundary` -- compaction tracking
7. `user` (non-tool-result) -- turn start, prompt tracking
8. `progress/agent_progress` -- subagent activity
9. `last-prompt` -- session end marker
10. `pr-link` -- PR tracking

Ignore: `progress/hook_progress` (noise), `file-history-snapshot` (low value), `queue-operation` (plan-mode detail).

### 8.3 Token Tracking

- Accumulate from `assistant.message.usage` only
- Track: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
- For total cost, also scan `subagents/*.jsonl` files
- Do not double-count: `progress/agent_progress` in the parent has no tokens

### 8.4 Turn Counting

A "turn" = one real user prompt + all assistant responses until the next user prompt.

- Count `user` events where `toolUseResult` is absent and `sourceToolUseID` is absent
- This excludes tool results, system injections, and compact summaries
- `isCompactSummary: true` user events should also be excluded from turn count

### 8.5 Subagent Detection

Two approaches (use both):
1. **In parent JSONL:** Look for `progress/agent_progress` events and `Agent` tool calls in `assistant` events
2. **On filesystem:** Watch `{uuid}/subagents/` for new `.jsonl` files
3. **In subagent JSONL:** All events have `isSidechain: true` and `agentId` set

### 8.6 Sidechain Filtering

When computing main session metrics, filter out events where `isSidechain === true`. These belong to subagents and should be tracked separately.

In the main session JSONL, sidechain events are rare (they appear mostly in subagent JSONLs). But in subagent JSONLs, ALL events have `isSidechain: true`.

### 8.7 entrypoint Significance

| Value | Meaning |
|---|---|
| `cli` | Standard `claude` CLI session |
| `sdk-cli` | Session spawned via Claude Code SDK |

Sentinel should track `entrypoint` to distinguish user-initiated from programmatic sessions.

---

## 9. Surprises and Edge Cases

1. **No `result` events in JSONL.** The Gateway code handles `result` events, but these come from the streaming protocol and are never persisted in JSONL files.

2. **No `summary` events found.** Karma's code parses `type: "summary"` (SessionTitleMessage), but none were found in 198 JSONL files across 10 projects. May be version-dependent or require specific conditions.

3. **Subagent JSONL location.** Subagent transcripts are NOT in the main JSONL. They're in separate files under `{uuid}/subagents/`. The main JSONL only gets `progress/agent_progress` events showing subagent activity summaries.

4. **Compact subagents.** Auto-compact creates a special subagent (`acompact-*`) with its own JSONL but no `.meta.json`. These have hundreds of events (the compacted context processing).

5. **`input_tokens` is misleadingly small.** Because of prompt caching, `input_tokens` is typically single-digit. The real input cost is in `cache_read_input_tokens` + `cache_creation_input_tokens`.

6. **`hook_progress` dominates.** 33% of all events are hook progress. With 2 hooks per tool call and many tool calls per turn, these pile up fast. Sentinel should skip them during tailing for performance.

7. **`file-history-snapshot` has no common fields.** Unlike all other events, it lacks `uuid`, `timestamp`, `sessionId`, etc. at the top level. The timestamp is nested in `snapshot.timestamp`.

8. **`permissionMode` on user events.** Values `"bypassPermissions"` and `"dontAsk"` indicate the session runs with reduced permission prompts. Value `"plan"` indicates plan-mode.

9. **Path encoding is NOT reversible.** The directory name `-home-blasi-finance-blasi-development` could be `/home/blasi/finance.blasi/development` or `/home/blasi/finance-blasi/development`. Always read `cwd` from events, never decode from path.

10. **`tool-results/` directory.** Sessions can have a `tool-results/` directory with stored tool output files. These are large results that would bloat the JSONL. Sentinel does not need to read these.

---

## 10. Scripts Produced

| Script | Purpose | Location |
|---|---|---|
| `jsonl-event-catalog.mjs` | Scan all JSONL files, catalog event types | `sandbox/sprint0/jsonl-event-catalog.mjs` |
| `token-extractor.mjs` | Parse single JSONL, extract per-turn tokens/tools/questions | `sandbox/sprint0/token-extractor.mjs` |
| `event-catalog-output.txt` | Catalog output from all 78 sessions (22,752 events) | `sandbox/sprint0/event-catalog-output.txt` |
