<script lang="ts">
  import { fetchTelemetry } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import type { TelemetryRecord, TelemetryStats, TelemetrySdk } from "../lib/types";

  /** SDK display colors keyed by identifier */
  const SDK_COLORS: Record<string, string> = {
    aria: "var(--accent-purple)",
    onecollector: "var(--accent-blue)",
    adjust: "var(--accent-yellow)",
    appcenter: "var(--accent-red)",
    ecs: "var(--accent-cyan)",
    analytics: "var(--accent-green)",
    vortex: "var(--accent-purple)",
    google: "var(--accent-yellow)",
    rewards: "var(--accent-blue)",
    webxt: "var(--accent-cyan)",
    unknown: "var(--text-muted)",
  };

  let records: TelemetryRecord[] = $state([]);
  let stats: TelemetryStats | null = $state(null);
  let sdkFilter: string = $state("");
  let autoScroll: boolean = $state(true);
  let expandedIdx: number | null = $state(null);
  let container: HTMLElement | undefined = $state();

  // Initial fetch
  if (typeof window !== "undefined") {
    fetchTelemetry({ limit: 500 }).then((data) => {
      records = data.records;
      stats = data.stats;
    });
  }

  // Live SSE updates — append new records from store
  $effect(() => {
    const rec = store.lastTelemetry;
    if (!rec) return;

    // Filter check
    if (sdkFilter && rec.sdk !== sdkFilter) return;

    records = [...records, rec];
    // Cap client-side buffer at 1000
    if (records.length > 1000) {
      records = records.slice(-500);
    }

    // Update stats counters locally
    if (stats) {
      stats = {
        ...stats,
        total: stats.total + 1,
        by_sdk: {
          ...stats.by_sdk,
          [rec.sdk]: (stats.by_sdk[rec.sdk] ?? 0) + 1,
        },
      };
    }
  });

  // Auto-scroll when new records arrive
  $effect(() => {
    if (autoScroll && container && records.length > 0) {
      requestAnimationFrame(() => {
        container!.scrollTop = container!.scrollHeight;
      });
    }
  });

  function handleScroll() {
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    autoScroll = scrollHeight - scrollTop - clientHeight < 50;
  }

  function filteredRecords(): TelemetryRecord[] {
    if (!sdkFilter) return records;
    return records.filter((r) => r.sdk === sdkFilter);
  }

  function setFilter(sdk: string) {
    sdkFilter = sdkFilter === sdk ? "" : sdk;
    // Re-fetch with new filter
    fetchTelemetry({ limit: 500, sdk: sdkFilter || undefined }).then((data) => {
      records = data.records;
      stats = data.stats;
    });
  }

  function toggleExpand(idx: number) {
    expandedIdx = expandedIdx === idx ? null : idx;
  }

  function formatTime(ts: string): string {
    return ts.slice(11, 23); // HH:MM:SS.mmm
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  /** Get sorted SDK entries from stats for filter chips */
  function sdkEntries(): Array<[string, number]> {
    if (!stats?.by_sdk) return [];
    return Object.entries(stats.by_sdk)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a);
  }

  function sdkColor(sdk: string): string {
    return SDK_COLORS[sdk] ?? "var(--text-muted)";
  }

  function truncatePath(path: string, max = 60): string {
    return path.length > max ? path.slice(0, max) + "..." : path;
  }
</script>

<!-- Stats bar -->
{#if stats}
  <div class="stats-bar">
    <div class="stat">
      <span class="stat-value">{stats.total.toLocaleString()}</span>
      <span class="stat-label">total</span>
    </div>
    <div class="stat">
      <span class="stat-value">{stats.per_hour}</span>
      <span class="stat-label">/hr</span>
    </div>
    <div class="stat">
      <span class="stat-value">{sdkEntries().length}</span>
      <span class="stat-label">SDKs</span>
    </div>
  </div>
{/if}

<!-- SDK filter chips -->
<div class="chips">
  {#each sdkEntries() as [sdk, count]}
    <button
      class="chip"
      class:active={sdkFilter === sdk}
      style="--chip-color: {sdkColor(sdk)}"
      onclick={() => setFilter(sdk)}
    >
      <span class="chip-dot" style="background: {sdkColor(sdk)}"></span>
      {sdk}
      <span class="chip-count">{count}</span>
    </button>
  {/each}
  {#if sdkFilter}
    <button class="chip chip-clear" onclick={() => setFilter("")}>
      clear
    </button>
  {/if}
</div>

<!-- Controls -->
<div class="flex items-center gap-2 mb-2 mt-2">
  <span class="text-xs text-[var(--text-muted)]">
    {filteredRecords().length} record{filteredRecords().length !== 1 ? 's' : ''}
  </span>
  <label class="flex items-center gap-1 text-xs text-[var(--text-muted)] cursor-pointer ml-auto">
    <input type="checkbox" bind:checked={autoScroll} class="accent-[var(--accent-blue)]" />
    Auto-scroll
  </label>
</div>

<!-- Record list -->
<div
  bind:this={container}
  class="card overflow-y-auto font-mono text-xs leading-5"
  style="max-height: 60vh;"
  onscroll={handleScroll}
>
  {#each filteredRecords() as record, idx}
    <div class="record" class:expanded={expandedIdx === idx}>
      <!-- Summary row -->
      <button class="record-summary" onclick={() => toggleExpand(idx)}>
        <span class="record-ts">{formatTime(record.ts)}</span>
        <span class="record-method" class:post={record.method === "POST"}>{record.method}</span>
        <span class="record-sdk" style="color: {sdkColor(record.sdk)}">{record.sdk}</span>
        <span class="record-path">{truncatePath(record.path)}</span>
        <span class="record-size">{formatBytes(record.body_bytes)}</span>
      </button>

      <!-- Expanded detail -->
      {#if expandedIdx === idx}
        <div class="record-detail">
          <div class="detail-row">
            <span class="detail-key">Host</span>
            <span class="detail-val">{record.host || '(empty)'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-key">Content-Type</span>
            <span class="detail-val">{record.content_type || '(none)'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-key">User-Agent</span>
            <span class="detail-val truncate-ua">{record.user_agent || '(none)'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-key">Full Path</span>
            <span class="detail-val" style="word-break: break-all">{record.path}</span>
          </div>
          {#if record.body_preview}
            <div class="detail-row detail-body">
              <span class="detail-key">Body</span>
              <pre class="detail-pre">{record.body_preview}</pre>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <p class="text-[var(--text-muted)] text-center py-4">
      No telemetry records captured yet. Enable <code>[telemetry_sink]</code> in operad.toml and rebuild Edge APK.
    </p>
  {/each}
</div>

<style>
  .stats-bar {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 0.75rem;
  }
  .stat {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }
  .stat-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
  }
  .stat-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1875rem 0.5rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.7rem;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .chip:hover { border-color: var(--chip-color, var(--text-muted)); }
  .chip.active {
    border-color: var(--chip-color, var(--accent-blue));
    background: rgba(88, 166, 255, 0.1);
    color: var(--text-primary);
  }
  .chip-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .chip-count {
    color: var(--text-muted);
    font-size: 0.625rem;
  }
  .chip-clear {
    color: var(--accent-red);
    border-color: var(--accent-red);
    font-style: italic;
  }

  .record {
    border-bottom: 1px solid var(--bg-tertiary);
  }
  .record:last-child { border-bottom: none; }
  .record-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.25rem 0.25rem;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    text-align: left;
    border-radius: 3px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .record-summary:hover { background: var(--bg-tertiary); }
  .record.expanded .record-summary { background: var(--bg-tertiary); }

  .record-ts {
    color: var(--text-muted);
    flex-shrink: 0;
    font-size: 0.6875rem;
  }
  .record-method {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--accent-green);
    min-width: 2.5rem;
  }
  .record-method.post { color: var(--accent-yellow); }
  .record-sdk {
    flex-shrink: 0;
    font-weight: 500;
    min-width: 5rem;
  }
  .record-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .record-size {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 0.6875rem;
    text-align: right;
    min-width: 3.5rem;
  }

  .record-detail {
    padding: 0.5rem 0.5rem 0.5rem 1.5rem;
    background: var(--bg-primary);
    border-radius: 0 0 4px 4px;
  }
  .detail-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.125rem 0;
    font-size: 0.6875rem;
  }
  .detail-key {
    color: var(--text-muted);
    min-width: 6rem;
    flex-shrink: 0;
  }
  .detail-val {
    color: var(--text-secondary);
    word-break: break-word;
  }
  .truncate-ua {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 30rem;
  }
  .detail-body { flex-direction: column; }
  .detail-pre {
    margin: 0.25rem 0 0;
    padding: 0.375rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.625rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-secondary);
    max-height: 10rem;
  }

  @media (max-width: 768px) {
    .stats-bar { gap: 1rem; }
    .stat-value { font-size: 1rem; }
    .record-sdk { min-width: 3.5rem; font-size: 0.625rem; }
    .record-size { display: none; }
    .record-path { font-size: 0.625rem; }
    .detail-key { min-width: 4.5rem; }
  }
</style>
