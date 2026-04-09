<script lang="ts">
  import { fetchBridgeHealth } from "../lib/api";
  import type { BridgeHealth } from "../lib/types";

  let health: BridgeHealth | null = $state(null);
  let expanded = $state(false);
  /** Snapshot of bridge uptime at last fetch (seconds) */
  let fetchedUptime = $state(0);
  /** Monotonic time (ms) when last fetch occurred */
  let fetchedAt = $state(0);
  /** Live-ticking uptime in seconds, updated every second */
  let liveUptime = $state(0);

  async function refresh() {
    health = await fetchBridgeHealth();
    if (health?.uptime != null) {
      // process.uptime() returns seconds
      fetchedUptime = health.uptime;
      fetchedAt = Date.now();
    }
  }

  // Initial fetch + poll every 15s (browser only) — cleaned up on component destroy
  $effect(() => {
    if (typeof window === "undefined") return;
    refresh();
    const pollId = setInterval(refresh, 15_000);
    const tickId = setInterval(() => {
      if (fetchedAt > 0) {
        const elapsed = (Date.now() - fetchedAt) / 1000;
        liveUptime = Math.floor(fetchedUptime + elapsed);
      }
    }, 1000);
    return () => { clearInterval(pollId); clearInterval(tickId); };
  });

  function formatUptime(seconds: number): string {
    if (seconds <= 0) return "0m";
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  /** Short tool name: strip common prefixes */
  function shortTool(name: string): string {
    return name.replace(/^(mcp__cfc-bridge__|browser_)/, "");
  }
</script>

<div class="card compact-card" class:expanded>
  <button class="card-header" onclick={() => expanded = !expanded}>
    <span class="header-left">
      <span class="chevron">{expanded ? "▾" : "▸"}</span>
      <span class="label">CFC</span>
    </span>
    {#if health}
      {#if !expanded}
        <span class="inline-info">
          {#if liveUptime > 0}
            <span class="uptime-text">{formatUptime(liveUptime)}</span>
          {/if}
          {#if health.lastTool}
            <span class="last-tool" title="Last tool: {health.lastTool}">{shortTool(health.lastTool)}</span>
          {/if}
        </span>
      {/if}
      <span class="badge-row">
        {#if health.cdp}
          <span class="badge" class:badge-green={health.cdp.state === "connected"} class:badge-dim={health.cdp.state !== "connected"}>
            CDP
          </span>
        {/if}
        {#if health.status === "ok"}
          <span class="badge badge-green">on</span>
        {:else}
          <span class="badge badge-dim">off</span>
        {/if}
      </span>
    {:else}
      <span class="badge badge-dim">...</span>
    {/if}
  </button>

  {#if expanded && health}
    <div class="card-body">
      {#if health.status === "ok"}
        <div class="detail-grid">
          {#if health.version}
            <span class="detail-label">Version</span>
            <span>{health.version}</span>
          {/if}
          {#if health.clients != null}
            <span class="detail-label">Clients</span>
            <span>{health.clients}</span>
          {/if}
          <span class="detail-label">Uptime</span>
          <span>{formatUptime(liveUptime)}</span>
          {#if health.cdp}
            <span class="detail-label">CDP</span>
            <span>
              {health.cdp.state}
              {#if health.cdp.targets != null}
                <span class="text-muted">({health.cdp.targets} targets)</span>
              {/if}
            </span>
          {/if}
          {#if health.lastTool}
            <span class="detail-label">Last tool</span>
            <span class="tool-name">{health.lastTool}</span>
          {/if}
          {#if health.lastToolTime}
            <span class="detail-label">Tool time</span>
            <span class="text-muted">{new Date(health.lastToolTime).toLocaleTimeString()}</span>
          {/if}
        </div>
      {:else}
        <p class="offline-msg">{health.error ?? "Not running"}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .compact-card { padding: 0; overflow: hidden; }
  .compact-card.expanded { padding: 0; }
  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: none;
    border: none;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  }
  .card-header:hover { background: var(--bg-tertiary); }
  .header-left {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }
  .chevron { font-size: 0.625rem; color: var(--text-muted); width: 0.75rem; }
  .label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .inline-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .uptime-text {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    white-space: nowrap;
    /* Fixed width prevents layout shift when uptime format changes
       (e.g. "59m" → "1h 0m" → "1d 2h") every second tick */
    font-variant-numeric: tabular-nums;
    min-width: 3rem;
  }
  .last-tool {
    font-size: 0.625rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge-row {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .card-body { padding: 0 0.75rem 0.75rem; }
  .detail-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.125rem 0.75rem;
    font-size: 0.6875rem;
  }
  .detail-label { color: var(--text-muted); }
  .text-muted { color: var(--text-muted); }
  .tool-name {
    word-break: break-all;
    color: var(--accent-purple);
  }
  .offline-msg {
    font-size: 0.6875rem;
    color: var(--text-muted);
    margin: 0;
  }

  @media (max-width: 768px) {
    .card-header { padding: 0.5rem 0.625rem; gap: 0.375rem; }
    .label { font-size: 0.5625rem; }
    .uptime-text { font-size: 0.5625rem; }
    .last-tool { font-size: 0.5rem; }
    .detail-grid { font-size: 0.5625rem; }
  }
</style>
