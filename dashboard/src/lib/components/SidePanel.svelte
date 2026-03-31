<script>
  import StatusBadge from './StatusBadge.svelte';

  let { session, onClose, onUpdate } = $props();
</script>

<aside class="panel">
  <div class="panel-header">
    <div class="panel-title">
      <StatusBadge status={session.status} />
      <span class="label">{session.label ?? session.id.slice(0, 12)}</span>
    </div>
    <div class="panel-actions">
      <a href="/sessions/{session.id}" class="open-full">Open full &#x2197;</a>
      <button class="close-btn" onclick={onClose}>&times;</button>
    </div>
  </div>

  <div class="panel-body">
    <div class="detail-grid">
      <div class="detail"><span class="detail-label">ID</span><span class="detail-value mono">{session.id}</span></div>
      <div class="detail"><span class="detail-label">Type</span><span class="detail-value">{session.type}</span></div>
      <div class="detail"><span class="detail-label">Owner</span><span class="detail-value">{session.owner ?? '\u2014'}</span></div>
      <div class="detail"><span class="detail-label">Project</span><span class="detail-value">{session.project_name ?? '\u2014'}</span></div>
      <div class="detail"><span class="detail-label">Branch</span><span class="detail-value mono">{session.git_branch ?? '\u2014'}</span></div>
      <div class="detail"><span class="detail-label">Model</span><span class="detail-value">{session.model ?? '\u2014'}</span></div>
    </div>

    <p class="placeholder-note">Full side panel in issue #35</p>
  </div>
</aside>

<style>
  .panel {
    width: 38%;
    min-width: 320px;
    background: var(--bg-surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .panel-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .label {
    font-weight: 600;
    font-size: 14px;
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .open-full {
    font-size: 12px;
    color: var(--accent-blue);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .panel-body {
    padding: 16px;
    flex: 1;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .detail-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .detail-value {
    font-size: 13px;
    color: var(--text-primary);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .placeholder-note {
    margin-top: 24px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
