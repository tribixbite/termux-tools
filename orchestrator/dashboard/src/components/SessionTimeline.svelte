<script lang="ts">
  import { fetchTimeline } from "../lib/api";
  import type { TimelineEvent } from "../lib/types";

  interface Props {
    sessionName: string;
  }
  let { sessionName }: Props = $props();

  let events: TimelineEvent[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let expanded = $state(false);

  /** Source-based dot color */
  function dotColor(source: string): string {
    switch (source) {
      case "conversation": return "dot-blue";
      case "state": return "dot-yellow";
      default: return "dot-dim";
    }
  }

  /** Format timestamp to short time */
  function fmtTime(ts: string): string {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return ts; }
  }

  async function load() {
    loading = true;
    try {
      events = await fetchTimeline(sessionName, { limit: 50 });
      error = null;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (typeof window === "undefined" || !expanded) return;
    load();
  });
</script>

<div class="timeline-section">
  <button class="timeline-toggle" onclick={() => expanded = !expanded}>
    <span class="chevron">{expanded ? "▾" : "▸"}</span>
    <span class="section-label">Timeline</span>
    {#if events.length > 0 && !expanded}
      <span class="event-count">{events.length}</span>
    {/if}
  </button>

  {#if expanded}
    <div class="timeline-body">
      {#if loading}
        <p class="muted">Loading timeline...</p>
      {:else if error}
        <p class="error">{error}</p>
      {:else if events.length === 0}
        <p class="muted">No events found</p>
      {:else}
        <div class="event-list">
          {#each events as event, idx (idx)}
            <div class="event-row">
              <span class="event-time">{fmtTime(event.timestamp)}</span>
              <span class="event-dot {dotColor(event.source)}"></span>
              <span class="event-text">{event.event}</span>
              {#if event.detail}
                <span class="event-detail">{event.detail}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .timeline-section {
    margin-top: 0.5rem;
  }
  .timeline-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: none;
    border: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.6875rem;
    cursor: pointer;
    padding: 0.25rem 0;
  }
  .timeline-toggle:hover { color: var(--text-primary); }
  .chevron { font-size: 0.5625rem; color: var(--text-muted); width: 0.625rem; }
  .section-label {
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.5625rem;
  }
  .event-count {
    font-size: 0.5rem;
    color: var(--text-muted);
    background: var(--bg-tertiary);
    padding: 0.0625rem 0.25rem;
    border-radius: 3px;
  }
  .timeline-body {
    padding: 0.375rem 0;
    max-height: 15rem;
    overflow-y: auto;
  }
  .muted { color: var(--text-muted); font-size: 0.625rem; margin: 0; }
  .error { color: var(--accent-red); font-size: 0.625rem; margin: 0; }
  .event-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .event-row {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
    font-size: 0.625rem;
    line-height: 1.4;
  }
  .event-time {
    flex-shrink: 0;
    width: 4.5rem;
    color: var(--text-muted);
    font-family: "SF Mono", "Cascadia Code", monospace;
    font-size: 0.5625rem;
  }
  .event-dot {
    flex-shrink: 0;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    margin-top: 0.25rem;
  }
  .dot-blue { background: var(--accent-blue); }
  .dot-yellow { background: var(--accent-yellow); }
  .dot-dim { background: var(--text-muted); opacity: 0.5; }
  .event-text {
    color: var(--text-secondary);
    word-break: break-word;
  }
  .event-detail {
    color: var(--text-muted);
    font-style: italic;
    word-break: break-word;
  }
</style>
