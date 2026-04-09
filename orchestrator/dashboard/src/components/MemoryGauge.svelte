<script lang="ts">
  import { store } from "../lib/store.svelte";
  import type { SystemMemory } from "../lib/types";

  let expanded = $state(false);
  const memory = $derived<SystemMemory | null>(store.daemon?.memory ?? null);

  function pressureColor(pressure: string): string {
    switch (pressure) {
      case "emergency": case "critical": return "var(--accent-red)";
      case "warning": return "var(--accent-yellow)";
      default: return "var(--accent-green)";
    }
  }

  function pressureBadge(pressure: string): string {
    switch (pressure) {
      case "emergency": case "critical": return "badge-red";
      case "warning": return "badge-yellow";
      default: return "badge-green";
    }
  }
</script>

<div class="card compact-card" class:expanded>
  <button class="card-header" onclick={() => expanded = !expanded}>
    <span class="header-left">
      <span class="chevron">{expanded ? "▾" : "▸"}</span>
      <span class="label">Memory</span>
    </span>
    {#if memory}
      {#if !expanded}
        <span class="inline-gauge">
          <span class="gauge-bar inline-bar">
            <span class="gauge-fill" style="width: {memory.used_pct}%; background-color: {pressureColor(memory.pressure)}"></span>
          </span>
          <span class="inline-nums">{memory.available_mb}<span class="unit">MB</span></span>
        </span>
      {/if}
      <span class="badge {pressureBadge(memory.pressure)}">{memory.pressure}</span>
    {/if}
  </button>

  {#if expanded && memory}
    <div class="card-body">
      <div class="detail-row">
        <span>{memory.available_mb} MB free</span>
        <span>{memory.total_mb} MB total</span>
      </div>
      <div class="gauge-bar">
        <span class="gauge-fill" style="width: {memory.used_pct}%; background-color: {pressureColor(memory.pressure)}"></span>
      </div>
      {#if memory.swap_total_mb > 0}
        <div class="swap-info">
          Swap: {memory.swap_free_mb}/{memory.swap_total_mb} MB free
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .compact-card { padding: 0; overflow: hidden; }
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
  .inline-gauge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }
  .inline-bar { flex: 1; height: 6px; }
  .inline-nums {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    white-space: nowrap;
    flex-shrink: 0;
    /* Prevent width jitter when available MB changes every SSE tick */
    font-variant-numeric: tabular-nums;
    min-width: 3.5rem;
    text-align: right;
  }
  .unit { color: var(--text-muted); margin-left: 1px; font-size: 0.625rem; }
  .card-body { padding: 0 0.75rem 0.75rem; }
  .detail-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.6875rem;
    color: var(--text-secondary);
    margin-bottom: 0.375rem;
  }
  .swap-info {
    font-size: 0.6875rem;
    color: var(--text-muted);
    margin-top: 0.375rem;
  }
</style>
