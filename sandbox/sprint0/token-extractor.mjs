#!/usr/bin/env node
/**
 * token-extractor.mjs
 *
 * Sprint 0 investigation script for Session Sentinel.
 * Parses a single JSONL session file and extracts per-turn token usage,
 * tool calls, questions, and status signals.
 *
 * Usage:
 *   node token-extractor.mjs <path-to-jsonl>
 *   node token-extractor.mjs <path-to-jsonl> --verbose     # show per-turn details
 *   node token-extractor.mjs <path-to-jsonl> --json        # raw JSON output
 *
 * Output: per-turn breakdown, tool call summary, question log, and session totals.
 */

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const verbose = args.includes("--verbose");
const jsonOutput = args.includes("--json");

if (!filePath) {
  console.error("Usage: node token-extractor.mjs <path-to-jsonl> [--verbose] [--json]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse JSONL
// ---------------------------------------------------------------------------

let content;
try {
  content = readFileSync(filePath, "utf-8");
} catch (err) {
  console.error(`Cannot read file: ${filePath}`);
  process.exit(1);
}

const lines = content.split("\n").filter((l) => l.trim());
const events = [];
let parseErrors = 0;

for (const line of lines) {
  try {
    events.push(JSON.parse(line));
  } catch {
    parseErrors++;
  }
}

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

const sessionId = basename(filePath, ".jsonl");
const projectDir = basename(dirname(filePath));
let slug = null;
let cwd = null;
let gitBranch = null;
let model = null;
let version = null;
let entrypoint = null;
let remoteUrl = null;
let firstTs = null;
let lastTs = null;

for (const evt of events) {
  if (!slug && evt.slug) slug = evt.slug;
  if (!cwd && evt.cwd) cwd = evt.cwd;
  if (!gitBranch && evt.gitBranch) gitBranch = evt.gitBranch;
  if (!version && evt.version) version = evt.version;
  if (!entrypoint && evt.entrypoint) entrypoint = evt.entrypoint;
  if (evt.type === "assistant" && !model && evt.message?.model) {
    model = evt.message.model;
  }
  if (evt.type === "system" && evt.subtype === "bridge_status" && evt.url) {
    remoteUrl = evt.url;
  }
  if (evt.timestamp) {
    if (!firstTs) firstTs = evt.timestamp;
    lastTs = evt.timestamp;
  }
}

// ---------------------------------------------------------------------------
// Turn-by-turn analysis
// ---------------------------------------------------------------------------

// A "turn" is: user message -> one or more assistant messages -> (optional) system events
// We split on user messages (non-sidechain, non-tool-result)

const turns = [];
let currentTurn = null;

for (const evt of events) {
  // Skip metadata-only events (last-prompt, custom-title, agent-name, queue-operation)
  if (["last-prompt", "custom-title", "agent-name", "queue-operation", "pr-link"].includes(evt.type)) {
    continue;
  }

  // Start a new turn on each user message that is not a tool result
  // (tool results are injected system messages, not real user prompts)
  const isRealUserMessage =
    evt.type === "user" &&
    !evt.isSidechain &&
    !evt.toolUseResult &&
    !evt.sourceToolUseID &&
    !evt.isCompactSummary;

  if (isRealUserMessage) {
    currentTurn = {
      turnNumber: turns.length + 1,
      userTimestamp: evt.timestamp,
      userUuid: evt.uuid,
      isSidechain: false,
      prompt: extractPromptPreview(evt),
      assistantMessages: [],
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      toolCalls: {},
      questions: [],
      errors: [],
      turnDurationMs: null,
      messageCount: null,
      sidechainAssistantCount: 0,
    };
    turns.push(currentTurn);
    continue;
  }

  if (!currentTurn) {
    // Events before first user message (hooks, bridge_status, etc)
    // Create a synthetic "turn 0" for pre-conversation events
    if (!turns.length || turns[0].turnNumber !== 0) {
      currentTurn = {
        turnNumber: 0,
        userTimestamp: evt.timestamp,
        userUuid: null,
        isSidechain: false,
        prompt: "(pre-conversation)",
        assistantMessages: [],
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        toolCalls: {},
        questions: [],
        errors: [],
        turnDurationMs: null,
        messageCount: null,
        sidechainAssistantCount: 0,
      };
      turns.unshift(currentTurn);
    } else {
      currentTurn = turns[0];
    }
  }

  // Accumulate assistant data
  if (evt.type === "assistant") {
    if (evt.isSidechain) {
      currentTurn.sidechainAssistantCount++;
    }

    const usage = evt.message?.usage;
    if (usage) {
      currentTurn.input_tokens += usage.input_tokens || 0;
      currentTurn.output_tokens += usage.output_tokens || 0;
      currentTurn.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
      currentTurn.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
    }

    const content = evt.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use" && block.name) {
          currentTurn.toolCalls[block.name] = (currentTurn.toolCalls[block.name] || 0) + 1;

          // Detect questions
          if (block.name === "AskUserQuestion" || block.name === "AskFollowupQuestions") {
            const question =
              block.input?.question ||
              block.input?.questions?.[0]?.question ||
              block.input?.text ||
              "(question)";
            currentTurn.questions.push({
              toolName: block.name,
              question: question.length > 200 ? question.slice(0, 200) + "..." : question,
              timestamp: evt.timestamp,
            });
          }
        }
      }
    }

    // Detect error responses
    if (evt.error || evt.isApiErrorMessage) {
      currentTurn.errors.push({
        error: evt.error || "API error",
        timestamp: evt.timestamp,
      });
    }
  }

  // Capture turn duration from system:turn_duration
  if (evt.type === "system" && evt.subtype === "turn_duration") {
    currentTurn.turnDurationMs = evt.durationMs;
    currentTurn.messageCount = evt.messageCount;
  }

  // Capture API errors
  if (evt.type === "system" && evt.subtype === "api_error") {
    currentTurn.errors.push({
      error: `API ${evt.error?.status || "?"}: ${evt.error?.error?.error?.type || "unknown"}`,
      retryAttempt: evt.retryAttempt,
      timestamp: evt.timestamp,
    });
  }
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

const totals = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  totalToolCalls: {},
  totalQuestions: [],
  totalErrors: [],
  turnCount: turns.filter((t) => t.turnNumber > 0).length,
  sidechainMessages: 0,
};

for (const turn of turns) {
  totals.input_tokens += turn.input_tokens;
  totals.output_tokens += turn.output_tokens;
  totals.cache_read_input_tokens += turn.cache_read_input_tokens;
  totals.cache_creation_input_tokens += turn.cache_creation_input_tokens;
  totals.sidechainMessages += turn.sidechainAssistantCount;
  for (const [name, count] of Object.entries(turn.toolCalls)) {
    totals.totalToolCalls[name] = (totals.totalToolCalls[name] || 0) + count;
  }
  totals.totalQuestions.push(...turn.questions);
  totals.totalErrors.push(...turn.errors);
}

// Detect compact boundaries
const compactEvents = events.filter(
  (e) => e.type === "system" && e.subtype === "compact_boundary"
);

// Detect file-history-snapshots
const snapshotCount = events.filter((e) => e.type === "file-history-snapshot").length;

// Detect hook progress events
const hookEvents = events.filter(
  (e) => e.type === "progress" && e.data?.type === "hook_progress"
);
const hookNames = new Set(hookEvents.map((e) => e.data?.hookName).filter(Boolean));

// Detect agent progress (sub-agent calls)
const agentProgressCount = events.filter(
  (e) => e.type === "progress" && e.data?.type === "agent_progress"
).length;

// Sidechain events
const sidechainEvents = events.filter((e) => e.isSidechain);
const agentIds = new Set(
  events.filter((e) => e.agentId).map((e) => e.agentId)
);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (jsonOutput) {
  console.log(
    JSON.stringify(
      {
        session: { sessionId, slug, cwd, gitBranch, model, version, entrypoint, remoteUrl, firstTs, lastTs },
        totals,
        compactEvents: compactEvents.length,
        snapshotCount,
        hookNames: [...hookNames],
        agentProgressCount,
        sidechainEventCount: sidechainEvents.length,
        agentIds: [...agentIds],
        turns: turns.map((t) => ({
          ...t,
          toolCalls: Object.entries(t.toolCalls).length > 0 ? t.toolCalls : undefined,
          questions: t.questions.length > 0 ? t.questions : undefined,
          errors: t.errors.length > 0 ? t.errors : undefined,
        })),
      },
      null,
      2
    )
  );
  process.exit(0);
}

// Formatted report
console.log("=".repeat(80));
console.log("  Token Extractor — Session Sentinel Sprint 0");
console.log("=".repeat(80));
console.log();
console.log(`File:            ${filePath}`);
console.log(`Session ID:      ${sessionId}`);
console.log(`Slug:            ${slug || "(none)"}`);
console.log(`Project:         ${projectDir}`);
console.log(`CWD:             ${cwd || "(unknown)"}`);
console.log(`Git branch:      ${gitBranch || "(unknown)"}`);
console.log(`Model:           ${model || "(unknown)"}`);
console.log(`Version:         ${version || "(unknown)"}`);
console.log(`Entrypoint:      ${entrypoint || "(unknown)"}`);
console.log(`Remote URL:      ${remoteUrl || "(none)"}`);
console.log(`First event:     ${firstTs || "(none)"}`);
console.log(`Last event:      ${lastTs || "(none)"}`);
console.log(`Total events:    ${events.length}`);
console.log(`Parse errors:    ${parseErrors}`);
console.log();

// Per-turn breakdown
console.log("-".repeat(80));
console.log("  PER-TURN TOKEN BREAKDOWN");
console.log("-".repeat(80));
console.log();
console.log(
  `${"Turn".padStart(5)} ${"Input".padStart(10)} ${"Output".padStart(10)} ${"Cache Read".padStart(12)} ${"Cache Create".padStart(13)} ${"Tools".padStart(6)} ${"Duration".padStart(10)} ${"SC".padStart(4)}`
);
console.log(
  `${"─".repeat(5)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(12)} ${"─".repeat(13)} ${"─".repeat(6)} ${"─".repeat(10)} ${"─".repeat(4)}`
);

for (const turn of turns) {
  const toolCount = Object.values(turn.toolCalls).reduce((a, b) => a + b, 0);
  const duration = turn.turnDurationMs ? `${(turn.turnDurationMs / 1000).toFixed(1)}s` : "-";
  const sc = turn.sidechainAssistantCount > 0 ? String(turn.sidechainAssistantCount) : "-";
  console.log(
    `${String(turn.turnNumber).padStart(5)} ${String(turn.input_tokens).padStart(10)} ${String(turn.output_tokens).padStart(10)} ${String(turn.cache_read_input_tokens).padStart(12)} ${String(turn.cache_creation_input_tokens).padStart(13)} ${String(toolCount).padStart(6)} ${duration.padStart(10)} ${sc.padStart(4)}`
  );

  if (verbose && turn.questions.length > 0) {
    for (const q of turn.questions) {
      console.log(`       >> QUESTION [${q.toolName}]: ${q.question}`);
    }
  }
  if (verbose && turn.errors.length > 0) {
    for (const e of turn.errors) {
      console.log(`       >> ERROR: ${typeof e.error === "string" ? e.error : JSON.stringify(e.error)}`);
    }
  }
  if (verbose && Object.keys(turn.toolCalls).length > 0) {
    const toolStr = Object.entries(turn.toolCalls)
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n}(${c})`)
      .join(", ");
    console.log(`       tools: ${toolStr}`);
  }
}

// Totals
console.log();
console.log("-".repeat(80));
console.log("  SESSION TOTALS");
console.log("-".repeat(80));
console.log();
console.log(`  User turns:              ${totals.turnCount}`);
console.log(`  Input tokens:            ${totals.input_tokens.toLocaleString()}`);
console.log(`  Output tokens:           ${totals.output_tokens.toLocaleString()}`);
console.log(`  Cache read tokens:       ${totals.cache_read_input_tokens.toLocaleString()}`);
console.log(`  Cache creation tokens:   ${totals.cache_creation_input_tokens.toLocaleString()}`);
console.log(
  `  Total tokens consumed:   ${(totals.input_tokens + totals.output_tokens + totals.cache_read_input_tokens).toLocaleString()}`
);
console.log(`  Sidechain messages:      ${totals.sidechainMessages}`);
console.log(`  Compact boundaries:      ${compactEvents.length}`);
console.log(`  File snapshots:          ${snapshotCount}`);
console.log(`  Agent progress events:   ${agentProgressCount}`);
console.log(`  Unique agent IDs:        ${agentIds.size} ${agentIds.size > 0 ? `(${[...agentIds].join(", ")})` : ""}`);
console.log();

// Tool call summary
console.log("-".repeat(80));
console.log("  TOOL CALL SUMMARY");
console.log("-".repeat(80));
console.log();

const sortedTools = Object.entries(totals.totalToolCalls).sort((a, b) => b[1] - a[1]);
if (sortedTools.length === 0) {
  console.log("  (no tool calls detected)");
} else {
  console.log(`  ${"Tool Name".padEnd(40)} ${"Count".padStart(8)}`);
  console.log(`  ${"─".repeat(40)} ${"─".repeat(8)}`);
  for (const [name, count] of sortedTools) {
    console.log(`  ${name.padEnd(40)} ${String(count).padStart(8)}`);
  }
}
console.log();

// Questions
console.log("-".repeat(80));
console.log("  QUESTIONS DETECTED");
console.log("-".repeat(80));
console.log();

if (totals.totalQuestions.length === 0) {
  console.log("  (no AskUserQuestion/AskFollowupQuestions detected)");
} else {
  for (const q of totals.totalQuestions) {
    console.log(`  [${q.timestamp}] ${q.toolName}: ${q.question}`);
  }
}
console.log();

// Errors
if (totals.totalErrors.length > 0) {
  console.log("-".repeat(80));
  console.log("  ERRORS DETECTED");
  console.log("-".repeat(80));
  console.log();
  for (const e of totals.totalErrors) {
    const errText = typeof e.error === "string" ? e.error : JSON.stringify(e.error);
    console.log(`  [${e.timestamp}] ${errText}${e.retryAttempt ? ` (retry ${e.retryAttempt})` : ""}`);
  }
  console.log();
}

// Hooks
if (hookNames.size > 0) {
  console.log("-".repeat(80));
  console.log("  HOOKS OBSERVED");
  console.log("-".repeat(80));
  console.log();
  for (const name of [...hookNames].sort()) {
    console.log(`  ${name}`);
  }
  console.log();
}

// Status inference signals
console.log("-".repeat(80));
console.log("  STATUS INFERENCE SIGNALS");
console.log("-".repeat(80));
console.log();

const lastEvent = events[events.length - 1];
const lastEventType = lastEvent?.type + (lastEvent?.subtype ? `:${lastEvent.subtype}` : "");
console.log(`  Last event type:         ${lastEventType}`);
console.log(`  Last event timestamp:    ${lastEvent?.timestamp || "(none)"}`);

const hasQuestions = totals.totalQuestions.length > 0;
const hasApiErrors = totals.totalErrors.some((e) => String(e.error).includes("API"));
const hasCompaction = compactEvents.length > 0;
const lastIsStopHook = lastEvent?.type === "system" && lastEvent?.subtype === "stop_hook_summary";
const lastIsTurnDuration = lastEvent?.type === "system" && lastEvent?.subtype === "turn_duration";

console.log(`  Has questions:           ${hasQuestions ? "YES" : "no"}`);
console.log(`  Has API errors:          ${hasApiErrors ? "YES" : "no"}`);
console.log(`  Has compaction:          ${hasCompaction ? "YES" : "no"}`);
console.log(`  Ends with stop_hook:     ${lastIsStopHook ? "YES (turn completed)" : "no"}`);
console.log(`  Ends with turn_duration: ${lastIsTurnDuration ? "YES (turn completed)" : "no"}`);
console.log();

console.log("=".repeat(80));
console.log("  END OF REPORT");
console.log("=".repeat(80));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPromptPreview(evt) {
  const msg = evt.message;
  if (!msg) return "(no message)";
  const content = msg.content;
  if (typeof content === "string") {
    return content.length > 120 ? content.slice(0, 120) + "..." : content;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "string") {
        return part.length > 120 ? part.slice(0, 120) + "..." : part;
      }
      if (part.text) {
        return part.text.length > 120 ? part.text.slice(0, 120) + "..." : part.text;
      }
    }
  }
  return "(complex content)";
}
