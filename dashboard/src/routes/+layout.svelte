<script>
  import '../app.css';

  let { children } = $props();
</script>

<div class="app">
  <header class="topbar">
    <a href="/" class="logo">
      <span class="logo-icon">◆</span>
      Session Sentinel
    </a>
  </header>

  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .topbar {
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
    padding: 0 24px;
    height: 48px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .logo {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .logo:hover {
    text-decoration: none;
  }

  .logo-icon {
    color: var(--accent-purple);
    font-size: 18px;
  }

  .content {
    flex: 1;
    overflow: hidden;
  }
</style>
