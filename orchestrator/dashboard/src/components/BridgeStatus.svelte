<script lang="ts">
  import { fetchBridgeHealth } from "../lib/api";
  import type { BridgeHealth } from "../lib/types";

  let health: BridgeHealth | null = $state(null);

  async function refresh() {
    health = await fetchBridgeHealth();
  }

  // Initial fetch + poll every 30s (browser only)
  if (typeof window !== "undefined") {
    refresh();
    setInterval(refresh, 30_000);
  }

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
</script>

<div class="card">
  <div class="flex items-center justify-between mb-2">
    <h3 class="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">CFC Bridge</h3>
    {#if health}
      {#if health.status === "ok"}
        <span class="badge badge-green">connected</span>
      {:else}
        <span class="badge badge-dim">offline</span>
      {/if}
    {/if}
  </div>

  {#if health}
    {#if health.status === "ok"}
      <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {#if health.version}
          <span class="text-[var(--text-muted)]">Version</span>
          <span>{health.version}</span>
        {/if}
        {#if health.clients != null}
          <span class="text-[var(--text-muted)]">Clients</span>
          <span>{health.clients}</span>
        {/if}
        {#if health.uptime != null}
          <span class="text-[var(--text-muted)]">Uptime</span>
          <span>{formatUptime(Math.floor(health.uptime / 1000))}</span>
        {/if}
        {#if health.cdp}
          <span class="text-[var(--text-muted)]">CDP</span>
          <span>
            {health.cdp.state}
            {#if health.cdp.targets != null}
              <span class="text-[var(--text-muted)]">({health.cdp.targets} targets)</span>
            {/if}
          </span>
        {/if}
      </div>
    {:else}
      <p class="text-xs text-[var(--text-muted)]">{health.error ?? "Not running"}</p>
    {/if}
  {:else}
    <p class="text-xs text-[var(--text-muted)]">Checking...</p>
  {/if}
</div>
