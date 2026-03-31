<script>
  let { type } = $props();
</script>

<span class="badge" class:managed={type === 'managed'}>
  {type}
</span>

<style>
  .badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text-muted);
  }

  .badge.managed {
    background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
    color: var(--accent-blue);
  }
</style>
