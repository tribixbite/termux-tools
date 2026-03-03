<script lang="ts">
  import { SseClient, fetchLogs } from "../lib/api";
  import type { LogEntry } from "../lib/types";

  interface Props {
    sessionFilter?: string;
  }

  let { sessionFilter = "" }: Props = $props();

  let entries: LogEntry[] = $state([]);
  let levelFilter: string = $state("all");
  let autoScroll: boolean = $state(true);
  let container: HTMLElement | undefined = $state();

  // Initial fetch (only in browser — SSR has no API to call)
  if (typeof window !== "undefined") {
    fetchLogs(sessionFilter || undefined).then((e) => (entries = e));
  }

  // SSE for real-time log events (browser only)
  const sse = typeof window !== "undefined" ? new SseClient() : null;
  sse?.on<{ entries: LogEntry[] }>("state", async () => {
    // Refresh logs when state changes (new log entries are likely)
    entries = await fetchLogs(sessionFilter || undefined);
    if (autoScroll && container) {
      requestAnimationFrame(() => {
        container!.scrollTop = container!.scrollHeight;
      });
    }
  });

  function levelColor(level: string): string {
    switch (level) {
      case "error": return "var(--accent-red)";
      case "warn": return "var(--accent-yellow)";
      case "info": return "var(--accent-blue)";
      default: return "var(--text-muted)";
    }
  }

  function filteredEntries(): LogEntry[] {
    if (levelFilter === "all") return entries;
    return entries.filter((e) => e.level === levelFilter);
  }

  function handleScroll() {
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    // Auto-scroll enabled if near bottom
    autoScroll = scrollHeight - scrollTop - clientHeight < 50;
  }

  // Reactive scroll
  $effect(() => {
    if (autoScroll && container && entries.length > 0) {
      requestAnimationFrame(() => {
        container!.scrollTop = container!.scrollHeight;
      });
    }
  });
</script>

<div class="flex items-center gap-2 mb-2">
  <select
    class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-primary)]"
    bind:value={levelFilter}
  >
    <option value="all">All levels</option>
    <option value="error">Error</option>
    <option value="warn">Warn</option>
    <option value="info">Info</option>
    <option value="debug">Debug</option>
  </select>

  <label class="flex items-center gap-1 text-xs text-[var(--text-muted)] cursor-pointer ml-auto">
    <input type="checkbox" bind:checked={autoScroll} class="accent-[var(--accent-blue)]" />
    Auto-scroll
  </label>
</div>

<div
  bind:this={container}
  class="card overflow-y-auto font-mono text-xs leading-5"
  style="max-height: 60vh;"
  onscroll={handleScroll}
>
  {#each filteredEntries() as entry}
    <div class="flex gap-2 hover:bg-[var(--bg-tertiary)] px-1 rounded">
      <span class="text-[var(--text-muted)] shrink-0 w-20">{entry.ts.slice(11, 23)}</span>
      <span class="shrink-0 w-12 font-medium" style="color: {levelColor(entry.level)}">
        {entry.level.toUpperCase()}
      </span>
      {#if entry.session}
        <span class="text-[var(--accent-purple)] shrink-0">[{entry.session}]</span>
      {/if}
      <span class="break-all">{entry.msg}</span>
    </div>
  {:else}
    <p class="text-[var(--text-muted)] text-center py-4">No log entries</p>
  {/each}
</div>
