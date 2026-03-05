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
    <table class="app-table">
      <tbody>
        {#each apps as app (app.pkg)}
          <tr class="app-row" class:system={app.system}>
            <td class="td-label">{app.label}</td>
            <td class="td-rss">{app.rss_mb}<span class="unit">MB</span></td>
            <td class="td-action">
              {#if !app.system}
                <button
                  class="btn btn-sm btn-danger"
                  onclick={() => handleStop(app.pkg)}
                  disabled={stopping.has(app.pkg)}
                >
                  {stopping.has(app.pkg) ? "..." : "Stop"}
                </button>
              {:else}
                <span class="sys-label">system</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .app-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  .app-row td {
    padding: 0.5rem 0.375rem;
    border-top: 1px solid var(--border);
    vertical-align: middle;
  }
  .app-row:first-child td { border-top: none; }
  .app-row.system { opacity: 0.5; }
  .td-label {
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 0;
    width: 100%;
  }
  .td-rss {
    text-align: right;
    color: var(--text-secondary);
    font-size: 0.75rem;
    white-space: nowrap;
    padding-right: 0.75rem !important;
  }
  .unit { color: var(--text-muted); margin-left: 1px; }
  .td-action {
    text-align: right;
    white-space: nowrap;
    width: 4rem;
  }
  .sys-label {
    font-size: 0.6875rem;
    color: var(--text-muted);
  }
</style>
