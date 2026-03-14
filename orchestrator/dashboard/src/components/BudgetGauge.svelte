<script lang="ts">
  import { store } from "../lib/store.svelte";

  const count = $derived(store.daemon?.procs?.phantom_procs ?? null);
</script>

<div class="card compact-card">
  <div class="card-header">
    <span class="label">Procs</span>
    {#if count !== null}
      <span class="value">{count}</span>
      <span class="note">phantom</span>
    {/if}
  </div>
</div>

<style>
  .compact-card { padding: 0; overflow: hidden; }
  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    color: var(--text-primary);
  }
  .label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .value {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .note {
    font-size: 0.625rem;
    color: var(--text-muted);
  }
</style>
