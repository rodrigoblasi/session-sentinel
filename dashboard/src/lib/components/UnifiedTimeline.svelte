<script lang="ts">
  import { formatTokens, timeAgo } from '$lib/utils.js';
  import type { TranscriptEntry, SessionEvent, Run } from '$lib/types.js';

  let { transcript = [], events = [], runs = [] }: {
    transcript: TranscriptEntry[];
    events: SessionEvent[];
    runs: Run[];
  } = $props();

  let filter = $state('all');
  let search = $state('');
  let expandedTurns: Set<number> = $state(new Set());

  // Build run boundary map: run_id -> run metadata
  let runMap = $derived(new Map(runs.map(r => [r.id, r])));

  type TimelineItem =
    | { kind: 'turn'; time: string; data: TranscriptEntry; runId: number | null }
    | { kind: 'event'; time: string; data: SessionEvent }
    | { kind: 'separator'; time: string; data: Run };

  // Merge transcript + events into unified timeline
  let timeline = $derived.by(() => {
    const items: TimelineItem[] = [];

    for (const t of transcript) {
      items.push({
        kind: 'turn',
        time: t.created_at,
        data: t,
        runId: t.run_id,
      });
    }

    for (const e of events) {
      items.push({
        kind: 'event',
        time: e.created_at,
        data: e,
      });
    }

    // Sort chronologically; tiebreaker: turn before event
    items.sort((a, b) => {
      const cmp = a.time.localeCompare(b.time);
      if (cmp !== 0) return cmp;
      const kindOrder = (k: string) => k === 'turn' ? 0 : 1;
      return kindOrder(a.kind) - kindOrder(b.kind);
    });

    // Insert run separators
    const withSeparators: TimelineItem[] = [];
    let lastRunId: number | null = null;
    for (const item of items) {
      if (item.kind === 'turn' && item.runId !== lastRunId) {
        const run = item.runId != null ? runMap.get(item.runId) : undefined;
        if (run) {
          withSeparators.push({ kind: 'separator', data: run, time: item.time });
        }
        lastRunId = item.runId;
      }
      withSeparators.push(item);
    }

    return withSeparators;
  });

  let filtered = $derived.by(() => {
    let list = timeline;

    if (filter === 'user') list = list.filter(i => i.kind === 'turn' && i.data.role === 'user');
    else if (filter === 'assistant') list = list.filter(i => i.kind === 'turn' && i.data.role === 'assistant');
    else if (filter === 'events') list = list.filter(i => i.kind === 'event');

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i => {
        if (i.kind === 'turn') return (i.data as TranscriptEntry).content.toLowerCase().includes(q);
        if (i.kind === 'event') return ((i.data as SessionEvent).event_type ?? '').toLowerCase().includes(q);
        return true;
      });
    }

    return list;
  });

  function toggleExpand(id: number) {
    const next = new Set(expandedTurns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedTurns = next;
  }

  function parseTools(toolsJson: string | null): string[] {
    if (!toolsJson) return [];
    try { return JSON.parse(toolsJson) as string[]; }
    catch { return []; }
  }

  const TOOL_COLORS: Record<string, string> = {
    Read: 'var(--accent-blue)', Bash: 'var(--accent-green)',
    Edit: 'var(--accent-yellow)', Write: 'var(--accent-yellow)',
    Glob: 'var(--accent-orange)', Grep: 'var(--accent-red)',
    Agent: 'var(--accent-purple)',
  };
</script>

<div class="timeline">
  <!-- Filters -->
  <div class="timeline-toolbar">
    <div class="filters">
      {#each [['all', 'All'], ['user', 'User'], ['assistant', 'Assistant'], ['events', 'Events']] as [key, label]}
        <button class="pill" class:active={filter === key} onclick={() => filter = key}>{label}</button>
      {/each}
    </div>
    <input class="search" type="text" placeholder="Search timeline..." bind:value={search} />
  </div>

  <!-- Items -->
  <div class="timeline-items">
    {#each filtered as item (item.kind + '-' + (item.data?.id ?? item.time))}
      {#if item.kind === 'separator'}
        {@const run = item.data as Run}
        <div class="run-separator">
          <div class="sep-line"></div>
          <div class="sep-label">
            Run #{run.run_number} &middot; {run.owner_during_run ?? '\u2014'} &middot; {run.start_type}
            {#if run.ended_at}
              &middot; {formatTokens(run.output_tokens)} tokens
            {:else}
              &middot; running
            {/if}
          </div>
          <div class="sep-line"></div>
        </div>
      {:else if item.kind === 'turn'}
        {@const turn = item.data as TranscriptEntry}
        {@const isUser = turn.role === 'user'}
        {@const isExpanded = expandedTurns.has(turn.id)}
        {@const tools = parseTools(turn.tools_used)}
        <div class="turn-card" class:user={isUser} class:assistant={!isUser}>
          <div class="turn-header">
            <span class="role-badge" class:user={isUser}>{turn.role}</span>
            <span class="turn-num">#{turn.turn}</span>
            <span class="turn-time">{timeAgo(turn.created_at)}</span>
            {#if tools.length > 0}
              <span class="tool-chips">
                {#each [...new Set(tools)] as tool}
                  <span class="tool-chip" style="color: {TOOL_COLORS[tool] ?? 'var(--text-muted)'}">{tool}</span>
                {/each}
              </span>
            {/if}
            <span class="turn-tokens">{formatTokens(turn.output_tokens)} tok</span>
          </div>

          <div class="turn-content" class:truncated={!isExpanded && turn.content.length > 400}>
            {isExpanded ? turn.content : turn.content.slice(0, 400)}
            {#if turn.content.length > 400}
              <button class="expand-btn" onclick={() => toggleExpand(turn.id)}>
                {isExpanded ? 'Collapse \u25B4' : 'Expand \u25BE'}
              </button>
            {/if}
          </div>
        </div>
      {:else if item.kind === 'event'}
        {@const event = item.data as SessionEvent}
        <div class="event-entry">
          <span class="event-dot" style="background: {event.to_status === 'error' ? 'var(--accent-red)' : event.to_status === 'waiting' ? 'var(--accent-yellow)' : 'var(--accent-green)'}"></span>
          <span class="event-type">{event.event_type}</span>
          {#if event.from_status && event.to_status}
            <span class="event-transition">{event.from_status} &rarr; {event.to_status}</span>
          {/if}
          <span class="event-actor">{event.actor}</span>
          <span class="event-time">{timeAgo(event.created_at)}</span>
        </div>
      {/if}
    {/each}

    {#if filtered.length === 0}
      <div class="empty">No timeline entries match filter</div>
    {/if}
  </div>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .timeline-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .filters { display: flex; gap: 4px; }

  .pill {
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
  }

  .pill:hover { background: var(--bg-elevated); }
  .pill.active {
    background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
    color: var(--accent-blue);
    border-color: var(--accent-blue);
  }

  .search {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 13px;
    width: 200px;
  }

  .search::placeholder { color: var(--text-muted); }

  .timeline-items {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Run separator */
  .run-separator {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
  }

  .sep-line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .sep-label {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  /* Turn card */
  .turn-card {
    border-radius: var(--radius-md);
    padding: 12px 16px;
    background: var(--bg-surface);
    border-left: 3px solid transparent;
  }

  .turn-card.user { border-left-color: var(--accent-blue); }
  .turn-card.assistant { border-left-color: var(--accent-green); }

  .turn-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .role-badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-green) 15%, transparent);
    color: var(--accent-green);
    font-weight: 600;
    text-transform: uppercase;
  }

  .role-badge.user {
    background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
    color: var(--accent-blue);
  }

  .turn-num { font-size: 12px; color: var(--text-muted); }
  .turn-time { font-size: 12px; color: var(--text-muted); }

  .tool-chips {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }

  .tool-chip {
    font-size: 11px;
    font-family: var(--font-mono);
  }

  .turn-tokens {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .turn-content {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .turn-content.truncated {
    max-height: 120px;
    overflow: hidden;
    position: relative;
  }

  .expand-btn {
    background: none;
    border: none;
    color: var(--accent-blue);
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    margin-top: 4px;
    display: block;
  }

  /* Event entry */
  .event-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 16px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .event-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .event-type { font-weight: 500; }
  .event-transition { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
  .event-actor { color: var(--text-muted); }
  .event-time { margin-left: auto; color: var(--text-muted); }

  .empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }
</style>
