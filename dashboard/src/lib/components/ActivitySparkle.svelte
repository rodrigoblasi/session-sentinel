<script>
  let { state, count = 0 } = $props();
</script>

{#if state === 'processing' || state === 'subagents'}
  <span class="sparkle" class:subagents={state === 'subagents'}>
    <span class="dot"></span>
    <span class="dot"></span>
    <span class="dot"></span>
    {#if state === 'subagents' && count > 0}
      <span class="label">{count} agent{count !== 1 ? 's' : ''}</span>
    {/if}
  </span>
{/if}

<style>
  .sparkle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent-blue);
    animation: sparkle 1.6s ease-in-out infinite;
  }

  .subagents .dot {
    background: var(--accent-purple);
  }

  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  .label {
    font-size: 11px;
    color: var(--accent-purple);
    margin-left: 4px;
  }

  @keyframes sparkle {
    0%, 100% { opacity: 0.3; transform: scale(0.8) translateY(0); }
    50% { opacity: 1; transform: scale(1.2) translateY(-2px); }
  }
</style>
