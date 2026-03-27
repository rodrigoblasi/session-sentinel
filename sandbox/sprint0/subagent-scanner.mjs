#!/usr/bin/env node
/**
 * subagent-scanner.mjs
 *
 * Sprint 0 investigation script for Session Sentinel.
 * Scans all conversation directories under ~/.claude/projects/ that have a
 * subagents/ subdirectory. For each sub-agent found, it reads the .meta.json
 * file, counts events and tokens in the sub-agent JSONL, and correlates with
 * the parent JSONL via agent_progress events and Agent tool calls.
 *
 * Usage:
 *   node subagent-scanner.mjs              # summary output
 *   node subagent-scanner.mjs --verbose    # include per-subagent details
 *   node subagent-scanner.mjs --json       # emit full JSON to stdout
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const JSON_OUT = args.includes("--json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonlFile(filePath) {
  const events = [];
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // ignore malformed lines
    }
  }
  return events;
}

function extractTokens(events) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  for (const ev of events) {
    if (ev.type === "assistant") {
      const usage = ev.message?.usage ?? {};
      inputTokens += usage.input_tokens ?? 0;
      outputTokens += usage.output_tokens ?? 0;
      cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      cacheCreateTokens += usage.cache_creation_input_tokens ?? 0;
    }
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens };
}

function classifyAgentId(agentId) {
  if (agentId.startsWith("acompact-")) return "compact";
  if (agentId.startsWith("aside_question-")) return "side_question";
  return "regular";
}

// ---------------------------------------------------------------------------
// Scan a parent JSONL for Agent tool calls and agent_progress events
// ---------------------------------------------------------------------------

function scanParentJsonl(parentJsonlPath) {
  if (!existsSync(parentJsonlPath)) return { agentCalls: [], progressAgentIds: new Set() };

  const events = readJsonlFile(parentJsonlPath);

  // Collect Agent tool_use blocks: { toolUseId, description, subagentType }
  const agentCalls = [];
  // Collect agentIds seen in agent_progress events
  const progressAgentIds = new Set();
  // Map parentToolUseID -> Set of agentIds from agent_progress
  const progressByToolUseId = new Map();

  for (const ev of events) {
    if (ev.type === "assistant") {
      for (const block of ev.message?.content ?? []) {
        if (block.type === "tool_use" && block.name === "Agent") {
          agentCalls.push({
            toolUseId: block.id,
            description: block.input?.description ?? "",
            subagentType: block.input?.subagent_type ?? block.input?.agentType ?? null,
          });
        }
      }
    }
    if (ev.type === "progress" && ev.data?.type === "agent_progress") {
      const agentId = ev.data?.agentId;
      if (agentId) {
        progressAgentIds.add(agentId);
        const parentId = ev.parentToolUseID;
        if (parentId) {
          if (!progressByToolUseId.has(parentId)) progressByToolUseId.set(parentId, new Set());
          progressByToolUseId.get(parentId).add(agentId);
        }
      }
    }
  }

  return { agentCalls, progressAgentIds, progressByToolUseId };
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

const results = {
  scannedAt: new Date().toISOString(),
  projectsRoot: PROJECTS_DIR,
  summary: {
    totalConversationsWithSubagents: 0,
    totalSubagentFiles: 0,
    byPattern: { regular: 0, compact: 0, side_question: 0 },
    agentTypeDistribution: {},
    totalOutputTokensAllSubagents: 0,
    subagentsPerConversationDistribution: {},
  },
  conversations: [],
};

// Walk project dirs
const projectEntries = readdirSync(PROJECTS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

for (const projectDir of projectEntries) {
  const projectPath = join(PROJECTS_DIR, projectDir);

  // Walk conversation UUID dirs (subdirectories that are not .jsonl files)
  let convEntries;
  try {
    convEntries = readdirSync(projectPath, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    continue;
  }

  for (const convEntry of convEntries) {
    const convUuid = convEntry.name;
    const convDir = join(projectPath, convUuid);
    const subagentsDir = join(convDir, "subagents");

    if (!existsSync(subagentsDir)) continue;

    // Find all agent-*.jsonl files in subagents/
    let subagentFiles;
    try {
      subagentFiles = readdirSync(subagentsDir).filter(
        (f) => f.startsWith("agent-") && f.endsWith(".jsonl"),
      );
    } catch {
      continue;
    }

    if (subagentFiles.length === 0) continue;

    // Scan parent JSONL for correlation data
    const parentJsonlPath = join(projectPath, `${convUuid}.jsonl`);
    const parentData = scanParentJsonl(parentJsonlPath);

    const convResult = {
      projectDir,
      convUuid,
      parentJsonlExists: existsSync(parentJsonlPath),
      subagentCount: subagentFiles.length,
      subagents: [],
    };

    for (const subFile of subagentFiles) {
      // Filename: agent-{agentId}.jsonl  (agentId does NOT include "agent-" prefix)
      const base = subFile.replace(/\.jsonl$/, ""); // "agent-a7d41ee5dab91e6cf"
      const agentId = base.slice("agent-".length); // "a7d41ee5dab91e6cf"
      const pattern = classifyAgentId(agentId);

      // Read .meta.json if present
      const metaPath = join(subagentsDir, `${base}.meta.json`);
      let meta = null;
      if (existsSync(metaPath)) {
        try {
          meta = JSON.parse(readFileSync(metaPath, "utf8"));
        } catch {
          // ignore
        }
      }

      // Count events and tokens in sub-agent JSONL
      const subJsonlPath = join(subagentsDir, subFile);
      let events = [];
      let eventTypes = {};
      let tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
      let parentSessionId = null;
      let subSlug = null;
      let promptId = null;

      try {
        events = readJsonlFile(subJsonlPath);
        tokens = extractTokens(events);

        for (const ev of events) {
          const key = ev.subtype ? `${ev.type}/${ev.subtype}` : (ev.data?.type ? `${ev.type}/${ev.data.type}` : ev.type);
          eventTypes[key] = (eventTypes[key] ?? 0) + 1;
          if (!parentSessionId && ev.sessionId) parentSessionId = ev.sessionId;
          if (!subSlug && ev.slug) subSlug = ev.slug;
          if (!promptId && ev.promptId) promptId = ev.promptId;
        }
      } catch {
        // ignore read errors
      }

      // Correlation with parent
      const foundInAgentProgress = parentData.progressAgentIds.has(agentId);

      // Find which Agent tool call matches this subagent (via progressByToolUseId)
      let linkedAgentCall = null;
      for (const [toolUseId, agentIds] of parentData.progressByToolUseId) {
        if (agentIds.has(agentId)) {
          linkedAgentCall = parentData.agentCalls.find((c) => c.toolUseId === toolUseId) ?? {
            toolUseId,
            description: null,
            subagentType: null,
          };
          break;
        }
      }

      const subResult = {
        agentId,
        pattern,
        agentType: meta?.agentType ?? null,
        description: meta?.description ?? null,
        hasMeta: meta !== null,
        eventCount: events.length,
        eventTypes,
        tokens,
        parentSessionId,
        subSlug,
        promptId,
        correlations: {
          foundInAgentProgress,
          linkedAgentCall,
          parentSessionIdMatchesConvUuid: parentSessionId === convUuid,
        },
      };

      convResult.subagents.push(subResult);

      // Update summary
      results.summary.totalSubagentFiles++;
      results.summary.byPattern[pattern]++;
      results.summary.totalOutputTokensAllSubagents += tokens.outputTokens;

      if (meta?.agentType) {
        results.summary.agentTypeDistribution[meta.agentType] =
          (results.summary.agentTypeDistribution[meta.agentType] ?? 0) + 1;
      }
    }

    results.conversations.push(convResult);
    results.summary.totalConversationsWithSubagents++;

    // Track subagents-per-conversation distribution
    const n = subagentFiles.length.toString();
    results.summary.subagentsPerConversationDistribution[n] =
      (results.summary.subagentsPerConversationDistribution[n] ?? 0) + 1;
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

// Human-readable output
const s = results.summary;
console.log("=== Sub-agent Scanner ===");
console.log(`Scanned at: ${results.scannedAt}`);
console.log(`Projects root: ${PROJECTS_DIR}`);
console.log("");
console.log("--- Summary ---");
console.log(`Conversations with sub-agents: ${s.totalConversationsWithSubagents}`);
console.log(`Total sub-agent JSONL files:   ${s.totalSubagentFiles}`);
console.log("");
console.log("By ID pattern:");
console.log(`  regular:       ${s.byPattern.regular}`);
console.log(`  compact:       ${s.byPattern.compact}`);
console.log(`  side_question: ${s.byPattern.side_question}`);
console.log("");
console.log("agentType distribution (from .meta.json):");
for (const [type, count] of Object.entries(s.agentTypeDistribution).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type}: ${count}`);
}
console.log("");
console.log(`Total output tokens across all sub-agents: ${s.totalOutputTokensAllSubagents.toLocaleString()}`);
console.log("");
console.log("Sub-agents per conversation:");
for (const [n, count] of Object.entries(s.subagentsPerConversationDistribution).sort(
  (a, b) => Number(a[0]) - Number(b[0]),
)) {
  console.log(`  ${n} sub-agent(s): ${count} conversation(s)`);
}

console.log("\n--- Correlation Analysis ---");
let foundInProgress = 0;
let notFoundInProgress = 0;
let linkedToCall = 0;
let sessionIdMatch = 0;

for (const conv of results.conversations) {
  for (const sub of conv.subagents) {
    if (sub.correlations.foundInAgentProgress) foundInProgress++;
    else notFoundInProgress++;
    if (sub.correlations.linkedAgentCall) linkedToCall++;
    if (sub.correlations.parentSessionIdMatchesConvUuid) sessionIdMatch++;
  }
}

console.log(`Sub-agents found in parent's agent_progress events: ${foundInProgress}`);
console.log(`Sub-agents NOT found in parent's agent_progress:    ${notFoundInProgress}`);
console.log(`Sub-agents linked to Agent tool call via toolUseId:  ${linkedToCall}`);
console.log(`Sub-agents whose sessionId == conv UUID:             ${sessionIdMatch} / ${s.totalSubagentFiles}`);

if (VERBOSE) {
  console.log("\n--- Per-Conversation Details ---");
  for (const conv of results.conversations) {
    console.log(`\n[${conv.projectDir} / ${conv.convUuid}]`);
    console.log(`  Parent JSONL exists: ${conv.parentJsonlExists}`);
    console.log(`  Sub-agents (${conv.subagentCount}):`);
    for (const sub of conv.subagents) {
      console.log(`    agent-${sub.agentId}`);
      console.log(`      pattern:    ${sub.pattern}`);
      console.log(`      hasMeta:    ${sub.hasMeta}`);
      console.log(`      agentType:  ${sub.agentType ?? "N/A"}`);
      console.log(`      desc:       ${sub.description ?? "N/A"}`);
      console.log(`      events:     ${sub.eventCount}`);
      console.log(`      out tokens: ${sub.tokens.outputTokens}`);
      console.log(`      inProgress: ${sub.correlations.foundInAgentProgress}`);
      if (sub.correlations.linkedAgentCall) {
        console.log(`      linkedCall: ${sub.correlations.linkedAgentCall.description}`);
      }
    }
  }
}
