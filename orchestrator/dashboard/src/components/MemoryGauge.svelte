<script lang="ts">
  import { SseClient, fetchStatus } from "../lib/api";
  import type { SystemMemory, DaemonStatus } from "../lib/types";

  let memory: SystemMemory | null = $state(null);

  // Fetch initial data (browser only)
  if (typeof window !== "undefined") {
    fetchStatus().then((d) => { memory = d.memory; });
  }

  // SSE updates (browser only)
  const sse = typeof window !== "undefined" ? new SseClient() : null;
  sse?.on<DaemonStatus>("state", (data) => {
    memory = data.memory;
  });

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

<div class="card">
  <div class="flex items-center justify-between mb-2">
    <h3 class="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Memory</h3>
    {#if memory}
      <span class="badge {pressureBadge(memory.pressure)}">{memory.pressure}</span>
    {/if}
  </div>

  {#if memory}
    <div class="mb-2">
      <div class="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
        <span>{memory.available_mb} MB free</span>
        <span>{memory.total_mb} MB total</span>
      </div>
      <div class="gauge-bar">
        <div
          class="gauge-fill"
          style="width: {memory.used_pct}%; background-color: {pressureColor(memory.pressure)}"
        ></div>
      </div>
    </div>

    {#if memory.swap_total_mb > 0}
      <div class="text-xs text-[var(--text-muted)]">
        Swap: {memory.swap_free_mb}/{memory.swap_total_mb} MB free
      </div>
    {/if}
  {:else}
    <p class="text-xs text-[var(--text-muted)]">Loading...</p>
  {/if}
</div>
