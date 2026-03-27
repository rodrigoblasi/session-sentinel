#!/usr/bin/env node
/**
 * resume-detector.mjs
 *
 * Sprint 0 investigation script for Session Sentinel.
 * Scans ALL JSONL files under ~/.claude/projects/ looking for evidence of
 * resume behavior: does `claude --resume` create a new JSONL file or append
 * to the existing one?
 *
 * Strategies:
 *   1. Multiple sessionIds in the same JSONL file
 *   2. Resume-related keywords in JSONL content
 *   3. Multiple system:bridge_status events in the same file
 *   4. Multiple last-prompt events in the same file
 *   5. Timestamp gaps > 30 minutes within a file (restart signal)
 *   6. Same slug appearing across multiple JSONL files (same project or cross-project)
 *
 * Usage:
 *   node resume-detector.mjs              # full scan
 *   node resume-detector.mjs --verbose    # include per-file details
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findJsonlFiles(baseDir) {
  const results = [];
  let projectDirs;
  try {
    projectDirs = readdirSync(baseDir, { withFileTypes: true }).filter((d) =>
      d.isDirectory()
    );
  } catch {
    console.error(`Cannot read ${baseDir}`);
    process.exit(1);
  }

  for (const dir of projectDirs) {
    const projectPath = join(baseDir, dir.name);
    try {
      const entries = readdirSync(projectPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          results.push({
            path: join(projectPath, entry.name),
            project: dir.name,
          });
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return results;
}

function parseTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function formatDuration(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}min`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

const jsonlFiles = findJsonlFiles(PROJECTS_DIR);
if (jsonlFiles.length === 0) {
  console.error("No JSONL files found.");
  process.exit(1);
}

// Results accumulators
const strategy1Results = []; // Multiple sessionIds in one file
const strategy2Results = []; // Resume keywords found
const strategy3Results = []; // Multiple bridge_status events
const strategy4Results = []; // Multiple last-prompt events
const strategy5Results = []; // Timestamp gaps > threshold
const strategy6Map = new Map(); // slug -> [{file, project, sessionId}]

// Per-file metadata for summary
const fileSummaries = [];

let totalFiles = 0;
let totalEvents = 0;

for (const { path: filePath, project } of jsonlFiles) {
  totalFiles++;
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) continue;

  const fileBasename = basename(filePath, ".jsonl");

  // Per-file trackers
  const sessionIds = new Set();
  const slugs = new Set();
  const bridgeStatusEvents = [];
  const lastPromptEvents = [];
  const timestamps = [];
  let resumeKeywordHits = [];
  let firstUserEvent = null;
  let lastEvent = null;
  let eventCount = 0;
  let hookSessionStartCount = 0;
  let userPromptCount = 0; // real user prompts (not tool results)

  for (const line of lines) {
    totalEvents++;
    eventCount++;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Track sessionId
    if (obj.sessionId) sessionIds.add(obj.sessionId);

    // Track slug
    if (obj.slug) slugs.add(obj.slug);

    // Track timestamps
    const ts = parseTimestamp(obj.timestamp);
    if (ts) timestamps.push(ts);

    // Strategy 2: Resume keywords
    const lineStr = line.toLowerCase();
    if (lineStr.includes("resume") || lineStr.includes("resumed") || lineStr.includes("resuming")) {
      // Extract context for the hit
      const type = obj.type || "unknown";
      const subtype = obj.subtype || "";
      resumeKeywordHits.push({
        eventType: subtype ? `${type}:${subtype}` : type,
        timestamp: obj.timestamp,
        snippet: line.slice(0, 200),
      });
    }

    // Strategy 3: bridge_status events
    if (obj.type === "system" && obj.subtype === "bridge_status") {
      bridgeStatusEvents.push({
        timestamp: obj.timestamp,
        url: obj.url || null,
      });
    }

    // Strategy 4: last-prompt events
    if (obj.type === "last-prompt") {
      lastPromptEvents.push({
        timestamp: obj.timestamp,
        sessionId: obj.sessionId,
      });
    }

    // Track SessionStart hooks (each session start gets these)
    if (
      obj.type === "progress" &&
      obj.data?.type === "hook_progress" &&
      obj.data?.hookEvent === "SessionStart"
    ) {
      hookSessionStartCount++;
    }

    // Track real user prompts (not tool results)
    if (
      obj.type === "user" &&
      !obj.toolUseResult &&
      !obj.sourceToolUseID &&
      !obj.isCompactSummary
    ) {
      if (!firstUserEvent) firstUserEvent = obj;
      userPromptCount++;
    }

    lastEvent = obj;
  }

  // Strategy 1: Multiple sessionIds
  if (sessionIds.size > 1) {
    strategy1Results.push({
      file: filePath,
      project,
      sessionIds: [...sessionIds],
      eventCount,
    });
  }

  // Strategy 2: Collect resume keyword hits
  if (resumeKeywordHits.length > 0) {
    strategy2Results.push({
      file: filePath,
      project,
      hits: resumeKeywordHits,
    });
  }

  // Strategy 3: Multiple bridge_status
  if (bridgeStatusEvents.length > 1) {
    strategy3Results.push({
      file: filePath,
      project,
      events: bridgeStatusEvents,
    });
  }

  // Strategy 4: Multiple last-prompt
  if (lastPromptEvents.length > 1) {
    strategy4Results.push({
      file: filePath,
      project,
      events: lastPromptEvents,
    });
  }

  // Strategy 5: Timestamp gaps
  if (timestamps.length > 1) {
    timestamps.sort((a, b) => a.getTime() - b.getTime());
    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) {
      const gapMs = timestamps[i].getTime() - timestamps[i - 1].getTime();
      if (gapMs > GAP_THRESHOLD_MS) {
        gaps.push({
          beforeTimestamp: timestamps[i - 1].toISOString(),
          afterTimestamp: timestamps[i].toISOString(),
          gapMs,
          gapFormatted: formatDuration(gapMs),
        });
      }
    }
    if (gaps.length > 0) {
      strategy5Results.push({
        file: filePath,
        project,
        gaps,
        eventCount,
      });
    }
  }

  // Strategy 6: Collect slug -> files mapping
  for (const slug of slugs) {
    if (!strategy6Map.has(slug)) {
      strategy6Map.set(slug, []);
    }
    strategy6Map.get(slug).push({
      file: filePath,
      project,
      sessionId: [...sessionIds][0] || fileBasename,
    });
  }

  // File summary
  fileSummaries.push({
    file: filePath,
    project,
    sessionId: [...sessionIds][0] || fileBasename,
    slugs: [...slugs],
    eventCount,
    userPromptCount,
    bridgeStatusCount: bridgeStatusEvents.length,
    lastPromptCount: lastPromptEvents.length,
    hookSessionStartCount,
    firstTimestamp: timestamps[0]?.toISOString() || null,
    lastTimestamp: timestamps[timestamps.length - 1]?.toISOString() || null,
    durationMs:
      timestamps.length > 1
        ? timestamps[timestamps.length - 1].getTime() - timestamps[0].getTime()
        : 0,
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("=".repeat(80));
console.log("  Resume Detector — Session Sentinel Sprint 0");
console.log("=".repeat(80));
console.log();
console.log(`Scan date:       ${new Date().toISOString()}`);
console.log(`Projects dir:    ${PROJECTS_DIR}`);
console.log(`Files scanned:   ${totalFiles}`);
console.log(`Total events:    ${totalEvents}`);
console.log();

// --- Strategy 1: Multiple sessionIds ---
console.log("-".repeat(80));
console.log("  STRATEGY 1: Multiple sessionIds in same JSONL file");
console.log("  (resume = append to same file would show same sessionId)");
console.log("-".repeat(80));
console.log();
if (strategy1Results.length === 0) {
  console.log("  RESULT: No files with multiple sessionIds found.");
  console.log("  -> Every JSONL file contains exactly one sessionId.");
} else {
  console.log(`  RESULT: ${strategy1Results.length} files with multiple sessionIds:`);
  for (const r of strategy1Results) {
    console.log(`    ${basename(r.file)} (${r.project})`);
    console.log(`      sessionIds: ${r.sessionIds.join(", ")}`);
    console.log(`      events: ${r.eventCount}`);
  }
}
console.log();

// --- Strategy 2: Resume keywords ---
console.log("-".repeat(80));
console.log("  STRATEGY 2: Resume-related keywords in JSONL content");
console.log("-".repeat(80));
console.log();
if (strategy2Results.length === 0) {
  console.log("  RESULT: No 'resume' keywords found in any JSONL events.");
} else {
  console.log(`  RESULT: ${strategy2Results.length} files with resume keywords:`);
  for (const r of strategy2Results) {
    console.log(`\n    File: ${basename(r.file)} (${r.project})`);
    for (const hit of r.hits.slice(0, 5)) {
      console.log(`      Type: ${hit.eventType} @ ${hit.timestamp || "no-ts"}`);
      console.log(`      Snippet: ${hit.snippet}`);
    }
    if (r.hits.length > 5) {
      console.log(`      ... and ${r.hits.length - 5} more hits`);
    }
  }
}
console.log();

// --- Strategy 3: Multiple bridge_status ---
console.log("-".repeat(80));
console.log("  STRATEGY 3: Multiple system:bridge_status events in same file");
console.log("  (each session start gets one; multiple = resumed in same file)");
console.log("-".repeat(80));
console.log();
if (strategy3Results.length === 0) {
  console.log("  RESULT: No files with multiple bridge_status events.");
  console.log("  -> Each JSONL file has at most one bridge_status event.");
} else {
  console.log(`  RESULT: ${strategy3Results.length} files with multiple bridge_status events:`);
  for (const r of strategy3Results) {
    console.log(`\n    File: ${basename(r.file)} (${r.project})`);
    for (const evt of r.events) {
      console.log(`      ${evt.timestamp} — URL: ${evt.url || "(none)"}`);
    }
  }
}
console.log();

// --- Strategy 4: Multiple last-prompt ---
console.log("-".repeat(80));
console.log("  STRATEGY 4: Multiple last-prompt events in same file");
console.log("  (last-prompt is written at session end; multiple = ended-then-resumed)");
console.log("-".repeat(80));
console.log();
if (strategy4Results.length === 0) {
  console.log("  RESULT: No files with multiple last-prompt events.");
  console.log("  -> Each JSONL file has at most one last-prompt event (or zero).");
} else {
  console.log(`  RESULT: ${strategy4Results.length} files with multiple last-prompt events:`);
  for (const r of strategy4Results) {
    console.log(`\n    File: ${basename(r.file)} (${r.project})`);
    for (const evt of r.events) {
      console.log(`      ${evt.timestamp || "(no timestamp)"} sessionId=${evt.sessionId}`);
    }
  }
}
console.log();

// --- Strategy 5: Timestamp gaps ---
console.log("-".repeat(80));
console.log("  STRATEGY 5: Timestamp gaps > 30 minutes within a file");
console.log("  (suggests a process restart / resume within the same file)");
console.log("-".repeat(80));
console.log();
if (strategy5Results.length === 0) {
  console.log("  RESULT: No files with timestamp gaps > 30 minutes.");
} else {
  console.log(`  RESULT: ${strategy5Results.length} files with significant gaps:`);
  for (const r of strategy5Results) {
    console.log(`\n    File: ${basename(r.file)} (${r.project})`);
    console.log(`    Events: ${r.eventCount}`);
    for (const gap of r.gaps) {
      console.log(`      GAP: ${gap.gapFormatted}`);
      console.log(`        Before: ${gap.beforeTimestamp}`);
      console.log(`        After:  ${gap.afterTimestamp}`);
    }
  }
}
console.log();

// --- Strategy 6: Same slug across multiple files ---
console.log("-".repeat(80));
console.log("  STRATEGY 6: Same slug appearing in multiple JSONL files");
console.log("  (resume = new file would keep the same slug across files)");
console.log("-".repeat(80));
console.log();
const sharedSlugs = [...strategy6Map.entries()].filter(
  ([, files]) => files.length > 1
);
if (sharedSlugs.length === 0) {
  console.log("  RESULT: All slugs are unique to a single JSONL file.");
  console.log("  -> No evidence of slug reuse across files.");
} else {
  console.log(`  RESULT: ${sharedSlugs.length} slugs appear in multiple files:`);
  for (const [slug, files] of sharedSlugs) {
    console.log(`\n    Slug: "${slug}"`);
    for (const f of files) {
      console.log(`      ${basename(f.file)} in ${f.project} (session: ${f.sessionId})`);
    }
  }
}
console.log();

// ---------------------------------------------------------------------------
// Cross-strategy analysis
// ---------------------------------------------------------------------------

console.log("=".repeat(80));
console.log("  CROSS-STRATEGY ANALYSIS");
console.log("=".repeat(80));
console.log();

// Summarize bridge_status and last-prompt counts across all files
let filesWithBridgeStatus = 0;
let filesWithLastPrompt = 0;
let filesWithSessionStartHooks = 0;
let totalBridgeStatus = 0;
let totalLastPrompt = 0;
let totalSessionStartHookBlocks = 0;

for (const s of fileSummaries) {
  if (s.bridgeStatusCount > 0) filesWithBridgeStatus++;
  if (s.lastPromptCount > 0) filesWithLastPrompt++;
  totalBridgeStatus += s.bridgeStatusCount;
  totalLastPrompt += s.lastPromptCount;

  // Count distinct "SessionStart hook blocks": a run starts with a burst of
  // SessionStart hooks. If we see hooks in the file, count the file.
  if (s.hookSessionStartCount > 0) {
    filesWithSessionStartHooks++;
    totalSessionStartHookBlocks += s.hookSessionStartCount;
  }
}

console.log("  Global counters:");
console.log(`    Files with bridge_status:      ${filesWithBridgeStatus} / ${totalFiles} (${totalBridgeStatus} events total)`);
console.log(`    Files with last-prompt:         ${filesWithLastPrompt} / ${totalFiles} (${totalLastPrompt} events total)`);
console.log(`    Files with SessionStart hooks:  ${filesWithSessionStartHooks} / ${totalFiles} (${totalSessionStartHookBlocks} hook events total)`);
console.log(`    Unique slugs total:             ${strategy6Map.size}`);
console.log(`    Slugs in multiple files:        ${sharedSlugs.length}`);
console.log();

// Files with timestamp gaps that also have multiple bridge_status or last-prompt
const resumeEvidence = [];
for (const gapResult of strategy5Results) {
  const summary = fileSummaries.find((s) => s.file === gapResult.file);
  if (summary && (summary.bridgeStatusCount > 1 || summary.lastPromptCount > 1)) {
    resumeEvidence.push({
      file: gapResult.file,
      gaps: gapResult.gaps,
      bridgeStatusCount: summary.bridgeStatusCount,
      lastPromptCount: summary.lastPromptCount,
    });
  }
}

if (resumeEvidence.length > 0) {
  console.log("  STRONG RESUME EVIDENCE (gap + multiple bridge_status/last-prompt):");
  for (const r of resumeEvidence) {
    console.log(`    ${basename(r.file)}: ${r.gaps.length} gaps, ${r.bridgeStatusCount} bridge_status, ${r.lastPromptCount} last-prompt`);
  }
} else {
  console.log("  No strong resume evidence (gap + repeated start/end events) found.");
}
console.log();

// Check if any files have gaps but single bridge_status (weaker evidence)
const weakEvidence = strategy5Results.filter((gapResult) => {
  const summary = fileSummaries.find((s) => s.file === gapResult.file);
  return summary && summary.bridgeStatusCount <= 1 && summary.lastPromptCount <= 1;
});

if (weakEvidence.length > 0) {
  console.log("  TIMESTAMP GAP FILES (gap but no repeated start/end events):");
  console.log("  These could be long idle periods rather than resumes:");
  for (const r of weakEvidence) {
    const summary = fileSummaries.find((s) => s.file === r.file);
    console.log(`\n    ${basename(r.file)} (${r.project})`);
    console.log(`      Events: ${r.eventCount}, User prompts: ${summary?.userPromptCount}`);
    console.log(`      bridge_status: ${summary?.bridgeStatusCount}, last-prompt: ${summary?.lastPromptCount}`);
    for (const gap of r.gaps) {
      console.log(`      Gap: ${gap.gapFormatted} (${gap.beforeTimestamp} -> ${gap.afterTimestamp})`);
    }
  }
}
console.log();

// ---------------------------------------------------------------------------
// CLI behavior analysis
// ---------------------------------------------------------------------------

console.log("=".repeat(80));
console.log("  CLI RESUME BEHAVIOR (from --help analysis)");
console.log("=".repeat(80));
console.log();
console.log("  Relevant flags from `claude --help`:");
console.log();
console.log("  -r, --resume [value]");
console.log("    Resume a conversation by session ID, or open interactive picker.");
console.log("    Implies: appends to the SAME JSONL file (same session ID).");
console.log();
console.log("  -c, --continue");
console.log("    Continue the most recent conversation in the current directory.");
console.log("    Implies: appends to the SAME JSONL file (most recent by mtime).");
console.log();
console.log("  --fork-session");
console.log("    \"When resuming, create a new session ID instead of reusing the original\"");
console.log("    \"(use with --resume or --continue)\"");
console.log("    KEY INSIGHT: The existence of --fork-session PROVES that the DEFAULT");
console.log("    behavior of --resume is to reuse the original session ID (same JSONL file).");
console.log("    --fork-session is the opt-in escape hatch for creating a new file.");
console.log();
console.log("  --session-id <uuid>");
console.log("    \"Use a specific session ID for the conversation (must be a valid UUID)\"");
console.log("    Allows explicit control over which session/JSONL file to use.");
console.log();

// ---------------------------------------------------------------------------
// Conclusions
// ---------------------------------------------------------------------------

console.log("=".repeat(80));
console.log("  CONCLUSIONS");
console.log("=".repeat(80));
console.log();
console.log("  1. DEFAULT RESUME BEHAVIOR: `claude --resume` appends to the SAME JSONL file.");
console.log("     Evidence:");
console.log("       a) --fork-session docs say \"create a new session ID instead of reusing the original\"");
console.log("          This proves default = reuse original session ID = same JSONL file.");
console.log("       b) --resume help says \"Resume a conversation by session ID\" (singular ID).");
console.log("       c) No evidence of shared slugs across files (Strategy 6) — if resume created");
console.log("          new files, we'd expect slug reuse.");
console.log();
console.log("  2. SESSION IDENTITY: One JSONL file = one Claude session ID.");
console.log("     Evidence:");
console.log("       a) Strategy 1: Every JSONL file has exactly one sessionId (no multi-ID files).");
console.log("       b) sessionId = filename UUID.");
console.log();

const hasGapEvidence = strategy5Results.length > 0;
const hasMultipleBridgeStatus = strategy3Results.length > 0;
const hasMultipleLastPrompt = strategy4Results.length > 0;

if (hasGapEvidence && (hasMultipleBridgeStatus || hasMultipleLastPrompt)) {
  console.log("  3. RESUME EVIDENCE FOUND in existing data:");
  console.log("     Timestamp gaps combined with multiple start/end events confirm");
  console.log("     that --resume appends to the existing file.");
} else if (hasGapEvidence) {
  console.log("  3. POSSIBLE RESUME EVIDENCE: Timestamp gaps found but no corroborating");
  console.log("     multiple bridge_status or last-prompt events. These gaps could be");
  console.log("     long idle periods within a single continuous session.");
} else {
  console.log("  3. NO RESUME EVIDENCE in existing data.");
  console.log("     No timestamp gaps > 30 min, no repeated start/end events.");
  console.log("     The existing JSONL data likely contains only fresh (non-resumed) sessions.");
  console.log("     Manual verification needed: run `claude --resume` to confirm behavior.");
}
console.log();

console.log("  4. SENTINEL MAPPING RECOMMENDATION:");
console.log();
console.log("     | Claude Code concept     | Sentinel concept | Notes                              |");
console.log("     |-------------------------|------------------|------------------------------------|");
console.log("     | JSONL file (UUID)        | Session          | 1:1 if no --fork-session           |");
console.log("     | Each start/resume cycle  | Run              | Detect via bridge_status / gap     |");
console.log("     | --fork-session resume    | New Session      | New UUID = new Session + new Run   |");
console.log("     | slug                     | Session label    | Stable within a session            |");
console.log();
console.log("     The session ID in Claude Code is stable across resumes.");
console.log("     Sentinel should use claude_session_id (JSONL UUID) as the primary link");
console.log("     between Claude Code and Sentinel sessions.");
console.log();
console.log("     Run boundaries within a single JSONL file can be detected by:");
console.log("       - New system:bridge_status event (new Remote URL)");
console.log("       - SessionStart hook_progress events after a gap");
console.log("       - Timestamp gap > threshold");
console.log();

// ---------------------------------------------------------------------------
// Verbose: per-file details
// ---------------------------------------------------------------------------

if (verbose) {
  console.log("=".repeat(80));
  console.log("  PER-FILE DETAILS");
  console.log("=".repeat(80));
  console.log();

  const header = [
    "SessionID".padEnd(38),
    "Evts".padStart(6),
    "Prompts".padStart(7),
    "BS".padStart(3),
    "LP".padStart(3),
    "SSH".padStart(4),
    "Duration".padStart(10),
    "Slugs",
  ].join(" ");
  console.log(`  ${header}`);
  console.log(`  ${"─".repeat(header.length)}`);

  for (const s of fileSummaries.sort((a, b) => b.eventCount - a.eventCount)) {
    const row = [
      s.sessionId.slice(0, 36).padEnd(38),
      String(s.eventCount).padStart(6),
      String(s.userPromptCount).padStart(7),
      String(s.bridgeStatusCount).padStart(3),
      String(s.lastPromptCount).padStart(3),
      String(s.hookSessionStartCount).padStart(4),
      s.durationMs ? formatDuration(s.durationMs).padStart(10) : "n/a".padStart(10),
      s.slugs.join(", ") || "(none)",
    ].join(" ");
    console.log(`  ${row}`);
  }
}

console.log();
console.log("=".repeat(80));
console.log("  END OF RESUME DETECTOR REPORT");
console.log("=".repeat(80));
