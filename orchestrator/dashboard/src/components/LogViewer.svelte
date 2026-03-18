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

  // SSE for real-time log events (browser only) — cleaned up on component destroy
  $effect(() => {
    if (typeof window === "undefined") return;
    const sse = new SseClient();
    sse.on<{ entries: LogEntry[] }>("state", async () => {
      // Refresh logs when state changes (new log entries are likely)
      entries = await fetchLogs(sessionFilter || undefined);
      if (autoScroll && container) {
        requestAnimationFrame(() => {
          container!.scrollTop = container!.scrollHeight;
        });
      }
    });
    return () => sse.close();
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
    <div class="log-line">
      <span class="log-ts">{entry.ts.slice(11, 23)}</span>
      <span class="log-level" style="color: {levelColor(entry.level)}">{entry.level.toUpperCase().padEnd(5)}</span>
      {#if entry.session}
        <span class="log-session">[{entry.session}]</span>
      {/if}
      <span class="log-msg">{entry.msg}</span>
    </div>
  {:else}
    <p class="text-[var(--text-muted)] text-center py-4">No log entries</p>
  {/each}
</div>

<style>
  .log-line {
    display: flex;
    gap: 0.5rem;
    padding: 0.125rem 0.25rem;
    border-radius: 3px;
    white-space: pre;
    overflow-x: auto;
  }
  .log-line:hover { background: var(--bg-tertiary); }
  .log-ts {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .log-level {
    flex-shrink: 0;
    font-weight: 600;
  }
  .log-session {
    color: var(--accent-purple);
    flex-shrink: 0;
  }
  .log-msg {
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
