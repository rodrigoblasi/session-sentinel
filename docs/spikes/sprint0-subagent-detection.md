# Sprint 0 Spike: Sub-agent Detection and Linking Strategy

**Date:** 2026-03-27
**Author:** Sprint 0 investigation
**Status:** Complete
**Depends on:** Task 2 (JSONL Format Study)
**Feeds into:** Session Monitor implementation, data model design

---

## 1. File Structure

### 1.1 Exact Filesystem Layout

```
~/.claude/projects/
  {encoded-cwd}/                          # project directory (one per working directory)
    {conv-uuid}.jsonl                     # parent session transcript
    {conv-uuid}/                          # companion directory (same UUID as .jsonl)
      subagents/
        agent-{agentId}.jsonl             # sub-agent transcript
        agent-{agentId}.meta.json         # sub-agent metadata (not always present)
      tool-results/
        {hash}.txt                        # stored tool output (large results)
```

**Key facts:**
- The sub-agent directory lives inside `{conv-uuid}/subagents/`, where `{conv-uuid}` is the same UUID as the parent JSONL file.
- The parent-child relationship is **entirely filesystem-path-based**: the `{conv-uuid}` directory IS the parent.
- The `agentId` in the sub-agent filename does NOT include the `"agent-"` prefix. The filename format is `agent-{agentId}.jsonl`, so the agentId is everything after `"agent-"`.
- Each sub-agent has its own JSONL file. Sub-agent events are NOT written to the parent JSONL.

### 1.2 Coverage from Scanner

Corpus scanned: all of `~/.claude/projects/` (10 project directories).

| Metric | Value |
|---|---|
| Conversations with sub-agents | 40 |
| Total sub-agent JSONL files | 127 |
| Sub-agents with `.meta.json` | 114 |
| Sub-agents without `.meta.json` | 13 (all compact and side_question) |

---

## 2. Meta File Schema

### 2.1 Schema

The `.meta.json` file contains exactly two fields:

```json
{
  "agentType": "Explore",
  "description": "Adversarial review of diff"
}
```

| Field | Type | Description |
|---|---|---|
| `agentType` | string | Type/role of the sub-agent. Comes from `Agent` tool's `subagent_type` input field. |
| `description` | string | Human-readable description of the sub-agent's task. Matches `Agent` tool's `description` input field. |

### 2.2 agentType Values Observed

| Value | Count | Notes |
|---|---|---|
| `Explore` | 78 | Read-only research/exploration agent |
| `general-purpose` | 32 | General task agent |
| `claude-code-guide` | 2 | Claude Code documentation helper |
| `Plan` | 1 | Planning/design agent |
| `superpowers:code-reviewer` | 1 | Specialized skill-based reviewer |

### 2.3 Which Sub-agents Have No Meta

Compact (`acompact-*`) and side_question (`aside_question-*`) sub-agents have **no `.meta.json`**. This is consistent across all 13 observed cases. These sub-agent types are not spawned by an explicit `Agent` tool call with a description.

---

## 3. Sub-agent JSONL Structure

### 3.1 Event Structure

Sub-agent JSONL files use the **same event types** as parent JSONL files. There is no separate schema. The key differences are two additional fields on every event:

| Field | Value | Present In |
|---|---|---|
| `isSidechain` | Always `true` | All sub-agent events |
| `agentId` | The sub-agent's ID (e.g., `"a7d41ee5dab91e6cf"`) | All sub-agent events |

### 3.2 Session Identity in Sub-agent Events

**Critical finding:** Sub-agent events use the **parent session's UUID** as `sessionId`.

```json
{
  "sessionId": "fa52c6bb-b1a7-44b3-8ff1-75292056294d",  // ← parent session UUID
  "agentId": "a7d41ee5dab91e6cf",                        // ← this agent's own ID
  "isSidechain": true,
  ...
}
```

Verification: 127 / 127 sub-agent files had `sessionId == convUuid` (the parent conversation UUID). Sub-agents share the parent's `sessionId`, `slug`, `cwd`, and `entrypoint`. They do NOT have their own `sessionId`.

### 3.3 Event Type Distribution in Sub-agent Files

Observed across all 127 sub-agent JSONL files (total ~19,000 events):

| Event Type | Count | % |
|---|---|---|
| `progress` (hook_progress) | 8,835 | ~45% |
| `assistant` | 5,716 | ~30% |
| `user` | 4,033 | ~21% |
| `system/stop_hook_summary` | 223 | ~1% |
| `system/api_error` | 92 | ~0.5% |
| `system/turn_duration` | 89 | ~0.5% |
| `system/bridge_status` | 14 | ~0.1% |
| `system/compact_boundary` | 1 | rare |

This matches the parent JSONL distribution exactly. Sub-agents run as full Claude Code sessions internally.

### 3.4 No last-prompt in Sub-agent Files

None of the 127 sub-agent JSONL files had a `last-prompt` event. Sub-agents do not write a session exit breadcrumb.

### 3.5 First Event in Sub-agent Files

| Sub-agent type | First event type | Notes |
|---|---|---|
| `regular` | `user` | The initial prompt delivered to the sub-agent |
| `compact` | `system/bridge_status` or `progress/hook_progress` | Starts with session setup events |
| `side_question` | `progress/hook_progress` or `system/bridge_status` | Same as compact |

Regular sub-agents have `parentUuid: null` on their first `user` event, with `promptId` set to the same `promptId` as the originating `user` event in the parent (the turn that triggered the `Agent` tool call).

---

## 4. ID Patterns

All ID patterns observed across 127 sub-agent files:

### 4.1 Regular: `a{16-char hex}`

```
agent-a7d41ee5dab91e6cf.jsonl
agent-a413f031d19bfc353.jsonl
agent-aeb3897ee3267e12c.jsonl
```

- **Format:** Starts with `a`, followed by exactly 16 lowercase hex characters.
- **Total length of agentId:** 17 characters.
- **Count:** 114 of 127 (89.8%).
- **Meta:** Always has `.meta.json`.
- **Trigger:** Explicit `Agent` tool call in a parent `assistant` event.
- **Correlation:** May or may not appear in parent's `agent_progress` events (see Section 5).

### 4.2 Compact: `acompact-{16-char hex}`

```
agent-acompact-767ece576f2b74e8.jsonl
agent-acompact-97b6b9c650154fd8.jsonl
agent-acompact-52eb91dca484beb9.jsonl
```

- **Format:** `acompact-` prefix followed by exactly 16 lowercase hex characters.
- **Count:** 3 of 127 (2.4%).
- **Meta:** Never has `.meta.json`.
- **Trigger:** Context compaction (`/compact` or auto-compact). This sub-agent contains the full session continuation that runs post-compaction. Its JSONL starts at session start time and covers the entire compacted flow.
- **Important:** The compact sub-agent is NOT spawned by an `Agent` tool call. It is created by the compaction mechanism. Its events start from the very beginning of the session (with `system/bridge_status` and `progress/hook_progress`), meaning it is effectively the "resumed" execution context.
- **Correlation:** Not found in parent's `agent_progress` events.

### 4.3 Side Question: `aside_question-{16-char hex}`

```
agent-aside_question-c5e5c961a7749e08.jsonl
agent-aside_question-8b4a4b72a5f49701.jsonl
agent-aside_question-98ac8cf56333b568.jsonl
```

- **Format:** `aside_question-` prefix followed by exactly 16 lowercase hex characters.
- **Count:** 10 of 127 (7.9%).
- **Meta:** Never has `.meta.json`.
- **Trigger:** User asks a quick side question while the main agent is running in the background. Claude Code spawns a lightweight separate instance to answer it without interrupting the main agent.
- **Evidence from event content:** The second `user` event in a side_question sub-agent contains a system reminder: `"This is a side question from the user. You must answer this question directly in a single response. IMPORTANT CONTEXT: You are a separate, lightweight agent spawned to answer this one question. The main agent is NOT interrupted — it continues working independently in the background."` This confirms the purpose.
- **Correlation:** Not found in parent's `agent_progress` events.

---

## 5. Parent-Child Linking Strategy

Three mechanisms exist, ranked by reliability:

### 5.1 Primary: Filesystem Path (Always Works)

The `{conv-uuid}` directory IS the parent. This is a structural guarantee built into Claude Code's file layout.

```
{conv-uuid}.jsonl          → parent session
{conv-uuid}/subagents/     → all sub-agents for this session
```

**How Sentinel should use this:**
1. When discovering a new `subagents/agent-*.jsonl` file, extract the parent UUID from the directory path: `path.split('/').at(-3)` (grandparent dir name).
2. Look up the parent session in Sentinel's database by `session_id = conv_uuid`.
3. This always works regardless of whether `agent_progress` events exist in the parent.

### 5.2 Secondary: Event Correlation via agent_progress (Works for 47% of regular sub-agents)

When a parent session runs sub-agents **concurrently** (multiple `Agent` tool calls in parallel), the parent JSONL emits `progress/agent_progress` events during execution.

```json
{
  "type": "progress",
  "data": {
    "type": "agent_progress",
    "agentId": "a8797c2232ecde8f2",     // ← matches sub-agent ID
    "prompt": "I need to investigate...",
    "message": {
      "type": "user",
      "message": { "role": "user", "content": [...] }
    }
  },
  "parentToolUseID": "toolu_01AbCdEf...",   // ← matches Agent tool_use block id
  "toolUseID": "agent_msg_01XyzAbc...",
  ...
}
```

**Key fields:**
- `data.agentId` — directly matches the sub-agent file's agentId.
- `parentToolUseID` — matches the `id` field of the `Agent` tool_use block in the parent's `assistant` event.

**Limitation:** 54 of 114 regular sub-agents (47%) run in parent sessions that have **zero** `agent_progress` events. This happens when sub-agents are run sequentially (run-and-wait pattern). The filesystem path method (5.1) is still reliable for these.

### 5.3 Tertiary: Agent Tool Call in Parent JSONL

In parent `assistant` events, `Agent` tool calls have:
```json
{
  "type": "tool_use",
  "name": "Agent",
  "id": "toolu_012yvWJmRS1KXcB9edt3F1dv",
  "input": {
    "description": "Audit Gateway API responses",
    "subagent_type": "Explore",
    "prompt": "...",
    "name": "optional-label"
  }
}
```

The `description` field matches `meta.agentType` == `input.subagent_type` and `meta.description` == `input.description`. This allows correlating the `Agent` tool call to the `.meta.json` file.

**All 114 regular sub-agents** were found via this method (100% coverage). The `id` (`toolu_...`) links to `agent_progress.parentToolUseID`.

### 5.4 sessionId Correlation

All sub-agent events have `sessionId == parent_conv_uuid`. This confirms ownership but does not help distinguish which sub-agent belongs to which parent when only looking at sub-agent events in isolation (since all sub-agents for a session share the same `sessionId`).

---

## 6. Token Attribution

### 6.1 Tokens are NOT in Parent JSONL

The parent JSONL's `assistant` events do NOT include tokens spent by sub-agents. The parent only has `progress/agent_progress` events (which carry no token data) and the final tool result (also no tokens).

### 6.2 Sub-agent Tokens are in Their Own JSONL

Each sub-agent JSONL accumulates its own `assistant.message.usage` data:

```json
{
  "usage": {
    "input_tokens": 3,
    "output_tokens": 1247,
    "cache_read_input_tokens": 42891,
    "cache_creation_input_tokens": 8301
  }
}
```

Accumulation rules are the same as for parent sessions (see Task 2 findings).

### 6.3 Scale

From the scanner (127 sub-agent files):

| Metric | Value |
|---|---|
| Total sub-agent output tokens | 1,127,357 |
| Average output tokens per sub-agent | 8,877 |
| Largest single sub-agent (compact) | ~92,000 output tokens |

The compact sub-agent (3 observed) can dwarf individual regular sub-agents because it contains the full post-compaction session.

### 6.4 Token Rollup Decision

**Recommendation: Dual tracking.**
- Track sub-agent tokens separately (per `agentId`) for granular reporting.
- Roll up to the session total for the `sessions` table `total_tokens` column.
- Do NOT double-count: parent `progress/agent_progress` events have no token data, so summing parent + sub-agent JSONLs is safe with no deduplication needed.

**Formula for session total:**
```
session_total_output = SUM(parent_assistant.usage.output_tokens)
                     + SUM(ALL subagent_assistant.usage.output_tokens)
```

---

## 7. Impact on Sentinel Data Model

### 7.1 Discovery Strategy

The Session Monitor must:
1. Watch `~/.claude/projects/` recursively via `fs.watch`.
2. When a new file appears at `{project}/{conv-uuid}/subagents/agent-*.jsonl`, detect the parent from the path.
3. If the parent session exists in the DB, create a sub-agent record with `parent_session_id = conv_uuid`.
4. Watch the sub-agent JSONL for events (same tailing logic as parent JSONL).

### 7.2 parent_session_id Column

A `parent_session_id` column on a `sub_agents` table (or on `sessions` with `is_subagent` flag) is straightforward to populate:

```
parent_session_id = grandparent_directory_name_of_subagent_jsonl
```

This is 100% reliable because it is derived from the filesystem structure, not from event parsing.

### 7.3 Sub-agent Table Recommendation

Separate `sub_agents` table rather than mixing into `sessions`:

```sql
CREATE TABLE sub_agents (
  id            TEXT PRIMARY KEY,     -- agentId (e.g., "a7d41ee5dab91e6cf")
  session_id    TEXT NOT NULL,         -- parent session UUID (conv_uuid)
  pattern       TEXT NOT NULL,         -- "regular" | "compact" | "side_question"
  agent_type    TEXT,                  -- from .meta.json agentType, NULL for compact/side_question
  description   TEXT,                  -- from .meta.json description, NULL for compact/side_question
  jsonl_path    TEXT NOT NULL,         -- absolute path to sub-agent JSONL
  event_count   INTEGER DEFAULT 0,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens    INTEGER DEFAULT 0,
  cache_create_tokens  INTEGER DEFAULT 0,
  started_at    TEXT,                  -- timestamp of first event
  ended_at      TEXT,                  -- timestamp of last event
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

### 7.4 What to Ignore vs Track

| Sub-agent type | Track in DB | Watch for events | Include in token total |
|---|---|---|---|
| `regular` | Yes | Yes | Yes |
| `compact` | Yes (low priority) | Optional | Yes |
| `side_question` | Yes (low priority) | Optional | Yes |

For the Session Monitor's first implementation, tracking `regular` sub-agents is sufficient. Compact and side_question sub-agents are internal mechanisms; operators rarely need to know about them.

---

## 8. Decision: Detection and Linking Approach for Implementation

### 8.1 Detection

Use **filesystem path** as the sole mechanism for parent-child linking:

```typescript
// When a new subagent JSONL is discovered:
function extractParentSessionId(subagentJsonlPath: string): string {
  // path: .../{conv-uuid}/subagents/agent-{agentId}.jsonl
  const parts = subagentJsonlPath.split('/');
  const subagentsIdx = parts.indexOf('subagents');
  return parts[subagentsIdx - 1]; // the {conv-uuid} directory
}
```

Do NOT rely on `sessionId` from events (correct but redundant with path) or `agent_progress` events (only present for 47% of regular sub-agents).

### 8.2 Agent ID Extraction

```typescript
function parseAgentFilename(filename: string): { agentId: string; pattern: string } {
  const base = filename.replace(/\.(?:jsonl|meta\.json)$/, '');
  const agentId = base.replace(/^agent-/, '');
  const pattern =
    agentId.startsWith('acompact-') ? 'compact' :
    agentId.startsWith('aside_question-') ? 'side_question' :
    'regular';
  return { agentId, pattern };
}
```

### 8.3 Discovery Trigger

`fs.watch` on the `subagents/` directory (created lazily when the first sub-agent is spawned) is the primary trigger. Sentinel also needs to scan on startup for already-existing sub-agents.

Recommended watch strategy:
1. Watch `~/.claude/projects/` recursively.
2. Filter `change` events for paths matching `*/subagents/agent-*.jsonl`.
3. On new file: parse parent ID from path, read `.meta.json` if present, tail the JSONL.

### 8.4 What agent_progress Events Provide (Beyond Linking)

Even though `agent_progress` is not needed for linking, it provides the initial prompt text for display:

```json
data.prompt = "Research task — inspect the Claude Code CLI binary..."
```

This can populate a `sub_agents.initial_prompt` column for dashboard display without reading the sub-agent JSONL directly.

### 8.5 Sidechain Filtering in Parent JSONL

The parent JSONL may contain a small number of `isSidechain: true` events (observed: rare in parent files). The Monitor should filter these out when computing parent session metrics. All events in sub-agent JSONL files have `isSidechain: true`.

---

## 9. Surprises and Edge Cases

1. **agent_progress is not universal.** 54 of 114 regular sub-agents (47%) run in parent sessions with no `agent_progress` events. These appear to be sequential sub-agents (the parent waits for the sub-agent to complete before continuing). Only concurrent sub-agents emit `agent_progress` in the parent. Filesystem path is the only universal linking mechanism.

2. **compact sub-agent spans the whole session.** The `acompact-*` sub-agent starts at session start time and runs alongside the parent, covering the compacted execution context. It has 270+ assistant events and ~92,000 output tokens — far more than a typical regular sub-agent. It is closer in nature to a continuation of the parent than a sub-task.

3. **side_question sub-agents share the parent's sessionId, slug, and bridge_status URL.** They appear to reuse the parent session's connection. The first event is `progress/hook_progress` (same session start sequence), and the `system/bridge_status` URL is identical to the parent's.

4. **No sub-agent has its own unique sessionId.** All 127 tested sub-agents had `sessionId == conv_uuid`. This means the `sessions` table's primary key (sessionId = conv_uuid) correctly identifies the parent, and sub-agents are always children, never peers.

5. **sub-agent IDs are 17 chars for regular (a + 16 hex), 25 chars for compact (acompact- + 16 hex), and 32 chars for side_question (aside_question- + 16 hex).** All hex portions are exactly 16 characters.

6. **Agent tool input has 7 possible fields.** Observed: `description` (100%), `prompt` (100%), `subagent_type` (82%), `name` (49%), `run_in_background` (8%), `mode` (6%), `model` (6%). Only `description` and `prompt` are always present.

7. **Multiple side_question sub-agents can share the same first event UUID.** In session `318d3967`, two side_question sub-agents (`aside_question-8b4a4b72a5f49701` and `aside_question-98ac8cf56333b568`) had identical first events including `uuid` and `timestamp`. They appear to have been spawned simultaneously from the same parent turn.

---

## 10. Scripts Produced

| Script | Purpose | Location |
|---|---|---|
| `subagent-scanner.mjs` | Scan all sub-agent files, report patterns, tokens, correlations | `sandbox/sprint0/subagent-scanner.mjs` |

Usage:
```bash
node sandbox/sprint0/subagent-scanner.mjs              # summary
node sandbox/sprint0/subagent-scanner.mjs --verbose    # per-subagent detail
node sandbox/sprint0/subagent-scanner.mjs --json       # JSON output
```
