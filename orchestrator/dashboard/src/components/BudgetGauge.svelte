<script lang="ts">
  import { SseClient, fetchStatus } from "../lib/api";
  import type { BudgetStatus, DaemonStatus } from "../lib/types";

  let budget: BudgetStatus | null = $state(null);

  // Fetch initial data (browser only)
  if (typeof window !== "undefined") {
    fetchStatus().then((d) => { budget = d.budget; });
  }

  // SSE updates (browser only)
  const sse = typeof window !== "undefined" ? new SseClient() : null;
  sse?.on<DaemonStatus>("state", (data) => {
    budget = data.budget;
  });

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

<div class="card">
  <div class="flex items-center justify-between mb-2">
    <h3 class="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Process Budget</h3>
    {#if budget}
      <span class="badge {modeBadge(budget.mode)}">{budget.mode}</span>
    {/if}
  </div>

  {#if budget}
    <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
      <span>{budget.total_procs} processes</span>
      <span>{budget.budget} budget</span>
    </div>
    <div class="gauge-bar">
      <div
        class="gauge-fill"
        style="width: {Math.min(budget.usage_pct, 100)}%; background-color: {modeColor(budget.mode)}"
      ></div>
    </div>
  {:else}
    <p class="text-xs text-[var(--text-muted)]">Loading...</p>
  {/if}
</div>
