<script lang="ts">
  import { fetchTokens } from "../lib/api";
  import type { ProjectTokenUsage } from "../lib/types";
  import CostChart from "./CostChart.svelte";

  let expanded = $state(false);
  let projects: ProjectTokenUsage[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Format cost as dollar string */
  function fmtCost(usd: number): string {
    if (usd < 0.01) return "<$0.01";
    if (usd < 1) return `$${usd.toFixed(2)}`;
    return `$${usd.toFixed(2)}`;
  }

  /** Format large token counts with K/M suffix */
  function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  }

  /** Cache efficiency: % of input from cache vs total input */
  function cacheEfficiency(p: ProjectTokenUsage): string {
    const total = p.total.input_tokens + p.total.cache_read_tokens + p.total.cache_creation_tokens;
    if (total === 0) return "0%";
    const cached = p.total.cache_read_tokens;
    return `${Math.round((cached / total) * 100)}%`;
  }

  const totalCost = $derived(projects.reduce((sum, p) => sum + p.total.cost_usd, 0));
  const totalTurns = $derived(projects.reduce((sum, p) => sum + p.total.turns, 0));

  async function load() {
    try {
      projects = await fetchTokens();
      error = null;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (typeof window === "undefined") return;
    load();
    // Poll every 30s — token data changes slowly
    pollTimer = setInterval(load, 30_000);
    return () => { if (pollTimer) clearInterval(pollTimer); };
  });
</script>

<div class="card compact-card" class:expanded>
  <button class="card-header" onclick={() => expanded = !expanded}>
    <span class="header-left">
      <span class="chevron">{expanded ? "▾" : "▸"}</span>
      <span class="label">Tokens</span>
    </span>
    {#if !loading}
      {#if !expanded}
        <span class="inline-info">
          <span class="inline-stat">{totalTurns}<span class="unit">turns</span></span>
        </span>
      {/if}
      <span class="badge badge-cost">{fmtCost(totalCost)}</span>
    {:else}
      <span class="inline-info dim">...</span>
    {/if}
  </button>

  {#if expanded}
    <div class="card-body">
      {#if error}
        <p class="error">{error}</p>
      {:else if projects.length === 0}
        <p class="empty">No active sessions with token data</p>
      {:else}
        <!-- Cost chart -->
        <CostChart />
        <table class="token-table">
          <thead>
            <tr>
              <th>Session</th>
              <th class="right">Turns</th>
              <th class="right">Cost</th>
              <th class="right">Cache</th>
            </tr>
          </thead>
          <tbody>
            {#each projects as project (project.path)}
              <tr>
                <td class="name">{project.name}</td>
                <td class="right nums">{project.total.turns}</td>
                <td class="right nums">{fmtCost(project.total.cost_usd)}</td>
                <td class="right nums cache">{cacheEfficiency(project)}</td>
              </tr>
              {#if project.sessions.length > 1}
                {#each project.sessions.slice(0, 3) as session (session.session_id)}
                  <tr class="sub-row">
                    <td class="sub-name">{session.session_id.slice(0, 8)}</td>
                    <td class="right nums dim">{session.turns}</td>
                    <td class="right nums dim">{fmtCost(session.cost_usd)}</td>
                    <td class="right nums dim">{fmtTokens(session.output_tokens)}<span class="unit">out</span></td>
                  </tr>
                {/each}
                {#if project.sessions.length > 3}
                  <tr class="sub-row"><td colspan="4" class="dim">+{project.sessions.length - 3} more</td></tr>
                {/if}
              {/if}
            {/each}
          </tbody>
        </table>
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
  .inline-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    justify-content: flex-end;
  }
  .inline-stat {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .unit { color: var(--text-muted); margin-left: 2px; font-size: 0.625rem; }
  .dim { color: var(--text-muted); }
  .badge-cost {
    font-size: 0.625rem;
    font-weight: 600;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    background: rgba(88, 166, 255, 0.12);
    color: var(--accent-blue);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .card-body { padding: 0 0.75rem 0.75rem; }
  .error { color: var(--accent-red); font-size: 0.6875rem; }
  .empty { color: var(--text-muted); font-size: 0.6875rem; }

  .token-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.6875rem;
  }
  .token-table th {
    text-align: left;
    font-size: 0.5625rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 0.25rem 0.375rem;
  }
  .token-table td {
    padding: 0.25rem;
    border-top: 1px solid var(--border);
  }
  .right { text-align: right; }
  .nums { font-variant-numeric: tabular-nums; }
  .name { font-weight: 500; color: var(--accent-blue); }
  .cache { color: var(--accent-green); }
  .sub-row td { border-top: none; padding: 0.125rem 0.25rem; }
  .sub-name {
    font-family: "SF Mono", "Cascadia Code", monospace;
    font-size: 0.5625rem;
    color: var(--text-muted);
    padding-left: 0.75rem;
  }
</style>
