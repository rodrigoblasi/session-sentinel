import { describe, it, expect } from 'vitest';
import {
  extractParentSessionId,
  parseAgentFilename,
  readMetaFile,
} from '../../src/monitor/subagent-detector.js';
import path from 'node:path';

describe('parseAgentFilename', () => {
  it('parses regular sub-agent', () => {
    const result = parseAgentFilename('agent-aeb3897ee3267e12c.jsonl');
    expect(result.agentId).toBe('aeb3897ee3267e12c');
    expect(result.pattern).toBe('regular');
  });

  it('parses compact sub-agent', () => {
    const result = parseAgentFilename('agent-acompact-767ece576f2b74e8.jsonl');
    expect(result.agentId).toBe('acompact-767ece576f2b74e8');
    expect(result.pattern).toBe('compact');
  });

  it('parses side_question sub-agent', () => {
    const result = parseAgentFilename('agent-aside_question-c5e5c961a7749e08.jsonl');
    expect(result.agentId).toBe('aside_question-c5e5c961a7749e08');
    expect(result.pattern).toBe('side_question');
  });
});

describe('extractParentSessionId', () => {
  it('extracts parent UUID from sub-agent path', () => {
    const subagentPath = '/home/user/.claude/projects/-home-user-project/aaaa-bbbb-cccc/subagents/agent-a123.jsonl';
    expect(extractParentSessionId(subagentPath)).toBe('aaaa-bbbb-cccc');
  });
});

describe('readMetaFile', () => {
  it('reads meta.json for regular sub-agent', () => {
    const fixturePath = path.join(
      process.cwd(),
      'sandbox/fixtures/eeee5555-0000-0000-0000-000000000005/subagents/agent-a1234567890abcdef.meta.json',
    );
    // meta.json is next to jsonl, we derive it from jsonl path
    const jsonlPath = fixturePath.replace('.meta.json', '.jsonl');
    const meta = readMetaFile(jsonlPath);
    expect(meta?.agentType).toBe('Explore');
    expect(meta?.description).toBe('Explore src/ directory');
  });

  it('returns null for missing meta.json', () => {
    const meta = readMetaFile('/nonexistent/path/agent-acompact-123.jsonl');
    expect(meta).toBeNull();
  });
});
