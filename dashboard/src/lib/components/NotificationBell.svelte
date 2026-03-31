<script>
  import { updateNotifications } from '$lib/api.js';

  let { session, onUpdate } = $props();

  let showPopover = $state(false);
  let targetAgent = $state(session.notifications_target_override ?? '');
  let error = $state('');

  function bellState() {
    if (session.type === 'unmanaged') return 'na';
    if (!session.notifications_enabled) return 'disabled';
    if (session.status === 'waiting' || session.status === 'error') return 'fired';
    return 'active';
  }

  async function toggleEnabled() {
    error = '';
    try {
      await updateNotifications(session.id, { enabled: !session.notifications_enabled });
      onUpdate?.();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed';
    }
  }

  async function saveTarget() {
    error = '';
    try {
      await updateNotifications(session.id, {
        target_agent: targetAgent.trim() || null,
      });
      onUpdate?.();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed';
    }
  }

  let state = $derived(bellState());
</script>

{#if state === 'na'}
  <span class="bell na">&mdash;</span>
{:else}
  <button class="bell {state}" onclick={() => showPopover = !showPopover}>
    {state === 'disabled' ? '\u{1F515}' : '\u{1F514}'}
    {#if state === 'active'}<span class="indicator green"></span>{/if}
    {#if state === 'fired'}<span class="indicator red pulse"></span>{/if}
  </button>

  {#if showPopover}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => showPopover = false} onkeydown={() => {}}></div>
    <div class="popover">
      <div class="popover-header">Notification Settings</div>

      {#if error}
        <div class="error-msg">{error}</div>
      {/if}

      <label class="toggle-row">
        <span>Enabled</span>
        <button class="toggle-btn" class:on={session.notifications_enabled} onclick={toggleEnabled}>
          {session.notifications_enabled ? 'ON' : 'OFF'}
        </button>
      </label>

      <label class="field">
        <span>Deliver to</span>
        <div class="input-row">
          <input type="text" bind:value={targetAgent} placeholder={session.owner ?? 'owner'} />
          <button class="save-btn" onclick={saveTarget}>Save</button>
        </div>
      </label>

      <div class="info-section">
        <div class="info-label">Triggers</div>
        <div class="info-value">waiting, error</div>
      </div>

      <div class="info-section">
        <div class="info-label">Channels</div>
        <div class="info-value">discord_owner, sentinel-log</div>
      </div>

      <div class="popover-footer">
        {session.type} · owner: {session.owner ?? '\u2014'}
      </div>
    </div>
  {/if}
{/if}

<style>
  .bell {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    position: relative;
    padding: 2px;
    line-height: 1;
  }

  .bell.na {
    color: var(--text-muted);
    cursor: default;
  }

  .indicator {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .indicator.green { background: var(--accent-green); }
  .indicator.red { background: var(--accent-red); }
  .indicator.pulse { animation: pulse 1.5s ease-in-out infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.3); }
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .popover {
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 4px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px;
    width: 260px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .popover-header {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .error-msg {
    font-size: 12px;
    color: var(--accent-red);
    padding: 4px 8px;
    background: color-mix(in srgb, var(--accent-red) 10%, transparent);
    border-radius: var(--radius-sm);
  }

  .toggle-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .toggle-btn {
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
  }

  .toggle-btn.on {
    background: color-mix(in srgb, var(--accent-green) 20%, transparent);
    color: var(--accent-green);
    border-color: var(--accent-green);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .input-row {
    display: flex;
    gap: 6px;
  }

  .input-row input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 12px;
  }

  .save-btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--accent-blue);
    font-size: 12px;
    cursor: pointer;
  }

  .info-section {
    font-size: 12px;
  }

  .info-label {
    color: var(--text-muted);
    margin-bottom: 2px;
  }

  .info-value {
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .popover-footer {
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border-subtle);
    padding-top: 8px;
  }
</style>
