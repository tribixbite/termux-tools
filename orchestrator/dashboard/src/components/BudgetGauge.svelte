<script lang="ts">
  import { store } from "../lib/store.svelte";
  import type { BudgetStatus } from "../lib/types";

  let expanded = $state(false);
  const budget = $derived<BudgetStatus | null>(store.daemon?.budget ?? null);

  function modeColor(mode: string): string {
    switch (mode) {
      case "critical": return "var(--accent-red)";
      case "warning": return "var(--accent-yellow)";
      default: return "var(--accent-green)";
    }
  }

  function modeBadge(mode: string): string {
    switch (mode) {
      case "critical": return "badge-red";
      case "warning": return "badge-yellow";
      default: return "badge-green";
    }
  }
</script>

<div class="card compact-card" class:expanded>
  <button class="card-header" onclick={() => expanded = !expanded}>
    <span class="header-left">
      <span class="chevron">{expanded ? "▾" : "▸"}</span>
      <span class="label">Budget</span>
    </span>
    {#if budget}
      {#if !expanded}
        <span class="inline-gauge">
          <span class="gauge-bar inline-bar">
            <span class="gauge-fill" style="width: {Math.min(budget.usage_pct, 100)}%; background-color: {modeColor(budget.mode)}"></span>
          </span>
          <span class="inline-nums">{budget.total_procs}<span class="unit">/{budget.budget}</span></span>
        </span>
      {/if}
      <span class="badge {modeBadge(budget.mode)}">{budget.mode}</span>
    {/if}
  </button>

  {#if expanded && budget}
    <div class="card-body">
      <div class="detail-row">
        <span>{budget.total_procs} processes</span>
        <span>{budget.budget} budget</span>
      </div>
      <div class="gauge-bar">
        <span class="gauge-fill" style="width: {Math.min(budget.usage_pct, 100)}%; background-color: {modeColor(budget.mode)}"></span>
      </div>
      <div class="usage-info">{budget.usage_pct}% utilization</div>
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
  .usage-info {
    font-size: 0.6875rem;
    color: var(--text-muted);
    margin-top: 0.375rem;
  }
</style>
