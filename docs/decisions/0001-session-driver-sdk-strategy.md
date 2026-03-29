# ADR-0001: Session Driver SDK Strategy

**Status:** Decided — Option B (SDK V1 only)
**Date:** 2026-03-28
**Author:** Claude (with rodrigoblasi)
**Issue:** #13 (Sprint 2 planning)
**Relates to:** Sprint 0 spikes, design spec Section 2 and 4

---

## 1. Context

Session Sentinel's Session Manager needs to programmatically create, resume, send messages to, and terminate Claude Code sessions. The design spec (Section 2) mandates **interactive sessions only** — persistent processes that stay alive between turns, matching the operator's terminal experience.

Sprint 0 investigated the available approaches and recommended **Option E: Hybrid** — an SDK V2 primary driver with V1 fallback, behind a `SessionDriver` abstraction interface (see `docs/spikes/sprint0-sdk-interactive.md`, Section 5).

Sprint 2 is about to implement this. During planning, a critical gap was discovered between what the spike *expected* from SDK V2 and what was *actually confirmed* through testing.

---

## 2. The Problem

### What the spike assumed (Section 4, Option B)

The Sprint 0 spike document (`sprint0-sdk-interactive.md`) described SDK V2 usage like this:

```typescript
const session = await unstable_v2_createSession({
  permissionMode: 'bypassPermissions',
  allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit'],
});
```

This implies `permissionMode` and `allowedTools` are available in the V2 creation options.

### What was actually tested (Sprint 1, Issue #3)

The Claude Remote spike (`sprint0-claude-remote.md`, Section 3.2) ran real tests against the SDK V2 API on 2026-03-28 and found:

> The `SDKSessionOptions` type only exposes: `model`, `pathToClaudeCodeExecutable`, `executable`, `executableArgs`, `env` — no `extraArgs`, `cwd`, or `systemPrompt`.

Two tests were run:

| Test | Config | Result |
|------|--------|--------|
| Test 1 | `unstable_v2_createSession({ model })` | Worked. Minimal JSONL (1 `queue-operation` event). |
| Test 2 | Same + `extraArgs: { 'remote-control': null }` | `extraArgs` not in `SDKSessionOptions` type — silently ignored. |

Additional observations:
- V2 sessions produce minimal JSONL output (1 `queue-operation` event in main file)
- V2 spawns subagent-like worker files (`agent-*.jsonl`) for actual work
- No `entrypoint` field is set on V2 events
- No `bridge_status` event (no Claude Remote URL for SDK sessions)
- `send()` returns `Promise<void>`, responses come via `stream()` async generator

### What the official docs say (as of 2026-03-28)

The official SDK documentation (platform.claude.com) confirms the gap:

**V1 `query()` Options** — ~40+ properties available:

| Option | Type | Available in V1? |
|--------|------|:---:|
| `cwd` | `string` | Yes |
| `permissionMode` | `PermissionMode` | Yes |
| `allowedTools` | `string[]` | Yes |
| `disallowedTools` | `string[]` | Yes |
| `systemPrompt` | `string \| preset` | Yes |
| `model` | `string` | Yes |
| `effort` | `'low' \| 'medium' \| 'high' \| 'max'` | Yes |
| `maxBudgetUsd` | `number` | Yes |
| `env` | `Record<string, string>` | Yes |
| `sessionId` | `string` | Yes |
| `resume` | `string` | Yes |
| `extraArgs` | `Record<string, string \| null>` | Yes |
| `mcpServers` | `Record<string, McpServerConfig>` | Yes |
| `maxTurns` | `number` | Yes |
| `settingSources` | `SettingSource[]` | Yes |
| `hooks` | `HookCallbackMatcher[]` | Yes |
| `allowDangerouslySkipPermissions` | `boolean` | Yes |
| `canUseTool` | `CanUseTool` | Yes |
| `abortController` | `AbortController` | Yes |

**V2 `unstable_v2_createSession()` Options** — documented as:

```
Parameters:
  model (string) - Required
  "Additional options are supported but not detailed here."
```

The TypeScript type `SDKSessionOptions` exposes only:
- `model`
- `pathToClaudeCodeExecutable`
- `executable`
- `executableArgs`
- `env`

### The gap

To create a useful managed session, Sentinel needs at minimum:

| Capability | Why | V1? | V2 typed? |
|-----------|-----|:---:|:---------:|
| Set working directory (`cwd`) | Agent says "open session in wow-bot" → resolve to `/home/blasi/wow-bot` | Yes | No |
| Set permission mode | Managed sessions need `bypassPermissions` — no human to approve | Yes | No |
| Set allowed tools | Security boundary for managed sessions | Yes | No |
| Set system prompt | Inject Sentinel context, project instructions | Yes | No |
| Set effort level | Cost/quality control per session | Yes | No |
| Set max budget | Cost cap per session | Yes | No |
| Control session ID | Predictable IDs for tracking | Yes | No |

Without these, V2 sessions would run in the default directory, with default permissions (which require human interaction for approvals), and with no cost controls — unusable for managed sessions.

---

## 3. Options

### Option A: SDK V2 with `executableArgs` workaround

Pass the missing options as CLI flags through the `executableArgs` field, which IS available in V2's typed options.

```typescript
const session = await unstable_v2_createSession({
  model: 'claude-sonnet-4-6',
  executableArgs: [
    '--dangerously-skip-permissions',
    '--cwd', '/home/blasi/wow-bot',
    '--allowed-tools', 'Read,Glob,Grep,Bash,Edit',
    '--system-prompt', 'You are working inside project wow-bot...',
    '--effort', 'high',
    '--max-budget-usd', '5',
  ],
});
```

**How it works:** `executableArgs` passes arguments to the underlying Node.js process that runs the Claude Code agent loop. Since the agent loop is the same code as the `claude` CLI, CLI flags *should* be parsed and honored.

**Pros:**
- Uses V2's persistent session model (`send()`/`stream()` without respawn)
- Matches the spec's "interactive only" vision
- If it works, gives full control over all session parameters
- `SessionDriver` abstraction still protects against future V2 type changes

**Cons:**
- **Untested** — nobody has confirmed `executableArgs` passes through to the agent loop as CLI flags
- The Sprint 1 test showed `extraArgs` was silently ignored; `executableArgs` might behave differently but there's no guarantee
- Relies on undocumented behavior — may break on SDK updates
- If the underlying process doesn't parse `--cwd` or `--dangerously-skip-permissions` from `executableArgs`, sessions would be useless
- Error feedback for invalid args is unknown (silent ignore? crash? partial application?)

**Risk level:** Medium-High. The workaround is plausible but unverified. A failed workaround means wasted Sprint 2 implementation time.

**Verification cost:** Low — a single test script that tries `unstable_v2_createSession({ model, executableArgs: ['--cwd', '/tmp/test'] })` and checks if the session's working directory is `/tmp/test`.

### Option B: SDK V1 only (proven, per-turn)

Use V1 `query()` as the sole driver. All options are available and documented. Accept the per-turn model (each `query()` call is one turn, similar to the old Gateway).

```typescript
// First turn
for await (const msg of query({
  prompt: 'Review the auth module',
  options: {
    cwd: '/home/blasi/wow-bot',
    permissionMode: 'bypassPermissions',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit'],
    systemPrompt: 'You are working inside project wow-bot...',
    model: 'claude-sonnet-4-6',
    effort: 'high',
    maxBudgetUsd: 5,
    sessionId: predeterminedUUID,
  },
})) {
  // handle messages
}

// Second turn (resume same session)
for await (const msg of query({
  prompt: 'Now fix the issues you found',
  options: {
    resume: sessionId,
    permissionMode: 'bypassPermissions',
  },
})) {
  // handle messages
}
```

**Pros:**
- **Proven** — all options documented, typed, and tested (Gateway used this pattern successfully)
- Full control over `cwd`, `permissionMode`, `allowedTools`, `systemPrompt`, `effort`, `maxBudgetUsd`
- Session continuity via `resume: sessionId` — first-class support
- Typed `SDKMessage` stream — no manual NDJSON parsing
- JSONL files still written to `~/.claude/projects/` — Monitor integration preserved
- No undocumented behavior, no workarounds
- Lower implementation risk — can focus Sprint 2 on business logic, not SDK wrangling

**Cons:**
- Per-turn model: each `query()` likely reinitializes context (re-reads CLAUDE.md, re-initializes LSP, etc.)
- Startup overhead per turn (~2-5 seconds observed in Gateway)
- Does NOT fulfill the spec's "persistent interactive session" vision
- Architecturally similar to the Gateway approach (which the spec explicitly moved away from)

**Risk level:** Low. This is the safe path with known trade-offs.

**Spec deviation:** The spec (Section 2) says "Sentinel uses interactive sessions exclusively" and "the session is a real, persistent conversation." V1 `query()` does NOT provide this — it is per-turn, equivalent to `--print` mode with a better API. The spec's intent is partially met (session continuity via resume) but not the persistent-process aspect.

### Option C: SDK V2 primary, V1 fallback, with upfront spike (original Option E, adapted)

Add a short spike task at the start of Sprint 2 to test whether `executableArgs` works for passing `cwd`, `permissionMode`, etc. to V2 sessions. Based on the result:

- **If `executableArgs` works:** Implement V2 driver with the workaround, V1 fallback ready
- **If `executableArgs` doesn't work:** Implement V1 as the sole driver, defer V2 to a future sprint when Anthropic expands the typed options

Both paths go behind a `SessionDriver` abstraction interface.

```typescript
interface SessionDriver {
  create(opts: CreateSessionOpts): Promise<ManagedSession>;
  send(session: ManagedSession, message: string): Promise<void>;
  stream(session: ManagedSession): AsyncGenerator<StreamEvent>;
  resume(sessionId: string, opts: ResumeSessionOpts): Promise<ManagedSession>;
  terminate(session: ManagedSession): Promise<void>;
}

interface CreateSessionOpts {
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  maxBudgetUsd?: number;
  label?: string;
  owner: string;
}
```

**Sprint 2 Task 1 would be:** "Spike: Verify SDK V2 `executableArgs` for session configuration"
- Write a test script that creates a V2 session with `executableArgs: ['--cwd', '/tmp/test', '--dangerously-skip-permissions']`
- Verify: Does the session's working directory change? Does permission bypass work? Does the JSONL appear in the expected location?
- Timebox: 1 hour. Binary outcome: works or doesn't.

**Pros:**
- Resolves uncertainty before committing to a driver strategy
- If V2 works: best of both worlds (persistent sessions + full control)
- If V2 doesn't work: falls back cleanly to V1 with no wasted effort
- `SessionDriver` abstraction makes the choice swappable even after Sprint 2
- Minimal upfront investment (1 spike task) for maximum information

**Cons:**
- Adds a dependency at the start of Sprint 2 (other tasks can't start until spike resolves)
- If V2 works but is fragile, we carry the risk of it breaking on SDK updates
- Two potential implementation paths means the plan must account for branching (more complex plan document)

**Risk level:** Low (the spike de-risks the decision itself).

### Option D: SDK V2 with undocumented options passthrough

The official docs say "Additional options are supported but not detailed here" for V2. This suggests the V2 function may accept more options than what's typed. We could try passing V1-style options directly:

```typescript
const session = await unstable_v2_createSession({
  model: 'claude-sonnet-4-6',
  // These are NOT in SDKSessionOptions type but might be accepted at runtime
  cwd: '/home/blasi/wow-bot',
  permissionMode: 'bypassPermissions',
  allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit'],
} as any);  // Type assertion required
```

**Pros:**
- If it works, cleanest solution — V2 persistent sessions with full options
- Minimal code difference from the spike's original Option B vision

**Cons:**
- Requires `as any` type assertion — loses type safety
- The Sprint 1 test showed `extraArgs` was silently ignored when not in the type — same may apply here
- "Supported but not detailed" may refer to future SDK versions, not current
- Completely undocumented — highest breakage risk on SDK updates

**Risk level:** High. Relying on undocumented runtime behavior with no type safety.

**Note:** This option could be absorbed into Option C's spike — test both `executableArgs` AND direct option passthrough in the same spike task.

---

## 4. Comparison Matrix

| Criterion | A: V2 + executableArgs | B: V1 only | C: Spike then decide | D: V2 + untyped opts |
|-----------|:---:|:---:|:---:|:---:|
| Persistent session (spec vision) | Yes | No | Depends on spike | Yes |
| All session options available | Unverified | Yes | Depends on spike | Unverified |
| Implementation risk | Medium-High | Low | Low | High |
| Type safety | Partial | Full | Full | None (`as any`) |
| SDK update resilience | Low | High | Medium-High | Very Low |
| Spec compliance | Full (if works) | Partial | Full or Partial | Full (if works) |
| Sprint 2 planning complexity | Simple | Simple | Branching | Simple |
| Upfront cost | None | None | ~1 hour spike | None |
| Future-proofing (V2 stabilization) | Good | Needs migration | Best | Fragile |

---

## 5. Recommendation

**Option C: Spike first, then decide.**

Rationale:
1. The spike costs ~1 hour and resolves the biggest unknown in Sprint 2
2. If V2 + `executableArgs` works → we get persistent sessions (spec vision) with known workaround
3. If it doesn't → we fall back to V1 with zero wasted effort, and the `SessionDriver` abstraction means we can swap to V2 later when Anthropic expands the type
4. The `SessionDriver` interface is the same regardless of outcome — Sprint 2's architecture doesn't change
5. We avoid the Gateway's mistake of committing to a pattern without testing it first

The spike should test both `executableArgs` (Option A) and direct untyped passthrough (Option D) in one go. Whichever path works becomes the V2 driver. If neither works, V1 is the driver.

---

## 6. Decision

> **Status: DECIDED** — 2026-03-28

**Chosen option:** Option B — SDK V1 only, with `SessionDriver` abstraction

**Reasoning:**

A follow-up investigation (Issue #13 comment, 2026-03-28) resolved the key unknowns that made Option C necessary:

1. **In-flight state risk does not exist in practice.** The housekeeping idle timer resets on every JSONL event. Sessions with active tool calls or in-progress output are always emitting events — they can never go idle. Idle state and in-flight state are mutually exclusive by design.

2. **Context preservation is identical between V1 and V2.** Agents read session history from SQLite (populated by the Monitor). Process state is irrelevant. Resume via the SDK's `resume` option reloads full JSONL context in both V1 and V2.

3. **The 2–5 second startup overhead is noise.** Agent workflows are async and task-driven — Claude turns take minutes to tens of minutes. Sub-second initiation is not a Sprint 2 requirement.

4. **V1 is architecturally aligned with the housekeeping model.** Processes exist only during active turns. Between turns, zero processes, zero RAM. Housekeeping is purely a SQLite status concern — no SIGTERM needed.

5. **V2 adds risk without adding capability for Sprint 2 use cases.** The `unstable_` prefix, unverified `executableArgs` workaround, and limited typed options introduce SDK instability risk. None of the V2 advantages (sub-second initiation, "persistent terminal feel") are relevant for agent-driven API workflows.

The `SessionDriver` abstraction is still implemented — it keeps the door open for V2 when Anthropic stabilizes and expands the typed options, or when a use case emerges that requires persistent sessions.

---

## 7. Consequences (per option)

### If Option A is chosen (V2 + executableArgs)
- Sprint 2 plan assumes `executableArgs` works; no spike task needed
- Risk: if it doesn't work mid-implementation, Sprint 2 derails
- Must document the `executableArgs` workaround clearly for future maintainers

### If Option B is chosen (V1 only)
- Sprint 2 plan is simpler — single driver, proven API
- Spec Section 2 ("interactive only") is partially unmet — document as known limitation
- `SessionDriver` interface still defined, but only V1 driver implemented
- V2 driver becomes a future issue when Anthropic expands V2 options

### If Option C is chosen (spike first)
- Sprint 2 plan starts with spike task (Task 1, ~1 hour)
- Tasks 2+ depend on spike result but `SessionDriver` interface is defined regardless
- Plan must document both paths (V2 driver if spike succeeds, V1 driver if not)
- Best information-to-cost ratio

### If Option D is chosen (V2 + untyped opts)
- Sprint 2 plan assumes runtime passthrough works; `as any` assertions throughout
- Highest maintenance burden on SDK updates
- Not recommended

---

## 8. References

- Design spec Section 2: `docs/specs/2026-03-27-session-sentinel-design.md` (interactive only mandate)
- Design spec Section 4: architecture, Session Manager responsibilities
- Sprint 0 SDK spike: `docs/spikes/sprint0-sdk-interactive.md` (Option E recommendation)
- Sprint 0 Claude Remote spike: `docs/spikes/sprint0-claude-remote.md` (Section 3.2, V2 test results)
- SDK V1 docs: https://platform.claude.com/docs/en/agent-sdk/typescript
- SDK V2 docs: https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview
- Gateway reference: `/home/blasi/claude_code_gateway/src/session-manager.ts`
