/**
 * Issue #3 Test 2: SDK V2 session WITH --remote-control flag via extraArgs.
 *
 * Run: npx tsx sandbox/spike-bridge-status/test-v2-remote.ts
 */
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';

const WATCH_DIR = path.join(process.env.HOME!, '.claude/projects');

async function testV2WithRemoteControl() {
  console.log('=== Test 2: SDK V2 session WITH --remote-control ===\n');

  const beforeFiles = new Set(findJsonlFiles(WATCH_DIR));

  console.log('Creating V2 session with extraArgs: { "remote-control": null }...');
  const session = await unstable_v2_createSession({
    model: 'claude-sonnet-4-6',
    // @ts-expect-error -- extraArgs not in SDKSessionOptions but may be passed through
    extraArgs: { 'remote-control': null },
  } as any);

  console.log('Sending message...');
  await session.send('Say hello in one word.');
  console.log('Message sent.');

  // Wait for JSONL writes
  await new Promise((r) => setTimeout(r, 3000));

  const afterFiles = findJsonlFiles(WATCH_DIR);
  const newFiles = afterFiles.filter((f) => !beforeFiles.has(f));

  console.log(`\nNew JSONL files: ${newFiles.length}`);

  for (const file of newFiles) {
    console.log(`\nChecking: ${file}`);
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    console.log(`  Total events: ${lines.length}`);

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

    // Show all event types for analysis
    const types = new Set<string>();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        types.add(`${event.type}${event.subtype ? ':' + event.subtype : ''}`);
      } catch {}
    }
    console.log(`  Event types: ${[...types].join(', ')}`);
  }

  session.close();
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

testV2WithRemoteControl().catch(console.error);
