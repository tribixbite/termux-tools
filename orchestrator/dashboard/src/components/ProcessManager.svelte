<script lang="ts">
  import { fetchProcesses, killProcess, type ProcessInfo } from "../lib/api";

  let processes: ProcessInfo[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let killing = $state(new Set<number>());

  async function refresh() {
    try {
      processes = await fetchProcesses();
      error = null;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleKill(pid: number) {
    killing = new Set([...killing, pid]);
    try {
      await killProcess(pid);
      // Brief delay then refresh
      setTimeout(refresh, 500);
    } catch (e) {
      error = `Failed to kill PID ${pid}: ${(e as Error).message}`;
    } finally {
      killing = new Set([...killing].filter((p) => p !== pid));
    }
  }

  // Truncate long command strings
  function truncateCmd(cmd: string, maxLen = 60): string {
    if (cmd.length <= maxLen) return cmd;
    return cmd.slice(0, maxLen - 1) + "\u2026";
  }

  // Initial load
  if (typeof window !== "undefined") {
    refresh();
  }

  // Total RSS
  let totalRss = $derived(processes.reduce((sum, p) => sum + p.rss_mb, 0));
</script>

<div class="card">
  <div class="flex items-center justify-between mb-3">
    <h2 class="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Processes</h2>
    <div class="flex items-center gap-2">
      {#if totalRss > 0}
        <span class="text-xs text-[var(--text-muted)]">{totalRss}MB total</span>
      {/if}
      <button class="btn btn-sm" onclick={refresh}>Refresh</button>
    </div>
  </div>

  {#if loading}
    <p class="text-xs text-[var(--text-muted)]">Loading...</p>
  {:else if error}
    <p class="text-xs text-[var(--accent-red)]">{error}</p>
  {:else if processes.length === 0}
    <p class="text-xs text-[var(--text-muted)]">No processes found</p>
  {:else}
    <div class="space-y-0.5">
      {#each processes as proc (proc.pid)}
        <div class="proc-row">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <span class="text-xs text-[var(--text-muted)] w-6 text-right flex-shrink-0">{proc.rss_mb}</span>
            <span class="text-xs text-[var(--text-secondary)] font-medium flex-shrink-0">{proc.name}</span>
            <span class="text-xs text-[var(--text-muted)] truncate min-w-0">{truncateCmd(proc.cmd)}</span>
          </div>
          <button
            class="btn btn-sm btn-danger flex-shrink-0"
            onclick={() => handleKill(proc.pid)}
            disabled={killing.has(proc.pid)}
          >
            {killing.has(proc.pid) ? "..." : "Kill"}
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .proc-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0;
    border-top: 1px solid var(--border);
  }
  .proc-row:first-child { border-top: none; }
  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
