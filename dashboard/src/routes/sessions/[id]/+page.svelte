<script lang="ts">
  let { data } = $props();
  const session = $derived(data.session);
  const runs = $derived(data.runs);
  const events = $derived(data.events);
  const transcript = $derived(data.transcript);

  const STATUS_COLORS: Record<string, string> = {
    starting: '#94a3b8',
    active: '#4ade80',
    waiting: '#facc15',
    idle: '#f97316',
    ended: '#6b7280',
    error: '#ef4444',
  };

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
</script>

<svelte:head>
  <title>{session.label ?? session.id} — Session Sentinel</title>
</svelte:head>

<main>
  <a href="/">&larr; Back to overview</a>

  <section class="metadata">
    <h1>
      <span class="status-badge" style="background:{STATUS_COLORS[session.status]}">{session.status}</span>
      {session.label ?? session.id}
    </h1>
    <div class="meta-grid">
      <div><strong>ID:</strong> {session.id}</div>
      <div><strong>Type:</strong> {session.type}</div>
      <div><strong>Owner:</strong> {session.owner ?? '—'}</div>
      <div><strong>Project:</strong> {session.project_name ?? '—'}</div>
      <div><strong>Branch:</strong> {session.git_branch ?? '—'}</div>
      <div><strong>Model:</strong> {session.model ?? '—'}</div>
      <div><strong>Tokens:</strong> {formatTokens(session.input_tokens)} in / {formatTokens(session.output_tokens)} out</div>
      <div><strong>Created:</strong> {timeAgo(session.created_at)}</div>
    </div>

    {#if session.status === 'waiting' && session.pending_question}
      <div class="alert waiting">
        <strong>Pending question:</strong> {session.pending_question}
      </div>
    {/if}

    {#if session.status === 'error' && session.error_message}
      <div class="alert error">
        <strong>Error:</strong> {session.error_message}
      </div>
    {/if}

    {#if session.remote_url}
      <div><strong>Remote:</strong> <a href={session.remote_url} target="_blank">{session.remote_url}</a></div>
    {/if}
  </section>

  <section class="runs">
    <h2>Runs ({runs.length})</h2>
    <table>
      <thead><tr><th>#</th><th>Type</th><th>Owner</th><th>Start</th><th>Tokens</th><th>Duration</th></tr></thead>
      <tbody>
        {#each runs as run}
          <tr>
            <td>{run.run_number}</td>
            <td>{run.start_type}</td>
            <td>{run.owner_during_run ?? '—'}</td>
            <td>{timeAgo(run.started_at)}</td>
            <td>{formatTokens(run.input_tokens + run.output_tokens)}</td>
            <td>{run.ended_at ? timeAgo(run.ended_at) : 'running'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="events">
    <h2>Events (last 50)</h2>
    <table>
      <thead><tr><th>Time</th><th>Type</th><th>From</th><th>To</th><th>Actor</th></tr></thead>
      <tbody>
        {#each events as event}
          <tr>
            <td>{timeAgo(event.created_at)}</td>
            <td>{event.event_type}</td>
            <td>{event.from_status ?? '—'}</td>
            <td>{event.to_status ?? '—'}</td>
            <td>{event.actor}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="transcript">
    <h2>Transcript ({transcript.length} turns)</h2>
    <div class="transcript-list">
      {#each transcript as entry}
        <div class="turn {entry.role}">
          <div class="turn-header">
            <span class="role">{entry.role}</span>
            <span class="tokens">{formatTokens((entry.input_tokens || 0) + (entry.output_tokens || 0))} tokens</span>
          </div>
          <div class="turn-content">{entry.content.substring(0, 500)}{entry.content.length > 500 ? '...' : ''}</div>
        </div>
      {/each}
    </div>
  </section>
</main>

<style>
  main { max-width: 1000px; margin: 0 auto; padding: 2rem; font-family: monospace; color: #e2e8f0; background: #0f172a; }
  a { color: #60a5fa; }
  .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; color: #000; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin: 1rem 0; }
  .alert { padding: 0.75rem; border-radius: 4px; margin: 1rem 0; }
  .alert.waiting { background: #422006; border: 1px solid #facc15; }
  .alert.error { background: #450a0a; border: 1px solid #ef4444; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #1e293b; }
  th { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; }
  .transcript-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .turn { padding: 0.75rem; border-radius: 4px; background: #1e293b; }
  .turn.user { border-left: 3px solid #60a5fa; }
  .turn.assistant { border-left: 3px solid #4ade80; }
  .turn-header { display: flex; justify-content: space-between; font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.25rem; }
  .turn-content { white-space: pre-wrap; font-size: 0.85rem; }
  h2 { margin-top: 2rem; color: #94a3b8; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
</style>
