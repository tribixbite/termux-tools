<script lang="ts">
  import { fetchApps, forceStopApp, type AppInfo } from "../lib/api";

  let apps: AppInfo[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let stopping = $state(new Set<string>());

  async function refresh() {
    try {
      apps = await fetchApps();
      error = null;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleStop(pkg: string) {
    stopping = new Set([...stopping, pkg]);
    try {
      await forceStopApp(pkg);
      setTimeout(refresh, 800);
    } catch (e) {
      error = `Failed to stop ${pkg}: ${(e as Error).message}`;
    } finally {
      stopping = new Set([...stopping].filter((p) => p !== pkg));
    }
  }

  // Initial load
  if (typeof window !== "undefined") {
    refresh();
  }

  let totalRss = $derived(apps.reduce((sum, a) => sum + a.rss_mb, 0));
  let killableApps = $derived(apps.filter((a) => !a.system));
</script>

<div class="card">
  <div class="flex items-center justify-between mb-3">
    <h2 class="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Android Apps</h2>
    <div class="flex items-center gap-2">
      {#if totalRss > 0}
        <span class="text-xs text-[var(--text-muted)]">{totalRss}MB</span>
      {/if}
      <button class="btn btn-sm" onclick={refresh}>Refresh</button>
    </div>
  </div>

  {#if loading}
    <p class="text-xs text-[var(--text-muted)]">Loading...</p>
  {:else if error}
    <p class="text-xs text-[var(--accent-red)]">{error}</p>
  {:else if apps.length === 0}
    <p class="text-xs text-[var(--text-muted)]">No apps found (ADB offline?)</p>
  {:else}
    <div class="app-list">
      {#each apps as app (app.pkg)}
        <div class="app-row" class:system={app.system}>
          <div class="app-info">
            <span class="app-label">{app.label}</span>
            <span class="app-rss">{app.rss_mb}MB</span>
          </div>
          {#if !app.system}
            <button
              class="btn btn-sm btn-danger"
              onclick={() => handleStop(app.pkg)}
              disabled={stopping.has(app.pkg)}
            >
              {stopping.has(app.pkg) ? "..." : "Stop"}
            </button>
          {:else}
            <span class="text-xs text-[var(--text-muted)]">system</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .app-list {
    display: flex;
    flex-direction: column;
  }
  .app-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--border);
  }
  .app-row:first-child { border-top: none; }
  .app-row.system { opacity: 0.5; }
  .app-info {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }
  .app-label {
    font-size: 0.8125rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .app-rss {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }
</style>
