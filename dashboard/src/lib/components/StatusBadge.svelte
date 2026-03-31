<script>
  let { status } = $props();

  const colors = {
    starting: 'var(--accent-blue)',
    active: 'var(--accent-green)',
    waiting: 'var(--accent-yellow)',
    idle: 'var(--accent-orange)',
    ended: 'var(--accent-gray)',
    error: 'var(--accent-red)',
  };
</script>

<span class="badge" style="--badge-color: {colors[status] ?? 'var(--text-muted)'}">
  <span class="dot"></span>
  {status}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 500;
    color: var(--badge-color);
    text-transform: capitalize;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--badge-color);
  }
</style>
