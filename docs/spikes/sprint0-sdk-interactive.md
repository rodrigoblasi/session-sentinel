# Sprint 0 Spike: SDK and Interactive Session Management Strategy

**Date:** 2026-03-27
**Status:** Complete
**Issue:** Sprint 0 investigation — SDK interactive support
**Author:** Automated investigation

---

## 1. SDK Availability

### 1.1 Official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

An official TypeScript SDK exists and is actively maintained by Anthropic.

| Field | Value |
|-------|-------|
| Package | `@anthropic-ai/claude-agent-sdk` |
| Version | 0.2.85 (latest as of 2026-03-27) |
| Registry | https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk |
| Source | https://github.com/anthropics/claude-agent-sdk-typescript |
| Size | ~48.7 MB (bundles the Claude Code runtime) |
| Entry | `sdk.mjs` (types: `sdk.d.ts`) |
| Exports | `.` (main SDK), `./embed`, `./bridge`, `./browser`, `./sdk-tools` |

This is **not** a thin process wrapper. It bundles the full Claude Code agent loop, tools, and context management. It runs the same logic as the `claude` CLI but exposed as a TypeScript API.

### 1.2 Two API Surfaces

**V1 (Stable) — `query()` function:**
- Async generator pattern: `for await (const message of query({...}))`
- Each `query()` call is one turn. Process spawns, runs, exits.
- Session continuity via `resume: sessionId` or `continue: true` in options.
- Returns `SDKMessage` union type (assistant, user, result, system, etc.)
- Supports `allowedTools`, `permissionMode`, `model`, `max_budget_usd`.

**V2 (Preview/Unstable) — Session object:**
- `unstable_v2_createSession()` / `unstable_v2_resumeSession()`
- Returns `SDKSession` with `send(message)` and `stream()` methods.
- Multi-turn via repeated `send()`/`stream()` cycles on the same session.
- `close()` method for cleanup.
- Prefixed `unstable_v2_` — APIs may change between versions.

### 1.3 Other Packages

| Package | Notes |
|---------|-------|
| `@anthropic-ai/claude-code` (2.1.85) | The CLI itself. No programmatic exports. |
| `@anthropic-ai/sdk` (0.80.0) | Raw Anthropic API client (Messages API). Not Claude Code. |
| `claude-code-sdk` (0.1.0) | Third-party wrapper by jasonkneen. Avoid. |
| `@instantlyeasy/claude-code-sdk-ts` (0.3.3) | Unofficial TS port. Avoid. |

### 1.4 Python SDK

An official Python SDK also exists (`claude-agent-sdk` on PyPI, `@anthropic-ai/claude-agent-sdk-python` on GitHub). Not relevant for Sentinel (Node.js/TypeScript stack) but confirms Anthropic's investment in programmatic access.

---

## 2. Claude CLI Flags for Programmatic Use

Full flag inventory from `claude --help` (v2.1.85), filtered for Sentinel relevance:

| Flag | Purpose | Works with --print? | Viable for Sentinel? |
|------|---------|---------------------|---------------------|
| `-p, --print` | Non-interactive: print response and exit | N/A (defines mode) | Yes (per-turn model) |
| `--output-format <format>` | Output format: `text`, `json`, `stream-json` | --print only | Yes — `stream-json` for real-time parsing |
| `--input-format <format>` | Input format: `text`, `stream-json` | --print only | **Critical** — enables bidirectional streaming |
| `-r, --resume <id>` | Resume a conversation by session ID | Yes | Yes — session continuity |
| `-c, --continue` | Continue most recent conversation in cwd | Yes | Possible but `--resume` preferred |
| `--session-id <uuid>` | Force a specific session ID | Yes | Yes — predictable IDs |
| `--fork-session` | Create new session ID when resuming | Yes | Yes — branch conversations |
| `--dangerously-skip-permissions` | Bypass all permission checks | Yes | Yes — managed sessions need this |
| `--permission-mode <mode>` | Permission mode (acceptEdits, bypassPermissions, etc.) | Yes | Yes — `bypassPermissions` for managed |
| `--allowedTools <tools>` | Restrict available tools | Yes | Yes — security boundary |
| `--model <model>` | Model selection | Yes | Yes |
| `--effort <level>` | Effort level (low, medium, high, max) | Yes | Yes |
| `--system-prompt <prompt>` | Override system prompt | Yes | Yes — inject Sentinel context |
| `--append-system-prompt <prompt>` | Append to default system prompt | Yes | Yes — less invasive |
| `--mcp-config <configs>` | Load MCP servers | Yes | Possible future use |
| `--verbose` | Verbose output | Yes | Yes — richer stream events |
| `--include-partial-messages` | Stream partial message chunks | --print + stream-json | Yes — real-time UI updates |
| `--replay-user-messages` | Re-emit user messages on stdout | stream-json both dirs | Yes — acknowledgment loop |
| `--no-session-persistence` | Don't save session to disk | --print only | No — we need persistence |
| `--max-budget-usd <amount>` | Spending limit | --print only | Yes — cost control |
| `--bare` | Minimal mode: skip hooks, LSP, plugins | Yes | Consider for managed sessions |
| `-n, --name <name>` | Display name for session | Yes | Yes — label sessions |
| `--add-dir <dirs>` | Additional directory access | Yes | Yes — multi-project |

### Key discovery: `--input-format stream-json`

This flag transforms `--print` mode from one-shot into bidirectional streaming:

- Claude process stays alive reading NDJSON from stdin
- Output streams as NDJSON on stdout
- Enables multi-turn conversations within a single `--print` process
- Combined with `--output-format stream-json` creates a full duplex channel

**Caveat:** This protocol is largely undocumented (GitHub issue [#24594](https://github.com/anthropics/claude-code/issues/24594)). The NDJSON message format for stdin, multi-turn flow, and permission handling are not formally specified. Community projects have reverse-engineered it.

---

## 3. Gateway's Approach (Reference)

The old Gateway (`/home/blasi/claude_code_gateway/src/session-manager.ts`) used:

### How it worked

```typescript
// Each turn = new process spawn
const args = [
  '--print', text,          // one-shot mode, prompt as argument
  '--output-format=stream-json',
  '--verbose',
  '--dangerously-skip-permissions',
];

if (isResume) args.push('--resume', session.session_id);
else           args.push('--session-id', session.session_id);

const proc = spawn('claude', args, { cwd, stdio: ['pipe','pipe','pipe'] });
```

### What worked

1. **Structured output parsing** — `stream-json` provided typed NDJSON events (system/init, assistant, result, etc.)
2. **Session continuity** — `--resume` with session ID preserved conversation history across turns
3. **Token tracking** — Parsed `usage` fields from assistant messages for cost monitoring
4. **Status detection** — Detected "waiting" state by looking for `AskUserQuestion` tool use blocks
5. **Remote URL capture** — Caught `bridge_status` system events for Claude Remote URLs
6. **Process lifecycle** — Clean spawn/exit/error handling with watchdog timers

### What didn't work (why the spec says NOT to use --print)

1. **No persistent process** — Each message spawned a new `claude` process. Startup overhead per turn (~2-5 seconds).
2. **No natural waiting** — Claude couldn't "wait" for input. It ran to completion and exited. The Gateway faked waiting by detecting AskUserQuestion in output.
3. **Context reload per turn** — Each spawn re-read CLAUDE.md, re-initialized LSP, re-loaded context. Wasteful.
4. **Fragile resume** — `--resume` worked but occasionally produced confusing behavior when the previous turn had errors or incomplete tool calls.
5. **No real conversation flow** — The operator's terminal experience (persistent process, natural back-and-forth) was not replicated.

### Lessons for Sentinel

The Gateway proved that `--print` + `--output-format=stream-json` + `--resume` is a *functional* approach for programmatic session management. Its limitations are mostly about UX and efficiency, not fundamental breakage. The spec's strong preference for "interactive only" stems from wanting the managed session experience to match what the operator gets in the terminal.

---

## 4. Interactive Session Management Strategy

### Option A: Claude Agent SDK (V1 — `query()`)

**How it works:**
```typescript
import { query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// First turn
let sessionId: string | undefined;
for await (const msg of query({
  prompt: 'Review the auth module',
  options: {
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit'],
    permissionMode: 'bypassPermissions',
    sessionId: predeterminedUUID,
  },
})) {
  if (msg.type === 'system' && msg.subtype === 'init') {
    sessionId = msg.session_id;
  }
  if (msg.type === 'result') {
    console.log(`Cost: $${msg.total_cost_usd}`);
  }
}

// Next turn (resume)
for await (const msg of query({
  prompt: 'Now fix the issues you found',
  options: {
    resume: sessionId,
    permissionMode: 'bypassPermissions',
  },
})) {
  // handle messages...
}
```

**Pros:**
- Official, maintained by Anthropic, versioned, typed
- Same agent loop as `claude` CLI — no behavior divergence
- Structured `SDKMessage` types — no manual NDJSON parsing
- Session resume via `resume: sessionId` — first-class support
- `allowedTools` and `permissionMode` — security built in
- Cost tracking via `total_cost_usd` on result messages
- No need to manage child processes, stdin/stdout, or TTY
- JSONL files are still written to `~/.claude/projects/` — Monitor still works

**Cons:**
- V1 `query()` is per-turn (async generator per call) — same model as `--print`
- Each `query()` likely spawns an internal process or re-initializes context
- No persistent process between turns — similar overhead to Gateway
- The SDK bundles ~48 MB — significant dependency
- SDK version must track Claude Code version (both at 2.1.85/0.2.85)

**Assessment:** This is the Gateway's approach with a better API. It solves the DX and reliability problems (typed messages, no manual spawn) but does NOT solve the spec's core desire for a persistent, interactive session.

### Option B: Claude Agent SDK (V2 — Session object)

**How it works:**
```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from '@anthropic-ai/claude-agent-sdk';

// Create session — stays alive
const session = await unstable_v2_createSession({
  permissionMode: 'bypassPermissions',
  allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit'],
});

// Turn 1
await session.send('Review the auth module');
for await (const msg of session.stream()) {
  // handle streaming messages
}

// Turn 2 — same session, no respawn
await session.send('Now fix the issues you found');
for await (const msg of session.stream()) {
  // handle streaming messages
}

// Later: close and resume
const savedId = session.sessionId;
await session.close();

// Resume from a different context
const resumed = await unstable_v2_resumeSession(savedId, {
  permissionMode: 'bypassPermissions',
});
await resumed.send('What was the last thing you did?');
```

**Pros:**
- Persistent session object — `send()`/`stream()` cycle without respawn
- Matches the spec's "interactive only" vision perfectly
- Session lifecycle management built in (create, send, stream, close, resume)
- Same typed `SDKMessage` streaming as V1
- Official Anthropic SDK — will eventually stabilize
- Multi-turn without process overhead per turn

**Cons:**
- **Unstable API** — prefixed `unstable_v2_`, may change between minor versions
- API surface may not be finalized; could break on updates
- Less community usage and examples compared to V1
- Internal implementation details unknown — may still spawn processes per turn internally
- Risk of being removed or significantly refactored before stabilization

**Assessment:** This is the ideal API for Sentinel's needs. The `send()`/`stream()` pattern maps directly to the Session Manager's requirements. The instability risk is real but manageable with version pinning and an abstraction layer.

### Option C: `--print` per turn with `--resume` (CLI, Gateway-style)

**How it works:**
```typescript
import { spawn } from 'node:child_process';

function runTurn(sessionId: string, message: string, cwd: string) {
  const args = [
    '--print', message,
    '--output-format=stream-json',
    '--resume', sessionId,
    '--dangerously-skip-permissions',
    '--verbose',
  ];
  const proc = spawn('claude', args, { cwd, stdio: ['pipe','pipe','pipe'] });
  // Parse NDJSON from stdout...
}
```

**Pros:**
- Proven pattern (Gateway used it successfully)
- No SDK dependency — just child process management
- Full control over process lifecycle
- `stream-json` output is well-understood from Gateway experience

**Cons:**
- Process spawn per turn (startup overhead)
- Manual NDJSON parsing (error-prone, no type safety)
- Must manage process lifecycle manually
- No advantage over SDK V1 (which wraps this same pattern)
- The spec explicitly wants to move away from this model

**Assessment:** This is the Gateway's approach without the SDK wrapper. Strictly worse than Option A. Only viable as a fallback if the SDK has blocking issues.

### Option D: `--print` with bidirectional `stream-json` (persistent process)

**How it works:**
```typescript
const proc = spawn('claude', [
  '--print',
  '--input-format=stream-json',
  '--output-format=stream-json',
  '--dangerously-skip-permissions',
  '--verbose',
  '--include-partial-messages',
  '--session-id', sessionUUID,
], { cwd, stdio: ['pipe','pipe','pipe'] });

// Send turns as NDJSON on stdin
proc.stdin.write(JSON.stringify({ type: 'user_message', content: 'Review auth' }) + '\n');

// Read NDJSON responses from stdout
const rl = createInterface({ input: proc.stdout });
rl.on('line', (line) => {
  const event = JSON.parse(line);
  // handle event...
});

// Send follow-up (same process, no respawn)
proc.stdin.write(JSON.stringify({ type: 'user_message', content: 'Fix the issues' }) + '\n');
```

**Pros:**
- Single persistent process — matches spec's "interactive only" vision
- Structured I/O on both directions (NDJSON)
- No SDK dependency — raw CLI usage
- Process stays alive between turns
- `--include-partial-messages` for real-time streaming

**Cons:**
- **Undocumented protocol** — stdin NDJSON format not formally specified (GitHub #24594)
- Must reverse-engineer or discover message format experimentally
- No type safety for input messages
- Must handle permission requests/responses manually in the stream
- Protocol may change without notice (not a stable API)
- Error handling for malformed input is unknown

**Assessment:** This achieves the spec's persistent-process goal without the SDK, but at the cost of relying on an undocumented protocol. High risk of breakage on Claude Code updates.

### Option E: Hybrid — SDK V2 primary, SDK V1 fallback

**How it works:**

```typescript
// Abstraction layer
interface SessionDriver {
  create(opts: CreateOpts): Promise<ManagedSession>;
  send(session: ManagedSession, message: string): Promise<void>;
  stream(session: ManagedSession): AsyncGenerator<StreamEvent>;
  resume(sessionId: string, opts: ResumeOpts): Promise<ManagedSession>;
  terminate(session: ManagedSession): Promise<void>;
}

// Primary: SDK V2 driver
class SDKV2Driver implements SessionDriver { /* uses unstable_v2_createSession */ }

// Fallback: SDK V1 driver
class SDKV1Driver implements SessionDriver { /* uses query() with resume */ }
```

**Pros:**
- Best of both worlds: V2 when available, V1 as stable fallback
- Abstraction layer isolates Session Manager from SDK internals
- Can swap drivers without changing Manager logic
- Can test both approaches in Sprint 1 and pick winner
- When V2 stabilizes, just drop the fallback

**Cons:**
- More initial code (two drivers + interface)
- Must ensure both drivers produce identical `StreamEvent` types
- Testing burden doubled during the dual-driver period

**Assessment:** This is the safest approach that still targets the spec's vision.

---

## 5. Decision

### Recommended approach: Option E (Hybrid) with SDK V2 as primary target

**Use `@anthropic-ai/claude-agent-sdk` with the V2 Session API as the primary driver, backed by a V1 `query()` fallback, behind a `SessionDriver` abstraction.**

### Rationale

1. **The SDK exists and is official.** There is no reason to manage raw child processes when Anthropic provides a typed, maintained SDK that bundles the same agent loop.

2. **V2 matches the spec.** The `createSession()`/`send()`/`stream()`/`close()`/`resumeSession()` API maps 1:1 to the Session Manager's requirements (create, send, monitor, terminate, resume). This is what the spec envisioned in Section 2.

3. **V1 is a proven fallback.** The `query()` function with `resume` is essentially the Gateway pattern with better DX. If V2 breaks or is removed, V1 works today.

4. **The abstraction protects us.** A `SessionDriver` interface means the Session Manager never calls SDK functions directly. When V2 stabilizes (drops `unstable_` prefix), we just update the driver. If Anthropic releases a V3, we write a new driver.

5. **JSONL files are still written.** Both V1 and V2 write JSONL to `~/.claude/projects/`. The Session Monitor continues to work regardless of which driver is active.

6. **Raw process management (Options C/D) offers no advantage.** Option C is strictly worse than V1. Option D relies on undocumented protocol. The SDK wraps both patterns with type safety.

### Key trade-offs accepted

| Trade-off | Mitigation |
|-----------|------------|
| V2 API instability (`unstable_v2_` prefix) | Version-pin SDK; `SessionDriver` abstraction isolates changes |
| Large dependency (~48 MB) | Acceptable for a server-side control plane |
| SDK version must track CLI version | Automate with dependabot or version check on startup |
| V2 may still spawn processes internally per turn | Measure in Sprint 1; if so, behavior matches V1 and is acceptable |
| Two drivers to maintain initially | Drop V1 driver once V2 stabilizes |

### Dependencies and libraries needed

| Dependency | Purpose | Version |
|------------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | Session management SDK | ^0.2.85 (pin minor) |
| `better-sqlite3` | Already in stack (database) | Per spec |
| No `node-pty` needed | SDK handles TTY internally | N/A |
| No manual NDJSON parsing | SDK provides typed messages | N/A |

### Implementation notes for Sprint 1

1. **Define `SessionDriver` interface first** — before writing any SDK code.
2. **Implement V2 driver** — wrap `unstable_v2_createSession`, `send`, `stream`, `resumeSession`, `close`.
3. **Implement V1 driver** — wrap `query()` with `resume`/`sessionId` options. Map async generator to `StreamEvent`.
4. **Map `SDKMessage` to internal `StreamEvent`** — the Session Manager and Monitor should use Sentinel's own event types, not SDK types directly.
5. **Test both drivers** with real Claude sessions in `sandbox/`.
6. **Configuration flag** to select driver: `SESSION_DRIVER=v2|v1` (default: `v2`).
7. **Capture session ID early** — from `system/init` message in stream.
8. **Capture Claude Remote URL** — from `system/bridge_status` message in stream.

### What changes in the spec

The spec's Section 2 says: "Managed sessions run `claude` (without `--print`), keeping the process alive with stdin/stdout open."

This investigation shows that:
- The SDK V2 Session API achieves this goal (persistent session, `send()`/`stream()` without respawn).
- The SDK V1 `query()` function does NOT (it is per-turn, like `--print`).
- Raw interactive mode (no `--print`, no SDK) requires TTY emulation and is fragile.

The spec's intent is correct. The implementation path is: **SDK V2 for persistent sessions, SDK V1 as graceful degradation.** The spec does not need modification — the SDK is how Sentinel achieves the interactive-only vision.

---

## Appendix A: Stream Event Types (from Gateway + SDK docs)

Events observed in `--output-format stream-json` and expected from SDK streaming:

| Event type | Subtype | Contains | Sentinel use |
|------------|---------|----------|-------------|
| `system` | `init` | `session_id`, `model`, `gitBranch` | Session identity, model tracking |
| `system` | `bridge_status` | `url` | Claude Remote URL capture |
| `assistant` | — | `message.content[]`, `message.usage` | Token tracking, tool call counting |
| `assistant` (content) | `tool_use` with `AskUserQuestion` | `question` | Detect waiting state |
| `result` | `success` | `result`, `session_id`, `total_cost_usd` | Turn completion, cost |
| `result` | `error` | `error` | Error detection |
| `stream_event` | `text_delta` | `delta.text` | Real-time output (with `--include-partial-messages`) |

## Appendix B: SDK V1 vs V2 Comparison

| Capability | V1 `query()` | V2 Session |
|------------|-------------|------------|
| Multi-turn | Via `resume` option (new generator per turn) | Via `send()`/`stream()` on same session |
| Persistent process | No (likely spawns per call) | Yes (session object stays alive) |
| Session resume | `resume: sessionId` in options | `unstable_v2_resumeSession(id)` |
| Fork | `fork: true` in options | Unknown / TBD |
| API stability | Stable | Unstable (`unstable_v2_` prefix) |
| Streaming | `for await (const msg of query(...))` | `for await (const msg of session.stream())` |
| Type safety | Full (`SDKMessage` union) | Full (`SDKMessage` union) |
| Process management | Handled by SDK | Handled by SDK |
| Cost tracking | `result.total_cost_usd` | `result.total_cost_usd` |

## Appendix C: References

- [Claude Agent SDK TypeScript — npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [Agent SDK overview — Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK V2 interface (preview)](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [Agent SDK reference — TypeScript](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Work with sessions — Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Run Claude Code programmatically (headless)](https://code.claude.com/docs/en/headless)
- [CLI reference — Claude Code Docs](https://code.claude.com/docs/en/cli-reference)
- [GitHub #24594 — `--input-format stream-json` undocumented](https://github.com/anthropics/claude-code/issues/24594)
- Gateway reference: `/home/blasi/claude_code_gateway/src/session-manager.ts`
