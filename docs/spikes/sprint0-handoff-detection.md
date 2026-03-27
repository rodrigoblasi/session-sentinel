# Sprint 0 Spike: Managed-to-Unmanaged Handoff Detection

**Date:** 2026-03-27
**Status:** Complete
**Issue:** Sprint 0 investigation — handoff detection
**Author:** Automated investigation
**Depends on:** Task 2 (JSONL Format), Task 3 (Resume), Task 5 (SDK), Task 7 (Claude Remote)

---

## 1. The Problem

Sentinel spawns a managed session via the Claude Agent SDK. The session has an
assigned owner (an agent), and Sentinel is responsible for monitoring it and
delivering notifications.

At some point, one of these events may occur:

1. **User resumes via terminal** — runs `claude --resume <session-id>` in their
   shell. A new run starts on the same JSONL file under CLI ownership.
2. **User opens Claude Remote** — navigates to the session's `bridge_status`
   URL in a browser. Now a human is driving the session interactively.
3. **Sentinel crashes** — the SDK session handle is lost. The session may
   continue running (if the underlying process persists), or the user may find
   the session idle and resume it manually.
4. **Two SDK clients** — a second agent or process tries to manage the same
   session concurrently.

In all cases, Sentinel must detect the transition and downgrade the session
from `managed` to `unmanaged`. After transition:

- Stop sending notifications to the old owner (no owner to notify)
- Stop counting the session as managed in the dashboard
- Continue monitoring JSONL (read-only observation, never interfere)
- Record the handoff event in `session_events` for audit

---

## 2. JSONL Signals for Detecting Source of Input

### 2.1 The `entrypoint` Field

Every JSONL event carries an `entrypoint` field. Observed values across 78
sessions (22,787 events):

| Value | Meaning | Count |
|-------|---------|-------|
| `cli` | Session launched or resumed via `claude` CLI (interactive) | 47 sessions |
| `sdk-cli` | Session launched via `@anthropic-ai/claude-agent-sdk` (V1 `query()`) | 30 sessions |

**Critical finding:** The `entrypoint` field is **stamped at session startup
and does not change within a single run**. All events in a run carry the same
`entrypoint` value — it reflects how the current run was initiated, not who is
typing at this moment.

**Evidence for handoff detection:** Session `4e23878d` showed a real handoff in
the observed dataset. It started with `entrypoint: cli` for the first 345
events, then at event 346 (a `SessionStart:resume` hook event) the entrypoint
switched to `sdk-cli`. This confirms: **when a new run is initiated via a
different client, the `entrypoint` field changes at the run boundary**.

The handoff direction relevant to Sentinel is `sdk-cli` → `cli` (SDK-managed
session taken over by a terminal user).

### 2.2 The `permissionMode` Field

Present on `user` events that carry real user prompts (not tool results).
Observed values:

| Value | Meaning |
|-------|---------|
| `bypassPermissions` | All permission checks bypassed — typical for SDK/automation |
| `dontAsk` | Tool use allowed without prompting — used by some SDK configurations |
| `default` | Standard interactive mode — typical for a human in terminal |
| `plan` | Plan mode — human chose plan-mode in terminal |

Cross-tab of entrypoint × permissionMode on real user events:

| entrypoint | permissionMode | count |
|------------|----------------|-------|
| `cli` | `bypassPermissions` | 381 |
| `cli` | `default` | 2 |
| `cli` | `plan` | 3 |
| `cli` | (absent) | 115 |
| `sdk-cli` | `bypassPermissions` | 32 |
| `sdk-cli` | `dontAsk` | 3 |
| `sdk-cli` | (absent) | 27 |

**Key observation:** `default` and `plan` only appear on `cli` sessions. SDK
sessions only use `bypassPermissions` or `dontAsk`. However, `bypassPermissions`
is heavily used by both entrypoints (humans sometimes explicitly request bypass
mode).

**Evidence for real-world permissionMode transitions:** Two sessions showed
permissionMode changing mid-session:

- `26ad1495`: `bypassPermissions` → `plan` → `bypassPermissions` (user toggled
  plan mode during a CLI session — not a handoff, just mode switch)
- `9fdc4da1`: `bypassPermissions` → `default` (may indicate a resume by a
  different user with different settings — or the same user without bypass flag)

Both transitions happened within `cli` sessions (no entrypoint change), so
these are not handoffs. They confirm that permissionMode changes are **not
reliable as the sole handoff signal** — they reflect session configuration
choices, not client ownership changes.

### 2.3 The `userType` Field

Always `"external"` in all 3,283 observed user events. This field does not
distinguish between a human in the terminal and an SDK call. It is useless for
handoff detection.

### 2.4 `sourceToolUseID` / `toolUseResult`

Present on tool result user events (injected by Claude Code in response to tool
calls). Out of 3,283 user events, only 5 have `sourceToolUseID`. These are not
real user prompts and are irrelevant to handoff detection.

### 2.5 `bridge_status` and `entrypoint`

From Task 7 findings:

- `bridge_status` events appear **only** on `cli` sessions. Zero of 30 `sdk-cli`
  sessions produced a `bridge_status` event.
- If a managed session (SDK-initiated, `entrypoint: sdk-cli`) suddenly emits a
  `bridge_status` event in a new run, this would indicate the new run was CLI-
  initiated — a strong handoff signal.

However, `bridge_status` does not indicate who is *sending messages*, only who
started the run. A CLI-started run can still be driven programmatically if
Sentinel somehow re-attaches.

### 2.6 `SessionStart` Hook Event as Run Boundary

From Task 3 findings, when a session is resumed, a `SessionStart:resume` hook
event appears at the start of the new run. This hook carries the `entrypoint`
of the **new client doing the resume**.

Real evidence: Session `4e23878d` had `cli` runs followed by an `sdk-cli` resume
(the inverse of the Sentinel handoff scenario, but it confirms the mechanism).
For Sentinel, the scenario is: SDK-managed session resumed by terminal user →
`SessionStart:resume` with `entrypoint: cli`.

---

## 3. Detection Strategies

### Strategy A: Message Tracking (Sentinel tracks what it sends)

Sentinel logs every message it sends via the SDK (`session.send(message)` or
`query()` calls) including a unique identifier embedded in each message. The
Session Monitor watches the JSONL for new `user` events. If a `user` event
appears that Sentinel did NOT initiate — i.e., the `promptId` does not match
any pending Sentinel message — then a human or external agent sent it.

**How to embed identity:** Sentinel can include a marker in every SDK-sent
message body, e.g., `[sentinel-msg-id:abc123] <actual task>`. When the Monitor
sees a real user event (non-tool-result) without a known `promptId`, it
classifies it as an external prompt.

**Pros:**
- Works even if `entrypoint` does not change (e.g., another SDK client takes over)
- Does not rely on undocumented fields
- Can detect mid-run external injection without waiting for a new run boundary

**Cons:**
- Requires tight coupling between Session Manager (sends) and Session Monitor (reads)
- Race condition: Monitor must receive the `promptId` before the JSONL event
  appears (the SDK send and JSONL write are ~milliseconds apart)
- The embedded marker approach adds noise to session transcripts
- A user who starts typing before Sentinel sends anything will trigger a false
  positive on the very first user event (no expected `promptId`)
- Does not distinguish "new run started by user" from "external message injected
  into active Sentinel-managed run" (different severity)

**Verdict: Viable as a secondary layer, not appropriate as the primary mechanism.**

### Strategy B: `entrypoint` Field Change at Run Boundary

Sentinel monitors the JSONL for `SessionStart:resume` hook events (or
`bridge_status` events) that signal a new run started. If the `entrypoint` on
the new run events differs from the session's known `entrypoint` (which Sentinel
recorded when it created/resumed the session), the run was initiated by a
different client.

Specific trigger: A managed session (Sentinel holds SDK handle, last known
`entrypoint: sdk-cli`) sees a new run boundary where events carry `entrypoint: cli`
→ handoff to terminal user.

**Pros:**
- No message tracking or ID embedding needed
- Purely reactive — Monitor watches JSONL as normal
- `entrypoint` field is stable and reliable per-run (confirmed across 78 sessions)
- The run boundary detection logic already exists from Task 3 findings
- Confirmed by real-world evidence: `4e23878d` showed this exact transition

**Cons:**
- Only detects handoff at run boundaries (new resume), not mid-run injection
- Does not detect a human opening Claude Remote (no new run, no entrypoint change)
- Cannot detect a second SDK client taking over within the same run (both use
  `sdk-cli`)
- If the SDK V2 session creates a persistent process that the CLI resumes (same
  process, no new run boundary), this won't fire

**Verdict: The strongest primary signal. Should be the first-tier detector.**

### Strategy C: Process-Level Detection

Sentinel holds the SDK session handle. If:
- The SDK session's process terminates unexpectedly
- A `session.close()` or equivalent is never called but the JSONL keeps growing
- A new `SessionStart:resume` event appears in JSONL without Sentinel initiating
  a resume

Then Sentinel infers a handoff.

**Pros:**
- Process death is an unambiguous signal (Sentinel's SDK reference becomes invalid)
- Can detect Sentinel crash + user takeover on restart

**Cons:**
- SDK V2 internal process lifecycle is opaque — Sentinel may not get a reliable
  signal when the underlying `claude` process exits
- A background crash can be indistinguishable from network interruption
- On Sentinel restart, it must correlate its database (which sessions it managed)
  with current JSONL state to detect what changed while it was down

**Verdict: Necessary for crash recovery but not the primary live-monitoring signal.**

### Strategy D: `permissionMode` Change

If the `permissionMode` on new user events changes from a Sentinel-typical value
(`bypassPermissions` or `dontAsk`) to a human-typical value (`default` or
`plan`), this may indicate a handoff.

**Pros:**
- Works within a run (no boundary needed)
- `default` and `plan` exclusively appear on `cli` sessions in observed data

**Cons:**
- `bypassPermissions` is also used by humans explicitly — not a reliable
  separator
- Sentinel itself uses `bypassPermissions` (spec Section 2), making the expected
  value ambiguous if a human also enables bypass
- Changes are sparse and not guaranteed to signal a handoff (see `26ad1495` and
  `9fdc4da1` — both were same-client mode toggles)
- `permissionMode` can be absent entirely on user events

**Verdict: Too noisy. Only useful as a corroborating signal alongside Strategy B.**

### Strategy E: `bridge_status` in Previously SDK-Only Session

From Task 7: SDK V1 sessions (`entrypoint: sdk-cli`) never produce `bridge_status`.
If Sentinel observes a `bridge_status` event in a run that follows a known SDK-
managed run, the new run was CLI-initiated.

This is essentially a sub-case of Strategy B — `bridge_status` confirms that
the new run used the CLI. The `entrypoint` field on the hook events is the
canonical signal; `bridge_status` is a corroborating confirmation.

**Special case — Claude Remote while Sentinel manages:** A user opening the
session URL in a browser does NOT generate a new `bridge_status` event. The
bridge was already established when Sentinel launched the CLI session. Remote
access is transparent to the JSONL. There is no JSONL signal for a human
connecting via Claude Remote to an already-running session.

**Verdict: Good corroborating signal for Strategy B. Does not add standalone
detection capability.**

---

## 4. Recommended Strategy

### Primary: Strategy B + C combined (entrypoint change at run boundary + process monitoring)

**Tier 1 — Run boundary handoff detection (Strategy B):**

When the Session Monitor detects a new run boundary (via `SessionStart:resume`
hook, new `bridge_status`, or `last-prompt` → new events pattern), it checks
the `entrypoint` of the new run's first event against the session's recorded
`entrypoint` in the database.

```
IF sessions.managed == true
AND sessions.last_entrypoint == 'sdk-cli'
AND new_run.entrypoint == 'cli'
THEN trigger: HANDOFF_DETECTED
```

Action: Set `sessions.managed = false`, set `sessions.owner = null`, emit
`session_events` record with `type: handoff`, stop sending owner notifications.

**Tier 2 — Sentinel process death / SDK handle loss (Strategy C):**

When Sentinel restarts after a crash, on startup it reconciles:
- All sessions in DB marked `managed = true`
- Against current JSONL state (how many runs have accumulated, current entrypoint)

If a managed session has a new run with `entrypoint: cli` that Sentinel did not
initiate (no corresponding `managed_run` record in the DB), trigger handoff
detection retroactively.

If a managed session shows only SDK runs but the SDK handle is invalid (process
gone), mark the session as `managed_pending_recovery` — a state where Sentinel
can attempt to re-resume or surface to the operator for decision.

**Tier 3 — Message tracking (Strategy A, optional):**

As a defense-in-depth layer, Sentinel can track `promptId` values for every
message it sends. If a real user event (no `toolUseResult`, no `sourceToolUseID`)
appears in an active managed run with a `promptId` that Sentinel did not send,
escalate to `HANDOFF_SUSPECTED`. This requires no in-message markers — just
correlating `promptId` fields.

Note: `promptId` is present on SDK-sent real user events (confirmed in observed
data) but may not always match a Sentinel-issued message. This tier requires
careful implementation to avoid false positives.

---

## 5. Edge Cases

### 5.1 User Opens Claude Remote While Sentinel Manages

The user navigates to the `bridge_status` URL in their browser. A human is now
observing and potentially sending messages to the same process Sentinel manages.

**JSONL signals:** None. Claude Remote connections leave no trace in the JSONL
beyond the standard `user` events they inject. From the JSONL perspective, a
message typed in Claude Remote looks identical to a message sent by Sentinel
via SDK.

**Detection options:**
- Strategy A (message tracking) would catch this if the human sends a message
  Sentinel did not initiate.
- No passive detection is possible without Strategy A.

**Decision:** This scenario is partially detectable only with Strategy A
(Tier 3 message tracking). For the primary use case (agent-managed sessions),
the operator opening Claude Remote to observe is acceptable and expected — it is
a feature, not a violation. Only if the human *sends messages* does it become a
handoff concern.

**Recommended handling:** Flag as `HANDOFF_SUSPECTED` if an unexpected `promptId`
appears in an active managed run, but do not immediately downgrade — surface to
operator via dashboard. The operator can confirm or dismiss.

### 5.2 User Resumes Managed Session via `claude --resume`

This is the canonical handoff case. The user runs `claude --resume <session-id>`
in their terminal.

**JSONL signals:**
- `SessionStart:resume` hook event with `entrypoint: cli` (if hooks configured)
- New `bridge_status` event (CLI-launched run = bridge active)
- New user event with `entrypoint: cli` following a `last-prompt` boundary

**Detection:** Strategy B catches this definitively. The run boundary is clear
and the `entrypoint` change is unambiguous.

**Recommended handling:** Downgrade immediately to `unmanaged` upon detection.
Log handoff event. Stop owner notifications.

### 5.3 Sentinel Crashes; User Takes Over; Sentinel Restarts

On crash: Sentinel's SDK handle is lost. The underlying `claude` process may
continue (if it was a persistent V2 session) or may have exited (if the SDK
terminated it on close).

On user takeover: User may resume via `claude --resume`. New CLI run appears
in JSONL.

On Sentinel restart:
1. Load all sessions from DB that have `managed = true`
2. For each, read the current JSONL and check:
   - Is there a new run boundary since the last recorded run?
   - If yes: what is the `entrypoint` of the new run?
   - If `cli`: trigger handoff detection (downgrade to unmanaged)
   - If `sdk-cli`: unexpected — another SDK client may have taken over

**Decision:** The startup reconciliation (Strategy C) handles this case.
Sentinel must store `last_run_id` and `last_run_entrypoint` in the DB so it can
compare against current JSONL state on restart.

### 5.4 Two SDK Clients Try to Manage the Same Session

One Sentinel instance is managing a session. A second SDK client (or a second
Sentinel instance on restart) calls `unstable_v2_resumeSession(id)`.

**JSONL signals:** The second resume creates a new `SessionStart:resume` hook
event with `entrypoint: sdk-cli`. Both runs share the file. From JSONL alone,
you cannot distinguish which SDK instance sent which message.

**Detection:** Strategy A (promptId tracking) is the only viable mechanism.
Sentinel can detect that a `user` event with `promptId` it did not issue appeared
in what it believed was its managed run.

**Decision:** This case is rare and requires explicit protection at the Session
Manager level: when creating or resuming a managed session, record a claim in
the DB with an expiry (`managed_by: sentinelInstanceId`, `claimed_at`). On any
SDK resume attempt, check if an active claim exists. For now, document this as
a known limitation to address in Sprint 1.

### 5.5 Session Created by User in Terminal (entrypoint: cli), Then Managed by Sentinel

The inverse of the main scenario. User starts a session interactively, then
Sentinel tries to make it managed (e.g., an agent requests ownership of an
existing session).

In this case, the "new run" initiated by Sentinel would have `entrypoint: sdk-cli`.
The handoff detection logic is symmetric — any run boundary with an `entrypoint`
change is a potential ownership change, regardless of direction.

---

## 6. Impact on Session Manager

The Session Manager must implement:

### 6.1 Entrypoint Recording

When creating or resuming a managed session:
- Record `sessions.last_entrypoint = 'sdk-cli'` (for SDK V1 or V2)
- Record `runs.entrypoint = 'sdk-cli'` for the current run
- Record `runs.sentinel_managed = true` for runs initiated by Sentinel

### 6.2 Run Boundary Watch in Session Monitor

The Session Monitor already detects run boundaries (Task 3 decision). Extend
the boundary handler:

```typescript
function onRunBoundary(session: Session, newRunEntrypoint: string): void {
  if (session.managed && session.lastEntrypoint === 'sdk-cli' && newRunEntrypoint === 'cli') {
    triggerHandoff(session, 'new-cli-run');
  }
  session.lastEntrypoint = newRunEntrypoint;
}
```

### 6.3 Handoff Event Recording

When handoff is detected, write to `session_events`:

```sql
INSERT INTO session_events (session_id, type, payload, created_at)
VALUES (
  :sessionId,
  'handoff',
  json_object(
    'from_owner', :previousOwner,
    'trigger',    :trigger,          -- 'new-cli-run' | 'crash-recovery' | 'unexpected-prompt'
    'run_id',     :newRunId
  ),
  CURRENT_TIMESTAMP
);
```

### 6.4 Startup Reconciliation

On Sentinel startup:

```typescript
async function reconcileManagedSessions(db: Database, monitor: Monitor): Promise<void> {
  const managedSessions = db.prepare(
    'SELECT * FROM sessions WHERE managed = true'
  ).all();

  for (const session of managedSessions) {
    const currentEntrypoint = await monitor.getLatestRunEntrypoint(session.claude_session_id);
    if (currentEntrypoint === 'cli' && session.last_entrypoint === 'sdk-cli') {
      // Handoff occurred while Sentinel was down
      triggerHandoff(session, 'crash-recovery');
    }
  }
}
```

### 6.5 SDK Handle Validity Check

For SDK V2 sessions, the Manager should maintain a heartbeat or check that
`session.stream()` is still yielding events. If the session object becomes
invalid (throws on `send()` or `stream()`), mark as `managed_pending_recovery`
and alert operator.

---

## 7. Decision

### 7.1 Primary Detection Mechanism

**Use Strategy B as the primary handoff detector: watch for `entrypoint` change
at run boundaries.**

The `entrypoint` field is stable per-run, reliably stamped, and confirmed by
real-world evidence (`4e23878d` showed a CLI→SDK transition; the inverse SDK→CLI
is the Sentinel handoff scenario). This requires no message ID tracking, no
in-band markers, and no additional infrastructure beyond the run boundary
detection already required by Task 3.

### 7.2 Fallback Mechanism

**Use Strategy C (startup reconciliation) as the fallback for crash recovery.**

When Sentinel restarts, it must reconcile managed sessions against current JSONL
state. Any managed session with a CLI-entrypoint run that Sentinel did not
initiate triggers a retroactive handoff.

### 7.3 Optional Layer

**Implement Strategy A (promptId tracking) as a Sprint 2 enhancement, not Sprint 1.**

The primary scenarios (terminal resume, crash recovery) are handled by B and C.
Strategy A adds defense against mid-run injection via Claude Remote, but it
requires careful implementation and is lower priority.

### 7.4 Claude Remote Handoff

**Do not attempt to detect Claude Remote connections passively.** There is no
JSONL signal for a browser connecting to a running session. The operator opening
Claude Remote to observe is acceptable behavior. If they send messages, Strategy A
(Tier 3) would catch it via unexpected `promptId`. Surface as `HANDOFF_SUSPECTED`
rather than immediately downgrading — let the operator confirm.

### 7.5 Summary Table

| Scenario | Primary signal | Reliability | Action |
|----------|---------------|-------------|--------|
| User `claude --resume` | `entrypoint: cli` on new run boundary | High | Immediate downgrade to unmanaged |
| Sentinel crash + user resume | Startup reconciliation, `entrypoint: cli` | High | Retroactive downgrade on restart |
| User opens Claude Remote | No passive signal | None passively | Strategy A (optional) if they send messages |
| Second SDK client takes over | Same `entrypoint: sdk-cli`, unexpected `promptId` | Low (optional) | Strategy A (optional), Sprint 2 |
| User resumes with `--fork-session` | New JSONL file, new session | N/A — new Session | Monitor detects new unmanaged session |

---

## Appendix A: Observed Data Supporting Strategy B

Session `4e23878d-ee24-4ba0-a354-606195215a79` from `finance.blasi/development`:

- Events 0–345: `entrypoint: cli` (user-initiated CLI session)
- Event 346: `progress/hook_progress` with `hookName: SessionStart:resume`,
  `entrypoint: sdk-cli` — the Gateway SDK resumed the session
- Events 346–357: `entrypoint: sdk-cli` (SDK-managed run)

This is the real-world inverse of Sentinel's handoff scenario (CLI → SDK, not
SDK → CLI). It confirms that `entrypoint` changes at run boundaries and that the
new run's `entrypoint` reflects the client that initiated the resume.

The same mechanism works for Sentinel: a session started by Sentinel (`sdk-cli`)
resumed by a user (`cli`) will show the same entrypoint transition at the run
boundary.

---

## Appendix B: Field Reference for Handoff Detection

| Field | Location | Handoff use |
|-------|----------|-------------|
| `entrypoint` | All JSONL events | Primary signal: `sdk-cli` → `cli` at run boundary |
| `permissionMode` | `user` events | Corroborating: `default`/`plan` → likely human |
| `promptId` | `user` events (real prompts) | Optional: track Sentinel-issued IDs vs. externals |
| `SessionStart:resume` hook | `progress/hook_progress` events | Run boundary marker |
| `bridge_status` | `system` events | Corroborating: CLI-run confirmation |
| `last-prompt` | End-of-run events | Run boundary marker |

---

## Appendix C: References

- Task 2 JSONL format: `docs/spikes/sprint0-jsonl-format.md`
- Task 3 resume identity: `docs/spikes/sprint0-resume-identity.md`
- Task 5 SDK interactive: `docs/spikes/sprint0-sdk-interactive.md`
- Task 7 Claude Remote: `docs/spikes/sprint0-claude-remote.md`
- Spec Section 3: Session vs Run, Managed vs Unmanaged, Ownership
- Evidence session: `~/.claude/projects/-home-blasi-finance-blasi-development/4e23878d-ee24-4ba0-a354-606195215a79.jsonl`
