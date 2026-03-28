<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  const STATUS_COLORS: Record<string, string> = {
    starting: '#94a3b8',
    active: '#22c55e',
    waiting: '#eab308',
    idle: '#f97316',
    ended: '#6b7280',
    error: '#ef4444',
  };

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // Auto-refresh every 3 seconds
  onMount(() => {
    const interval = setInterval(() => invalidateAll(), 3000);
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>Session Sentinel — Debug</title>
</svelte:head>

<main>
  <h1>Session Sentinel <span class="debug-badge">DEBUG</span></h1>

  <!-- Stats -->
  <section class="stats">
    <div class="stat">
      <span class="stat-value">{data.stats.totalSessions}</span>
      <span class="stat-label">Sessions</span>
    </div>
    {#each Object.entries(data.stats.statusCounts) as [status, count]}
      <div class="stat">
        <span class="stat-value" style="color: {STATUS_COLORS[status] ?? '#888'}">{count}</span>
        <span class="stat-label">{status}</span>
      </div>
    {/each}
    <div class="stat">
      <span class="stat-value">{formatTokens(data.stats.totalOutputTokens)}</span>
      <span class="stat-label">Output tokens</span>
    </div>
  </section>

  <!-- Sessions table -->
  <section>
    <h2>Sessions</h2>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Label</th>
          <th>Project</th>
          <th>Type</th>
          <th>Owner</th>
          <th>Model</th>
          <th>Tokens (out)</th>
          <th>Last Activity</th>
        </tr>
      </thead>
      <tbody>
        {#each data.sessions as session}
          <tr>
            <td>
              <span class="badge" style="background: {STATUS_COLORS[session.status] ?? '#888'}">
                {session.status}
              </span>
            </td>
            <td>{session.label ?? session.claude_session_id.slice(0, 8)}</td>
            <td>{session.project_name ?? '—'}</td>
            <td>{session.type}</td>
            <td>{session.owner ?? '—'}</td>
            <td class="mono">{session.model?.replace('claude-', '') ?? '—'}</td>
            <td class="mono">{formatTokens(session.output_tokens)}</td>
            <td>{timeAgo(session.updated_at)}</td>
          </tr>
          {#if session.pending_question}
            <tr class="question-row">
              <td colspan="8">⏳ {session.pending_question}</td>
            </tr>
          {/if}
          {#if session.error_message}
            <tr class="error-row">
              <td colspan="8">❌ {session.error_message}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </section>

  <!-- Recent events -->
  <section>
    <h2>Recent Events</h2>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Session</th>
          <th>Transition</th>
          <th>Actor</th>
        </tr>
      </thead>
      <tbody>
        {#each data.events as event}
          <tr>
            <td>{timeAgo(event.created_at)}</td>
            <td><span class="event-type">{event.event_type}</span></td>
            <td>{event.session_label ?? event.session_id.slice(0, 12)}</td>
            <td>
              {#if event.from_status && event.to_status}
                <span class="badge small" style="background: {STATUS_COLORS[event.from_status] ?? '#888'}">{event.from_status}</span>
                →
                <span class="badge small" style="background: {STATUS_COLORS[event.to_status] ?? '#888'}">{event.to_status}</span>
              {:else}
                —
              {/if}
            </td>
            <td>{event.actor}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <footer>
    Last refresh: {data.timestamp}
  </footer>
</main>

<style>
  :global(body) {
    font-family: 'SF Mono', 'Fira Code', monospace;
    background: #0f172a;
    color: #e2e8f0;
    margin: 0;
    padding: 1rem;
  }

  main { max-width: 1200px; margin: 0 auto; }

  h1 { font-size: 1.5rem; margin-bottom: 1rem; }

  .debug-badge {
    background: #ef4444;
    color: white;
    font-size: 0.6rem;
    padding: 2px 6px;
    border-radius: 3px;
    vertical-align: super;
  }

  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #334155; padding-bottom: 0.3rem; }

  .stats {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .stat { text-align: center; }
  .stat-value { display: block; font-size: 1.5rem; font-weight: bold; }
  .stat-label { font-size: 0.75rem; color: #94a3b8; }

  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; padding: 0.4rem 0.6rem; color: #94a3b8; border-bottom: 1px solid #334155; }
  td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #1e293b; }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    color: white;
    font-weight: 600;
  }

  .badge.small { font-size: 0.65rem; padding: 1px 5px; }

  .event-type { color: #60a5fa; }

  .mono { font-family: inherit; }

  .question-row td { color: #eab308; font-style: italic; padding-left: 2rem; font-size: 0.8rem; border-bottom: none; }
  .error-row td { color: #ef4444; font-style: italic; padding-left: 2rem; font-size: 0.8rem; }

  footer { margin-top: 2rem; font-size: 0.7rem; color: #475569; }
</style>
