#!/usr/bin/env node
/**
 * jsonl-event-catalog.mjs
 *
 * Sprint 0 investigation script for Session Sentinel.
 * Scans ALL JSONL files under ~/.claude/projects/ and catalogs every event type.
 *
 * Usage:
 *   node jsonl-event-catalog.mjs                    # scan all projects
 *   node jsonl-event-catalog.mjs finance             # filter by project name substring
 *   node jsonl-event-catalog.mjs --json              # output raw JSON instead of formatted report
 *
 * Output: formatted report of all event types with counts, keys, and truncated samples.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const MAX_SAMPLE_LENGTH = 600;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findJsonlFiles(baseDir, projectFilter) {
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
    if (projectFilter && !dir.name.includes(projectFilter)) continue;
    const projectPath = join(baseDir, dir.name);
    try {
      const files = readdirSync(projectPath);
      for (const file of files) {
        if (file.endsWith(".jsonl")) {
          results.push(join(projectPath, file));
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return results;
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + "... [truncated]";
}

function eventKey(obj) {
  const type = obj.type || "MISSING";
  const subtype = obj.subtype || "";
  // For progress events, include data.type as a secondary discriminator
  if (type === "progress" && obj.data?.type) {
    return `progress/${obj.data.type}`;
  }
  return subtype ? `${type}:${subtype}` : type;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const projectFilter = args.find((a) => !a.startsWith("--")) || null;

const jsonlFiles = findJsonlFiles(PROJECTS_DIR, projectFilter);
if (jsonlFiles.length === 0) {
  console.error(
    `No JSONL files found${projectFilter ? ` matching "${projectFilter}"` : ""}.`
  );
  process.exit(1);
}

// Catalog: key -> { count, topLevelKeys (Set), sample (first occurrence) }
const catalog = new Map();
let totalFiles = 0;
let totalLines = 0;
let parseErrors = 0;

// Track global field frequency (across all events)
const globalFieldFreq = new Map();

// Track per-file session metadata
const sessions = [];

for (const filePath of jsonlFiles) {
  totalFiles++;
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  let sessionId = basename(filePath, ".jsonl");
  let projectDir = basename(dirname(filePath));
  let slug = null;
  let firstTs = null;
  let lastTs = null;

  for (const line of lines) {
    totalLines++;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }

    const key = eventKey(obj);
    const topKeys = Object.keys(obj);

    // Track global field frequency
    for (const k of topKeys) {
      globalFieldFreq.set(k, (globalFieldFreq.get(k) || 0) + 1);
    }

    if (!catalog.has(key)) {
      catalog.set(key, {
        count: 0,
        topLevelKeys: new Set(),
        sample: truncate(JSON.stringify(obj, null, 2), MAX_SAMPLE_LENGTH),
      });
    }

    const entry = catalog.get(key);
    entry.count++;
    for (const k of topKeys) {
      entry.topLevelKeys.add(k);
    }

    // Extract session metadata from any event
    if (!slug && obj.slug) slug = obj.slug;
    if (obj.timestamp) {
      if (!firstTs) firstTs = obj.timestamp;
      lastTs = obj.timestamp;
    }
    if (obj.sessionId) sessionId = obj.sessionId;
  }

  sessions.push({ sessionId, projectDir, slug, firstTs, lastTs, lines: lines.length });
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (jsonOutput) {
  const result = {};
  for (const [key, entry] of catalog) {
    result[key] = {
      count: entry.count,
      topLevelKeys: [...entry.topLevelKeys].sort(),
      sample: JSON.parse(entry.sample.replace(/\.\.\. \[truncated\]$/, "} // truncated") || "{}"),
    };
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// Formatted report
console.log("=".repeat(80));
console.log("  JSONL Event Catalog — Session Sentinel Sprint 0");
console.log("=".repeat(80));
console.log();
console.log(`Scan date:       ${new Date().toISOString()}`);
console.log(`Projects dir:    ${PROJECTS_DIR}`);
console.log(`Project filter:  ${projectFilter || "(all)"}`);
console.log(`Files scanned:   ${totalFiles}`);
console.log(`Total lines:     ${totalLines}`);
console.log(`Parse errors:    ${parseErrors}`);
console.log(`Event types:     ${catalog.size}`);
console.log();

// Sort by count descending
const sorted = [...catalog.entries()].sort((a, b) => b[1].count - a[1].count);

console.log("-".repeat(80));
console.log("  EVENT TYPE SUMMARY");
console.log("-".repeat(80));
console.log();
console.log(`${"Event Type".padEnd(40)} ${"Count".padStart(8)} ${"% of Total".padStart(10)}`);
console.log(`${"─".repeat(40)} ${"─".repeat(8)} ${"─".repeat(10)}`);
for (const [key, entry] of sorted) {
  const pct = ((entry.count / totalLines) * 100).toFixed(1);
  console.log(`${key.padEnd(40)} ${String(entry.count).padStart(8)} ${(pct + "%").padStart(10)}`);
}

console.log();
console.log("-".repeat(80));
console.log("  COMMON FIELDS (present in >50% of events)");
console.log("-".repeat(80));
console.log();

const commonThreshold = totalLines * 0.5;
const commonFields = [...globalFieldFreq.entries()]
  .filter(([, count]) => count > commonThreshold)
  .sort((a, b) => b[1] - a[1]);

for (const [field, count] of commonFields) {
  const pct = ((count / totalLines) * 100).toFixed(1);
  console.log(`  ${field.padEnd(30)} ${String(count).padStart(8)} (${pct}%)`);
}

console.log();
console.log("-".repeat(80));
console.log("  DETAILED EVENT CATALOG");
console.log("-".repeat(80));

for (const [key, entry] of sorted) {
  console.log();
  console.log(`${"=".repeat(4)} ${key} ${"=".repeat(Math.max(0, 72 - key.length))}`);
  console.log(`  Count: ${entry.count}`);
  console.log(`  Top-level keys: ${[...entry.topLevelKeys].sort().join(", ")}`);
  console.log(`  Sample:`);
  // Indent sample
  const sampleLines = entry.sample.split("\n");
  for (const sl of sampleLines) {
    console.log(`    ${sl}`);
  }
}

console.log();
console.log("-".repeat(80));
console.log("  SESSION SUMMARY (per file)");
console.log("-".repeat(80));
console.log();
console.log(`${"Session ID".padEnd(40)} ${"Project".padEnd(30)} ${"Lines".padStart(6)} ${"Slug"}`);
console.log(`${"─".repeat(40)} ${"─".repeat(30)} ${"─".repeat(6)} ${"─".repeat(30)}`);
for (const s of sessions.sort((a, b) => b.lines - a.lines).slice(0, 30)) {
  const shortProject = s.projectDir.length > 28 ? s.projectDir.slice(0, 28) + ".." : s.projectDir;
  console.log(
    `${s.sessionId.padEnd(40)} ${shortProject.padEnd(30)} ${String(s.lines).padStart(6)} ${s.slug || "(none)"}`
  );
}
if (sessions.length > 30) {
  console.log(`  ... and ${sessions.length - 30} more sessions`);
}

console.log();
console.log("=".repeat(80));
console.log("  END OF CATALOG");
console.log("=".repeat(80));
