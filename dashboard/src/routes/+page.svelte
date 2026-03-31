<script>
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { getWsUrl } from '$lib/api.js';
  import { formatTokens, formatDuration, shortenModel } from '$lib/utils.js';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import TypeBadge from '$lib/components/TypeBadge.svelte';
  import ActivitySparkle from '$lib/components/ActivitySparkle.svelte';
  import NotificationBell from '$lib/components/NotificationBell.svelte';
  import SidePanel from '$lib/components/SidePanel.svelte';

  let { data } = $props();

  // --- State ---
  let filter = $state('all');
  let search = $state('');
  let sortCol = $state('status');
  let sortAsc = $state(true);
  let selectedId = $state(null);
  let ws = $state(null);

  // --- Status priority for sorting ---
  const STATUS_PRIORITY = { waiting: 0, active: 1, idle: 2, starting: 3, error: 4, ended: 5 };

  // --- Filtering ---
  let filtered = $derived.by(() => {
    let list = data.sessions ?? [];

    if (filter === 'active') list = list.filter(s => ['active', 'starting', 'idle'].includes(s.status));
    else if (filter === 'waiting') list = list.filter(s => s.status === 'waiting');
    else if (filter === 'managed') list = list.filter(s => s.type === 'managed');
    else if (filter === 'unmanaged') list = list.filter(s => s.type === 'unmanaged');

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        (s.label ?? '').toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.git_branch ?? '').toLowerCase().includes(q)
      );
    }

    return list;
  });

  // --- Sorting ---
  let sorted = $derived.by(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'status') {
        cmp = (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9);
      } else if (sortCol === 'tokens') {
        cmp = a.output_tokens - b.output_tokens;
      } else if (sortCol === 'duration') {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else {
        const va = String(a[sortCol] ?? '');
        const vb = String(b[sortCol] ?? '');
        cmp = va.localeCompare(vb);
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  });

  // --- Hierarchy: build parent -> children map ---
  let rootSessions = $derived.by(() => {
    const childMap = new Map();
    for (const s of sorted) {
      if (s.parent_session_id) {
        if (!childMap.has(s.parent_session_id)) childMap.set(s.parent_session_id, []);
        childMap.get(s.parent_session_id).push(s);
      }
    }

    const rows = [];
    for (const s of sorted) {
      if (!s.parent_session_id) {
        rows.push({ ...s, indent: 0 });
        for (const child of childMap.get(s.id) ?? []) {
          rows.push({ ...child, indent: 1 });
        }
      }
    }
    // Add orphan children (parent not in current view)
    for (const s of sorted) {
      if (s.parent_session_id && !sorted.find(p => p.id === s.parent_session_id)) {
        rows.push({ ...s, indent: 1 });
      }
    }
    return rows;
  });

  let selected = $derived(data.sessions?.find(s => s.id === selectedId) ?? null);

  // --- Column header click ---
  function toggleSort(col) {
    if (sortCol === col) { sortAsc = !sortAsc; }
    else { sortCol = col; sortAsc = true; }
  }

  // --- WebSocket with exponential backoff ---
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30_000;
  let reconnectTimer = null;

  onMount(() => {
    connectWs();
  });

  onDestroy(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  });

  function connectWs() {
    const socket = new WebSocket(getWsUrl());
    socket.onopen = () => {
      reconnectDelay = 1000; // reset on successful connection
    };
    socket.onmessage = () => invalidateAll();
    socket.onclose = () => {
      reconnectTimer = setTimeout(connectWs, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    };
    ws = socket;
  }

  // Filter counts
  let totalCount = $derived(data.sessions?.length ?? 0);
  let filteredCount = $derived(filtered.length);
</script>

<div class="page" class:has-panel={selectedId}>
  <div class="table-area">
    <!-- Toolbar -->
    <div class="toolbar">
      <div class="filters">
        {#each ['all', 'active', 'waiting', 'managed', 'unmanaged'] as f}
          <button class="pill" class:active={filter === f} onclick={() => filter = f}>
            {f}
          </button>
        {/each}
      </div>

      <div class="toolbar-right">
        <span class="count">{filteredCount}{filteredCount !== totalCount ? ` / ${totalCount}` : ''}</span>
        <input class="search" type="text" placeholder="Search..." bind:value={search} />
      </div>
    </div>

    <!-- Table -->
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            {#each [
              ['status', 'Status'],
              ['label', 'Label'],
              ['type', 'Type'],
              ['project_name', 'Project'],
              ['git_branch', 'Branch'],
              ['model', 'Model'],
              ['effort', 'Effort'],
              ['duration', 'Duration'],
              ['tokens', 'Tokens'],
              ['bell', '\u{1F514}'],
            ] as [key, label]}
              <th
                class:sortable={key !== 'bell'}
                class:sorted={sortCol === key}
                onclick={() => key !== 'bell' && toggleSort(key)}
              >
                {label}
                {#if sortCol === key}
                  <span class="sort-arrow">{sortAsc ? '\u2191' : '\u2193'}</span>
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rootSessions as row (row.id)}
            {@const isSelected = row.id === selectedId}
            {@const isEnded = row.status === 'ended' || row.status === 'error'}
            <tr
              class:selected={isSelected}
              class:ended={isEnded}
              class:indent={row.indent > 0}
              onclick={() => selectedId = selectedId === row.id ? null : row.id}
            >
              <td>
                <StatusBadge status={row.status} />
                <ActivitySparkle state={row.activity_state} count={row.sub_agent_count} />
              </td>
              <td class="label-cell">
                {#if row.indent > 0}<span class="indent-marker">{'\u21B3'}</span>{/if}
                {row.label ?? row.claude_session_id?.slice(0, 12) ?? row.id.slice(0, 12)}
              </td>
              <td><TypeBadge type={row.type} /></td>
              <td>{row.project_name ?? '\u2014'}</td>
              <td class="mono">{row.git_branch ?? '\u2014'}</td>
              <td>{shortenModel(row.model)}</td>
              <td>{row.effort ?? '\u2014'}</td>
              <td>{formatDuration(row.created_at, row.ended_at)}</td>
              <td class="mono">{formatTokens(row.output_tokens)}</td>
              <td class="bell-cell">
                <NotificationBell session={row} onUpdate={() => invalidateAll()} />
              </td>
            </tr>

            <!-- Expandable sub-rows -->
            {#if row.status === 'waiting' && row.pending_question}
              <tr class="sub-row">
                <td></td>
                <td colspan="9" class="sub-content waiting">
                  {'\u{1F4AC}'} {row.pending_question}
                </td>
              </tr>
            {/if}
            {#if row.status === 'error' && row.error_message}
              <tr class="sub-row">
                <td></td>
                <td colspan="9" class="sub-content error">
                  {'\u26A0'} {row.error_message}
                </td>
              </tr>
            {/if}
          {/each}

          {#if rootSessions.length === 0}
            <tr>
              <td colspan="10" class="empty">No sessions found</td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Level 2: Side Panel -->
  {#if selected}
    <SidePanel session={selected} onClose={() => selectedId = null} onUpdate={() => invalidateAll()} />
  {/if}
</div>

<style>
  .page {
    display: flex;
    height: calc(100vh - 48px);
    overflow: hidden;
  }

  .table-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .page.has-panel .table-area {
    flex: 0 0 62%;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .filters {
    display: flex;
    gap: 4px;
  }

  .pill {
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-transform: capitalize;
  }

  .pill:hover { background: var(--bg-elevated); }
  .pill.active {
    background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
    color: var(--accent-blue);
    border-color: var(--accent-blue);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .count {
    font-size: 12px;
    color: var(--text-muted);
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

  .table-wrap {
    flex: 1;
    overflow: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 10;
  }

  th {
    background: var(--bg-surface);
    padding: 8px 12px;
    text-align: left;
    font-weight: 500;
    color: var(--text-secondary);
    font-size: 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    user-select: none;
  }

  th.sortable { cursor: pointer; }
  th.sortable:hover { color: var(--text-primary); }
  th.sorted { color: var(--accent-blue); }
  .sort-arrow { margin-left: 4px; font-size: 10px; }

  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
    white-space: nowrap;
  }

  tr { cursor: pointer; }
  tr:nth-child(even) td { background: var(--bg-row-alt); }
  tr:hover td { background: var(--bg-hover); }
  tr.selected td { background: color-mix(in srgb, var(--accent-blue) 10%, var(--bg-surface)); }
  tr.ended td { color: var(--text-muted); }
  tr.indent { opacity: 0.85; }

  .label-cell { font-weight: 500; }
  .mono { font-family: var(--font-mono); font-size: 12px; }
  .bell-cell { position: relative; text-align: center; }

  .indent-marker {
    color: var(--accent-purple);
    margin-right: 4px;
  }

  .sub-row td {
    padding: 0;
    border: none;
    cursor: default;
  }

  .sub-row:hover td { background: inherit; }

  .sub-content {
    padding: 6px 12px 6px 48px;
    font-size: 12px;
    white-space: normal;
    line-height: 1.4;
  }

  .sub-content.waiting { color: var(--accent-yellow); }
  .sub-content.error { color: var(--accent-red); }

  .empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }
</style>
