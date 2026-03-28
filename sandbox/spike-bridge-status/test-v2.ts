/**
 * Issue #3: Test whether SDK V2 createSession/send produces bridge_status events.
 *
 * Run: npx tsx sandbox/spike-bridge-status/test-v2.ts
 *
 * After running, check ~/.claude/projects/ for the JSONL file and search for bridge_status.
 */
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';

const WATCH_DIR = path.join(process.env.HOME!, '.claude/projects');

async function testV2BridgeStatus() {
  console.log('=== Test 1: SDK V2 session without --remote-control ===\n');

  // Take snapshot of existing JSONL files
  const beforeFiles = new Set(findJsonlFiles(WATCH_DIR));

  console.log('Creating V2 session...');
  const session = await unstable_v2_createSession({
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Respond briefly.',
    cwd: process.cwd(),
  });

  console.log('Sending message...');
  await session.send('Say hello in one word.');
  console.log('Message sent.');

  // Wait for JSONL to be written
  await new Promise((r) => setTimeout(r, 2000));

  // Find new JSONL files
  const afterFiles = findJsonlFiles(WATCH_DIR);
  const newFiles = afterFiles.filter((f) => !beforeFiles.has(f));

  console.log(`\nNew JSONL files: ${newFiles.length}`);

  for (const file of newFiles) {
    console.log(`\nChecking: ${file}`);
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    let foundBridgeStatus = false;
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'system' && event.subtype === 'bridge_status') {
          foundBridgeStatus = true;
          console.log('  ✓ bridge_status FOUND');
          console.log(`    URL: ${event.url}`);
          break;
        }
      } catch {}
    }

    if (!foundBridgeStatus) {
      console.log('  ✗ bridge_status NOT found');
    }

    // Show entrypoint
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.entrypoint) {
          console.log(`  entrypoint: ${event.entrypoint}`);
          break;
        }
      } catch {}
    }
  }

  await session.close?.();
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(path.join(entry.parentPath ?? entry.path ?? dir, entry.name));
      }
    }
  } catch {}
  return results;
}

testV2BridgeStatus().catch(console.error);
