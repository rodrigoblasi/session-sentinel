import fs from 'node:fs';
import path from 'node:path';
import type { SubAgentPattern } from '../shared/types.js';

export interface AgentFileInfo {
  agentId: string;
  pattern: SubAgentPattern;
}

export interface AgentMeta {
  agentType: string;
  description: string;
}

export function parseAgentFilename(filename: string): AgentFileInfo {
  const base = filename.replace(/\.(?:jsonl|meta\.json)$/, '');
  const agentId = base.replace(/^agent-/, '');

  let pattern: SubAgentPattern;
  if (agentId.startsWith('acompact-')) {
    pattern = 'compact';
  } else if (agentId.startsWith('aside_question-')) {
    pattern = 'side_question';
  } else {
    pattern = 'regular';
  }

  return { agentId, pattern };
}

export function extractParentSessionId(subagentJsonlPath: string): string {
  const parts = subagentJsonlPath.split(path.sep);
  const subagentsIdx = parts.indexOf('subagents');
  if (subagentsIdx < 1) {
    throw new Error(`Cannot extract parent session ID from path: ${subagentJsonlPath}`);
  }
  return parts[subagentsIdx - 1];
}

export function readMetaFile(jsonlPath: string): AgentMeta | null {
  const metaPath = jsonlPath.replace(/\.jsonl$/, '.meta.json');
  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(content);
    return {
      agentType: parsed.agentType ?? null,
      description: parsed.description ?? null,
    };
  } catch {
    return null;
  }
}

export function isSubagentPath(filePath: string): boolean {
  return filePath.includes(`${path.sep}subagents${path.sep}`) && filePath.endsWith('.jsonl');
}
