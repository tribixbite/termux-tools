<script lang="ts">
  import { fetchPrompts, starPrompt, unstarPrompt } from "../lib/api";
  import type { PromptSearchResult, PromptEntry } from "../lib/types";

  interface Props {
    /** Called when user selects a prompt; receives the full display text */
    onselect?: (text: string) => void;
    /** Compact dropdown-style rendering (smaller font, no header) */
    compact?: boolean;
    /** Pre-filter to a specific project path */
    filterProject?: string;
  }
  let { onselect, compact = false, filterProject }: Props = $props();

  // -- Search & filter state --------------------------------------------------

  let searchInput = $state("");
  let debouncedQuery = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let showStarred = $state(false);
  let selectedProject = $state("");

  // -- Data state -------------------------------------------------------------

  let prompts = $state<PromptEntry[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let loadingMore = $state(false);
  let error = $state<string | null>(null);
  let offset = $state(0);
  let copyFeedback = $state<string | null>(null);

  const PAGE_SIZE = 20;

  /** Unique project basenames extracted from loaded prompts */
  const projectOptions = $derived(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const p of prompts) {
      const base = projectBasename(p.project);
      if (base && !seen.has(base)) {
        seen.add(base);
        list.push(base);
      }
    }
    return list.sort();
  });

  const hasMore = $derived(offset + PAGE_SIZE < total);

  // -- Debounce search input --------------------------------------------------

  $effect(() => {
    // Track searchInput reactively
    const val = searchInput;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedQuery = val;
    }, 300);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  // -- Fetch prompts when filters change --------------------------------------

  $effect(() => {
    // Track all filter dependencies
    const _q = debouncedQuery;
    const _starred = showStarred;
    const _proj = selectedProject;
    const _filterProj = filterProject;
    // Reset offset and reload
    offset = 0;
    loadPrompts(0, _q, _starred, _proj || _filterProj || "");
  });

  async function loadPrompts(
    requestOffset: number,
    q: string,
    starred: boolean,
    project: string,
  ) {
    loading = requestOffset === 0;
    loadingMore = requestOffset > 0;
    error = null;
    try {
      const result: PromptSearchResult = await fetchPrompts({
        q: q || undefined,
        starred: starred || undefined,
        project: project || undefined,
        limit: PAGE_SIZE,
        offset: requestOffset,
      });
      if (requestOffset === 0) {
        prompts = result.prompts;
      } else {
        prompts = [...prompts, ...result.prompts];
      }
      total = result.total;
      offset = result.offset;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const nextOffset = offset + PAGE_SIZE;
    await loadPrompts(
      nextOffset,
      debouncedQuery,
      showStarred,
      selectedProject || filterProject || "",
    );
  }

  // -- Star/unstar toggle -----------------------------------------------------

  async function toggleStar(prompt: PromptEntry) {
    const prev = prompt.starred;
    // Optimistic update
    prompt.starred = !prev;
    prompts = [...prompts];
    try {
      if (prev) {
        await unstarPrompt(prompt.id);
      } else {
        await starPrompt(prompt.id);
      }
    } catch {
      // Revert on failure
      prompt.starred = prev;
      prompts = [...prompts];
    }
  }

  // -- Select / copy ----------------------------------------------------------

  function handleSelect(prompt: PromptEntry) {
    if (onselect) {
      onselect(prompt.display);
    } else {
      copyToClipboard(prompt.display);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copyFeedback = "Copied";
      setTimeout(() => { copyFeedback = null; }, 1500);
    } catch {
      copyFeedback = "Copy failed";
      setTimeout(() => { copyFeedback = null; }, 1500);
    }
  }

  // -- Helpers ----------------------------------------------------------------

  /** Extract the last path segment as a project display name */
  function projectBasename(path: string): string {
    if (!path) return "";
    const segments = path.replace(/\/+$/, "").split("/");
    return segments[segments.length - 1] || path;
  }

  /** Truncate text to maxLen chars with ellipsis */
  function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen).trimEnd() + "...";
  }

  /** Relative time string from epoch ms */
  function timeAgo(epochMs: number): string {
    const ms = Date.now() - epochMs;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
</script>

<div class="prompt-library" class:compact class:card={!compact}>
  {#if !compact}
    <div class="header">
      <h2 class="title">Prompt Library</h2>
      <span class="count">{total} prompts</span>
    </div>
  {/if}

  <!-- Search input -->
  <div class="search-row">
    <input
      type="text"
      class="search-input"
      placeholder="Search prompts..."
      bind:value={searchInput}
    />
    {#if copyFeedback}
      <span class="copy-feedback">{copyFeedback}</span>
    {/if}
  </div>

  <!-- Filter pills -->
  <div class="filter-row">
    <button
      class="pill"
      class:pill-active={showStarred}
      onclick={() => { showStarred = !showStarred; }}
    >
      <span class="star-icon">{showStarred ? "\u2605" : "\u2606"}</span>
      Starred
    </button>

    {#if !filterProject}
      <select
        class="project-select"
        bind:value={selectedProject}
      >
        <option value="">All projects</option>
        {#each projectOptions() as proj (proj)}
          <option value={proj}>{proj}</option>
        {/each}
      </select>
    {/if}
  </div>

  <!-- Prompt list -->
  <div class="prompt-list">
    {#if loading}
      <div class="status-msg">Loading...</div>
    {:else if error}
      <div class="status-msg error">{error}</div>
    {:else if prompts.length === 0}
      <div class="status-msg">
        {debouncedQuery || showStarred ? "No matching prompts" : "No prompts found"}
      </div>
    {:else}
      {#each prompts as prompt (prompt.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="prompt-item"
          onclick={() => handleSelect(prompt)}
          onkeydown={(e) => { if (e.key === "Enter") handleSelect(prompt); }}
          role="button"
          tabindex="0"
          title={prompt.display}
        >
          <div class="prompt-text">{truncate(prompt.display, 120)}</div>
          <div class="prompt-meta">
            <span class="prompt-project">{projectBasename(prompt.project)}</span>
            <span class="prompt-time">{timeAgo(prompt.timestamp)}</span>
            {#if prompt.sessionId}
              <span class="prompt-session">{prompt.sessionId.slice(0, 6)}</span>
            {/if}
          </div>
          <!-- Star toggle -->
          <button
            class="star-btn"
            class:starred={prompt.starred}
            onclick={(e) => { e.stopPropagation(); toggleStar(prompt); }}
            title={prompt.starred ? "Unstar" : "Star"}
          >
            {prompt.starred ? "\u2605" : "\u2606"}
          </button>
        </div>
      {/each}

      {#if hasMore}
        <button
          class="load-more-btn"
          onclick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading..." : `Load more (${total - prompts.length} remaining)`}
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  /* -- Layout -- */
  .prompt-library {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .prompt-library:not(.compact) {
    /* Standalone card mode uses card class from global.css */
  }

  /* -- Header (standalone mode only) -- */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }
  .title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
  }
  .count {
    font-size: 0.625rem;
    color: var(--text-muted);
  }

  /* -- Search row -- */
  .search-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .search-input {
    flex: 1;
    padding: 0.375rem 0.5rem;
    font-size: 0.6875rem;
    font-family: inherit;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    outline: none;
  }
  .search-input::placeholder { color: var(--text-muted); }
  .search-input:focus { border-color: var(--accent-blue); }
  .compact .search-input { font-size: 0.625rem; padding: 0.25rem 0.375rem; }

  .copy-feedback {
    font-size: 0.5625rem;
    color: var(--accent-green);
    white-space: nowrap;
    animation: fade-in 0.15s ease;
  }

  /* -- Filter row -- */
  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.1875rem;
    padding: 0.1875rem 0.5rem;
    font-size: 0.625rem;
    font-family: inherit;
    border: 1px solid var(--border);
    border-radius: 9999px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .pill:hover { border-color: var(--text-muted); color: var(--text-primary); }
  .pill-active {
    border-color: var(--accent-yellow);
    color: var(--accent-yellow);
    background: rgba(210, 153, 34, 0.1);
  }
  .star-icon { font-size: 0.6875rem; line-height: 1; }

  .project-select {
    padding: 0.1875rem 0.375rem;
    font-size: 0.625rem;
    font-family: inherit;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    outline: none;
    cursor: pointer;
    max-width: 10rem;
  }
  .project-select:focus { border-color: var(--accent-blue); }

  /* -- Prompt list -- */
  .prompt-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    max-height: 24rem;
    overflow-y: auto;
  }
  .compact .prompt-list { max-height: 16rem; }

  .status-msg {
    font-size: 0.6875rem;
    color: var(--text-muted);
    text-align: center;
    padding: 1rem 0;
  }
  .status-msg.error { color: var(--accent-red); }

  /* -- Prompt item -- */
  .prompt-item {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    gap: 0.125rem 0.5rem;
    align-items: start;
    padding: 0.375rem 0.375rem;
    border: none;
    border-top: 1px solid var(--border);
    background: none;
    color: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    width: 100%;
  }
  .prompt-item:first-child { border-top: none; }
  .prompt-item:hover { background: var(--bg-tertiary); }

  .prompt-text {
    grid-column: 1;
    grid-row: 1;
    font-size: 0.6875rem;
    line-height: 1.35;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .compact .prompt-text {
    font-size: 0.625rem;
    -webkit-line-clamp: 1;
  }

  .prompt-meta {
    grid-column: 1;
    grid-row: 2;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.625rem;
    color: var(--text-muted);
    margin-top: 0.0625rem;
  }
  .compact .prompt-meta { font-size: 0.5625rem; }

  .prompt-project {
    color: var(--accent-blue);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 8rem;
  }
  .prompt-time { white-space: nowrap; }
  .prompt-session {
    font-family: "SF Mono", "Cascadia Code", monospace;
    font-size: 0.5625rem;
    color: var(--text-muted);
    opacity: 0.7;
  }

  /* -- Star button -- */
  .star-btn {
    grid-column: 2;
    grid-row: 1 / 3;
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 0.875rem;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    flex-shrink: 0;
  }
  .star-btn:hover { background: var(--bg-tertiary); color: var(--accent-yellow); }
  .star-btn.starred { color: var(--accent-yellow); }
  .compact .star-btn { width: 1.25rem; height: 1.25rem; font-size: 0.75rem; }

  /* -- Load more -- */
  .load-more-btn {
    align-self: center;
    margin-top: 0.375rem;
    padding: 0.25rem 0.75rem;
    font-size: 0.625rem;
    font-family: inherit;
    color: var(--accent-blue);
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .load-more-btn:hover { background: var(--bg-tertiary); }
  .load-more-btn:disabled {
    color: var(--text-muted);
    cursor: default;
  }

  /* -- Animations -- */
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* -- Mobile -- */
  @media (max-width: 768px) {
    .prompt-list { max-height: 18rem; }
    .compact .prompt-list { max-height: 12rem; }
    .prompt-text { font-size: 0.625rem; }
    .prompt-meta { font-size: 0.5625rem; }
    .star-btn { width: 1.25rem; height: 1.25rem; font-size: 0.75rem; }
  }
</style>
