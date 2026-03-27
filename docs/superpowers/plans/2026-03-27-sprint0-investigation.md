# Sprint 0 — Investigation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Investigate the 6 unknowns from the design spec (Section 11) that must be answered before implementation begins. Each investigation produces a findings document in `docs/spikes/` and proof-of-concept scripts in `sandbox/sprint0/`.

**Architecture:** Sprint 0 is research, not implementation. Deliverables are findings documents, analysis scripts, and decisions. No production code. All experiments go in `sandbox/sprint0/`. All findings go in `docs/spikes/`.

**Tech Stack:** Node.js v22 (already installed), shell scripts, Python 3 for quick analysis. No package.json or TypeScript compilation needed for Sprint 0 — scripts run directly with `node` or `python3`.

---

## Pre-requisites

Each investigation should be a GitHub issue with `type: spike`, `sprint: 0` labels, and a `spike/N-short-description` branch. Create the issues before starting. Per CLAUDE.md: one issue at a time, complete and merge before starting the next.

## What we already know

Preliminary analysis has revealed key facts that investigations should verify and extend:

- **JSONL path pattern:** `~/.claude/projects/{encoded-cwd}/{uuid}.jsonl`
- **sessionId = filename UUID** (e.g., file `79959980-...jsonl` has `sessionId: "79959980-..."`)
- **slug** is a human-readable auto-name (e.g., `"frolicking-munching-hare"`) — not the session ID
- **Event types observed:** `assistant`, `user`, `progress`, `file-history-snapshot`, `system:bridge_status`, `system:stop_hook_summary`, `system:turn_duration`, `last-prompt`
- **Progress subtypes:** `hook_progress` (Claude hooks), `agent_progress` (sub-agents)
- **Claude Remote URL:** Found in `system:bridge_status` event → `url` field
- **Sub-agent files:** `{conversation-uuid}/subagents/agent-{id}.jsonl` + `.meta.json`
- **Sub-agent meta:** `{"agentType": "Explore", "description": "..."}`
- **Common event fields:** `parentUuid`, `isSidechain`, `sessionId`, `slug`, `timestamp`, `cwd`, `gitBranch`, `userType`, `version`, `uuid`

## Reference implementations

Two existing codebases have solved related problems. Read before investigating:

| Codebase | Path | What to learn |
|----------|------|---------------|
| **Claude Code Gateway** (discontinued) | `/home/blasi/claude_code_gateway/src/` | JSONL tailing (`session-watcher.ts`), stream parsing (`session-manager.ts`), types (`types.ts`), notifications (`notification-engine.ts`) |
| **Claude Karma** | `/home/blasi/claude-code-karma/` | JSONL parsing (`api/models/jsonl_utils.py`), session metadata (`api/models/session.py`), live tracking hooks (`hooks/live_session_tracker.py`), DB indexing (`api/db/indexer.py`) |

**Notification script:** `/home/blasi/.openclaw/scripts/agent-notify.sh`

---

## File Structure

### Files to create

```
sandbox/sprint0/
  jsonl-event-catalog.mjs       Task 2 — catalogs all JSONL event types across sessions
  token-extractor.mjs           Task 2 — extracts and accumulates token usage from JSONL
  resume-detector.mjs           Task 3 — tests whether --resume creates new file or appends
  subagent-scanner.mjs          Task 4 — scans projects dir for sub-agent relationships

docs/spikes/
  sprint0-jsonl-format.md       Task 2 — JSONL format: event types, schemas, examples
  sprint0-resume-identity.md    Task 3 — resume behavior, Session vs Run mapping
  sprint0-subagent-detection.md Task 4 — sub-agent file structure and linking strategy
  sprint0-sdk-interactive.md    Task 5 — SDK capabilities for programmatic interaction
  sprint0-agent-notify.md       Task 6 — notification script review and payload design
  sprint0-claude-remote.md      Task 7 — Claude Remote URL capture and integration
  sprint0-handoff-detection.md  Task 8 — managed-to-unmanaged handoff detection strategy
  sprint0-summary.md            Task 9 — consolidated findings, decisions, spec amendments
```

### Reference files to read (not modified)

```
/home/blasi/claude_code_gateway/src/types.ts                          Gateway types & status enum
/home/blasi/claude_code_gateway/src/session-watcher.ts                Gateway JSONL tailing logic
/home/blasi/claude_code_gateway/src/session-manager.ts                Gateway stream parsing
/home/blasi/claude_code_gateway/src/notification-engine.ts            Gateway notification format
/home/blasi/claude-code-karma/api/models/jsonl_utils.py               Karma JSONL parser
/home/blasi/claude-code-karma/api/models/session.py                   Karma session metadata extraction
/home/blasi/claude-code-karma/hooks/live_session_tracker.py           Karma live session hooks
/home/blasi/.openclaw/scripts/agent-notify.sh                         Notification bridge script
~/.claude/projects/                                                   Real JSONL session data
```

---

## Task 1: Sprint 0 Setup

**Files:**
- Create: `sandbox/sprint0/` (directory)
- Create: `docs/spikes/` (directory)

- [ ] **Step 1: Create directory structure**

```bash
cd /home/blasi/session-sentinel
mkdir -p sandbox/sprint0
mkdir -p docs/spikes
```

- [ ] **Step 2: Verify tooling**

```bash
node --version   # Expect: v22.x
python3 --version  # Expect: 3.x
claude --version   # Expect: 2.x (Claude Code CLI)
```

All three must be available. If not, install before proceeding.

- [ ] **Step 3: Verify JSONL data exists**

```bash
ls ~/.claude/projects/ | head -10
```

Expected: Multiple directories with encoded project paths (e.g., `-home-blasi-session-sentinel`).

- [ ] **Step 4: Commit setup**

```bash
git checkout -b spike/N-sprint0-setup
git add sandbox/.gitkeep docs/spikes/.gitkeep
git commit -m "spike(infra): create sandbox and spikes directories — closes #N"
```

(Replace `N` with the actual GitHub issue number.)

---

## Task 2: JSONL Format Study

**Goal:** Document every JSONL event type — its schema, when it appears, and what data Sentinel can extract from it. This is the foundational investigation; Tasks 3, 4, 7, and 8 build on it.

**Files:**
- Create: `sandbox/sprint0/jsonl-event-catalog.mjs`
- Create: `sandbox/sprint0/token-extractor.mjs`
- Create: `docs/spikes/sprint0-jsonl-format.md`

**Reference — read first:**
- `/home/blasi/claude_code_gateway/src/session-watcher.ts:87-300` — Gateway's `processFile()` and `tailNewLines()` show how to incrementally read JSONL and extract metrics
- `/home/blasi/claude_code_gateway/src/session-manager.ts:205-298` — Gateway's `handleStreamLine()` shows event parsing patterns
- `/home/blasi/claude-code-karma/api/models/session.py:326+` — Karma's `_load_metadata()` does single-pass extraction of timestamps, tokens, tools, branches, models

- [ ] **Step 1: Write the event catalog script**

Create `sandbox/sprint0/jsonl-event-catalog.mjs`:

```javascript
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects');
const targetProject = process.argv[2]; // optional: filter by project name substring

const eventSchemas = new Map();
let totalFiles = 0;
let totalLines = 0;

for (const projDir of readdirSync(PROJECTS_ROOT)) {
  if (targetProject && !projDir.includes(targetProject)) continue;
  const projPath = join(PROJECTS_ROOT, projDir);
  if (!statSync(projPath).isDirectory()) continue;

  for (const file of readdirSync(projPath)) {
    if (!file.endsWith('.jsonl')) continue;
    totalFiles++;
    const filePath = join(projPath, file);
    const content = readFileSync(filePath, 'utf-8');

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      totalLines++;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }

      const type = evt.type || 'unknown';
      const subtype = evt.subtype || '';
      const key = subtype ? `${type}:${subtype}` : type;

      if (!eventSchemas.has(key)) {
        eventSchemas.set(key, {
          count: 0,
          topLevelKeys: new Set(),
          sample: null,
          files: new Set(),
        });
      }
      const schema = eventSchemas.get(key);
      schema.count++;
      schema.files.add(basename(filePath));
      for (const k of Object.keys(evt)) schema.topLevelKeys.add(k);
      if (!schema.sample) schema.sample = evt;
    }
  }
}

console.log(`Scanned ${totalFiles} JSONL files, ${totalLines} lines\n`);
console.log('=== Event Type Catalog ===\n');

for (const [key, schema] of [...eventSchemas.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`## ${key}`);
  console.log(`  Count: ${schema.count} (across ${schema.files.size} files)`);
  console.log(`  Top-level keys: ${[...schema.topLevelKeys].sort().join(', ')}`);
  console.log(`  Sample (truncated):`);
  const sampleStr = JSON.stringify(schema.sample, (k, v) => {
    if (typeof v === 'string' && v.length > 150) return v.substring(0, 150) + '...';
    if (Array.isArray(v) && v.length > 3) return [...v.slice(0, 3), `... (${v.length} items)`];
    return v;
  }, 2);
  console.log(`  ${sampleStr.substring(0, 600)}`);
  console.log();
}
```

- [ ] **Step 2: Run the event catalog across all projects**

```bash
cd /home/blasi/session-sentinel
node sandbox/sprint0/jsonl-event-catalog.mjs > sandbox/sprint0/event-catalog-output.txt
```

Expected: A catalog of all event types with counts, keys, and samples. Key types to look for:
- `assistant` — Claude responses, contains `message.usage` (tokens) and `message.content` (tool calls)
- `user` — User messages, contains `message.content`
- `progress` — Hook/agent progress, subtypes: `hook_progress`, `agent_progress`
- `system:bridge_status` — Claude Remote URL in `url` field
- `system:turn_duration` — Turn timing in `durationMs`
- `system:stop_hook_summary` — Hook execution results
- `file-history-snapshot` — File state snapshots
- `last-prompt` — Session's last prompt reference

- [ ] **Step 3: Write the token extractor script**

Create `sandbox/sprint0/token-extractor.mjs`:

```javascript
import { readFileSync } from 'fs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node token-extractor.mjs <path-to-jsonl>');
  process.exit(1);
}

const content = readFileSync(filePath, 'utf-8');
const turns = [];
let currentTurn = null;

for (const line of content.split('\n')) {
  if (!line.trim()) continue;
  let evt;
  try { evt = JSON.parse(line); } catch { continue; }

  if (evt.type === 'user' && evt.message?.role === 'user') {
    if (currentTurn) turns.push(currentTurn);
    currentTurn = {
      turnNumber: turns.length + 1,
      userContent: typeof evt.message.content === 'string'
        ? evt.message.content.substring(0, 80)
        : '(structured)',
      inputTokens: 0,
      outputTokens: 0,
      cacheHits: 0,
      toolCalls: [],
      questions: [],
      timestamp: evt.timestamp,
    };
  }

  if (evt.type === 'assistant' && evt.message?.usage) {
    const u = evt.message.usage;
    if (currentTurn) {
      currentTurn.inputTokens += u.input_tokens || 0;
      currentTurn.outputTokens += u.output_tokens || 0;
      currentTurn.cacheHits += u.cache_read_input_tokens || 0;
    }
  }

  if (evt.type === 'assistant' && Array.isArray(evt.message?.content)) {
    for (const block of evt.message.content) {
      if (block.type === 'tool_use' && block.name && currentTurn) {
        currentTurn.toolCalls.push(block.name);
        if (block.name === 'AskUserQuestion' || block.name === 'AskFollowupQuestions') {
          const q = block.input?.question || block.input?.text || '(no text)';
          currentTurn.questions.push(q.substring(0, 120));
        }
      }
    }
  }
}
if (currentTurn) turns.push(currentTurn);

let totalIn = 0, totalOut = 0, totalCache = 0;
console.log('=== Token Usage Per Turn ===\n');
for (const t of turns) {
  totalIn += t.inputTokens;
  totalOut += t.outputTokens;
  totalCache += t.cacheHits;
  console.log(`Turn ${t.turnNumber}: in=${t.inputTokens} out=${t.outputTokens} cache=${t.cacheHits}`);
  console.log(`  User: ${t.userContent}`);
  if (t.toolCalls.length) console.log(`  Tools: ${t.toolCalls.join(', ')}`);
  if (t.questions.length) console.log(`  Questions: ${t.questions.join('; ')}`);
  console.log();
}

console.log('=== Totals ===');
console.log(`Input:  ${totalIn.toLocaleString()}`);
console.log(`Output: ${totalOut.toLocaleString()}`);
console.log(`Cache:  ${totalCache.toLocaleString()}`);
console.log(`Total:  ${(totalIn + totalOut).toLocaleString()}`);
console.log(`Turns:  ${turns.length}`);
```

- [ ] **Step 4: Run token extractor against a real session**

```bash
node sandbox/sprint0/token-extractor.mjs \
  ~/.claude/projects/-home-blasi-finance-blasi-development/0ae38a42-80dd-43fd-b676-6a80c2c4b321.jsonl
```

Expected: Per-turn token breakdown showing `input_tokens`, `output_tokens`, `cache_read_input_tokens` accumulation. Verify that tokens come from `assistant` events → `message.usage`.

- [ ] **Step 5: Document the JSONL format findings**

Create `docs/spikes/sprint0-jsonl-format.md` with this structure:

```markdown
# Sprint 0 Finding: JSONL Format

**Investigation:** Claude Code SDK/JSONL study (Spec Section 11.1)
**Date:** 2026-03-27
**Status:** Complete

## File Organization

- Path pattern: `~/.claude/projects/{encoded-cwd}/{conversation-uuid}.jsonl`
- Encoding: forward slashes and special chars in cwd become hyphens
- Each conversation also has a directory: `{conversation-uuid}/` containing `subagents/` and `tool-results/`

## Event Types

### assistant
- **When:** Every Claude response (may be multiple per turn due to streaming)
- **Key fields:** `message.usage` (tokens), `message.content` (array of text/tool_use blocks)
- **Token extraction:** `message.usage.input_tokens`, `message.usage.output_tokens`, `message.usage.cache_read_input_tokens`
- **Tool detection:** `message.content[].type === 'tool_use'` → `.name`, `.input`
- **Question detection:** tool_use with name `AskUserQuestion` or `AskFollowupQuestions`
  - Question text: `.input.question` or `.input.text`
- **Schema:**
  (paste actual sample from catalog output)

### user
- **When:** Every user message
- **Key fields:** `message.content` (string), `promptId`, `toolUseResult` (if responding to tool)
- **Schema:**
  (paste actual sample)

(... continue for each event type ...)

## Common Fields Across Events

| Field | Description | Present in |
|-------|-------------|------------|
| `type` | Event type | all |
| `subtype` | Event subtype | system events |
| `sessionId` | Claude session UUID (= filename) | most |
| `slug` | Human-readable session name | most |
| `parentUuid` | UUID of parent event | most |
| `uuid` | This event's UUID | most |
| `timestamp` | ISO 8601 | most |
| `cwd` | Working directory | most |
| `gitBranch` | Current git branch | most |
| `isSidechain` | Whether this is a side-chain event | most |
| `userType` | User type identifier | most |
| `version` | Claude Code version | most |

## Token Accumulation Strategy

(document the accumulation pattern verified by token-extractor.mjs)

## Status Inference from JSONL Events

| Sentinel Status | JSONL Signal |
|----------------|-------------|
| active | Recent `assistant` events with tool_use |
| waiting | `assistant` event with `AskUserQuestion` tool_use, no subsequent `user` event |
| idle | No new events for N minutes |
| error | (document what error events look like) |
| ended | (document — `system:stop_hook_summary`? process exit?) |

## Decisions for Implementation

- (list decisions that affect the data model or Monitor design)
```

Fill in every section with actual data from the catalog and extractor outputs.

- [ ] **Step 6: Commit**

```bash
git add sandbox/sprint0/jsonl-event-catalog.mjs sandbox/sprint0/token-extractor.mjs docs/spikes/sprint0-jsonl-format.md
git commit -m "spike(monitor): document JSONL format — event types, tokens, status signals — closes #N"
```

---

## Task 3: Resume & Session Identity

**Goal:** Answer: does `claude --resume` create a new JSONL file or append to the existing one? How does Sentinel map Claude's model to its Session + Runs model?

**Files:**
- Create: `sandbox/sprint0/resume-detector.mjs`
- Create: `docs/spikes/sprint0-resume-identity.md`

**Key context:** Preliminary analysis found that `sessionId` = filename UUID, and `slug` is a human-readable name. No resumed sessions were found across 61 JSONL files (all slugs unique per file). This suggests either: (a) resumes append to the same file, (b) resumes are rare in this dataset, or (c) resumes create new files with new UUIDs but share the slug.

- [ ] **Step 1: Search for resume evidence in existing JSONL files**

Create `sandbox/sprint0/resume-detector.mjs`:

```javascript
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects');

// Strategy 1: Look for multiple sessionIds in the same JSONL file (resume = append)
// Strategy 2: Look for `--resume` or resume-related events in JSONL content
// Strategy 3: Check for system:init events that indicate a resume

const results = [];

for (const projDir of readdirSync(PROJECTS_ROOT)) {
  const projPath = join(PROJECTS_ROOT, projDir);
  if (!statSync(projPath).isDirectory()) continue;

  for (const file of readdirSync(projPath)) {
    if (!file.endsWith('.jsonl')) continue;
    const filePath = join(projPath, file);
    const content = readFileSync(filePath, 'utf-8');

    const sessionIds = new Set();
    const slugs = new Set();
    let hasResumeSignal = false;
    let lineCount = 0;
    const systemEvents = [];

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      lineCount++;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }

      if (evt.sessionId) sessionIds.add(evt.sessionId);
      if (evt.slug) slugs.add(evt.slug);

      // Look for resume-related signals
      if (evt.type === 'system') {
        systemEvents.push({ subtype: evt.subtype, content: String(evt.content || '').substring(0, 100) });
      }
      if (JSON.stringify(evt).includes('resume')) {
        hasResumeSignal = true;
      }
    }

    if (sessionIds.size > 1 || hasResumeSignal || slugs.size > 1) {
      results.push({
        file: filePath,
        sessionIds: [...sessionIds],
        slugs: [...slugs],
        hasResumeSignal,
        lineCount,
        systemEvents,
      });
    }
  }
}

if (results.length === 0) {
  console.log('No resume evidence found in existing JSONL files.');
  console.log('Next step: manually test `claude --resume` and observe file behavior.');
} else {
  console.log(`Found ${results.length} files with resume signals:\n`);
  for (const r of results) {
    console.log(`File: ${r.file}`);
    console.log(`  SessionIds: ${r.sessionIds.join(', ')}`);
    console.log(`  Slugs: ${r.slugs.join(', ')}`);
    console.log(`  Resume signal: ${r.hasResumeSignal}`);
    console.log(`  Lines: ${r.lineCount}`);
    if (r.systemEvents.length) {
      console.log(`  System events: ${JSON.stringify(r.systemEvents)}`);
    }
    console.log();
  }
}
```

- [ ] **Step 2: Run the resume detector**

```bash
node sandbox/sprint0/resume-detector.mjs
```

Expected: Either evidence of resumes in existing data, or confirmation that manual testing is needed.

- [ ] **Step 3: Manually test resume behavior**

In a **separate terminal** (not this Claude session), run:

```bash
# Start a session in the sandbox directory
cd /home/blasi/session-sentinel/sandbox
claude "Say hello and tell me your session ID"
# Note: after Claude responds, exit with Ctrl+C or /exit
# Record: the JSONL filename created, the sessionId, the slug

# Now resume it
claude --resume
# Claude should show recent sessions. Pick the one you just created.
# After it responds, exit again.
# Record: did a NEW JSONL file appear, or did the existing one grow?
```

Check the filesystem:
```bash
ls -la ~/.claude/projects/-home-blasi-session-sentinel-sandbox/*.jsonl
# Compare timestamps and sizes before/after resume
```

- [ ] **Step 4: Document resume behavior**

Create `docs/spikes/sprint0-resume-identity.md`:

```markdown
# Sprint 0 Finding: Resume & Session Identity

**Investigation:** How `--resume` maps to Session + Runs model (Spec Section 3, 11.1)
**Date:** 2026-03-27
**Status:** Complete

## How Claude Code Represents Sessions

- One JSONL file per conversation: `{conversation-uuid}.jsonl`
- `sessionId` field in events = filename UUID
- `slug` = human-readable auto-generated name (e.g., "frolicking-munching-hare")

## Resume Behavior

(Document findings from manual test):
- Does `--resume` create a new JSONL file? [yes/no]
- Does it append to the existing file? [yes/no]
- Does sessionId change? [yes/no]
- Does slug change? [yes/no]
- Any new event types on resume? (e.g., system:resume_init?)

## Mapping to Sentinel's Session + Runs Model

| Claude Code concept | Sentinel concept | Linking strategy |
|--------------------|-----------------| ----------------|
| (fill based on findings) | Session | |
| (fill based on findings) | Run | |

## Decision

(State the mapping decision and why. This directly affects the `sessions` and `runs` table design.)
```

- [ ] **Step 5: Commit**

```bash
git add sandbox/sprint0/resume-detector.mjs docs/spikes/sprint0-resume-identity.md
git commit -m "spike(monitor): investigate resume behavior and session identity mapping — closes #N"
```

---

## Task 4: Sub-agent Detection

**Goal:** Document how sub-agent sessions are stored in the filesystem and define a strategy for linking them to parent sessions.

**Files:**
- Create: `sandbox/sprint0/subagent-scanner.mjs`
- Create: `docs/spikes/sprint0-subagent-detection.md`

**Key context:**
- Sub-agent files live at: `{conversation-uuid}/subagents/agent-{id}.jsonl`
- Meta files: `{conversation-uuid}/subagents/agent-{id}.meta.json`
- Known meta structure: `{"agentType": "Explore", "description": "..."}`
- `progress` events with `data.type === "agent_progress"` appear in the parent JSONL

- [ ] **Step 1: Write the sub-agent scanner**

Create `sandbox/sprint0/subagent-scanner.mjs`:

```javascript
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects');
const relationships = [];

for (const projDir of readdirSync(PROJECTS_ROOT)) {
  const projPath = join(PROJECTS_ROOT, projDir);
  if (!statSync(projPath).isDirectory()) continue;

  for (const entry of readdirSync(projPath)) {
    const entryPath = join(projPath, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    // This is a conversation directory — check for subagents/
    const subagentsDir = join(entryPath, 'subagents');
    if (!existsSync(subagentsDir)) continue;

    const parentJsonl = join(projPath, entry + '.jsonl');
    const hasParentJsonl = existsSync(parentJsonl);

    for (const subFile of readdirSync(subagentsDir)) {
      if (!subFile.endsWith('.meta.json')) continue;

      const metaPath = join(subagentsDir, subFile);
      const agentId = subFile.replace('.meta.json', '');
      const agentJsonl = join(subagentsDir, agentId + '.jsonl');

      let meta = {};
      try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch {}

      let agentLineCount = 0;
      let agentTokens = { input: 0, output: 0 };
      if (existsSync(agentJsonl)) {
        const content = readFileSync(agentJsonl, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          agentLineCount++;
          try {
            const evt = JSON.parse(line);
            const usage = evt.message?.usage;
            if (usage) {
              agentTokens.input += usage.input_tokens || 0;
              agentTokens.output += usage.output_tokens || 0;
            }
          } catch {}
        }
      }

      relationships.push({
        project: projDir,
        parentConversation: entry,
        hasParentJsonl,
        agentId,
        agentType: meta.agentType || 'unknown',
        description: meta.description || '',
        agentLineCount,
        agentTokens,
      });
    }
  }
}

console.log(`Found ${relationships.length} sub-agent sessions:\n`);

const byProject = {};
for (const r of relationships) {
  if (!byProject[r.project]) byProject[r.project] = [];
  byProject[r.project].push(r);
}

for (const [proj, agents] of Object.entries(byProject)) {
  console.log(`Project: ${proj}`);
  for (const a of agents) {
    console.log(`  Parent: ${a.parentConversation} (JSONL exists: ${a.hasParentJsonl})`);
    console.log(`    Agent: ${a.agentId}`);
    console.log(`    Type: ${a.agentType} — "${a.description}"`);
    console.log(`    Lines: ${a.agentLineCount}, Tokens: in=${a.agentTokens.input} out=${a.agentTokens.output}`);
  }
  console.log();
}

// Check if parent JSONL has agent_progress events that reference these agents
console.log('\n=== Parent JSONL ↔ Sub-agent Correlation ===\n');
for (const r of relationships.slice(0, 5)) {
  if (!r.hasParentJsonl) continue;
  const parentPath = join(PROJECTS_ROOT, r.project, r.parentConversation + '.jsonl');
  const content = readFileSync(parentPath, 'utf-8');
  let agentProgressCount = 0;
  let agentRefs = new Set();
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'progress' && evt.data?.type === 'agent_progress') {
        agentProgressCount++;
      }
      // Look for references to the agent ID
      if (line.includes(r.agentId.replace('agent-', ''))) {
        agentRefs.add('direct-id-match');
      }
    } catch {}
  }
  console.log(`Parent ${r.parentConversation} → agent ${r.agentId}`);
  console.log(`  agent_progress events in parent: ${agentProgressCount}`);
  console.log(`  Agent ID referenced in parent: ${[...agentRefs].join(', ') || 'none found'}`);
  console.log();
}
```

- [ ] **Step 2: Run the scanner**

```bash
node sandbox/sprint0/subagent-scanner.mjs
```

Expected: A list of all sub-agent sessions with their parent conversations, agent types, and token usage. The correlation section should show whether agent IDs appear in parent JSONL events.

- [ ] **Step 3: Read a sub-agent JSONL file to check its structure**

```bash
# Pick one from the scanner output
head -3 ~/.claude/projects/-home-blasi-finance-blasi-development/0ae38a42-80dd-43fd-b676-6a80c2c4b321/subagents/agent-aeb3897ee3267e12c.jsonl | python3 -c "import sys,json; [print(json.dumps(json.loads(l),indent=2)[:400]) for l in sys.stdin if l.strip()]"
```

Expected: Sub-agent JSONL events have similar structure to parent events. Check if they have their own `sessionId` or reference the parent's.

- [ ] **Step 4: Document sub-agent detection findings**

Create `docs/spikes/sprint0-subagent-detection.md`:

```markdown
# Sprint 0 Finding: Sub-agent Detection

**Investigation:** Sub-agent detection strategy (Spec Section 11.2)
**Date:** 2026-03-27
**Status:** Complete

## File Structure

- Parent conversation: `{project-dir}/{conversation-uuid}.jsonl`
- Sub-agent JSONL: `{project-dir}/{conversation-uuid}/subagents/agent-{id}.jsonl`
- Sub-agent meta: `{project-dir}/{conversation-uuid}/subagents/agent-{id}.meta.json`

## Meta File Schema

```json
{
  "agentType": "Explore | Plan | general-purpose | ...",
  "description": "Human-readable task description"
}
```

## Linking Strategy

(Document how to link parent ↔ child based on scanner findings):
- Filesystem path: the conversation-uuid directory IS the parent
- Parent JSONL correlation: (document agent_progress events, ID references)
- Sub-agent sessionId: (document whether sub-agents have their own sessionId)

## Impact on Sentinel's Data Model

- `parent_session_id` in sessions table: (confirm this is viable)
- Discovery strategy: (scan for subagents/ directories during JSONL watching)
- Token attribution: (how to count sub-agent tokens — separate? rolled up?)

## Decision

(State the detection and linking strategy for implementation)
```

- [ ] **Step 5: Commit**

```bash
git add sandbox/sprint0/subagent-scanner.mjs docs/spikes/sprint0-subagent-detection.md
git commit -m "spike(monitor): document sub-agent detection strategy — closes #N"
```

---

## Task 5: SDK Interactive Support

**Goal:** Determine whether a Claude Code SDK exists for programmatic session interaction (create, resume, send message, kill) or whether Sentinel must use raw process management (spawn CLI, write to stdin, read stdout).

**Files:**
- Create: `docs/spikes/sprint0-sdk-interactive.md`

**Key context:**
- The Gateway used `claude --print --output-format=stream-json` (one-shot, NOT interactive)
- Sentinel's spec requires interactive mode (`claude` without `--print`)
- Karma uses Claude Code hooks (not SDK) for monitoring
- The npm package `@anthropic-ai/claude-code` may exist
- `claude` CLI v2.1.85 is installed

- [ ] **Step 1: Check for Claude Code SDK on npm**

```bash
npm search @anthropic-ai/claude-code 2>/dev/null || echo "npm search unavailable"
npm info @anthropic-ai/claude-code 2>/dev/null || echo "Package not found"
```

- [ ] **Step 2: Check Claude CLI help for SDK/API flags**

```bash
claude --help 2>&1 | head -60
claude sdk --help 2>&1 || echo "No sdk subcommand"
claude mcp --help 2>&1 | head -20 || echo "No mcp subcommand"
```

Look for: `--output-format`, `--print`, `--resume`, `--remote-control`, SDK-related flags.

- [ ] **Step 3: Research Claude Code documentation online**

Search for:
- Claude Code SDK documentation
- `@anthropic-ai/claude-code` npm package
- Claude Code programmatic session management
- Claude Agent SDK (different from Claude Code SDK)

Use web search or check https://docs.anthropic.com/en/docs/claude-code for SDK references.

- [ ] **Step 4: Test interactive process management**

In a **separate terminal**, test whether Sentinel can manage an interactive session:

```bash
# Start claude in a way that Sentinel could manage
# Test 1: Can we spawn claude and write to its stdin?
echo "Say hello" | timeout 30 claude 2>&1 | head -20
# This will likely fail because claude interactive mode reads TTY, not pipe

# Test 2: Try with --print for comparison
echo "Say hello" | claude --print 2>&1 | head -20

# Test 3: Check if there's a way to force non-TTY interactive mode
claude --help 2>&1 | grep -i "pipe\|stdin\|tty\|interactive\|non-interactive"
```

- [ ] **Step 5: Document SDK findings**

Create `docs/spikes/sprint0-sdk-interactive.md`:

```markdown
# Sprint 0 Finding: SDK Interactive Support

**Investigation:** Claude Code SDK for programmatic session interaction (Spec Section 11.3)
**Date:** 2026-03-27
**Status:** Complete

## SDK Availability

- npm package exists: [yes/no]
- Package name: [name or N/A]
- Capabilities: [list what it can do]

## Claude CLI Flags for Programmatic Use

| Flag | Purpose | Viable for Sentinel? |
|------|---------|---------------------|
| `--print` | One-shot mode | No — spec requires interactive |
| `--resume` | Resume existing session | Yes — for session resume |
| `--remote-control` | Enable Claude Remote | Yes — for URL capture |
| `--output-format=stream-json` | Structured output | (test if works in interactive) |
| (others found) | | |

## Interactive Session Management Strategy

(Document the viable approach based on findings):

### Option A: SDK (if available)
- How it works
- Pros/cons

### Option B: Raw process management
- Spawn `claude` as child process
- Write to stdin via process.stdin.write()
- Parse stdout for events
- Challenges: TTY detection, buffer handling

### Option C: Hybrid
- Use `--print` for individual turns (Gateway approach)
- Use `--resume` to maintain session continuity
- Trade-offs

## Decision

(State the chosen approach for Sentinel's Session Manager. This is one of the most important Sprint 0 decisions — it determines how the Manager module works.)
```

- [ ] **Step 6: Commit**

```bash
git add docs/spikes/sprint0-sdk-interactive.md
git commit -m "spike(manager): investigate SDK and interactive session support — closes #N"
```

---

## Task 6: agent-notify.sh Review

**Goal:** Understand the notification script's interface, test it, and design Sentinel's notification payload format.

**Files:**
- Create: `docs/spikes/sprint0-agent-notify.md`

**Key context:**
- Script: `/home/blasi/.openclaw/scripts/agent-notify.sh`
- Agents: `jarvis` (default), `mars`, `moon` — each has a Discord channel
- Options: `--agent`, `--title`, `--tag`, `--source`, `--file`, `--json`, `--dry-run`
- Requires `WORKSHOP_BOT_TOKEN` env var (from `~/.openclaw/.env`)
- Sentinel needs to send notifications for `waiting` and `error` states

- [ ] **Step 1: Read the full script**

```bash
cat /home/blasi/.openclaw/scripts/agent-notify.sh
```

Note:
- How it formats the Discord message (plain text? embed? markdown?)
- Maximum message length limits
- How it handles errors (exit codes, retry?)
- What `--json` output looks like
- The Discord API call structure

- [ ] **Step 2: Test with --dry-run**

```bash
/home/blasi/.openclaw/scripts/agent-notify.sh \
  "Test notification from Sentinel" \
  --agent jarvis \
  --tag SENTINEL \
  --title "Session Waiting" \
  --source session-sentinel \
  --dry-run
```

Expected: The script prints the Discord API payload without sending it. Examine the format.

- [ ] **Step 3: Test with --json output**

```bash
/home/blasi/.openclaw/scripts/agent-notify.sh \
  "Test" \
  --tag SENTINEL \
  --dry-run \
  --json
```

Expected: JSON output showing the request that would be sent.

- [ ] **Step 4: Design Sentinel notification payloads**

Design two notification templates — one for `waiting`, one for `error`:

```markdown
### Waiting notification

**[SENTINEL] Session Waiting — {label}**

Session `{session_id}` in **{project_name}** (`{git_branch}`) is waiting for input.

**Question:** {pending_question (truncated to 300 chars)}
**Waiting since:** {waiting_since}
**Owner:** {owner}

Check details: `GET /sessions/{id}`
Resume: `claude --resume {session_id}`

### Error notification

**[SENTINEL] Session Error — {label}**

Session `{session_id}` in **{project_name}** (`{git_branch}`) hit an error.

**Error:** {error_message (truncated to 300 chars)}
**Owner:** {owner}

Check details: `GET /sessions/{id}`
```

- [ ] **Step 5: Document notification findings**

Create `docs/spikes/sprint0-agent-notify.md`:

```markdown
# Sprint 0 Finding: agent-notify.sh Review

**Investigation:** Notification script review and payload design (Spec Section 11.4)
**Date:** 2026-03-27
**Status:** Complete

## Script Interface

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--agent` | Target agent (jarvis/mars/moon) | jarvis |
| `--title` | Bold title | none |
| `--tag` | Prefix tag | none |
| `--source` | Source identifier for logging | none |
| `--file` | Read message from file | stdin/arg |
| `--json` | JSON output mode | false |
| `--dry-run` | Don't send, just print | false |

## Discord Message Format

(Document how the script formats messages — plain text, embeds, character limits)

## Dry-run Output

(Paste actual --dry-run output)

## Sentinel Integration Plan

### Calling Convention

```javascript
// From Node.js
import { execFile } from 'child_process';

function notifyAgent(agent, title, message, tag = 'SENTINEL') {
  return new Promise((resolve, reject) => {
    execFile('/home/blasi/.openclaw/scripts/agent-notify.sh', [
      message,
      '--agent', agent,
      '--title', title,
      '--tag', tag,
      '--source', 'session-sentinel',
    ], (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
```

### Notification Templates

(Include the waiting and error templates designed in Step 4)

### Dual Delivery

Per spec Section 6: every notification sent to BOTH:
1. Owner's Discord thread (e.g., `--agent jarvis`)
2. `#sentinel-log` channel

How to implement dual delivery:
(Document — does agent-notify.sh support multiple targets? Or call it twice?)

## Decision

(State how Sentinel's Agent Bridge will call agent-notify.sh)
```

- [ ] **Step 6: Commit**

```bash
git add docs/spikes/sprint0-agent-notify.md
git commit -m "spike(bridge): review agent-notify.sh and design notification payloads — closes #N"
```

---

## Task 7: Claude Remote Integration

**Goal:** Confirm how to capture the Claude Remote URL from a session and document the integration strategy.

**Files:**
- Create: `docs/spikes/sprint0-claude-remote.md`

**Key context:**
- Already discovered: the `system:bridge_status` JSONL event contains the URL:
  ```json
  {
    "type": "system",
    "subtype": "bridge_status",
    "content": "/remote-control is active. Code in CLI or at https://claude.ai/code/session_...",
    "url": "https://claude.ai/code/session_01MJsiDbHpLf59XBYKTL8qPK"
  }
  ```
- This event appears once per session, near the beginning
- The spec says all managed sessions should have Claude Remote enabled

- [ ] **Step 1: Verify `system:bridge_status` appears in multiple sessions**

```bash
python3 -c "
import json, os, glob

base = os.path.expanduser('~/.claude/projects')
found = 0
not_found = 0
urls = []

for proj in os.listdir(base):
    proj_path = os.path.join(base, proj)
    if not os.path.isdir(proj_path): continue
    for jf in glob.glob(os.path.join(proj_path, '*.jsonl')):
        has_bridge = False
        for line in open(jf):
            line = line.strip()
            if not line: continue
            try:
                evt = json.loads(line)
                if evt.get('type') == 'system' and evt.get('subtype') == 'bridge_status':
                    has_bridge = True
                    url = evt.get('url', 'NO URL FIELD')
                    urls.append(url)
                    break
            except: pass
        if has_bridge:
            found += 1
        else:
            not_found += 1

print(f'Sessions WITH bridge_status: {found}')
print(f'Sessions WITHOUT bridge_status: {not_found}')
print(f'Sample URLs:')
for u in urls[:5]:
    print(f'  {u}')
"
```

Expected: Some sessions have the event (those run with `--remote-control`), some don't. The `url` field should contain the full Claude Remote URL.

- [ ] **Step 2: Check if Claude Remote URL appears in stdout when spawning**

```bash
# In a separate terminal:
claude --remote-control --print "Say hello" 2>&1 | grep -i "remote\|claude.ai/code"
```

Check if the URL is also printed to stderr or stdout, not just stored in JSONL. This matters for the Session Manager which spawns the process.

- [ ] **Step 3: Investigate programmatic interaction via Claude Remote**

The spec asks: "Whether agents can interact via Claude Remote programmatically."

Claude Remote exposes a web interface at `https://claude.ai/code/session_{id}`. Investigate:

```bash
# Check if Claude Remote has an API behind the web UI
# Try fetching the session URL to see what's returned
curl -s -o /dev/null -w "%{http_code}" "https://claude.ai/code/session_01MJsiDbHpLf59XBYKTL8qPK" 2>&1
# Note: this will likely require authentication (Anthropic account)

# Check Claude CLI for remote-related subcommands
claude --help 2>&1 | grep -i remote
```

Document:
- Is Claude Remote a read-only viewer or does it support sending messages?
- Does it expose an API that Sentinel or agents could call programmatically?
- Is authentication required? What kind?
- Could this serve as an alternative to stdin for sending messages to managed sessions?

- [ ] **Step 4: Document Claude Remote findings**

Create `docs/spikes/sprint0-claude-remote.md`:

```markdown
# Sprint 0 Finding: Claude Remote Integration

**Investigation:** Claude Remote URL capture and integration (Spec Section 11.5)
**Date:** 2026-03-27
**Status:** Complete

## URL Source

### JSONL event (confirmed)
- Event type: `system:bridge_status`
- URL field: `url`
- URL format: `https://claude.ai/code/session_{id}`
- Appears: once per session, near the beginning (before first user message)
- Reliability: (document — does it appear in ALL sessions with --remote-control?)

### Process output
- URL in stdout: [yes/no]
- URL in stderr: [yes/no]

## Capture Strategy for Session Manager

(Document the approach: watch for bridge_status event in JSONL, OR parse stdout, OR both)

```javascript
// Example: extract URL from JSONL events
function extractRemoteUrl(events) {
  for (const evt of events) {
    if (evt.type === 'system' && evt.subtype === 'bridge_status' && evt.url) {
      return evt.url;
    }
  }
  return null;
}
```

## CLI Flag

- `--remote-control` enables Claude Remote
- Sentinel should pass this flag when spawning managed sessions

## Programmatic Interaction via Claude Remote

- Read-only or interactive? [read-only viewer / supports sending messages]
- API available? [yes/no, details]
- Authentication required? [type]
- Viable as alternative to stdin for managed sessions? [yes/no, trade-offs]

## Dashboard Integration

- Store URL in `sessions.remote_url` column
- Dashboard shows clickable link to Claude Remote for each managed session

## Decision

(State the capture strategy and whether Claude Remote is a viable interaction channel)
```

- [ ] **Step 5: Commit**

```bash
git add docs/spikes/sprint0-claude-remote.md
git commit -m "spike(monitor): document Claude Remote URL capture and interaction strategy — closes #N"
```

---

## Task 8: Handoff Detection

**Goal:** Define how Sentinel detects that a user has taken over a managed session in the terminal (managed → unmanaged transition).

**Files:**
- Create: `docs/spikes/sprint0-handoff-detection.md`

**Key context from spec (Section 11.6):**
> How does Sentinel detect that a user has taken over a managed session in the terminal? Possible signals: PID change, stdin no longer controlled by Sentinel, new JSONL activity without Sentinel-initiated action.

This investigation depends on findings from Task 2 (JSONL format) and Task 5 (SDK interactive support).

- [ ] **Step 1: Analyze JSONL user events for origin signals**

Check if `user` events in JSONL contain any indication of who sent the message:

```bash
python3 -c "
import json, glob, os

base = os.path.expanduser('~/.claude/projects')
user_event_keys = set()
user_types = set()
permission_modes = set()

for proj in os.listdir(base):
    proj_path = os.path.join(base, proj)
    if not os.path.isdir(proj_path): continue
    for jf in glob.glob(os.path.join(proj_path, '*.jsonl'))[:20]:
        for line in open(jf):
            line = line.strip()
            if not line: continue
            try:
                evt = json.loads(line)
                if evt.get('type') == 'user':
                    user_event_keys.update(evt.keys())
                    if 'userType' in evt:
                        user_types.add(evt['userType'])
                    if 'permissionMode' in evt:
                        permission_modes.add(evt['permissionMode'])
            except: pass

print('User event keys:', sorted(user_event_keys))
print('userType values:', sorted(user_types))
print('permissionMode values:', sorted(permission_modes))
"
```

Expected: Check if `userType` or another field distinguishes between interactive (terminal) user input and programmatic (stdin) input.

- [ ] **Step 2: Analyze process-level signals**

When Sentinel spawns a managed session, it holds the `ChildProcess` handle. Consider:

```markdown
## Process-level detection signals

1. **Sentinel tracks its own messages.** Every message Sentinel sends via stdin is logged.
   If a new JSONL `user` event appears that Sentinel did NOT send → user took over.

2. **PID monitoring.** Sentinel knows the PID of managed sessions.
   If the process dies and is restarted by the user → new PID, handoff detected.

3. **Claude Remote.** If the user interacts via Claude Remote, does the JSONL differ?
   (Check if Claude Remote interactions have different userType or source fields)

4. **stdin ownership.** If Sentinel holds the stdin pipe and the user opens the same
   session in a terminal, does Claude reject? Does it create a new session?
```

- [ ] **Step 3: Document handoff detection strategy**

Create `docs/spikes/sprint0-handoff-detection.md`:

```markdown
# Sprint 0 Finding: Handoff Detection

**Investigation:** Managed→unmanaged handoff detection (Spec Section 11.6)
**Date:** 2026-03-27
**Status:** Complete

## The Problem

Sentinel spawns and manages a session (managed). A user opens the same session in their terminal (or resumes it). Sentinel must detect this and transition the session to unmanaged.

## JSONL Signals

### userType field
- Values found: (list from Step 1)
- Does it distinguish terminal vs programmatic input? (yes/no)

### Other distinguishing fields
- (document any field that helps identify the input source)

## Process-level Signals

### Message tracking (recommended approach)
- Sentinel logs every message it sends to stdin
- Monitor JSONL for `user` events
- If a `user` event appears that Sentinel did NOT initiate → handoff

### PID monitoring
- (document PID-based detection viability)

### Concurrent access
- Can two clients (Sentinel + terminal user) write to the same session simultaneously?
- (document behavior — does Claude reject, queue, or crash?)

## Recommended Strategy

(State the primary detection mechanism and fallback)

## Edge Cases

- User opens Claude Remote (browser) while Sentinel manages via stdin
- User resumes a managed session via `claude --resume` in terminal
- Sentinel process crashes, user takes over, Sentinel restarts

## Decision

(State the handoff detection approach for implementation)
```

- [ ] **Step 4: Commit**

```bash
git add docs/spikes/sprint0-handoff-detection.md
git commit -m "spike(manager): define managed-to-unmanaged handoff detection strategy — closes #N"
```

---

## Task 9: Sprint 0 Summary

**Goal:** Consolidate all findings into a single reference document. List decisions that affect the data model and architecture. Flag any spec changes needed.

**Files:**
- Create: `docs/spikes/sprint0-summary.md`

- [ ] **Step 1: Review all findings documents**

Read all 7 findings documents in `docs/spikes/` and the spec (`docs/specs/2026-03-27-session-sentinel-design.md`). For each finding, extract:
- The decision made
- Impact on spec/data model
- Open questions remaining

- [ ] **Step 2: Write the summary document**

Create `docs/spikes/sprint0-summary.md`:

```markdown
# Sprint 0 — Consolidated Findings

**Date:** 2026-03-27
**Investigations completed:** 7/7

## Decisions Summary

| # | Investigation | Decision | Impact |
|---|--------------|----------|--------|
| 1 | JSONL format | (decision) | Monitor module event parsing |
| 2 | Resume behavior | (decision) | Session vs Run data model |
| 3 | Sub-agent detection | (decision) | parent_session_id, discovery strategy |
| 4 | SDK interactive | (decision) | Session Manager architecture |
| 5 | agent-notify.sh | (decision) | Agent Bridge notification delivery |
| 6 | Claude Remote | (decision) | sessions.remote_url capture |
| 7 | Handoff detection | (decision) | Managed→unmanaged transition logic |

## Spec Amendments

Changes to `docs/specs/2026-03-27-session-sentinel-design.md` based on findings:

### Data Model Changes

(List any column additions, type changes, or table modifications needed)

### Architecture Changes

(List any changes to module responsibilities or data flow)

### New Constraints Discovered

(List any limitations or constraints discovered during investigation)

## Open Questions

(List anything that couldn't be fully resolved during Sprint 0 — these become follow-up issues)

## Ready for Implementation

With Sprint 0 complete, the following is confirmed and ready for implementation planning:

- [ ] JSONL event parsing patterns documented
- [ ] Session identity and resume model validated
- [ ] Sub-agent detection strategy defined
- [ ] Session Manager interaction model chosen
- [ ] Notification payload format designed
- [ ] Claude Remote URL capture strategy confirmed
- [ ] Handoff detection approach decided
```

- [ ] **Step 3: Commit**

```bash
git add docs/spikes/sprint0-summary.md
git commit -m "spike(docs): consolidate Sprint 0 findings and decisions — closes #N"
```

- [ ] **Step 4: Update spec if needed**

If any findings require changes to the design spec, make those changes now:

```bash
# Only if amendments are needed
git add docs/specs/2026-03-27-session-sentinel-design.md
git commit -m "docs(spec): amend data model based on Sprint 0 findings"
```
