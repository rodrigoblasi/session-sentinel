/**
 * Populate sentinel.db with realistic test data for dashboard development.
 * Run: npx tsx sandbox/seed.ts
 */
import { initDb, closeDb } from '../src/db/connection.js';
import * as queries from '../src/db/queries.js';

const DB_PATH = './sentinel-dev.db';

function seed() {
  initDb(DB_PATH);

  // Session 1: Active session working on feature
  const s1 = queries.upsertSession({
    claude_session_id: 'aaaa-1111-2222-3333',
    jsonl_path: '/home/user/.claude/projects/-home-user-app/aaaa-1111-2222-3333.jsonl',
    cwd: '/home/user/app',
    project_name: 'app',
    model: 'claude-opus-4-6',
    git_branch: 'feat/auth',
    label: 'busy-coding-elephant',
    last_entrypoint: 'cli',
  });
  queries.updateSessionStatus(s1.id, 'active');
  queries.updateSessionTokens(s1.id, {
    input_tokens: 50,
    output_tokens: 15000,
    cache_read_tokens: 500000,
    cache_create_tokens: 30000,
  });
  queries.insertRun({
    session_id: s1.id,
    jsonl_path: s1.jsonl_path,
    start_type: 'startup',
    model: 'claude-opus-4-6',
  });

  // Session 2: Waiting for user input
  const s2 = queries.upsertSession({
    claude_session_id: 'bbbb-4444-5555-6666',
    jsonl_path: '/home/user/.claude/projects/-home-user-api/bbbb-4444-5555-6666.jsonl',
    cwd: '/home/user/api',
    project_name: 'api',
    model: 'claude-opus-4-6',
    git_branch: 'fix/rate-limit',
    label: 'patient-waiting-falcon',
    last_entrypoint: 'cli',
  });
  queries.updateSessionStatus(s2.id, 'active');
  queries.updateSessionStatus(s2.id, 'waiting');
  queries.updateSessionTokens(s2.id, {
    output_tokens: 8000,
    cache_read_tokens: 200000,
  });
  queries.updateSessionPendingQuestion(s2.id, 'Should I apply the rate limit to all endpoints or just public ones?');
  queries.insertRun({
    session_id: s2.id,
    jsonl_path: s2.jsonl_path,
    start_type: 'startup',
  });

  // Session 3: Ended, can resume
  const s3 = queries.upsertSession({
    claude_session_id: 'cccc-7777-8888-9999',
    jsonl_path: '/home/user/.claude/projects/-home-user-docs/cccc-7777-8888-9999.jsonl',
    cwd: '/home/user/docs',
    project_name: 'docs',
    model: 'claude-sonnet-4-6',
    git_branch: 'docs/api-guide',
    label: 'sleepy-finished-owl',
    last_entrypoint: 'cli',
  });
  queries.updateSessionStatus(s3.id, 'active');
  queries.updateSessionStatus(s3.id, 'ended');
  queries.updateSessionTokens(s3.id, {
    output_tokens: 25000,
    cache_read_tokens: 800000,
    cache_create_tokens: 50000,
  });
  queries.insertRun({
    session_id: s3.id,
    jsonl_path: s3.jsonl_path,
    start_type: 'startup',
  });
  const r2 = queries.insertRun({
    session_id: s3.id,
    jsonl_path: s3.jsonl_path,
    start_type: 'resume',
  });
  queries.endRun(r2.id);

  // Session 4: Error state
  const s4 = queries.upsertSession({
    claude_session_id: 'dddd-aaaa-bbbb-cccc',
    jsonl_path: '/home/user/.claude/projects/-home-user-infra/dddd-aaaa-bbbb-cccc.jsonl',
    cwd: '/home/user/infra',
    project_name: 'infra',
    model: 'claude-opus-4-6',
    git_branch: 'chore/ci',
    label: 'troubled-erroring-raven',
    last_entrypoint: 'sdk-cli',
  });
  queries.updateSessionStatus(s4.id, 'active');
  queries.updateSessionStatus(s4.id, 'error');
  queries.updateSessionType(s4.id, 'managed');

  queries.insertRun({
    session_id: s4.id,
    jsonl_path: s4.jsonl_path,
    start_type: 'startup',
    type_during_run: 'managed',
    owner_during_run: 'jarvis',
    sentinel_managed: true,
  });

  // Projects
  queries.upsertProject('app', '/home/user/app');
  queries.upsertProject('api', '/home/user/api');
  queries.upsertProject('docs', '/home/user/docs');
  queries.upsertProject('infra', '/home/user/infra');

  console.log('Seed complete. Database:', DB_PATH);
  console.log('Sessions created:', 4);

  closeDb();
}

seed();
