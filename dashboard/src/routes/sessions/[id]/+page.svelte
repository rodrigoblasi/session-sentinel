<script lang="ts">
  import { goto } from '$app/navigation';
  import { terminateSession, sendMessage } from '$lib/api.js';
  import { formatTokens, formatDuration, shortenModel, timeAgo } from '$lib/utils.js';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import ActivitySparkle from '$lib/components/ActivitySparkle.svelte';
  import UnifiedTimeline from '$lib/components/UnifiedTimeline.svelte';

  let { data } = $props();

  let activeTab = $state('timeline');
  let messageText = $state('');
  let showConfirm = $state(false);
  let actionError = $state('');
  let messageSuccess = $state(false);

  let session = $derived(data.session);
  let totalTokens = $derived(session.input_tokens + session.output_tokens);

  async function handleTerminate() {
    actionError = '';
    try {
      await terminateSession(session.id);
      showConfirm = false;
      goto('/');
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
    } catch (err: unknown) {
      actionError = err instanceof Error ? err.message : 'Failed to send message';
    }
  }

  // Aggregate tool usage from transcript
  let toolStats = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const t of data.transcript ?? []) {
      if (t.tools_used) {
        try {
          for (const tool of JSON.parse(t.tools_used) as string[]) {
            counts[tool] = (counts[tool] || 0) + 1;
          }
        } catch { /* skip */ }
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: total ? Math.round((count / total) * 100) : 0 }));
  });

  const TOOL_COLORS: Record<string, string> = {
    Read: 'var(--accent-blue)', Bash: 'var(--accent-green)',
    Edit: 'var(--accent-yellow)', Write: 'var(--accent-yellow)',
    Glob: 'var(--accent-orange)', Grep: 'var(--accent-red)',
    Agent: 'var(--accent-purple)',
  };
</script>

<svelte:head>
  <title>{session.label ?? session.id.slice(0, 16)} — Session Sentinel</title>
</svelte:head>

<div class="page">
  <!-- Top bar -->
  <div class="top-bar">
    <a href="/" class="back">&larr; Sessions</a>
    <h1 class="session-title">{session.label ?? session.id.slice(0, 16)}</h1>
    <StatusBadge status={session.status} />
    <ActivitySparkle state={session.activity_state} count={session.sub_agent_count} />

    <div class="top-actions">
      {#if data.available_actions?.includes('send_message')}
        <div class="inline-message">
          <input type="text" bind:value={messageText} placeholder="Send message..." onkeydown={(e) => e.key === 'Enter' && handleSendMessage()} />
          <button class="btn primary" onclick={handleSendMessage}>Send</button>
          {#if messageSuccess}
            <span class="msg-ok">Sent</span>
          {/if}
        </div>
      {/if}

      {#if data.available_actions?.includes('terminate')}
        {#if showConfirm}
          <button class="btn danger" onclick={handleTerminate}>Confirm Kill</button>
          <button class="btn" onclick={() => showConfirm = false}>Cancel</button>
        {:else}
          <button class="btn danger" onclick={() => showConfirm = true}>Terminate</button>
        {/if}
      {/if}

      {#if data.available_actions?.includes('resume')}
        <code class="resume-cmd">claude --resume {session.claude_session_id}</code>
        <span class="resume-note">Run on homeserver01</span>
      {/if}

      {#if actionError}
        <span class="action-error">{actionError}</span>
      {/if}
    </div>
  </div>

  <!-- Stats bar -->
  <div class="stats-bar">
    {#each [
      ['Owner', session.owner ?? '\u2014'],
      ['Model', shortenModel(session.model)],
      ['Effort', session.effort ?? '\u2014'],
      ['Branch', session.git_branch ?? '\u2014'],
      ['Project', session.project_name ?? '\u2014'],
      ['Turns', String(data.transcript?.length ?? 0)],
      ['Duration', formatDuration(session.created_at, session.ended_at)],
      ['Tokens', formatTokens(totalTokens)],
      ['Runs', String(data.runs?.length ?? 0)],
    ] as [label, value]}
      <div class="stat-item">
        <span class="stat-key">{label}</span>
        <span class="stat-val">{value}</span>
      </div>
    {/each}
  </div>

  <!-- Tabs -->
  <div class="tabs">
    {#each [['timeline', 'Timeline'], ['tools', 'Tools'], ['notifications', 'Notifications'], ['runs', 'Runs']] as [key, label]}
      <button class="tab" class:active={activeTab === key} onclick={() => activeTab = key}>
        {label}
        {#if key === 'notifications' && data.notifications && data.notifications.length > 0}
          <span class="tab-count">{data.notifications.length}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Tab content -->
  <div class="tab-content">
    {#if activeTab === 'timeline'}
      <UnifiedTimeline
        transcript={data.transcript ?? []}
        events={data.events ?? []}
        runs={data.runs ?? []}
      />
    {:else if activeTab === 'tools'}
      <div class="tools-grid">
        {#each toolStats as tool}
          <div class="tool-card">
            <div class="tool-header">
              <span class="tool-name" style="color: {TOOL_COLORS[tool.name] ?? 'var(--text-secondary)'}">{tool.name}</span>
              <span class="tool-count">{tool.count}</span>
            </div>
            <div class="tool-bar-track">
              <div class="tool-bar-fill" style="width: {tool.pct}%; background: {TOOL_COLORS[tool.name] ?? 'var(--text-muted)'}"></div>
            </div>
            <span class="tool-pct">{tool.pct}%</span>
          </div>
        {/each}
        {#if toolStats.length === 0}
          <div class="empty">No tool usage recorded</div>
        {/if}
      </div>
    {:else if activeTab === 'notifications'}
      <div class="notification-list">
        {#each data.notifications ?? [] as notif}
          <div class="notif-card">
            <div class="notif-header">
              <span class="notif-trigger" class:error={notif.trigger === 'error'}>{notif.trigger}</span>
              <span class="notif-dest">{notif.destination}</span>
              <span class="notif-status" class:delivered={notif.delivered}>{notif.delivered ? '\u2713 delivered' : '\u2717 failed'}</span>
              <span class="notif-time">{timeAgo(notif.created_at)}</span>
            </div>
          </div>
        {/each}
        {#if !data.notifications?.length}
          <div class="empty">No notifications sent</div>
        {/if}
      </div>
    {:else if activeTab === 'runs'}
      <div class="runs-grid">
        {#each data.runs ?? [] as run}
          <div class="run-card" class:active={!run.ended_at}>
            <div class="run-header">
              <span class="run-num">Run #{run.run_number}</span>
              {#if !run.ended_at}
                <ActivitySparkle state="processing" />
              {/if}
              <span class="run-type">{run.start_type}</span>
            </div>
            <div class="run-details">
              <span>Owner: {run.owner_during_run ?? '\u2014'}</span>
              <span>Model: {shortenModel(run.model)}</span>
              <span>Duration: {formatDuration(run.started_at, run.ended_at)}</span>
              <span>Tokens: {formatTokens(run.output_tokens)}</span>
            </div>
          </div>
        {/each}
        {#if !data.runs?.length}
          <div class="empty">No runs recorded</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 48px);
    overflow: hidden;
  }

  .top-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .back {
    font-size: 13px;
    color: var(--accent-blue);
  }

  .session-title {
    font-size: 18px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .inline-message {
    display: flex;
    gap: 4px;
  }

  .inline-message input {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 13px;
    width: 200px;
  }

  .btn {
    padding: 4px 12px;
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

  .resume-cmd {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--bg-base);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    user-select: all;
  }

  .resume-note {
    font-size: 11px;
    color: var(--text-muted);
  }

  .action-error {
    font-size: 12px;
    color: var(--accent-red);
  }

  .msg-ok {
    font-size: 12px;
    color: var(--accent-green);
  }

  .stats-bar {
    display: flex;
    gap: 24px;
    padding: 8px 24px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    overflow-x: auto;
  }

  .stat-item {
    display: flex;
    gap: 6px;
    white-space: nowrap;
    font-size: 13px;
  }

  .stat-key { color: var(--text-muted); }
  .stat-val { color: var(--text-primary); font-weight: 500; }

  .tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    padding: 0 24px;
    flex-shrink: 0;
  }

  .tab {
    padding: 8px 16px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tab:hover { color: var(--text-primary); }
  .tab.active {
    color: var(--accent-blue);
    border-bottom-color: var(--accent-blue);
  }

  .tab-count {
    font-size: 10px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-muted);
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 24px;
  }

  /* Tools tab */
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    padding: 16px 0;
  }

  .tool-card {
    background: var(--bg-surface);
    padding: 12px;
    border-radius: var(--radius-md);
  }

  .tool-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .tool-name { font-weight: 600; font-size: 14px; }
  .tool-count { font-family: var(--font-mono); color: var(--text-secondary); }

  .tool-bar-track {
    height: 4px;
    background: var(--bg-base);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .tool-bar-fill {
    height: 100%;
    border-radius: 2px;
  }

  .tool-pct { font-size: 11px; color: var(--text-muted); }

  /* Notifications tab */
  .notification-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 0;
  }

  .notif-card {
    background: var(--bg-surface);
    padding: 12px;
    border-radius: var(--radius-md);
  }

  .notif-header {
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: 13px;
  }

  .notif-trigger {
    font-weight: 600;
    color: var(--accent-yellow);
  }

  .notif-trigger.error { color: var(--accent-red); }
  .notif-dest { font-family: var(--font-mono); color: var(--text-secondary); }
  .notif-status { color: var(--accent-green); }
  .notif-status:not(.delivered) { color: var(--accent-red); }
  .notif-time { margin-left: auto; color: var(--text-muted); }

  /* Runs tab */
  .runs-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 0;
  }

  .run-card {
    background: var(--bg-surface);
    padding: 14px;
    border-radius: var(--radius-md);
  }

  .run-card.active {
    border-left: 3px solid var(--accent-green);
  }

  .run-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .run-num { font-weight: 600; font-size: 14px; }
  .run-type {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text-muted);
  }

  .run-details {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }
</style>
