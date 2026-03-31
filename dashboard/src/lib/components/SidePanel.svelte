<script lang="ts">
  import { getSession, terminateSession, sendMessage } from '$lib/api.js';
  import { formatTokens, formatDuration, shortenModel, timeAgo } from '$lib/utils.js';
  import type { Session, SessionDetailResponse } from '$lib/types.js';
  import StatusBadge from './StatusBadge.svelte';
  import ActivitySparkle from './ActivitySparkle.svelte';

  let { session, onClose, onUpdate }: { session: Session; onClose: () => void; onUpdate?: () => void } = $props();

  let detail: SessionDetailResponse | null = $state(null);
  let messageText = $state('');
  let showConfirm = $state(false);
  let loading = $state(true);
  let actionError = $state('');
  let messageSuccess = $state(false);

  // Reload when session changes (abort guard prevents stale data on fast switches)
  $effect(() => {
    const targetId = session.id;
    loading = true;
    actionError = '';
    getSession(targetId).then((res) => {
      if (session.id === targetId) {
        detail = res;
        loading = false;
      }
    }).catch(() => {
      if (session.id === targetId) {
        loading = false;
      }
    });
  });

  async function handleTerminate() {
    actionError = '';
    try {
      await terminateSession(session.id);
      showConfirm = false;
      onUpdate?.();
    } catch (err: unknown) {
      actionError = err instanceof Error ? err.message : 'Failed to terminate';
    }
  }

  async function handleSendMessage() {
    if (!messageText.trim()) return;
    actionError = '';
    messageSuccess = false;
    try {
      await sendMessage(session.id, messageText.trim());
      messageText = '';
      messageSuccess = true;
      setTimeout(() => messageSuccess = false, 2000);
      onUpdate?.();
    } catch (err: unknown) {
      actionError = err instanceof Error ? err.message : 'Failed to send message';
    }
  }

  let totalTokens = $derived(session.input_tokens + session.output_tokens);
  let tools = $derived.by(() => {
    if (!detail?.transcript) return [] as [string, number][];
    const counts: Record<string, number> = {};
    for (const t of detail.transcript) {
      if (t.tools_used) {
        try {
          const parsed = JSON.parse(t.tools_used) as string[];
          for (const tool of parsed) {
            counts[tool] = (counts[tool] || 0) + 1;
          }
        } catch { /* ignore */ }
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  });

  const TOOL_COLORS: Record<string, string> = {
    Read: 'var(--accent-blue)',
    Bash: 'var(--accent-green)',
    Edit: 'var(--accent-yellow)',
    Write: 'var(--accent-yellow)',
    Glob: 'var(--accent-orange)',
    Grep: 'var(--accent-red)',
    Agent: 'var(--accent-purple)',
  };
</script>

<aside class="panel">
  <!-- Header -->
  <div class="panel-header">
    <div class="header-top">
      <h2 class="title">
        {session.label ?? session.id.slice(0, 12)}
      </h2>
      <button class="close-btn" onclick={onClose}>&times;</button>
    </div>
    <div class="header-meta">
      <StatusBadge status={session.status} />
      <ActivitySparkle state={session.activity_state} count={session.sub_agent_count} />
      <a href="/sessions/{session.id}" class="open-full">Open full &#x2197;</a>
    </div>
  </div>

  <div class="panel-body">
    {#if loading}
      <div class="loading">Loading...</div>
    {:else}
      <!-- Stats cards -->
      <div class="stats">
        <div class="stat">
          <div class="stat-value">{detail?.transcript?.length ?? '\u2014'}</div>
          <div class="stat-label">Turns</div>
        </div>
        <div class="stat">
          <div class="stat-value">{formatDuration(session.created_at, session.ended_at)}</div>
          <div class="stat-label">Duration</div>
        </div>
        <div class="stat">
          <div class="stat-value">{formatTokens(totalTokens)}</div>
          <div class="stat-label">Tokens</div>
        </div>
      </div>

      <!-- Token breakdown -->
      <div class="section">
        <h3>Token Breakdown</h3>
        {#each (() => {
          const maxTok = Math.max(session.input_tokens, session.output_tokens, session.cache_read_tokens || 1);
          return [
            { label: 'Input', value: session.input_tokens, color: 'var(--accent-blue)', maxTok },
            { label: 'Output', value: session.output_tokens, color: 'var(--accent-green)', maxTok },
            { label: 'Cache', value: session.cache_read_tokens, color: 'var(--accent-purple)', maxTok },
          ];
        })() as bar}
          <div class="bar-row">
            <span class="bar-label">{bar.label}</span>
            <div class="bar-track">
              <div class="bar-fill" style="width: {(bar.value / bar.maxTok) * 100}%; background: {bar.color}"></div>
            </div>
            <span class="bar-value">{formatTokens(bar.value)}</span>
          </div>
        {/each}
      </div>

      <!-- Tools used -->
      {#if tools.length > 0}
        <div class="section">
          <h3>Tools</h3>
          <div class="tool-badges">
            {#each tools as [name, count]}
              <span class="tool-badge" style="--tool-color: {TOOL_COLORS[name] ?? 'var(--text-muted)'}">
                {name} &times;{count}
              </span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Details grid -->
      <div class="section">
        <h3>Details</h3>
        <div class="details-grid">
          <span class="detail-key">Session ID</span>
          <span class="detail-val mono">{session.id}</span>
          <span class="detail-key">Type / Effort</span>
          <span class="detail-val">{session.type} / {session.effort ?? '\u2014'}</span>
          <span class="detail-key">Branch</span>
          <span class="detail-val mono">{session.git_branch ?? '\u2014'}</span>
          <span class="detail-key">Owner</span>
          <span class="detail-val">{session.owner ?? '\u2014'}</span>
          <span class="detail-key">Model</span>
          <span class="detail-val">{shortenModel(session.model)}</span>
          {#if session.remote_url}
            <span class="detail-key">Remote</span>
            <span class="detail-val"><a href={session.remote_url} target="_blank">Open &#x2197;</a></span>
          {/if}
        </div>
      </div>

      <!-- Actions -->
      {#if detail && detail.available_actions && detail.available_actions.length > 0}
        <div class="section">
          <h3>Actions</h3>
          <div class="actions">
            {#if detail.available_actions.includes('terminate')}
              {#if showConfirm}
                <div class="confirm">
                  <span>Terminate session?</span>
                  <button class="btn danger" onclick={handleTerminate}>Confirm</button>
                  <button class="btn" onclick={() => showConfirm = false}>Cancel</button>
                </div>
              {:else}
                <button class="btn danger" onclick={() => showConfirm = true}>Terminate</button>
              {/if}
            {/if}

            {#if detail.available_actions.includes('send_message')}
              <div class="message-input">
                <input type="text" bind:value={messageText} placeholder="Send message..." onkeydown={(e) => e.key === 'Enter' && handleSendMessage()} />
                <button class="btn primary" onclick={handleSendMessage}>Send</button>
              </div>
              {#if messageSuccess}
                <span class="msg-ok">Sent</span>
              {/if}
            {/if}

            {#if detail.available_actions.includes('resume')}
              <div class="resume-cmd">
                <span class="detail-key">Resume CLI:</span>
                <code>claude --resume {session.claude_session_id}</code>
              </div>
              <span class="resume-note">Run on homeserver01</span>
            {/if}

            {#if actionError}
              <div class="action-error">{actionError}</div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Runs -->
      {#if detail && detail.runs && detail.runs.length > 0}
        <div class="section">
          <h3>Runs ({detail.runs.length})</h3>
          <div class="runs-list">
            {#each detail.runs as run}
              <div class="run-item" class:active={!run.ended_at}>
                <span class="run-num">#{run.run_number}</span>
                <span>{run.owner_during_run ?? '\u2014'}</span>
                <span class="mono">{formatTokens(run.output_tokens)}</span>
                <span>{formatDuration(run.started_at, run.ended_at)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Audit log (recent events) -->
      {#if detail && detail.events && detail.events.length > 0}
        <div class="section">
          <h3>Events ({detail.events.length})</h3>
          <div class="event-list">
            {#each detail.events.slice(0, 20) as event}
              <div class="event-item">
                <span class="event-time">{timeAgo(event.created_at)}</span>
                <span class="event-type">{event.event_type}</span>
                {#if event.from_status && event.to_status}
                  <span class="event-transition">{event.from_status} &rarr; {event.to_status}</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</aside>

<style>
  .panel {
    width: 38%;
    min-width: 360px;
    background: var(--bg-surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title {
    font-size: 16px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 4px;
  }

  .close-btn:hover { color: var(--text-primary); }

  .header-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }

  .open-full {
    margin-left: auto;
    font-size: 12px;
    color: var(--accent-blue);
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .loading {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }

  .stat {
    background: var(--bg-elevated);
    padding: 12px;
    border-radius: var(--radius-md);
    text-align: center;
  }

  .stat-value {
    font-size: 20px;
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .stat-label {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .section h3 {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  /* Token bars */
  .bar-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .bar-label {
    font-size: 12px;
    color: var(--text-secondary);
    width: 48px;
  }

  .bar-track {
    flex: 1;
    height: 6px;
    background: var(--bg-base);
    border-radius: 3px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .bar-value {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    width: 48px;
    text-align: right;
  }

  /* Tools */
  .tool-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tool-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--tool-color) 15%, transparent);
    color: var(--tool-color);
  }

  /* Details grid */
  .details-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    font-size: 13px;
  }

  .detail-key { color: var(--text-muted); }
  .detail-val { color: var(--text-primary); }
  .mono { font-family: var(--font-mono); font-size: 12px; }

  /* Actions */
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .btn {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
  }

  .btn:hover { background: var(--bg-hover); }
  .btn.danger { color: var(--accent-red); border-color: var(--accent-red); }
  .btn.primary { color: var(--accent-blue); border-color: var(--accent-blue); }

  .confirm {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--accent-red);
  }

  .message-input {
    display: flex;
    gap: 6px;
  }

  .message-input input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 13px;
  }

  .msg-ok {
    font-size: 12px;
    color: var(--accent-green);
  }

  .action-error {
    font-size: 12px;
    color: var(--accent-red);
    padding: 4px 8px;
    background: color-mix(in srgb, var(--accent-red) 10%, transparent);
    border-radius: var(--radius-sm);
  }

  .resume-cmd {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .resume-cmd code {
    font-family: var(--font-mono);
    background: var(--bg-base);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    user-select: all;
  }

  .resume-note {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: -4px;
  }

  /* Runs */
  .runs-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .run-item {
    display: flex;
    gap: 12px;
    font-size: 12px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }

  .run-item.active {
    background: color-mix(in srgb, var(--accent-green) 10%, transparent);
    color: var(--accent-green);
  }

  .run-num { font-weight: 600; width: 24px; }

  /* Events */
  .event-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 200px;
    overflow-y: auto;
  }

  .event-item {
    display: flex;
    gap: 8px;
    font-size: 12px;
    padding: 2px 0;
    color: var(--text-secondary);
  }

  .event-time { color: var(--text-muted); width: 60px; flex-shrink: 0; }
  .event-type { font-weight: 500; }
  .event-transition { font-family: var(--font-mono); font-size: 11px; }
</style>
